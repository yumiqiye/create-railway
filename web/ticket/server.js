/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/**
 * 12306 购票系统后端（Node.js 原生实现，无第三方依赖）
 * 统一响应体：{ code: 200, result: any, message: 'ok' }
 * 同时兼容 /api/xxx 与 /xxx 两种前缀（Vite 代理会去掉 /api）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { WebSocketServer } = require('ws');
const { getDB, saveDB, refreshDB, resetDB, DEFAULT_SETTINGS, hashPassword, DB_PATH } = require('./db');
const { loadConfig } = require('../shared/config');
const { makePayload, parsePayload, sign } = require('../shared/ticket-qr');
const { planTransfers } = require('../shared/transfer-planner');
const { allocateSeats, bitmapFromOrders } = require('../shared/seat-alloc');
const { RateLimiter, TokenBucket } = require('../shared/rate-limit');

const RUN_DIR =
  process.env.QJ_ROOT_DIR || (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));
const CONFIG = loadConfig(process.env.QJ_CONFIG_DIR || RUN_DIR);
const TICKET_CFG = CONFIG.ticket || {};
const SHARED_CFG = CONFIG.shared || {};
const PORT = Number(process.env.PORT || TICKET_CFG.port || 3000);
const ADMIN_PORT = Number((CONFIG.admin || {}).port || 8001);
function paymentTimeoutMs(db) {
  const minutes = Number((db && db.settings && db.settings.paymentTimeoutMinutes) || 15);
  const safe = Number.isFinite(minutes) ? Math.min(120, Math.max(1, Math.round(minutes))) : 15;
  return safe * 60 * 1000;
}

/* 越站补票用的线路里程：按车次号配置，未配置的车次只支持起终点 */
const TRAIN_STOP_PLANS = {
  G2250: [['北京南', 0], ['南京南', 1023], ['上海虹桥', 1323]],
  G101: [['北京南', 0], ['南京南', 1023]],
  G701: [['南京南', 0], ['上海虹桥', 300]],
  G7001: [['南京南', 0], ['上海虹桥', 300]],
  G7022: [['南京南', 0], ['上海虹桥', 300]],
};
const PUBLIC_DIR = path.join(process.env.QJ_ROOT_DIR || path.join(__dirname, '..'), 'ticket', 'public');
const QR_SECRET = String(SHARED_CFG.qr_secret || 'change-me-in-config');
const QR_TTL = Number(SHARED_CFG.qr_ttl || 90);

const HCAPTCHA_CFG = CONFIG.hCaptcha || CONFIG.hcaptcha || {};
let hcaptchaSiteKey = process.env.HCAPTCHA_SITE_KEY || String(HCAPTCHA_CFG.siteKey || '');
let hcaptchaSecret = process.env.HCAPTCHA_SECRET || String(HCAPTCHA_CFG.secret || '');
const hcaptchaEnabled = HCAPTCHA_CFG.enabled !== false && Boolean(hcaptchaSiteKey && hcaptchaSecret);

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || (req.socket && req.socket.remoteAddress) || '';
  return ip.replace(/^::ffff:/, '');
}

const rateLimiter = new RateLimiter();
const ipViolations = new Map();
const RATE_POLICIES = {
  login: { capacity: 8, refillPerSecond: 0.1, blockAfter: 12, blockMs: 10 * 60 * 1000 },
  search: { capacity: 40, refillPerSecond: 0.6, blockAfter: 30, blockMs: 10 * 60 * 1000 },
  order: { capacity: 20, refillPerSecond: 0.2, blockAfter: 20, blockMs: 10 * 60 * 1000 },
  captcha: { capacity: 30, refillPerSecond: 0.4, blockAfter: 30, blockMs: 10 * 60 * 1000 },
  default: { capacity: 240, refillPerSecond: 4, blockAfter: 60, blockMs: 10 * 60 * 1000 },
};

function securityState(db) {
  if (!db.security) db.security = { blockedIps: [] };
  if (!Array.isArray(db.security.blockedIps)) db.security.blockedIps = [];
  return db.security;
}

function blockedIpInfo(db, ip) {
  const sec = securityState(db);
  const now = Date.now();
  sec.blockedIps = sec.blockedIps.filter((row) => Number(row.until) > now);
  return sec.blockedIps.find((row) => row.ip === ip) || null;
}

function policyFor(pathname, method) {
  if (/accounts\/login|agent\/login/.test(pathname)) return RATE_POLICIES.login;
  if (pathname.includes('captcha')) return RATE_POLICIES.captcha;
  if (pathname.includes('public/search')) return RATE_POLICIES.search;
  if (pathname.includes('public/orders') && method === 'POST') return RATE_POLICIES.order;
  return RATE_POLICIES.default;
}

function rejectTooMany(res, retryAfter) {
  res.writeHead(429, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': String(Math.max(1, retryAfter || 1)),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ code: 429, result: null, message: '请求过于频繁，请稍后再试' }));
}

function enforceRateLimit(req, res, pathname, method) {
  if (method === 'OPTIONS') return true;
  const db = getDB();
  const ip = clientIp(req) || 'unknown';
  const blocked = blockedIpInfo(db, ip);
  if (blocked) {
    rejectTooMany(res, Math.ceil((Number(blocked.until) - Date.now()) / 1000));
    return false;
  }
  const policy = policyFor(pathname, method);
  const result = rateLimiter.hit(ip, policy, 1);
  if (result.allowed) return true;

  const count = (ipViolations.get(ip) || 0) + 1;
  ipViolations.set(ip, count);
  if (count >= policy.blockAfter) {
    const sec = securityState(db);
    const now = Date.now();
    sec.blockedIps = sec.blockedIps.filter((row) => Number(row.until) > now);
    sec.blockedIps.push({ ip, until: now + policy.blockMs, reason: '高频请求超限', at: new Date(now).toISOString() });
    ipViolations.delete(ip);
    addLog(db, {
      action: 'security.ip_block',
      actor: 'system',
      role: 'system',
      target: ip,
      detail: `连续 ${count} 次触发限流，封禁 ${Math.round(policy.blockMs / 60000)} 分钟`,
      level: 'warn',
    });
    saveDB();
  } else if (count === 1 || count % 5 === 0) {
    addLog(db, {
      action: 'security.rate_limit',
      actor: 'system',
      role: 'system',
      target: ip,
      detail: `触发限流 ${count} 次：${method} ${pathname}`,
      level: 'warn',
    });
    saveDB();
  }
  rejectTooMany(res, result.retryAfter);
  return false;
}

async function verifyHcaptcha(response, req) {
  const body = new URLSearchParams();
  body.set('secret', hcaptchaSecret);
  body.set('response', response);
  body.set('sitekey', hcaptchaSiteKey);
  const ip = clientIp(req);
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://api.hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`hCaptcha 服务返回 ${res.status}`);
  return res.json();
}

/* ---------------- 登录态 / 验证码（内存存储） ---------------- */
const userTokens = new Map(); // token -> { userId, expire }
const adminTokens = new Map(); // token -> { accountId, role, expire }
const captchaTokens = new Map(); // token -> expire
const faceTokens = new Map(); // token -> { id, expire }

const TOKEN_TTL = 12 * 60 * 60 * 1000;
const CAPTCHA_TOKEN_TTL = 20 * 60 * 1000;

function newToken(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('hex')}`;
}

function issueToken(store, id, extra = {}) {
  const token = newToken('tk');
  store.set(token, { id, expire: Date.now() + TOKEN_TTL, ...extra });
  return token;
}

function readToken(req) {
  return String(req.headers['x-token'] || req.headers['token'] || '');
}

function issueFaceToken(userId) {
  const token = newToken('face');
  faceTokens.set(token, { id: userId, expire: Date.now() + 10 * 60 * 1000 });
  return token;
}

function normalizeFaceDescriptor(input) {
  if (!Array.isArray(input) || input.length !== 128) return null;
  const out = [];
  for (const value of input) {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > 2) return null;
    out.push(Number(n.toFixed(4)));
  }
  return out;
}

function faceDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Number(a[i]) - Number(b[i]);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function userOf(db, req) {
  const token = readToken(req);
  const item = token && userTokens.get(token);
  if (!item || item.expire < Date.now()) return null;
  const user = db.users.find((u) => u.id === item.id);
  return user || null;
}

function accountOf(db, req) {
  const token = readToken(req);
  const item = token && adminTokens.get(token);
  if (!item || item.expire < Date.now()) return null;
  const account = db.accounts.find((a) => a.id === item.id);
  return account || null;
}

function permissionsForRole(role) {
  const labels = {
    ticket_overview: '总览',
    ticket_cities: '城市管理',
    ticket_stations: '车站管理',
    ticket_trains: '车次管理',
    ticket_tickets: '车票管理',
    ticket_checkin: '检票管理',
    ticket_alerts: '告警中心',
    ticket_reports: '运营报表',
    ticket_settings: '系统设置',
    ticket_logs: '日志管理',
    ticket_orders: '订单管理',
    ticket_orders_manage: '订单处理',
    ticket_orders_delete: '删除订单记录',
    ticket_sales: '售票窗口',
    ticket_supplement: '补票管理',
    ticket_invoices: '发票管理',
    ticket_fares: '票价管理',
    ticket_bureaus: '铁路局管理',
    ticket_about: '关于',
  };
  const allowed =
    role === 'admin'
      ? Object.keys(labels)
      : role === 'operator'
        ? ['ticket_overview', 'ticket_orders', 'ticket_orders_manage', 'ticket_sales', 'ticket_about']
        : ['ticket_overview', 'ticket_orders', 'ticket_checkin', 'ticket_alerts', 'ticket_about'];
  return allowed.map((value) => ({ label: labels[value], value }));
}

function requireAccountRole(db, res, req, roles) {
  const account = accountOf(db, req);
  if (!account) {
    fail(res, 401, '后台登录已失效，请重新登录');
    return null;
  }
  if (account.enabled === false) {
    fail(res, 403, '该账号已停用，请联系管理员');
    return null;
  }
  if (roles && !roles.includes(account.role)) {
    fail(res, 403, '当前账号无权执行该操作');
    return null;
  }
  return account;
}

function requireUser(db, res, req) {
  const user = userOf(db, req);
  if (!user) fail(res, 401, '请先登录后操作');
  return user;
}

function captchaValid(req) {
  const token = String(req.headers['x-captcha'] || '');
  const expire = captchaTokens.get(token);
  return Boolean(expire && expire > Date.now());
}

function requireCaptcha(res, req) {
  if (captchaValid(req)) return true;
  fail(res, 400, '请先完成 hCaptcha 人机验证');
  return false;
}

/* ---------------- 审计日志 / 实时推送 ---------------- */
const wsClients = new Set();

/* 闸机心跳：只写内存，避免每台闸机每 5 秒全量读写 db.json */
const DEVICE_ONLINE_MS = 30 * 1000;
const devicePresence = new Map();
const deviceOnlineState = new Map();
let deviceBroadcastTimer = null;

function deviceKey(stationId, gateNo) {
  return `${String(stationId || '')}::${String(gateNo || '')}`;
}

function lastSeenMs(value) {
  const ms = value ? Date.parse(value) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function isDeviceOnline(value) {
  return Date.now() - lastSeenMs(value) <= DEVICE_ONLINE_MS;
}

function remoteConfigOf(device, db) {
  const base = {
    gateType: device.gateType || 'checkin',
    status: device.status || 'normal',
    maintenanceText: device.maintenanceText || ((db.settings || {}).maintenanceText || ''),
    mode: 'auto',
    cameraEnabled: true,
    showScanPreview: false,
    welcomeText: '',
  };
  return { ...base, ...(device.remoteConfig || {}) };
}

function decorateDevice(device, db) {
  const p = devicePresence.get(deviceKey(device.stationId, device.gateNo));
  const lastSeenAt = (p && p.lastSeenAt) || device.lastSeenAt || '';
  const configVersion = Number(device.configVersion || 0);
  return {
    ...device,
    online: isDeviceOnline(lastSeenAt),
    lastSeenAt,
    clientVersion: (p && p.clientVersion) || device.clientVersion || '',
    reportedGateType: (p && p.gateType) || device.reportedGateType || '',
    configVersion,
    configUpdatedAt: device.configUpdatedAt || '',
    configAckVersion: Number(device.configAckVersion || 0),
    configAckedAt: device.configAckedAt || '',
    configError: device.configError || '',
    remoteConfig: remoteConfigOf(device, db),
  };
}

function decoratedDevices(db) {
  return (db.devices || []).map((device) => decorateDevice(device, db));
}

function scheduleDeviceBroadcast(db) {
  if (deviceBroadcastTimer) return;
  deviceBroadcastTimer = setTimeout(() => {
    deviceBroadcastTimer = null;
    try {
      broadcast('devices', decoratedDevices(db));
    } catch (e) { /* ignore */ }
  }, 400);
  if (deviceBroadcastTimer.unref) deviceBroadcastTimer.unref();
}

function touchDevicePresence(db, input) {
  const stationId = String(input.stationId || '');
  const gateNo = String(input.gateNo || '').trim().slice(0, 20);
  if (!gateNo) return null;
  const now = new Date().toISOString();
  const key = deviceKey(stationId, gateNo);
  const previous = devicePresence.get(key) || {};
  const row = {
    ...previous,
    stationId,
    gateNo,
    lastSeenAt: now,
    gateType: String(input.gateType || previous.gateType || 'checkin').slice(0, 12),
    clientVersion: String(input.clientVersion || previous.clientVersion || '').slice(0, 40),
  };
  devicePresence.set(key, row);
  const device = (db.devices || []).find((d) => d.stationId === stationId && d.gateNo === gateNo);
  if (!device && stationId) {
    const station = (db.stations || []).find((s) => s.id === stationId);
    if (station) {
      const created = {
        id: newId('dev'),
        stationId,
        gateNo,
        name: gateNo,
        gateType: input.gateType === 'entry' || input.gateType === 'exit' ? input.gateType : 'checkin',
        status: 'normal',
        maintenanceText: (db.settings || {}).maintenanceText || '',
        lastSeenAt: now,
        createdAt: now,
        configVersion: 0,
        autoRegistered: true,
      };
      db.devices = [...(db.devices || []), created];
    }
  }
  if (device) {
    device.lastSeenAt = now;
    if (input.configVersion !== undefined) {
      const applied = Number(input.configVersion || 0);
      if (applied >= Number(device.configVersion || 0)) {
        device.configAckVersion = applied;
        device.configAckedAt = now;
        device.configError = '';
      }
    }
    if (input.configError) device.configError = String(input.configError).slice(0, 120);
  }
  return { key, online: true };
}

function addLog(db, entry) {
  const row = {
    id: newId('log'),
    at: new Date().toISOString(),
    action: String(entry.action || 'unknown'),
    actor: String(entry.actor || 'system'),
    role: String(entry.role || ''),
    target: String(entry.target || ''),
    detail: String(entry.detail || ''),
    level: String(entry.level || 'info'),
  };
  db.logs = [row, ...(db.logs || [])].slice(0, 2000);
  return row;
}

function alertSummary(db) {
  const rows = db.alerts || [];
  const openRows = rows.filter((a) => a.status === 'open');
  return {
    open: openRows.length,
    ack: rows.filter((a) => a.status === 'ack').length,
    ignored: rows.filter((a) => a.status === 'ignored').length,
    resolved: rows.filter((a) => a.status === 'resolved').length,
    critical: openRows.filter((a) => a.level === 'error').length,
    warn: openRows.filter((a) => a.level === 'warn').length,
  };
}

/*
 * 告警去重：同类型 + 同目标在未确认/未忽略期间不重复生成，
 * 只累加次数并刷新最后发生时间；每分钟最多写一次库。
 */
function addAlert(db, entry) {
  const now = new Date().toISOString();
  const type = String(entry.type || 'system').slice(0, 40);
  const target = String(entry.target || '').slice(0, 80);
  const detail = String(entry.detail || '').slice(0, 240);
  const level = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info';
  const existing = (db.alerts || []).find(
    (a) => a.type === type && a.target === target && (a.status === 'open' || a.status === 'ack')
  );
  if (existing) {
    const last = Date.parse(existing.lastAt || existing.at || '');
    if (Number.isFinite(last) && Date.now() - last < 60 * 1000 && existing.detail === detail) {
      return { alert: existing, changed: false };
    }
    existing.lastAt = now;
    existing.count = Number(existing.count || 1) + 1;
    existing.detail = detail || existing.detail;
    existing.level = level;
    return { alert: existing, changed: true };
  }
  const row = {
    id: newId('alert'),
    at: now,
    lastAt: now,
    type,
    level,
    title: String(entry.title || type).slice(0, 80),
    detail,
    target,
    source: String(entry.source || 'system').slice(0, 80),
    status: 'open',
    count: 1,
  };
  db.alerts = [row, ...(db.alerts || [])].slice(0, 1000);
  return { alert: row, changed: true };
}

function resolveAlerts(db, type, target) {
  let changed = false;
  for (const row of db.alerts || []) {
    if (row.type === type && (!target || row.target === target) && (row.status === 'open' || row.status === 'ack')) {
      row.status = 'resolved';
      row.resolvedAt = new Date().toISOString();
      changed = true;
    }
  }
  return changed;
}

function alertsPayload(db) {
  return {
    summary: alertSummary(db),
    rows: (db.alerts || [])
      .filter((a) => a.status === 'open' || a.status === 'ack')
      .slice(0, 60),
  };
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, at: new Date().toISOString(), payload: payload || {} });
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch (e) { /* ignore */ }
    }
  }
}

function liveSnapshot(db) {
  const today = todayStr();
  const paid = (db.orders || []).filter((o) => o.date === today && o.status === 'paid');
  const devices = decoratedDevices(db);
  return {
    today,
    wsUrl: `ws://localhost:${PORT}/ws`,
    devices,
    onlineDeviceCount: devices.filter((d) => d.online).length,
    orders: paid.slice(0, 60).map((o) => ({
      orderNo: o.orderNo,
      trainNo: o.trainNo,
      date: o.date,
      seatType: o.seatType,
      passengers: (o.passengers || []).map((p) => ({
        name: p.name,
        idNo: p.idNo,
        checkedIn: !!p.checkedIn,
        checkedInAt: p.checkedInAt || '',
        exception: p.exception || '',
      })),
      checkedCount: (o.passengers || []).filter((p) => p.checkedIn).length,
      passengerCount: (o.passengers || []).length,
      checkedIn: !!o.checkedIn,
    })),
    events: (db.checkinEvents || []).slice(0, 40),
    logs: (db.logs || []).slice(0, 30),
    alerts: alertsPayload(db),
  };
}

/* ---------------- 运营报表 ---------------- */
function dateRangeList(from, to) {
  const list = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return list;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    list.push(d.toISOString().slice(0, 10));
  }
  return list;
}

function orderPassengerCount(order) {
  return (order.passengers || []).length || 1;
}

function buildOperationsReport(db, from, to) {
  const range = dateRangeList(from, to);
  const trainById = new Map((db.trains || []).map((t) => [t.id, t]));
  const stationById = new Map((db.stations || []).map((s) => [s.id, s]));
  const orders = (db.orders || []).filter((o) => o.date >= from && o.date <= to);
  const summary = {
    orders: 0,
    paidOrders: 0,
    refundOrders: 0,
    canceledOrders: 0,
    ticketsSold: 0,
    validTickets: 0,
    refundTickets: 0,
    grossRevenue: 0,
    validRevenue: 0,
    refundAmount: 0,
    netRevenue: 0,
    checkedPassengers: 0,
    checkinRate: 0,
    avgTicketPrice: 0,
    trainCount: 0,
    stationCount: 0,
  };
  const dayMap = new Map(range.map((date) => [date, {
    date, orders: 0, paidOrders: 0, refundOrders: 0, canceledOrders: 0,
    ticketsSold: 0, validTickets: 0, refundTickets: 0,
    grossRevenue: 0, validRevenue: 0, refundAmount: 0, netRevenue: 0,
    checkedPassengers: 0, checkinRate: 0,
  }]));
  const stationMap = new Map();
  const trainMap = new Map();
  const seatMap = new Map();
  const channelMap = new Map();
  const trainIds = new Set();
  const stationIds = new Set();

  const bucket = (map, key, label, extra) => {
    if (!map.has(key)) map.set(key, { key, label, orders: 0, ticketsSold: 0, validTickets: 0, refundTickets: 0, grossRevenue: 0, refundAmount: 0, checkedPassengers: 0, ...(extra || {}) });
    return map.get(key);
  };

  for (const order of orders) {
    const train = trainById.get(order.trainId);
    const n = orderPassengerCount(order);
    const checked = (order.passengers || []).filter((p) => p.checkedIn).length;
    const gross = Number(order.totalPrice || 0);
    const refund = Number(order.refundAmount || 0);
    const paid = order.status === 'paid';
    const refunded = order.status === 'refunded';
    const canceled = order.status === 'canceled';
    const day = dayMap.get(order.date);
    if (train) {
      trainIds.add(train.id);
      stationIds.add(train.fromStationId);
    }
    summary.orders += 1;
    summary.ticketsSold += n;
    if (paid) {
      summary.paidOrders += 1;
      summary.validTickets += n;
      summary.validRevenue += gross;
      summary.checkedPassengers += checked;
    }
    if (refunded) {
      summary.refundOrders += 1;
      summary.refundTickets += n;
      summary.refundAmount += refund;
    }
    if (canceled) summary.canceledOrders += 1;
    if (!canceled) summary.grossRevenue += gross;
    if (day) {
      day.orders += 1;
      day.ticketsSold += n;
      if (paid) { day.paidOrders += 1; day.validTickets += n; day.validRevenue += gross; day.checkedPassengers += checked; }
      if (refunded) { day.refundOrders += 1; day.refundTickets += n; day.refundAmount += refund; }
      if (canceled) day.canceledOrders += 1;
      if (!canceled) day.grossRevenue += gross;
    }
    if (train) {
      const st = bucket(stationMap, train.fromStationId, (stationById.get(train.fromStationId) || {}).name || train.fromStationId);
      st.orders += 1; st.ticketsSold += n;
      if (paid) { st.validTickets += n; st.checkedPassengers += checked; }
      if (refunded) st.refundTickets += n;
      if (!canceled) st.grossRevenue += gross;
      if (refunded) st.refundAmount += refund;
      const tr = bucket(trainMap, train.trainNo, train.trainNo, {
        fromStationName: (stationById.get(train.fromStationId) || {}).name || '',
        toStationName: (stationById.get(train.toStationId) || {}).name || '',
        departTime: train.departTime || '',
        tripDates: [],
      });
      tr.orders += 1; tr.ticketsSold += n;
      if (paid) { tr.validTickets += n; tr.checkedPassengers += checked; }
      if (refunded) tr.refundTickets += n;
      if (!canceled) tr.grossRevenue += gross;
      if (refunded) tr.refundAmount += refund;
      tr.tripDates = Array.from(new Set((Array.isArray(tr.tripDates) ? tr.tripDates : []).concat([order.date])));
    }
    const seat = bucket(seatMap, order.seatType || '未指定', order.seatType || '未指定');
    seat.orders += 1; seat.ticketsSold += n;
    if (paid) seat.validTickets += n;
    if (refunded) seat.refundTickets += n;
    if (!canceled) seat.grossRevenue += gross;
    if (refunded) seat.refundAmount += refund;
    const channelKey = order.source === 'counter' ? 'counter' : order.source === 'agent' ? 'agent' : 'web';
    const channel = bucket(channelMap, channelKey, channelKey === 'counter' ? '售票窗口' : channelKey === 'agent' ? '代售' : '线上购票');
    channel.orders += 1; channel.ticketsSold += n;
    if (paid) channel.validTickets += n;
    if (refunded) channel.refundTickets += n;
    if (!canceled) channel.grossRevenue += gross;
  }

  for (const day of dayMap.values()) {
    day.netRevenue = day.grossRevenue - day.refundAmount;
    day.checkinRate = day.validTickets ? Number(((day.checkedPassengers / day.validTickets) * 100).toFixed(1)) : 0;
  }
  for (const row of [...stationMap.values(), ...trainMap.values(), ...seatMap.values(), ...channelMap.values()]) {
    row.netRevenue = row.grossRevenue - row.refundAmount;
    row.checkinRate = row.validTickets ? Number(((row.checkedPassengers / row.validTickets) * 100).toFixed(1)) : 0;
  }
  summary.netRevenue = Number((summary.grossRevenue - summary.refundAmount).toFixed(2));
  summary.grossRevenue = Number(summary.grossRevenue.toFixed(2));
  summary.validRevenue = Number(summary.validRevenue.toFixed(2));
  summary.refundAmount = Number(summary.refundAmount.toFixed(2));
  summary.netRevenue = Number(summary.netRevenue.toFixed(2));
  summary.checkinRate = summary.validTickets ? Number(((summary.checkedPassengers / summary.validTickets) * 100).toFixed(1)) : 0;
  summary.avgTicketPrice = summary.validTickets ? Number((summary.validRevenue / summary.validTickets).toFixed(2)) : 0;
  summary.trainCount = trainIds.size;
  summary.stationCount = stationIds.size;

  return {
    from,
    to,
    summary,
    daily: [...dayMap.values()],
    stations: [...stationMap.values()].sort((a, b) => b.grossRevenue - a.grossRevenue),
    trains: [...trainMap.values()]
      .map((row) => ({ ...row, tripDates: Array.isArray(row.tripDates) ? row.tripDates.length : Number(row.tripDates || 0) }))
      .sort((a, b) => b.grossRevenue - a.grossRevenue),
    seatTypes: [...seatMap.values()].sort((a, b) => b.ticketsSold - a.ticketsSold),
    channels: [...channelMap.values()].sort((a, b) => b.ticketsSold - a.ticketsSold),
  };
}

/* ---------------- 候车大屏 ---------------- */
function buildScreenData(db, stationId, date) {
  const now = new Date();
  const station = (db.stations || []).find((s) => s.id === stationId) || (db.stations || [])[0] || null;
  const settings = db.settings || {};
  const checkinMinutes = Number(settings.checkinMinutes || 30);
  const trains = (db.trains || [])
    .filter((t) => !station || t.fromStationId === station.id)
    .slice()
    .sort((a, b) => String(a.departTime || '').localeCompare(String(b.departTime || '')));
  const rows = [];
  let totalPassengers = 0;
  let totalChecked = 0;
  let stationOnline = 0;
  if (station) {
    stationOnline = decoratedDevices(db).filter((d) => d.stationId === station.id && d.online).length;
  }
  for (const train of trains.slice(0, 14)) {
    let passengers = 0;
    let checked = 0;
    for (const order of db.orders || []) {
      if (order.date !== date || order.trainId !== train.id || order.status !== 'paid') continue;
      passengers += orderPassengerCount(order);
      checked += (order.passengers || []).filter((p) => p.checkedIn).length;
    }
    totalPassengers += passengers;
    totalChecked += checked;
    const runtime = trainRuntime(train, date);
    const dep = new Date(`${date}T${runtime.departTime || '00:00'}:00`);
    const openAt = new Date(dep.getTime() - checkinMinutes * 60000);
    let status = 'waiting';
    let statusText = '候车';
    if (!Number.isNaN(dep.getTime())) {
      if (now >= dep) { status = 'closed'; statusText = '已发车'; }
      else if (now >= openAt) { status = 'boarding'; statusText = '正在检票'; }
    }
    if (runtime.status === 'cancelled') { status = 'cancelled'; statusText = '停运'; }
    else if (runtime.status === 'maintenance') { status = 'maintenance'; statusText = '暂停检票'; }
    else if (runtime.status === 'delayed') {
      statusText = runtime.statusText || `晚点 ${runtime.delayMinutes} 分钟`;
      if (status === 'boarding') statusText = `正在检票 · 晚点 ${runtime.delayMinutes} 分钟`;
      else if (status === 'closed') statusText = `已发车 · 晚点 ${runtime.delayMinutes} 分钟`;
    }
    rows.push({
      trainNo: train.trainNo,
      type: train.type || '',
      fromStationName: (db.stations || []).find((s) => s.id === train.fromStationId)?.name || '',
      toStationName: (db.stations || []).find((s) => s.id === train.toStationId)?.name || '',
      departTime: runtime.departTime || '',
      baseDepartTime: runtime.baseDepartTime,
      arriveTime: train.arriveTime || '',
      platform: runtime.platform,
      gates: runtime.gates,
      gate: runtime.gate,
      basePlatform: runtime.basePlatform,
      baseGate: runtime.baseGate,
      tempGate: runtime.tempGate,
      tempPlatform: runtime.tempPlatform,
      runtimeOverridden: runtime.overridden,
      landmarkColor: train.landmarkColor || '',
      status,
      statusText,
      delayMinutes: runtime.delayMinutes,
      runtimeNote: runtime.runtimeNote,
      passengers,
      checked,
      checkinRate: passengers ? Number(((checked / passengers) * 100).toFixed(1)) : 0,
      checkinMinutes,
    });
  }
  return {
    now: now.toISOString(),
    date,
    station: station ? { id: station.id, name: station.name, code: station.code || '', address: station.address || '' } : null,
    stations: (db.stations || []).map((s) => ({ id: s.id, name: s.name, code: s.code || '' })),
    trains: rows,
    stats: {
      passengers: totalPassengers,
      checked: totalChecked,
      checkinRate: totalPassengers ? Number(((totalChecked / totalPassengers) * 100).toFixed(1)) : 0,
      onlineDevices: stationOnline,
    },
    settings: {
      siteName: settings.siteName || '清江铁路12306',
      announcement: settings.announcementEnabled === false ? '' : settings.announcement || '',
      footerCopyright: settings.footerCopyright || '',
      footerIcp: settings.footerIcp || '',
      checkinMinutes,
    },
  };
}


/* ---------------- 时间与费用 ---------------- */
function departureAt(order, train) {
  if (!train) return null;
  const runtime = trainRuntime(train, order.date);
  const d = new Date(`${order.date}T${runtime.departTime}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 距发车小时数，已发车返回负数 */
function hoursToDeparture(order, train) {
  const dep = departureAt(order, train);
  if (!dep) return null;
  return (dep.getTime() - Date.now()) / 3600000;
}

/** 依据后台设置计算退票手续费；已过发车时间返回错误信息 */
function calcRefundFee(db, order, train) {
  const hours = hoursToDeparture(order, train);
  if (hours === null) return { error: '车次信息缺失，无法计算退票手续费' };
  if (hours < 0) return { error: '列车已发车，不能退票' };
  const rules = ((db.settings && db.settings.refundRules) || DEFAULT_SETTINGS.refundRules)
    .slice()
    .sort((a, b) => b.hoursBefore - a.hoursBefore);
  const rule = rules.find((r) => hours >= Number(r.hoursBefore)) || { feeRate: 0 };
  const feeRate = Number(rule.feeRate) || 0;
  const fee = Number(((order.totalPrice || 0) * feeRate).toFixed(2));
  return {
    feeRate,
    fee,
    refundAmount: Number(Math.max(0, (order.totalPrice || 0) - fee).toFixed(2)),
    hoursBefore: Number(rule.hoursBefore),
    hours: Number(hours.toFixed(1)),
  };
}

function passengerPrice(seat, type, settings) {
  if (type === '儿童') {
    const discount = settings && Number.isFinite(Number(settings.childDiscount)) ? Number(settings.childDiscount) : 0.5;
    return Number((seat.price * discount).toFixed(2));
  }
  return Number(seat.price);
}


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/* ---------------- 基础工具 ---------------- */

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function ok(res, result = null, message = 'ok') {
  sendJSON(res, 200, { code: 200, result, message });
}

function fail(res, status, message) {
  sendJSON(res, status, { code: status, result: null, message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

const pad = (n) => String(n).padStart(2, '0');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str || '')) return false;
  const d = new Date(str + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && str === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidTime(str) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(str || '')) return false;
  return true;
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function durationMinutes(dep, arr) {
  let d = toMinutes(arr) - toMinutes(dep);
  if (d < 0) d += 1440;
  return d;
}

function durationText(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}分`;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function genOrderNo() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `E${stamp}${rand}`;
}

/* 身份证 18 位校验 */
function isValidIdCard(value) {
  if (!/^\d{17}[\dXx]$/.test(value || '')) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(value[i]) * weights[i];
  return codes[sum % 11] === value[17].toUpperCase();
}

function isValidPhone(value) {
  return /^1[3-9]\d{9}$/.test(value || '');
}

/* ---------------- 业务辅助 ---------------- */

function findStation(db, id) {
  return db.stations.find((s) => s.id === id);
}

function findCity(db, id) {
  return db.cities.find((c) => c.id === id);
}

function orderHoldsSeat(order) {
  if (!order || order.seatHolding === false) return false;
  if (order.status === 'paid') return true;
  if (order.status === 'pending') {
    const deadline = Date.parse(order.paymentDeadline || '');
    return !Number.isFinite(deadline) || deadline > Date.now();
  }
  return false;
}

function soldCount(db, trainId, date, seatType) {
  return db.orders
    .filter((o) => o.trainId === trainId && o.date === date && o.seatType === seatType && orderHoldsSeat(o))
    .reduce((sum, o) => sum + (o.passengers ? o.passengers.length : 1), 0);
}

/** 某车次某天某席别的可售票额：优先取「车票管理」里设置的票额，否则取车次定员 */
function quotaOf(db, trainId, date, seatType, fallbackTotal) {
  const row = (db.quotas || []).find((q) => q.trainId === trainId && q.date === date);
  const item = row && (row.seats || []).find((s) => s.type === seatType);
  return item && Number.isFinite(item.quota) ? item.quota : fallbackTotal;
}

/**
 * 用位图给一笔订单分配座位。
 * 占用位从已支付订单的 seatIndex 重建，保证退票/取消后座位可再次分配。
 */
function assignSeatsToPassengers(db, train, date, seatType, passengers) {
  const seat = (train.seats || []).find((s) => s.type === seatType);
  if (!seat) return null;
  const capacity = Math.max(Number(seat.total) || 0, quotaOf(db, train.id, date, seatType, seat.total));
  const bitmap = bitmapFromOrders(db.orders, train.id, date, seatType, capacity);
  const result = allocateSeats(seatType, capacity, bitmap, passengers.length);
  if (result.seats.length < passengers.length) {
    return { error: `该车次 ${seatType} 可用座位不足` };
  }
  passengers.forEach((p, i) => {
    const assigned = result.seats[i];
    p.seatNo = assigned.label;
    p.seatIndex = assigned.index;
  });
  if (!Array.isArray(db.seatMaps)) db.seatMaps = [];
  let row = db.seatMaps.find((m) => m.trainId === train.id && m.date === date && m.seatType === seatType);
  if (!row) {
    row = { id: newId('sm'), trainId: train.id, date, seatType, capacity };
    db.seatMaps.push(row);
  }
  row.capacity = capacity;
  row.bits = result.bitmap.toBase64();
  row.occupied = result.bitmap.count();
  row.updatedAt = new Date().toISOString();
  return { seats: result.seats, row };
}

function seatAvailability(db, train, date) {
  const seats = (train.seats || []).map((s) => {
    const sold = soldCount(db, train.id, date, s.type);
    const total = quotaOf(db, train.id, date, s.type, s.total);
    return {
      type: s.type,
      price: s.price,
      total,
      capacity: s.total,
      sold,
      remaining: Math.max(0, total - sold),
    };
  });
  return seats;
}

/** 车次停靠站与累计里程；未单独配置的车次只返回起终点 */
function trainStops(db, train) {
  const plan = Array.isArray(train.stops)
    ? train.stops
    : TRAIN_STOP_PLANS[train.trainNo];
  const byName = (name) => (db.stations || []).find((s) => s.name === name);
  let stops = [];
  if (Array.isArray(plan) && plan.length) {
    stops = plan
      .map((item) => {
        if (Array.isArray(item)) {
          const station = byName(String(item[0]));
          return station ? { stationId: station.id, name: station.name, km: Number(item[1]) || 0 } : null;
        }
        const station = findStation(db, item.stationId);
        return station ? { stationId: station.id, name: station.name, km: Number(item.km) || 0 } : null;
      })
      .filter(Boolean);
  }
  if (stops.length >= 2) return stops;
  const from = findStation(db, train.fromStationId);
  const to = findStation(db, train.toStationId);
  return [
    from ? { stationId: from.id, name: from.name, km: 0 } : null,
    to ? { stationId: to.id, name: to.name, km: 1 } : null,
  ].filter(Boolean);
}

/** 计算越站区段补差票价：全程票价 × 越站区段里程 / 全程里程 */
function quoteSegmentFare(db, train, seatType, fromStationId, toStationId) {
  const stops = trainStops(db, train);
  const fromIdx = stops.findIndex((s) => s.stationId === fromStationId);
  const toIdx = stops.findIndex((s) => s.stationId === toStationId);
  if (fromIdx < 0 || toIdx < 0) return { error: '所选停靠站不在该车次线路中' };
  if (toIdx <= fromIdx) return { error: '越站到站必须晚于原到站' };
  const seat = (train.seats || []).find((s) => s.type === seatType);
  if (!seat) return { error: '该车次没有此席别' };
  const totalKm = stops[stops.length - 1].km - stops[0].km;
  const segmentKm = stops[toIdx].km - stops[fromIdx].km;
  if (!(totalKm > 0) || !(segmentKm > 0)) return { error: '该车次暂未配置可计算的里程' };
  const fare = Number((seat.price * segmentKm / totalKm).toFixed(2));
  return {
    fare,
    segmentKm,
    totalKm,
    from: stops[fromIdx],
    to: stops[toIdx],
    stops,
  };
}

/* ---------------- 铁路模组票务（售票机 / 闸机 / 后台） ---------------- */

function railwayAdminOk(db, req) {
  const expected = String((db.settings || {}).railwayAdminToken || 'qingjiang-railway-mod');
  if (String(req.headers['x-railway-token'] || '') === expected) return true;
  const account = accountOf(db, req);
  return Boolean(account && account.role === 'admin' && account.enabled !== false);
}

function railwayBrand(db) {
  const s = db.settings || {};
  return {
    systemName: s.systemName || '清江铁路',
    logoUrl: s.logoUrl || '',
    announcement: s.announcementEnabled === false ? '' : s.announcement || '',
    checkinMinutes: Number(s.checkinMinutes || 30),
    currency: s.railwayCurrency || 'emerald',
    bureau: s.railwayBureau || '清江铁路',
  };
}

function railwayStationByName(db, name) {
  const value = String(name || '').trim();
  if (!value) return null;
  return (db.stations || []).find((s) => s.name === value || s.mcName === value) || null;
}

function railwayFareKey(a, b) {
  return [String(a), String(b)].sort().join('|');
}

function railwayFindFare(db, fromId, toId) {
  const key = railwayFareKey(fromId, toId);
  return (db.fares || []).find((f) => f.key === key) || null;
}

function railwayHasCenter(station) {
  return Boolean(
    station &&
      station.x !== null &&
      station.x !== undefined &&
      station.y !== null &&
      station.y !== undefined &&
      station.z !== null &&
      station.z !== undefined &&
      [station.x, station.y, station.z].every((v) => Number.isFinite(Number(v)))
  );
}

function railwayDistance(stationA, stationB) {
  if (!railwayHasCenter(stationA) || !railwayHasCenter(stationB)) return 0;
  const ax = Number(stationA.x);
  const ay = Number(stationA.y);
  const az = Number(stationA.z);
  const bx = Number(stationB.x);
  const by = Number(stationB.y);
  const bz = Number(stationB.z);
  return Math.round(Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2));
}

function computeRailwayFare(db, distance) {
  const s = db.settings || {};
  const perBlock = Number(s.farePerBlock || 0.02);
  const min = Number(s.minFare || 1);
  const max = Number(s.maxFare || 64);
  if (!(distance > 0)) return min;
  const raw = Math.round(distance * perBlock);
  return Math.max(min, Math.min(max, raw));
}

/**
 * 单段票价：优先用后台票价表里填的该段价格；没有记录时按两站中心点距离即时计算。
 * 后台“手动改价”的段价会原样生效，保证网页上填多少、游戏里就收多少。
 */
function railwaySegmentFare(db, fromStationId, toStationId) {
  const fare = railwayFindFare(db, fromStationId, toStationId);
  if (fare && (fare.custom || Number(fare.price) > 0)) {
    return Math.max(0, Number(fare.price));
  }
  const from = findStation(db, fromStationId);
  const to = findStation(db, toStationId);
  const distance = railwayDistance(from, to);
  if (distance > 0) return computeRailwayFare(db, distance);
  if (fare) return Math.max(0, Number(fare.price) || Number(fare.autoPrice) || 0);
  return Math.max(0, Number((db.settings || {}).minFare || 1));
}

/** 直达两站票价（不经过中间站时使用）。 */
function railwayQuoteFare(db, fromStationId, toStationId) {
  return railwaySegmentFare(db, fromStationId, toStationId);
}

/**
 * 沿车次经停顺序累加分段票价：A-B-C 的 A→C 票价 = A-B 段价 + B-C 段价。
 * 这是网页、POS、游戏内支付的统一成交价。
 */
function railwayRouteFare(db, train, fromStationId, toStationId) {
  const stops = trainStops(db, train);
  let fromIndex = stops.findIndex((s) => s.stationId === fromStationId);
  let toIndex = stops.findIndex((s) => s.stationId === toStationId);
  // 列车反向运行时，按停站表倒序累加。
  if (fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex) {
    const reversed = stops.slice().reverse();
    fromIndex = reversed.findIndex((s) => s.stationId === fromStationId);
    toIndex = reversed.findIndex((s) => s.stationId === toStationId);
    return railwayRouteFareByStops(db, reversed, fromIndex, toIndex);
  }
  return railwayRouteFareByStops(db, stops, fromIndex, toIndex);
}

function railwayRouteFareByStops(db, stops, fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || toIndex <= fromIndex) {
    return fromIndex >= 0 && toIndex >= 0
      ? railwaySegmentFare(db, stops[fromIndex].stationId, stops[toIndex].stationId)
      : 0;
  }
  let total = 0;
  for (let i = fromIndex; i < toIndex; i += 1) {
    total += railwaySegmentFare(db, stops[i].stationId, stops[i + 1].stationId);
  }
  return Math.round(total * 100) / 100;
}

/** 按当前每格系数重算所有“未手动改价”的票价；手动票价保留。 */
function railwayRecalcAutoFares(db) {
  let count = 0;
  (db.fares || []).forEach((fare) => {
    const from = findStation(db, fare.fromStationId);
    const to = findStation(db, fare.toStationId);
    const distance = railwayDistance(from, to);
    if (!(distance > 0)) return;
    fare.distance = distance;
    fare.autoPrice = computeRailwayFare(db, distance);
    if (!fare.custom) fare.price = fare.autoPrice;
    fare.updatedAt = new Date().toISOString();
    count += 1;
  });
  return count;
}

function railwayAutoFares(db, changedStation) {
  if (!railwayHasCenter(changedStation)) return;
  (db.stations || []).forEach((other) => {
    if (other.id === changedStation.id) return;
    if (!railwayHasCenter(other)) return;
    const distance = railwayDistance(changedStation, other);
    if (!(distance > 0)) return;
    const key = railwayFareKey(changedStation.id, other.id);
    let fare = (db.fares || []).find((f) => f.key === key);
    const autoPrice = computeRailwayFare(db, distance);
    if (!fare) {
      fare = {
        id: newId('f'),
        key,
        fromStationId: changedStation.id,
        toStationId: other.id,
        distance,
        autoPrice,
        price: autoPrice,
        currency: (db.settings || {}).railwayCurrency || 'emerald',
        custom: false,
        updatedAt: new Date().toISOString(),
      };
      db.fares.push(fare);
    } else if (!fare.custom) {
      fare.distance = distance;
      fare.autoPrice = autoPrice;
      fare.price = autoPrice;
      fare.updatedAt = new Date().toISOString();
    }
  });
}

function railwayUpsertStation(db, body) {
  const name = String(body.name || '').trim();
  if (!name) return { error: '车站名称不能为空' };
  const center = body.center || {};
  const x = Number(center.x);
  const y = Number(center.y);
  const z = Number(center.z);
  let station = railwayStationByName(db, name);
  if (!station) {
    let cityId = String(body.cityId || '').trim();
    if (!cityId || !findCity(db, cityId)) {
      let city = (db.cities || []).find((c) => c.code === 'MC');
      if (!city) {
        city = { id: newId('c'), name: '模组铁路', pinyin: 'mod', code: 'MC' };
        db.cities.push(city);
      }
      cityId = city.id;
    }
    const code = String(body.code || '').trim().toUpperCase() || `MC${String((db.stations || []).length + 1).padStart(2, '0')}`;
    station = {
      id: newId('s'),
      name,
      cityId,
      code,
      status: 'normal',
      gateCount: 1,
      platformCount: 1,
      address: String(body.address || '模组内车站').slice(0, 80),
      bureauId: String(body.bureauId || ((db.bureaus || [])[0] || {}).id || ''),
      createdAt: new Date().toISOString(),
    };
    db.stations.push(station);
  }
  station.mcName = name;
  station.x = Number.isFinite(x) ? x : station.x;
  station.y = Number.isFinite(y) ? y : station.y;
  station.z = Number.isFinite(z) ? z : station.z;
  station.dimension = String(body.dimension || station.dimension || '');
  station.pos1 = body.pos1 || station.pos1 || null;
  station.pos2 = body.pos2 || station.pos2 || null;
  station.gates = Array.isArray(body.gates) ? body.gates.slice(0, 512) : station.gates || [];
  station.vendors = Array.isArray(body.vendors) ? body.vendors.slice(0, 128) : station.vendors || [];
  station.gateCount = Math.max(1, station.gates.length || station.gateCount || 1);
  if (body.bureauId && (db.bureaus || []).some((b) => b.id === body.bureauId)) station.bureauId = body.bureauId;
  railwayAutoFares(db, station);
  return { station };
}

function railwayOrderJson(db, order) {
  const train = (db.trains || []).find((t) => t.id === order.trainId);
  const from = (db.stations || []).find((s) => s.id === order.fromStationId);
  const to = (db.stations || []).find((s) => s.id === order.toStationId);
  const settings = db.settings || {};
  const checkinMinutes = Number(settings.checkinMinutes || 30);
  let checkinStart = '';
  if (order.date && order.departTime) {
    const depart = Date.parse(`${order.date}T${order.departTime}:00`);
    if (Number.isFinite(depart)) checkinStart = String(depart - checkinMinutes * 60000);
  }
  const passenger = (order.passengers || [])[0] || {};
  return {
    orderNo: order.orderNo,
    id: order.id,
    trainNo: order.trainNo || (train && train.trainNo) || '',
    trainName: order.trainName || (train ? `${train.trainNo} ${train.type || ''}`.trim() : order.trainNo || ''),
    trainId: order.trainId || '',
    fromStationId: order.fromStationId || (train && train.fromStationId) || '',
    fromStationName: order.fromStationName || (from && from.name) || '',
    toStationId: order.toStationId || (train && train.toStationId) || '',
    toStationName: order.toStationName || (to && to.name) || '',
    date: order.date || '',
    departTime: order.departTime || (train && train.departTime) || '',
    arriveTime: order.arriveTime || (train && train.arriveTime) || '',
    price: Number(order.price || 0),
    totalPrice: Number(order.totalPrice || order.price || 0),
    currency: order.currency || 'emerald',
    status: order.status || 'pending',
    source: order.source || 'web',
    seat: order.seatType || '',
    seatNo: passenger.seatNo || '',
    coach: passenger.coach || '',
    gateInfo: from && (from.gates || []).length ? `1-${(from.gates || []).length}检票口` : '',
    passengerName: passenger.name || order.contactName || '',
    idNo: passenger.idNo || '',
    coupon: order.coupon || 'ticket',
    checkedIn: Boolean(order.checkedIn || (passenger && passenger.checkedIn)),
    printed: Boolean(order.printed),
    printCount: Number(order.printCount || 0),
    paidBy: order.paidBy || '',
    paidCurrency: order.paidCurrency || '',
    checkinMinutes,
    checkinStart,
    createdAt: order.createdAt || '',
  };
}

function railwayCheckinState(db, train, date, stationName) {
  const settings = db.settings || {};
  const checkinMinutes = Number(settings.checkinMinutes || 30);
  const runtime = train ? trainRuntime(train, date) : null;
  const departTime = (runtime && runtime.departTime) || (train && train.departTime) || '';
  const depart = Date.parse(`${date}T${departTime}:00`);
  const openAt = Number.isFinite(depart) ? depart - checkinMinutes * 60000 : 0;
  const now = Date.now();
  const cancelled = runtime && (runtime.status === 'cancelled' || runtime.status === 'maintenance');
  const open = !cancelled && Number.isFinite(depart) && now >= openAt && now <= depart + 10 * 60000;
  return {
    open,
    departTime,
    checkinMinutes,
    checkinStart: openAt ? String(openAt) : '',
    departAt: Number.isFinite(depart) ? String(depart) : '',
    status: runtime ? runtime.status : 'normal',
    statusText: runtime ? runtime.statusText : '',
    stationName: stationName || '',
  };
}

function normalizeTrainStops(db, input) {
  if (!Array.isArray(input)) return null;
  const stops = [];
  input.forEach((item, index) => {
    const stationId = String((item && item.stationId) || item || '').trim();
    const station = findStation(db, stationId);
    if (!station) return;
    const km = Number(item && item.km);
    stops.push({
      stationId: station.id,
      name: station.name,
      km: Number.isFinite(km) ? km : index,
    });
  });
  return stops.length ? stops : null;
}

function expirePendingOrders(db) {
  const now = Date.now();
  let changed = 0;
  (db.orders || []).forEach((order) => {
    if (order.status !== 'pending') return;
    const deadline = Date.parse(order.paymentDeadline || '');
    if (Number.isFinite(deadline) && deadline <= now) {
      order.status = 'canceled';
      order.cancelReason = 'payment_timeout';
      order.canceledAt = new Date().toISOString();
      order.updatedAt = order.canceledAt;
      changed += 1;
    }
  });
  if (changed) {
    addLog(db, {
      action: 'order.payment_timeout',
      actor: 'system',
      role: 'system',
      target: `${changed} 笔订单`,
      detail: '待支付超时自动取消并释放座位',
      level: 'warn',
    });
    saveDB();
    broadcast('orders', { canceled: changed, reason: 'payment_timeout' });
  }
  return changed;
}

function trainView(db, train, date) {
  const from = findStation(db, train.fromStationId) || {};
  const to = findStation(db, train.toStationId) || {};
  const fromCity = findCity(db, from.cityId) || {};
  const toCity = findCity(db, to.cityId) || {};
  const mins = durationMinutes(train.departTime, train.arriveTime);
  const seats = seatAvailability(db, train, date);
  const runtime = trainRuntime(train, date);
  return {
    id: train.id,
    trainNo: train.trainNo,
    type: train.type,
    date,
    fromStationId: train.fromStationId,
    fromStationName: from.name || '-',
    fromCityId: from.cityId,
    fromCityName: fromCity.name || '-',
    toStationId: train.toStationId,
    toStationName: to.name || '-',
    toCityId: to.cityId,
    toCityName: toCity.name || '-',
    departTime: runtime.departTime,
    baseDepartTime: runtime.baseDepartTime,
    arriveTime: train.arriveTime,
    duration: mins,
    durationText: durationText(mins),
    platform: runtime.platform,
    basePlatform: runtime.basePlatform,
    gates: runtime.gates,
    baseGates: runtime.baseGates,
    tempGates: runtime.tempGates,
    tempGate: runtime.tempGate,
    tempPlatform: runtime.tempPlatform,
    gate: runtime.gate,
    baseGate: runtime.baseGate,
    status: runtime.status,
    statusText: runtime.statusText,
    delayMinutes: runtime.delayMinutes,
    runtimeNote: runtime.runtimeNote,
    runtimeDate: date,
    runtimeOverridden: runtime.overridden,
    runtimeByDate: train.runtimeByDate || {},
    landmarkColor: train.landmarkColor || '',
    stops: trainStops(db, train),
    seats,
    totalRemaining: seats.reduce((s, x) => s + x.remaining, 0),
    lowestPrice: seats.length ? Math.min(...seats.map((s) => s.price)) : 0,
  };
}

/** 某天所有车次的票额明细（总览 / 车票管理共用） */
function ticketRows(db, date) {
  return db.trains
    .map((t) => {
      const v = trainView(db, t, date);
      const seats = v.seats.map((s) => ({
        type: s.type,
        price: s.price,
        capacity: s.capacity,
        quota: s.total,
        sold: s.sold,
        remaining: s.remaining,
      }));
      return {
        trainId: t.id,
        trainNo: t.trainNo,
        type: t.type,
        date,
        fromStationName: v.fromStationName,
        toStationName: v.toStationName,
        departTime: v.departTime,
        arriveTime: v.arriveTime,
        durationText: v.durationText,
        seats,
        quota: seats.reduce((sum, s) => sum + s.quota, 0),
        sold: seats.reduce((sum, s) => sum + s.sold, 0),
        remaining: seats.reduce((sum, s) => sum + s.remaining, 0),
      };
    })
    .sort((a, b) => a.departTime.localeCompare(b.departTime));
}

function orderView(db, order) {  const train = db.trains.find((t) => t.id === order.trainId);
  const date = order.date;
  let route = null;
  if (train) {
    const v = trainView(db, train, date);
    route = {
      trainNo: v.trainNo,
      fromStationName: v.fromStationName,
      toStationName: v.toStationName,
      fromCityName: v.fromCityName,
      toCityName: v.toCityName,
      departTime: v.departTime,
      arriveTime: v.arriveTime,
      durationText: v.durationText,
      platform: v.platform,
      gate: v.gate,
      gates: v.gates,
      tempGate: v.tempGate,
      tempPlatform: v.tempPlatform,
      status: v.status,
      statusText: v.statusText,
      delayMinutes: v.delayMinutes,
      runtimeNote: v.runtimeNote,
      runtimeDate: v.runtimeDate,
      runtimeOverridden: v.runtimeOverridden,
      landmarkColor: v.landmarkColor,
    };
    if (order.routeOverride && order.routeOverride.fromStationName && order.routeOverride.toStationName) {
      route.fromStationName = order.routeOverride.fromStationName;
      route.toStationName = order.routeOverride.toStationName;
      if (order.routeOverride.arriveTime) route.arriveTime = order.routeOverride.arriveTime;
      if (order.routeOverride.durationText) route.durationText = order.routeOverride.durationText;
    }
  }
  const departure = train ? departureAt(order, train) : null;
  return {
    ...order,
    passengers: (order.passengers || []).map(({ faceDescriptor, ...p }) => p),
    route,
    departureAt: departure ? departure.toISOString() : null,
    checkedIn: Boolean(order.checkedIn),
    invoiceNo: order.invoiceNo || '',
    invoiceStatus: order.invoiceNo ? order.invoiceStatus || 'issued' : '',
    invoiceTitle: order.invoiceTitle || '',
    invoiceTaxNo: order.invoiceTaxNo || '',
    invoiceIssuedAt: order.invoiceIssuedAt || '',
    invoiceRedFlushedAt: order.invoiceRedFlushedAt || '',
    invoiceRedFlushReason: order.invoiceRedFlushReason || '',
  };
}

/* ---------------- 电子发票 PDF ---------------- */

function maskId(idNo) {
  const v = String(idNo || '');
  if (v.length <= 6) return v;
  return `${v.slice(0, 4)}********${v.slice(-4)}`;
}

function invoiceFontPath() {
  const candidates = [
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/arial.ttf',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function issueInvoice(order, title, taxNo) {
  if (!order) return { error: '订单不存在' };
  if (order.status !== 'paid') return { error: '只有已支付订单可以开具发票' };
  if (order.invoiceStatus === 'redFlushed') return { error: '该发票已红冲，不能重复开具' };
  if (!order.invoiceNo) {
    const d = new Date();
    order.invoiceNo = `FP${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${String(order.orderNo).slice(-8)}`;
    order.invoiceIssuedAt = new Date().toISOString();
  }
  order.invoiceStatus = 'issued';
  order.invoiceTitle = String(title || order.invoiceTitle || '个人').slice(0, 60);
  order.invoiceTaxNo = String(taxNo || order.invoiceTaxNo || '').slice(0, 30);
  return { value: order };
}

function redFlushInvoice(order, reason) {
  if (!order) return { error: '订单不存在' };
  if (!order.invoiceNo) return { error: '该订单尚未开具发票' };
  if (order.invoiceStatus === 'redFlushed') return { error: '该发票已经红冲，请勿重复操作' };
  order.invoiceStatus = 'redFlushed';
  order.invoiceRedFlushedAt = new Date().toISOString();
  order.invoiceRedFlushReason = String(reason || '订单已退票').slice(0, 60);
  return { value: order };
}

async function streamInvoice(db, res, order) {
  const train = db.trains.find((t) => t.id === order.trainId);
  const route = train ? trainView(db, train, order.date) : null;
  if (order.invoiceStatus === 'redFlushed') {
    throw new Error('该发票已红冲，不能下载');
  }
  if (!order.invoiceNo) {
    const d = new Date();
    order.invoiceNo = `FP${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${String(order.orderNo).slice(-8)}`;
    order.invoiceStatus = 'issued';
    order.invoiceIssuedAt = new Date().toISOString();
    order.invoiceTitle = order.invoiceTitle || '个人';
    saveDB();
  }
  const fontPath = invoiceFontPath();
  const doc = new PDFDocument({ size: 'A4', margin: 48, font: fontPath || 'Helvetica' });
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="invoice-${order.orderNo}.pdf"; filename*=UTF-8''${encodeURIComponent(
      `清江铁路电子发票-${order.orderNo}.pdf`
    )}`,
    'Cache-Control': 'no-store',
  });
  doc.pipe(res);
  if (fontPath) {
    try {
      doc.registerFont('cn', fontPath);
      doc.font('cn');
    } catch (e) {
      doc.font('Helvetica');
    }
  }
  const blue = '#1b64c4';
  doc.rect(0, 0, 595, 92).fill(blue);
  doc.fillColor('#ffffff').fontSize(22).text('清江铁路12306 · 电子发票', 48, 30);
  doc.fontSize(10).fillColor('#dce9ff').text('Railway Electronic Invoice', 48, 62);
  doc.fillColor('#eaf2ff').fontSize(10).text(`发票号码：${order.invoiceNo}`, 360, 36, { width: 190, align: 'right' });
  doc.text(`开票日期：${new Date().toLocaleDateString('zh-CN')}`, 360, 52, { width: 190, align: 'right' });

  doc.fillColor('#333333').fontSize(11);
  doc.text(`购票账号：${order.userPhone || order.contactPhone || '-'}`, 48, 118);
  doc.text(`发票抬头：${order.invoiceTitle || '个人'}`, 300, 118);
  doc.text(`订单号：${order.orderNo}`, 48, 138);
  doc.text(`乘车日期：${order.date}`, 300, 138);
  if (order.invoiceTaxNo) doc.text(`税号：${order.invoiceTaxNo}`, 48, 198);
  doc.text(`车次：${order.trainNo}　${route ? `${route.fromStationName} → ${route.toStationName}` : ''}`, 48, 158);
  doc.text(`席别：${order.seatType}`, 300, 158);
  if (route) {
    doc.text(`检票口：${route.gate || '-'}　站台：${route.platform || '-'}　地标：${route.landmarkColor || '-'}`, 48, 178);
    doc.text(`发车时间：${route.departTime}`, 300, 178);
  }

  const tableTop = 210;
  doc.rect(48, tableTop, 499, 28).fill('#eaf2ff');
  doc.fillColor('#1b4f92').fontSize(11);
  doc.text('乘车人', 58, tableTop + 8);
  doc.text('证件号', 150, tableTop + 8);
  doc.text('票种', 330, tableTop + 8);
  doc.text('席别', 380, tableTop + 8);
  doc.text('金额（元）', 460, tableTop + 8);
  doc.fillColor('#333333');
  let y = tableTop + 36;
  (order.passengers || []).forEach((p) => {
    doc.text(String(p.name), 58, y, { width: 86 });
    doc.text(maskId(p.idNo), 150, y, { width: 170 });
    doc.text(p.type || '成人', 330, y, { width: 44 });
    doc.text(order.seatType, 380, y, { width: 72 });
    doc.text(Number(p.price || order.price).toFixed(2), 460, y, { width: 84, align: 'right' });
    y += 24;
  });
  doc.moveTo(48, y + 2).lineTo(547, y + 2).strokeColor('#dddddd').stroke();
  doc.fontSize(12).fillColor('#d9363e').text(`合计金额：¥${Number(order.totalPrice || 0).toFixed(2)}`, 48, y + 14, {
    width: 499,
    align: 'right',
  });
  if (order.refundFee) {
    doc.fontSize(10).fillColor('#666666').text(`退票手续费：¥${Number(order.refundFee).toFixed(2)}`, 48, y + 38);
  }

  doc.fillColor('#666666').fontSize(9);
  doc.text('本发票为清江铁路12306演示系统生成的电子凭证，仅用于演示，不具备报销效力。', 48, 730, { width: 499 });
  doc.text('客服电话：12306　　官方渠道购票，请使用本人有效身份证件乘车。', 48, 746, { width: 499 });

  try {
    const qr = await QRCode.toBuffer(`QJ|${order.orderNo}|${order.invoiceNo}`, { width: 160, margin: 1 });
    doc.image(qr, 465, 620, { width: 82 });
    doc.fontSize(8).fillColor('#888888').text('扫码验票', 465, 704, { width: 82, align: 'center' });
  } catch (e) {
    /* 二维码失败不影响发票 */
  }
  doc.end();
}

/* ---------------- 静态资源 ---------------- */

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return false;
  }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

/* ---------------- 路由 ---------------- */

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api') pathname = '/';
  if (pathname.startsWith('/api/')) pathname = pathname.slice(4);
  // 兼容后台管理端使用的 /ticket 业务前缀（经 Vite 代理去掉 /api 后到达）
  if (pathname === '/ticket') pathname = '/';
  if (pathname.startsWith('/ticket/')) pathname = pathname.slice('/ticket'.length);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    res.end();
    return;
  }

  const query = Object.fromEntries(url.searchParams.entries());

  // API 入口统一走令牌桶限流；IP 黑名单命中直接返回 429
  if (isApiPath(pathname) && pathname !== '/health' && !enforceRateLimit(req, res, pathname, req.method)) {
    return;
  }

  if (pathname.startsWith('/public/') || pathname === '/' || !isApiPath(pathname)) {
    if (req.method === 'GET' && pathname.startsWith('/public/')) {
      // 前台接口
    } else if (req.method === 'GET' && !isApiPath(pathname)) {
      if (serveStatic(req, res, pathname)) return;
    }
  }

  try {
    await route(req, res, pathname, query);
  } catch (e) {
    console.error('[error]', e);
    fail(res, 500, e.message || '服务器内部错误');
  }
}

/* 第一段是否是 API 段 */
const API_SEGMENTS = new Set([
  'health', 'cities', 'stations', 'trains', 'orders', 'stats', 'public', 'admin',
  'tickets', 'settings', 'passengers', 'captcha', 'accounts', 'qrcode', 'invoice', 'invoices', 'checkin', 'agent', 'import', 'security', 'supplement', 'runtime-config',
  'alerts', 'reports', 'screen', 'railway',
]);
function isApiPath(pathname) {
  const first = pathname.split('/').filter(Boolean)[0];
  return API_SEGMENTS.has(first);
}

async function route(req, res, pathname, query) {
  const db = getDB();
  const method = req.method.toUpperCase();
  const segs = pathname.split('/').filter(Boolean);
  const [root, second, third, fourth] = segs;

  /* ===== 健康检查 ===== */
  if (root === 'health' && method === 'GET') {
    return ok(res, { status: 'up', time: new Date().toISOString() });
  }

  /* ===== 运行时端口配置（供前端/后台生成入口链接） ===== */
  if (root === 'runtime-config' && method === 'GET') {
    const host = String(req.headers.host || 'localhost').split(':')[0] || 'localhost';
    return ok(res, {
      ports: { ticket: PORT, admin: ADMIN_PORT },
      urls: {
        ticket: `http://${host}:${PORT}`,
        admin: `http://${host}:${ADMIN_PORT}`,
      },
    });
  }

  /* ===== 铁路模组票务（售票机 / 闸机 / 后台） ===== */
  if (root === 'railway') {
    /* 品牌与公告 */
    if (second === 'config' && method === 'GET') {
      return ok(res, railwayBrand(db));
    }

    /* 车站（带模组坐标） */
    if (second === 'stations' && method === 'GET' && !third) {
      return ok(
        res,
        (db.stations || [])
          .filter((s) => railwayHasCenter(s))
          .map((s) => ({
            id: s.id,
            name: s.name,
            code: s.code || '',
            x: Number(s.x),
            y: Number(s.y),
            z: Number(s.z),
            dimension: s.dimension || '',
            bureauId: s.bureauId || '',
            gateCount: (s.gates || []).length,
            vendorCount: (s.vendors || []).length,
          }))
      );
    }

    /* 售票机引导页数据：公告 + 本站可售车次 + 开检状态 */
    if (second === 'tvm' && third === 'bootstrap' && method === 'GET') {
      const brand = railwayBrand(db);
      const station = railwayStationByName(db, query.station || '');
      const today = isValidDate(query.date) ? query.date : todayStr();
      const trains = [];
      if (station) {
        (db.trains || []).forEach((train) => {
          const stops = trainStops(db, train);
          const index = stops.findIndex((s) => s.stationId === station.id);
          if (index < 0) return;
          const destination = stops[stops.length - 1];
          if (!destination || destination.stationId === station.id) return;
          const view = trainView(db, train, today);
          const check = railwayCheckinState(db, train, today, station.name);
          trains.push({
            trainId: train.id,
            trainNo: train.trainNo,
            trainName: `${train.trainNo} ${train.type || ''}`.trim(),
            fromStationName: station.name,
            toStationName: destination.name,
            departTime: check.departTime || train.departTime,
            arriveTime: train.arriveTime,
            price: railwayRouteFare(db, train, station.id, destination.stationId),
            currency: brand.currency,
            remaining: Number(view.totalRemaining || 0),
            checkinOpen: check.open,
            checkinStart: check.checkinStart,
            status: check.status,
            statusText: check.statusText,
          });
        });
        trains.sort((a, b) => String(a.departTime).localeCompare(String(b.departTime)));
      }
      return ok(res, {
        ...brand,
        today,
        station: station
          ? { id: station.id, name: station.name, code: station.code || '', gateCount: (station.gates || []).length, vendorCount: (station.vendors || []).length }
          : null,
        trains,
      });
    }

    /* 创建订单（售票机 / 网页共用；付款必须回到游戏内 /railway pay） */
    if (second === 'orders' && !third && method === 'POST') {
      const body = await readBody(req);
      const train =
        (db.trains || []).find((t) => t.id === String(body.trainId || '')) ||
        (db.trains || []).find((t) => t.trainNo === String(body.trainNo || '').trim().toUpperCase());
      if (!train) return fail(res, 404, '车次不存在');
      const station =
        railwayStationByName(db, body.stationName) || findStation(db, train.fromStationId);
      if (!station) return fail(res, 400, '出发车站不存在');
      const stops = trainStops(db, train);
      const index = stops.findIndex((s) => s.stationId === station.id);
      if (index < 0) return fail(res, 400, `该车次不经停 ${station.name}`);
      const destination =
        railwayStationByName(db, body.toStationName) ||
        stops[stops.length - 1];
      if (!destination || destination.stationId === station.id) return fail(res, 400, '到达车站无效');
      const seat = (train.seats || [])[0] || {};
      // 成交价按经停顺序累加分段票价，不信任前端传入的 price。
      const price = railwayRouteFare(db, train, station.id, destination.stationId);
      const passengerName = String(body.passengerName || body.name || '').trim().slice(0, 20);
      const idNo = String(body.idNo || '').trim().slice(0, 32);
      if (!passengerName) return fail(res, 400, '乘车人姓名不能为空');
      if (!idNo) return fail(res, 400, '身份证号不能为空');
      const date = isValidDate(body.date) ? body.date : todayStr();
      const source = body.source === 'machine' ? 'machine' : 'web';
      const seq = (db.orders || []).length % 30;
      const seatNo = body.seatNo || `${10 + Math.floor(seq / 5)}${['A', 'B', 'C', 'D', 'F'][seq % 5]}`;
      const order = {
        id: newId('o'),
        orderNo: genOrderNo(),
        trainId: train.id,
        trainNo: train.trainNo,
        trainName: `${train.trainNo} ${train.type || ''}`.trim(),
        fromStationId: station.id,
        fromStationName: station.name,
        toStationId: destination.stationId,
        toStationName: destination.name,
        departTime: train.departTime,
        arriveTime: train.arriveTime,
        date,
        seatType: String(body.seatType || seat.type || '二等座'),
        price,
        totalPrice: price,
        currency: (db.settings || {}).railwayCurrency || 'emerald',
        status: source === 'machine' ? 'paid' : 'pending',
        source,
        contactName: passengerName,
        contactPhone: '',
        paymentDeadline: new Date(Date.now() + 60 * 60000).toISOString(),
        passengers: [
          {
            name: passengerName,
            idNo,
            type: '成人',
            price,
            seatNo,
          },
        ],
        createdAt: new Date().toISOString(),
        checkedIn: false,
        invoiceNo: '',
        printed: false,
        printCount: 0,
        coupon: 'ticket',
      };
      if (source === 'machine') {
        order.paidAt = new Date().toISOString();
        order.paymentMethod = 'machine';
        order.paidCurrency = order.currency;
        order.paidAmount = price;
        order.paidBy = '售票机';
      }
      db.orders.push(order);
      saveDB();
      broadcast('order', { orderNo: order.orderNo, status: order.status, source: order.source });
      addLog(db, {
        action: 'railway.order.create',
        actor: passengerName,
        role: 'passenger',
        target: order.orderNo,
        detail: `${train.trainNo} ${station.name}→${destination.name} ${price} 绿宝石（${order.source === 'machine' ? '售票机' : '网页'}）`,
        level: 'info',
      });
      saveDB();
      return ok(res, { order: railwayOrderJson(db, order) }, source === 'machine' ? '购票成功，已自动支付' : '订单已创建，请完成支付');
    }

    /* 订单列表（模组 /railway pay 全部支付、TAB 补全、/railway status、POS 查询） */
    if (second === 'orders' && !third && method === 'GET') {
      const listQuery = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;
      const keyword = String(listQuery.get('keyword') || '').trim().toLowerCase();
      const playerName = String(listQuery.get('player') || '').trim();
      const status = String(listQuery.get('status') || '').trim();
      const limit = Math.min(200, Math.max(1, Number(listQuery.get('limit') || 100)));
      const orders = (db.orders || [])
        .filter((o) => {
          if (status && o.status !== status) return false;
          if (playerName && String((o.passengers || [])[0]?.name || o.contactName || '') !== playerName) return false;
          if (!keyword) return true;
          const passenger = (o.passengers || [])[0] || {};
          return [o.orderNo, passenger.idNo, passenger.name, o.contactName, o.trainNo]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(keyword));
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit);
      return ok(res, { orders: orders.map((o) => railwayOrderJson(db, o)) });
    }

    /* 查询订单（模组查询、售票机查询） */
    if (second === 'orders' && third && !fourth && method === 'GET') {
      const order = (db.orders || []).find((o) => o.orderNo === third || o.id === third);
      if (!order) return fail(res, 404, '订单不存在');
      const full = railwayOrderJson(db, order);
      if (!railwayAdminOk(db, req)) {
        return ok(res, {
          orderNo: full.orderNo,
          status: full.status,
          trainNo: full.trainNo,
          trainName: full.trainName,
          fromStationName: full.fromStationName,
          toStationName: full.toStationName,
          date: full.date,
          departTime: full.departTime,
          price: full.price,
          currency: full.currency,
          coupon: full.coupon,
          printed: full.printed,
          checkinStart: full.checkinStart,
        });
      }
      return ok(res, full);
    }

    /* 游戏内绿宝石支付回调 */
    if (second === 'orders' && third && fourth === 'pay' && method === 'POST') {
      const order = (db.orders || []).find((o) => o.orderNo === third || o.id === third);
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status === 'paid') return ok(res, { order: railwayOrderJson(db, order) }, '订单已支付，无需重复支付');
      if (order.status !== 'pending') return fail(res, 400, `订单状态为 ${order.status}，无法支付`);
      const deadline = Date.parse(order.paymentDeadline || '');
      if (Number.isFinite(deadline) && deadline <= Date.now()) {
        order.status = 'canceled';
        order.cancelReason = 'payment_timeout';
        order.canceledAt = new Date().toISOString();
        saveDB();
        return fail(res, 400, '订单已超过支付时限，请重新下单');
      }
      const body = await readBody(req);
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.paymentMethod = String(body.method || 'in-game').slice(0, 20);
      order.paidCurrency = String(body.currency || order.currency || 'emerald').slice(0, 32);
      order.paidAmount = Math.max(0, Number(body.amount) || Number(order.price) || 0);
      order.paidBy = String(body.player || '').slice(0, 20);
      order.updatedAt = order.paidAt;
      saveDB();
      broadcast('order', { orderNo: order.orderNo, status: order.status, source: order.source });
      addLog(db, {
        action: 'railway.order.pay',
        actor: order.paidBy || 'player',
        role: 'passenger',
        target: order.orderNo,
        detail: `${order.paymentMethod === 'cash' ? '人工现金' : order.paymentMethod === 'machine' ? '售票机自动' : '游戏内'}支付 ${order.paidAmount} ${order.paidCurrency}`,
        level: 'info',
      });
      saveDB();
      return ok(res, { order: railwayOrderJson(db, order) }, '支付成功');
    }

    /* 打印车票（模组生成物品后回写打印状态） */
    if (second === 'orders' && third && fourth === 'print' && method === 'POST') {
      const order = (db.orders || []).find((o) => o.orderNo === third || o.id === third);
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status !== 'paid') return fail(res, 400, '订单未支付，不能打印车票');
      if (order.printed) return fail(res, 400, '该订单已打印过车票');
      order.printed = true;
      order.printCount = Number(order.printCount || 0) + 1;
      order.printedAt = new Date().toISOString();
      saveDB();
      addLog(db, {
        action: 'railway.ticket.print',
        actor: 'player',
        role: 'passenger',
        target: order.orderNo,
        detail: `打印车票 ${order.trainNo} ${order.fromStationName}→${order.toStationName}`,
        level: 'info',
      });
      return ok(res, { order: railwayOrderJson(db, order) }, '车票已打印');
    }

    /* 补打车票：已支付订单可重复补打，累加打印次数并记录日志 */
    if (second === 'orders' && third && fourth === 'reprint' && method === 'POST') {
      const order = (db.orders || []).find((o) => o.orderNo === third || o.id === third);
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status !== 'paid') return fail(res, 400, '订单未支付，不能补打车票');
      order.printed = true;
      order.printCount = Number(order.printCount || 0) + 1;
      order.lastReprintAt = new Date().toISOString();
      saveDB();
      addLog(db, {
        action: 'railway.ticket.reprint',
        actor: 'player',
        role: 'passenger',
        target: order.orderNo,
        detail: `补打车票（第 ${order.printCount} 次）${order.trainNo} ${order.fromStationName}→${order.toStationName}`,
        level: 'info',
      });
      return ok(res, { order: railwayOrderJson(db, order) }, `第 ${order.printCount} 次打印，车票已补打`);
    }

    /* 闸机进站/检票回写：把乘车人标记为已检票 */
    if (second === 'orders' && third && fourth === 'checkin' && method === 'POST') {
      const order = (db.orders || []).find((o) => o.orderNo === third || o.id === third);
      if (!order) return fail(res, 404, '订单不存在');
      const body = await readBody(req);
      const idNo = String(body.idNo || '').toUpperCase();
      const passenger = (order.passengers || []).find((p) => !idNo || String(p.idNo || '').toUpperCase() === idNo)
        || (order.passengers || [])[0];
      if (!passenger) return fail(res, 400, '订单没有乘车人');
      passenger.checkedIn = true;
      passenger.checkedInAt = passenger.checkedInAt || new Date().toISOString();
      passenger.checkinMode = String(body.mode || 'gate');
      if ((order.passengers || []).every((p) => p.checkedIn)) {
        order.checkedIn = true;
        order.checkedInAt = passenger.checkedInAt;
        order.checkinMode = passenger.checkinMode;
      }
      addLog(db, {
        action: 'railway.checkin.gate',
        actor: passenger.name || 'gate',
        role: 'passenger',
        target: order.orderNo,
        detail: `${passenger.name} 通过闸机检票`,
        level: 'info',
      });
      saveDB();
      broadcast('checkin', liveSnapshot(db));
      return ok(res, { order: railwayOrderJson(db, order) }, '已记录检票');
    }

    /* 开检状态（闸机校验） */
    if (second === 'checkin' && method === 'GET') {
      const train =
        (db.trains || []).find((t) => t.id === String(query.trainId || '')) ||
        (db.trains || []).find((t) => t.trainNo === String(query.trainNo || '').toUpperCase());
      if (!train) return fail(res, 404, '车次不存在');
      const date = isValidDate(query.date) ? query.date : todayStr();
      return ok(res, railwayCheckinState(db, train, date, query.station || ''));
    }

    /* ----- 管理接口 ----- */
    if (second === 'admin') {
      if (!railwayAdminOk(db, req)) return fail(res, 403, '铁路管理令牌无效或未登录管理员账号');

      /* 删除车站（同时清理该站票价与终端绑定） */
      if (third === 'station' && fourth === 'delete' && method === 'POST') {
        const body = await readBody(req);
        const id = String(body.id || '').trim();
        const name = String(body.name || '').trim();
        const index = (db.stations || []).findIndex(
          (s) => (id && s.id === id) || (name && s.name === name),
        );
        if (index < 0) return fail(res, 404, '车站不存在');
        const [removed] = db.stations.splice(index, 1);
        db.fares = (db.fares || []).filter(
          (f) => f.fromStationId !== removed.id && f.toStationId !== removed.id,
        );
        (db.railwayDevices || []).forEach((d) => {
          if (d.stationId === removed.id) d.stationId = '';
        });
        saveDB();
        return ok(res, { stationId: removed.id, name: removed.name }, '车站已删除');
      }

      /* 单个车站同步 */
      if (third === 'station' && fourth !== 'bulk' && method === 'POST') {
        const body = await readBody(req);
        const result = railwayUpsertStation(db, body);
        if (result.error) return fail(res, 400, result.error);
        saveDB();
        return ok(res, { stationId: result.station.id, name: result.station.name }, '车站已同步');
      }

      /* 全量车站同步 */
      if (third === 'station' && fourth === 'bulk' && method === 'POST') {
        const body = await readBody(req);
        const list = Array.isArray(body.stations) ? body.stations : [];
        const results = [];
        list.forEach((item) => {
          const result = railwayUpsertStation(db, item || {});
          if (!result.error) results.push({ name: result.station.name, stationId: result.station.id });
        });
        saveDB();
        return ok(res, { stations: results }, `已同步 ${results.length} 个车站`);
      }

      /* 车站（模组坐标）列表 */
      if (third === 'stations' && method === 'GET') {
        return ok(
          res,
          (db.stations || [])
            .filter((s) => railwayHasCenter(s))
            .map((s) => {
              const bureau = (db.bureaus || []).find((b) => b.id === s.bureauId);
              return {
                id: s.id,
                name: s.name,
                code: s.code || '',
                x: s.x,
                y: s.y,
                z: s.z,
                dimension: s.dimension || '',
                bureauId: s.bureauId || '',
                bureauName: bureau ? bureau.name : '',
                gates: s.gates || [],
                vendors: s.vendors || [],
                updatedAt: s.updatedAt || '',
              };
            })
        );
      }

      /* 票价 */
      if (third === 'fares') {
        if (method === 'GET' && !fourth) {
          return ok(
            res,
            (db.fares || [])
              .map((f) => ({
                ...f,
                fromStationName: (findStation(db, f.fromStationId) || {}).name || '-',
                toStationName: (findStation(db, f.toStationId) || {}).name || '-',
              }))
              .sort((a, b) => a.fromStationName.localeCompare(b.fromStationName))
          );
        }
        if (method === 'POST' && fourth === 'recalculate') {
          const count = railwayRecalcAutoFares(db);
          saveDB();
          return ok(res, { recalculated: count }, `已重算 ${count} 条票价`);
        }
        if (method === 'POST' && !fourth) {
          const body = await readBody(req);
          const from = findStation(db, String(body.fromStationId || ''));
          const to = findStation(db, String(body.toStationId || ''));
          if (!from || !to) return fail(res, 400, '请选择有效的起点站和终点站');
          if (from.id === to.id) return fail(res, 400, '起点站与终点站不能相同');
          const key = railwayFareKey(from.id, to.id);
          let fare = (db.fares || []).find((f) => f.key === key);
          const geoDistance = railwayDistance(from, to);
          const requestedDistance = Number(body.distance);
          const distance = Number.isFinite(requestedDistance) && requestedDistance > 0 ? requestedDistance : geoDistance;
          const autoPrice = computeRailwayFare(db, distance);
          if (!fare) {
            fare = {
              id: newId('f'),
              key,
              fromStationId: from.id,
              toStationId: to.id,
              distance,
              autoPrice,
              price: autoPrice,
              currency: (db.settings || {}).railwayCurrency || 'emerald',
              custom: false,
              updatedAt: new Date().toISOString(),
            };
            db.fares.push(fare);
          } else {
            fare.distance = distance;
            fare.autoPrice = autoPrice;
          }
          if (body.price !== undefined) {
            const price = Math.max(0, Math.min(999, Number(body.price) || 0));
            fare.price = price;
            fare.custom = price !== fare.autoPrice;
          } else if (!fare.custom) {
            fare.price = autoPrice;
          }
          fare.updatedAt = new Date().toISOString();
          saveDB();
          return ok(res, fare, '票价已保存');
        }
        if (fourth && method === 'PUT') {
          const fare = (db.fares || []).find((f) => f.id === fourth);
          if (!fare) return fail(res, 404, '票价记录不存在');
          const body = await readBody(req);
          let distanceChanged = false;
          if (body.distance !== undefined) {
            fare.distance = Math.max(0, Number(body.distance) || 0);
            fare.autoPrice = computeRailwayFare(db, fare.distance);
            distanceChanged = true;
          }
          if (body.price !== undefined) {
            fare.price = Math.max(0, Math.min(999, Number(body.price) || 0));
            fare.custom = Number(fare.price) !== Number(fare.autoPrice);
          }
          if (body.resetAuto || (distanceChanged && !fare.custom)) {
            fare.custom = false;
            fare.price = fare.autoPrice;
          }
          fare.updatedAt = new Date().toISOString();
          saveDB();
          return ok(res, fare, '票价已更新');
        }
        if (fourth && method === 'DELETE') {
          db.fares = (db.fares || []).filter((f) => f.id !== fourth);
          saveDB();
          return ok(res, null, '票价已删除');
        }
      }

      /* 铁路局 */
      if (third === 'bureaus') {
        if (method === 'GET' && !fourth) {
          return ok(res, db.bureaus || []);
        }
        if (method === 'POST' && !fourth) {
          const body = await readBody(req);
          const name = String(body.name || '').trim();
          if (!name) return fail(res, 400, '铁路局名称不能为空');
          if ((db.bureaus || []).some((b) => b.name === name)) return fail(res, 400, '铁路局已存在');
          const bureau = {
            id: newId('b'),
            name,
            shortName: String(body.shortName || name).trim().slice(0, 20),
            color: String(body.color || '#1b64c4').slice(0, 20),
            remark: String(body.remark || '').slice(0, 80),
            createdAt: new Date().toISOString(),
          };
          db.bureaus.push(bureau);
          saveDB();
          return ok(res, bureau, '新增铁路局成功');
        }
        if (fourth && method === 'PUT') {
          const bureau = (db.bureaus || []).find((b) => b.id === fourth);
          if (!bureau) return fail(res, 404, '铁路局不存在');
          const body = await readBody(req);
          if (body.name !== undefined) {
            const name = String(body.name).trim();
            if (!name) return fail(res, 400, '铁路局名称不能为空');
            if ((db.bureaus || []).some((b) => b.id !== bureau.id && b.name === name))
              return fail(res, 400, '铁路局名称已存在');
            bureau.name = name;
          }
          if (body.shortName !== undefined) bureau.shortName = String(body.shortName).trim().slice(0, 20);
          if (body.color !== undefined) bureau.color = String(body.color).slice(0, 20);
          if (body.remark !== undefined) bureau.remark = String(body.remark).slice(0, 80);
          saveDB();
          return ok(res, bureau, '铁路局已更新');
        }
        if (fourth && method === 'DELETE') {
          db.bureaus = (db.bureaus || []).filter((b) => b.id !== fourth);
          (db.stations || []).forEach((s) => {
            if (s.bureauId === fourth) s.bureauId = (db.bureaus[0] || {}).id || '';
          });
          saveDB();
          return ok(res, null, '铁路局已删除');
        }
      }

      /* 模组设备统计 */
      if (third === 'devices' && method === 'GET') {
        return ok(
          res,
          (db.stations || [])
            .filter((s) => (s.gates || []).length || (s.vendors || []).length)
            .map((s) => ({
              id: s.id,
              name: s.name,
              gates: (s.gates || []).length,
              vendors: (s.vendors || []).length,
              center: [s.x, s.y, s.z],
              updatedAt: s.updatedAt || '',
            }))
        );
      }

      /* 系统设置（铁路品牌） */
      if (third === 'settings') {
        const s = db.settings || {};
        if (method === 'GET') {
          return ok(res, {
            systemName: s.systemName || '清江铁路',
            logoUrl: s.logoUrl || '',
            announcement: s.announcement || '',
            announcementEnabled: s.announcementEnabled !== false,
            railwayBureau: s.railwayBureau || '清江铁路',
            railwayCurrency: s.railwayCurrency || 'emerald',
            farePerBlock: Number(s.farePerBlock || 0.02),
            minFare: Number(s.minFare || 1),
            maxFare: Number(s.maxFare || 64),
            checkinMinutes: Number(s.checkinMinutes || 30),
            railwayAdminToken: s.railwayAdminToken || '',
          });
        }
        if (method === 'PUT') {
          const body = await readBody(req);
          if (body.systemName !== undefined) s.systemName = String(body.systemName).trim().slice(0, 40);
          if (body.logoUrl !== undefined) s.logoUrl = String(body.logoUrl).trim().slice(0, 200);
          if (body.announcement !== undefined) s.announcement = String(body.announcement).slice(0, 300);
          if (body.announcementEnabled !== undefined) s.announcementEnabled = Boolean(body.announcementEnabled);
          if (body.railwayBureau !== undefined) s.railwayBureau = String(body.railwayBureau).trim().slice(0, 40);
          if (body.farePerBlock !== undefined) s.farePerBlock = Math.max(0.001, Number(body.farePerBlock) || 0.02);
          if (body.minFare !== undefined) s.minFare = Math.max(0, Number(body.minFare) || 0);
          if (body.maxFare !== undefined) s.maxFare = Math.max(1, Number(body.maxFare) || 64);
          if (body.checkinMinutes !== undefined) s.checkinMinutes = Math.max(1, Math.min(180, Number(body.checkinMinutes) || 30));
          if (body.railwayAdminToken !== undefined) s.railwayAdminToken = String(body.railwayAdminToken).trim().slice(0, 80);
          db.settings = s;
          railwayRecalcAutoFares(db);
          saveDB();
          return ok(res, s, '铁路设置已保存，自动票价已按新系数重算');
        }
      }
      return fail(res, 404, '铁路管理接口不存在');
    }

    return fail(res, 404, '铁路接口不存在');
  }

  /* ===== 批量导入 ===== */
  if (root === 'import' && method === 'POST') {
    return handleImport(req, res, second, db);
  }

  /* ===== 数据概览（含票额） ===== */
  if (root === 'stats' && method === 'GET') {
    const today = todayStr();
    const date = isValidDate(query.date) ? query.date : today;
    const paid = db.orders.filter((o) => o.status === 'paid');
    const todayPaid = paid.filter((o) => o.date === today);
    const rows = ticketRows(db, date);
    const seatMap = {};
    rows.forEach((r) => {
      r.seats.forEach((s) => {
        if (!seatMap[s.type]) seatMap[s.type] = { type: s.type, quota: 0, sold: 0, remaining: 0 };
        seatMap[s.type].quota += s.quota;
        seatMap[s.type].sold += s.sold;
        seatMap[s.type].remaining += s.remaining;
      });
    });
    const quotaTotal = rows.reduce((s, r) => s + r.quota, 0);
    const quotaSold = rows.reduce((s, r) => s + r.sold, 0);
    const quotaRemaining = rows.reduce((s, r) => s + r.remaining, 0);
    return ok(res, {
      date,
      cityCount: db.cities.length,
      stationCount: db.stations.length,
      trainCount: db.trains.length,
      orderCount: db.orders.length,
      paidOrderCount: paid.length,
      todayOrderCount: todayPaid.length,
      ticketCount: paid.reduce((s, o) => s + (o.passengers ? o.passengers.length : 1), 0),
      todayTicketCount: todayPaid.reduce((s, o) => s + (o.passengers ? o.passengers.length : 1), 0),
      revenue: Number(paid.reduce((s, o) => s + (o.totalPrice || 0), 0).toFixed(2)),
      todayRevenue: Number(todayPaid.reduce((s, o) => s + (o.totalPrice || 0), 0).toFixed(2)),
      quota: {
        seats: quotaTotal,
        sold: quotaSold,
        remaining: quotaRemaining,
        utilization: quotaTotal ? Number(((quotaSold / quotaTotal) * 100).toFixed(1)) : 0,
      },
      seatTypes: Object.values(seatMap),
      trainQuotas: rows,
      recentOrders: db.orders.slice().reverse().slice(0, 8).map((o) => orderView(db, o)),
    });
  }

  /* ===== 运营报表 ===== */
  if (root === 'reports' && method === 'GET') {
    if (!requireAccountRole(db, res, req, ['admin'])) return;
    const to = isValidDate(query.to) ? query.to : todayStr();
    let from = isValidDate(query.from) ? query.from : '';
    if (!from) {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    if (from > to) return fail(res, 400, '开始日期不能晚于结束日期');
    return ok(res, buildOperationsReport(db, from, to));
  }

  /* ===== 候车大屏（公开只读，不含旅客信息） ===== */
  if (root === 'screen' && method === 'GET') {
    const date = isValidDate(query.date) ? query.date : todayStr();
    return ok(res, buildScreenData(db, String(query.stationId || ''), date));
  }

  /* ===== 告警中心 ===== */
  if (root === 'alerts') {
    if (method === 'GET' && !second) {
      const account = requireAccountRole(db, res, req, ['admin', 'inspector']);
      if (!account) return;
      const status = String(query.status || '').trim();
      const level = String(query.level || '').trim();
      const keyword = String(query.keyword || '').trim().toLowerCase();
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
      let rows = (db.alerts || []).slice();
      if (status && status !== 'all' && status !== 'pending') rows = rows.filter((a) => a.status === status);
      if (status === 'pending') rows = rows.filter((a) => a.status === 'open' || a.status === 'ack');
      if (level) rows = rows.filter((a) => a.level === level);
      if (keyword) {
        rows = rows.filter((a) =>
          [a.title, a.detail, a.type, a.target, a.source].filter(Boolean).join(' ').toLowerCase().includes(keyword)
        );
      }
      return ok(res, {
        summary: alertSummary(db),
        total: rows.length,
        page,
        pageSize,
        rows: rows.slice((page - 1) * pageSize, page * pageSize),
      });
    }
    if (method === 'POST' && second) {
      const account = requireAccountRole(db, res, req, ['admin', 'inspector']);
      if (!account) return;
      const alert = (db.alerts || []).find((a) => a.id === second);
      if (!alert) return fail(res, 404, '告警不存在');
      const body = await readBody(req);
      const action = String(body.action || 'ack');
      if (!['ack', 'ignore', 'resolve'].includes(action)) return fail(res, 400, '操作不正确');
      alert.status = action === 'ack' ? 'ack' : action === 'ignore' ? 'ignored' : 'resolved';
      alert.ackedBy = account.username;
      alert.ackedAt = new Date().toISOString();
      if (body.note) alert.note = String(body.note).slice(0, 120);
      if (alert.status === 'resolved') alert.resolvedAt = alert.ackedAt;
      addLog(db, {
        action: `alert.${action}`,
        actor: account.username,
        role: account.role,
        target: alert.target || alert.type,
        detail: `${alert.title || alert.type}${body.note ? '：' + alert.note : ''}`,
        level: action === 'ignore' ? 'warn' : 'info',
      });
      saveDB();
      broadcast('alerts', alertsPayload(db));
      return ok(res, alert, action === 'ack' ? '告警已确认' : action === 'ignore' ? '告警已忽略' : '告警已解决');
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 城市 ===== */
  if (root === 'cities') {
    if (['POST', 'PUT', 'DELETE'].includes(method) && !requireAccountRole(db, res, req, ['admin'])) return;
    if (method === 'GET' && !second) {
      return ok(
        res,
        db.cities.map((c) => ({
          ...c,
          stationCount: db.stations.filter((s) => s.cityId === c.id).length,
        }))
      );
    }
    if (method === 'POST' && !second) {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const pinyin = String(body.pinyin || '').trim().toLowerCase();
      const code = String(body.code || '').trim().toUpperCase();
      if (!name) return fail(res, 400, '城市名称不能为空');
      if (!/^[a-zA-Z\s]+$/.test(pinyin)) return fail(res, 400, '拼音只能是英文字母');
      if (!code) return fail(res, 400, '城市代码不能为空');
      if (db.cities.some((c) => c.name === name)) return fail(res, 400, '城市已存在');
      if (db.cities.some((c) => c.code === code)) return fail(res, 400, '城市代码已存在');
      const city = { id: newId('c'), name, pinyin, code };
      db.cities.push(city);
      saveDB();
      return ok(res, city, '新增城市成功');
    }
    if (second) {
      const city = db.cities.find((c) => c.id === second);
      if (!city) return fail(res, 404, '城市不存在');
      if (method === 'PUT') {
        const body = await readBody(req);
        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) return fail(res, 400, '城市名称不能为空');
          if (db.cities.some((c) => c.id !== city.id && c.name === name))
            return fail(res, 400, '城市名称已存在');
          city.name = name;
        }
        if (body.pinyin !== undefined) {
          const pinyin = String(body.pinyin).trim().toLowerCase();
          if (!/^[a-zA-Z\s]+$/.test(pinyin)) return fail(res, 400, '拼音只能是英文字母');
          city.pinyin = pinyin;
        }
        if (body.code !== undefined) {
          const code = String(body.code).trim().toUpperCase();
          if (!code) return fail(res, 400, '城市代码不能为空');
          if (db.cities.some((c) => c.id !== city.id && c.code === code))
            return fail(res, 400, '城市代码已存在');
          city.code = code;
        }
        saveDB();
        return ok(res, city, '更新城市成功');
      }
      if (method === 'DELETE') {
        const stations = db.stations.filter((s) => s.cityId === city.id);
        if (stations.length) return fail(res, 400, `该城市下还有 ${stations.length} 个车站，请先删除车站`);
        db.cities = db.cities.filter((c) => c.id !== city.id);
        saveDB();
        return ok(res, null, '删除城市成功');
      }
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 车站 ===== */
  if (root === 'stations') {
    if (['POST', 'PUT', 'DELETE'].includes(method) && !requireAccountRole(db, res, req, ['admin'])) return;
    if (method === 'GET' && !second) {
      let list = db.stations.map((s) => {
        const city = findCity(db, s.cityId) || {};
        return {
          ...s,
          cityName: city.name || '-',
          cityCode: city.code || '-',
          trainCount: db.trains.filter((t) => t.fromStationId === s.id || t.toStationId === s.id).length,
        };
      });
      if (query.cityId) list = list.filter((s) => s.cityId === query.cityId);
      if (query.keyword) {
        const kw = String(query.keyword).trim().toLowerCase();
        list = list.filter(
          (s) => s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw) || s.cityName.includes(kw)
        );
      }
      return ok(res, list);
    }
    if (method === 'POST' && !second) {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const cityId = String(body.cityId || '').trim();
      const code = String(body.code || '').trim().toUpperCase();
      if (!name) return fail(res, 400, '车站名称不能为空');
      if (!findCity(db, cityId)) return fail(res, 400, '所属城市不存在');
      if (!code) return fail(res, 400, '电报码不能为空');
      if (db.stations.some((s) => s.name === name && s.cityId === cityId))
        return fail(res, 400, '该城市下已存在同名车站');
      if (db.stations.some((s) => s.code === code)) return fail(res, 400, '电报码已存在');
      const station = {
        id: newId('s'),
        name,
        cityId,
        code,
        status: ['maintenance', 'disabled'].includes(String(body.status)) ? String(body.status) : 'normal',
        gateCount: Math.max(1, Math.min(99, Number(body.gateCount) || 1)),
        platformCount: Math.max(1, Math.min(99, Number(body.platformCount) || 1)),
        address: String(body.address || '').slice(0, 80),
      };
      db.stations.push(station);
      saveDB();
      return ok(res, station, '新增车站成功');
    }
    if (second) {
      const station = findStation(db, second);
      if (!station) return fail(res, 404, '车站不存在');
      if (method === 'PUT') {
        const body = await readBody(req);
        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) return fail(res, 400, '车站名称不能为空');
          station.name = name;
        }
        if (body.cityId !== undefined) {
          const cityId = String(body.cityId).trim();
          if (!findCity(db, cityId)) return fail(res, 400, '所属城市不存在');
          station.cityId = cityId;
        }
        if (body.code !== undefined) {
          const code = String(body.code).trim().toUpperCase();
          if (!code) return fail(res, 400, '电报码不能为空');
          if (db.stations.some((s) => s.id !== station.id && s.code === code))
            return fail(res, 400, '电报码已存在');
          station.code = code;
        }
        if (body.status !== undefined) {
          station.status = ['maintenance', 'disabled'].includes(String(body.status)) ? String(body.status) : 'normal';
        }
        if (body.gateCount !== undefined) station.gateCount = Math.max(1, Math.min(99, Number(body.gateCount) || 1));
        if (body.platformCount !== undefined) station.platformCount = Math.max(1, Math.min(99, Number(body.platformCount) || 1));
        if (body.address !== undefined) station.address = String(body.address).slice(0, 80);
        saveDB();
        return ok(res, station, '更新车站成功');
      }
      if (method === 'DELETE') {
        const used = db.trains.filter((t) => t.fromStationId === station.id || t.toStationId === station.id);
        if (used.length) return fail(res, 400, `该车站被 ${used.length} 个车次使用，请先调整车次`);
        db.stations = db.stations.filter((s) => s.id !== station.id);
        saveDB();
        return ok(res, null, '删除车站成功');
      }
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 车次 ===== */
  if (root === 'trains') {
    if (['POST', 'PUT', 'DELETE'].includes(method) && !requireAccountRole(db, res, req, ['admin'])) return;
    if (method === 'GET' && !second) {
      const date = isValidDate(query.date) ? query.date : todayStr();
      let list = db.trains.map((t) => trainView(db, t, date));
      if (query.keyword) {
        const kw = String(query.keyword).trim().toLowerCase();
        list = list.filter(
          (t) =>
            t.trainNo.toLowerCase().includes(kw) ||
            t.fromStationName.includes(kw) ||
            t.toStationName.includes(kw)
        );
      }
      list.sort((a, b) => a.trainNo.localeCompare(b.trainNo));
      return ok(res, list);
    }
    if (method === 'POST' && !second) {
      const body = await readBody(req);
      const trainNo = String(body.trainNo || '').trim().toUpperCase();
      const type = String(body.type || '高速动车').trim();
      const fromStationId = String(body.fromStationId || '');
      const toStationId = String(body.toStationId || '');
      const departTime = String(body.departTime || '');
      const arriveTime = String(body.arriveTime || '');
      const seats = normalizeSeats(body.seats);
      const platform = String(body.platform || '1').trim();
      const gateInfo = normalizeTrainGates(body.gates !== undefined ? body.gates : body.gate);
      if (gateInfo.error) return fail(res, 400, gateInfo.error);
      const landmarkColor = String(body.landmarkColor || '蓝色').trim();
      const COLORS = ['蓝色', '黄色', '绿色', '紫色', '红色', '白色'];
      if (!/^[0-9A-Za-z-]{1,10}$/.test(platform)) return fail(res, 400, '站台号格式不正确，示例：1、2A');
      if (!COLORS.includes(landmarkColor)) return fail(res, 400, `地标颜色需为：${COLORS.join(' / ')}`);
      if (!/^[GDCZKTLY]\d{1,4}$/.test(trainNo)) return fail(res, 400, '车次号格式不正确，示例：G1、D2281');
      if (db.trains.some((t) => t.trainNo === trainNo)) return fail(res, 400, '车次号已存在');
      if (!findStation(db, fromStationId) || !findStation(db, toStationId))
        return fail(res, 400, '出发站或到达站不存在');
      if (fromStationId === toStationId) return fail(res, 400, '出发站与到达站不能相同');
      if (!isValidTime(departTime) || !isValidTime(arriveTime))
        return fail(res, 400, '出发/到达时间格式应为 HH:MM');
      if (seats.error) return fail(res, 400, seats.error);
      const train = {
        id: newId('t'),
        trainNo,
        type,
        fromStationId,
        toStationId,
        departTime,
        arriveTime,
        platform,
        gates: gateInfo.gates,
        gate: gateInfo.gate,
        landmarkColor,
        status: 'normal',
        delayMinutes: 0,
        tempGates: [],
        tempGate: '',
        tempPlatform: '',
        runtimeNote: '',
        runtimeByDate: {},
        seats: seats.list,
      };
      if (body.runtimeDate !== undefined) {
        const runtimeDate = String(body.runtimeDate || '');
        if (!isValidDate(runtimeDate)) return fail(res, 400, '运行调整日期格式不正确');
        const built = buildRuntimeEntry(body, null);
        if (built.error) return fail(res, 400, built.error);
        if (!isEmptyRuntimeEntry(built.entry)) train.runtimeByDate[runtimeDate] = built.entry;
      }
      const stops = normalizeTrainStops(db, body.stops);
      if (stops) train.stops = stops;
      db.trains.push(train);
      saveDB();
      return ok(res, train, '新增车次成功');
    }
    if (second && third === 'seatmap' && method === 'GET') {
      const train = db.trains.find((t) => t.id === second);
      if (!train) return fail(res, 404, '车次不存在');
      const date = isValidDate(query.date) ? query.date : todayStr();
      const seatType = String(query.seatType || '');
      const seat = (train.seats || []).find((s) => s.type === seatType);
      if (!seat) return fail(res, 400, '该车次没有此席别');
      const capacity = Math.max(Number(seat.total) || 0, quotaOf(db, train.id, date, seatType, seat.total));
      const bitmap = bitmapFromOrders(db.orders, train.id, date, seatType, capacity);
      return ok(res, {
        trainId: train.id,
        date,
        seatType,
        capacity,
        occupied: bitmap.count(),
        remaining: Math.max(0, capacity - bitmap.count()),
        bits: bitmap.toBase64(),
      });
    }
    if (second) {
      const train = db.trains.find((t) => t.id === second);
      if (!train) return fail(res, 404, '车次不存在');
      if (method === 'PUT') {
        const body = await readBody(req);
        const runtimeDate = body.runtimeDate !== undefined ? String(body.runtimeDate || '') : '';
        if (runtimeDate) {
          if (!isValidDate(runtimeDate)) return fail(res, 400, '运行调整日期格式不正确');
          if (!train.runtimeByDate || typeof train.runtimeByDate !== 'object') train.runtimeByDate = {};
          const built = buildRuntimeEntry(body, train.runtimeByDate[runtimeDate]);
          if (built.error) return fail(res, 400, built.error);
          if (isEmptyRuntimeEntry(built.entry)) delete train.runtimeByDate[runtimeDate];
          else train.runtimeByDate[runtimeDate] = built.entry;
        }
        if (body.trainNo !== undefined) {
          const trainNo = String(body.trainNo).trim().toUpperCase();
          if (!/^[GDCZKTLY]\d{1,4}$/.test(trainNo)) return fail(res, 400, '车次号格式不正确');
          if (db.trains.some((t) => t.id !== train.id && t.trainNo === trainNo))
            return fail(res, 400, '车次号已存在');
          train.trainNo = trainNo;
        }
        if (body.type !== undefined) train.type = String(body.type).trim() || train.type;
        if (body.fromStationId !== undefined) {
          if (!findStation(db, body.fromStationId)) return fail(res, 400, '出发站不存在');
          train.fromStationId = String(body.fromStationId);
        }
        if (body.toStationId !== undefined) {
          if (!findStation(db, body.toStationId)) return fail(res, 400, '到达站不存在');
          train.toStationId = String(body.toStationId);
        }
        if (train.fromStationId === train.toStationId) return fail(res, 400, '出发站与到达站不能相同');
        if (body.departTime !== undefined) {
          if (!isValidTime(body.departTime)) return fail(res, 400, '出发时间格式应为 HH:MM');
          train.departTime = body.departTime;
        }
        if (body.arriveTime !== undefined) {
          if (!isValidTime(body.arriveTime)) return fail(res, 400, '到达时间格式应为 HH:MM');
          train.arriveTime = body.arriveTime;
        }
        if (body.platform !== undefined) {
          const v = String(body.platform).trim();
          if (!/^[0-9A-Za-z-]{1,10}$/.test(v)) return fail(res, 400, '站台号格式不正确');
          train.platform = v;
        }
        if (body.gates !== undefined || body.gate !== undefined) {
          const gateInfo = normalizeTrainGates(body.gates !== undefined ? body.gates : body.gate);
          if (gateInfo.error) return fail(res, 400, gateInfo.error);
          train.gates = gateInfo.gates;
          train.gate = gateInfo.gate;
        }
        if (!runtimeDate) {
          if (body.status !== undefined) {
            const status = String(body.status);
            if (!['normal', 'delayed', 'cancelled', 'maintenance'].includes(status))
              return fail(res, 400, '运行状态仅支持 normal / delayed / cancelled / maintenance');
            train.status = status;
            if (status !== 'delayed') train.delayMinutes = 0;
          }
          if (body.delayMinutes !== undefined) {
            train.delayMinutes = Math.max(0, Math.min(240, Number(body.delayMinutes) || 0));
            if (train.delayMinutes > 0 && train.status !== 'cancelled' && train.status !== 'maintenance')
              train.status = 'delayed';
          }
          if (body.tempGate !== undefined || body.tempGates !== undefined) {
            const tempInfo = optionalTrainGates(body.tempGates !== undefined ? body.tempGates : body.tempGate);
            if (tempInfo.error) return fail(res, 400, tempInfo.error);
            train.tempGates = tempInfo.gates;
            train.tempGate = tempInfo.gate || '';
          }
          if (body.tempPlatform !== undefined) {
            const v = String(body.tempPlatform).trim();
            if (v && !/^[0-9A-Za-z-]{1,10}$/.test(v)) return fail(res, 400, '临时站台格式不正确');
            train.tempPlatform = v;
          }
          if (body.runtimeNote !== undefined) train.runtimeNote = String(body.runtimeNote).trim().slice(0, 120);
        }
        if (body.landmarkColor !== undefined) {
          const COLORS = ['蓝色', '黄色', '绿色', '紫色', '红色', '白色'];
          const v = String(body.landmarkColor).trim();
          if (!COLORS.includes(v)) return fail(res, 400, `地标颜色需为：${COLORS.join(' / ')}`);
          train.landmarkColor = v;
        }
        if (body.seats !== undefined) {
          const seats = normalizeSeats(body.seats);
          if (seats.error) return fail(res, 400, seats.error);
          train.seats = seats.list;
        }
        if (body.stops !== undefined) {
          const stops = normalizeTrainStops(db, body.stops);
          if (!stops) return fail(res, 400, '经停站配置无效，请至少选择两个车站');
          train.stops = stops;
        }
        saveDB();
        return ok(res, train, '更新车次成功');
      }
      if (method === 'DELETE') {
        db.trains = db.trains.filter((t) => t.id !== train.id);
        saveDB();
        return ok(res, null, '删除车次成功');
      }
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 车票管理（按日期设置票额） ===== */
  if (root === 'tickets') {
    if (['POST', 'PUT', 'DELETE'].includes(method) && !requireAccountRole(db, res, req, ['admin'])) return;
    if (method === 'GET' && !second) {
      const date = isValidDate(query.date) ? query.date : todayStr();
      let list = ticketRows(db, date);
      if (query.keyword) {
        const kw = String(query.keyword).trim().toLowerCase();
        list = list.filter(
          (t) =>
            t.trainNo.toLowerCase().includes(kw) ||
            t.fromStationName.includes(kw) ||
            t.toStationName.includes(kw)
        );
      }
      return ok(res, { date, total: list.length, list });
    }
    if (method === 'PUT' && second) {
      const body = await readBody(req);
      const date = isValidDate(body.date) ? body.date : todayStr();
      const train = db.trains.find((t) => t.id === second);
      if (!train) return fail(res, 404, '车次不存在');
      if (!Array.isArray(body.seats) || !body.seats.length)
        return fail(res, 400, '请提交要设置的席别票额');
      const input = {};
      for (const item of body.seats) {
        const type = String(item.type || '').trim();
        const quota = Number(item.quota);
        if (!(train.seats || []).some((s) => s.type === type))
          return fail(res, 400, `该车次没有席别：${type || '空'}`);
        if (!Number.isInteger(quota) || quota < 0) return fail(res, 400, `${type} 票额必须是非负整数`);
        const sold = soldCount(db, train.id, date, type);
        if (quota < sold) return fail(res, 400, `${type} 票额不能小于已售 ${sold} 张`);
        input[type] = quota;
      }
      let row = db.quotas.find((q) => q.trainId === train.id && q.date === date);
      if (!row) {
        row = { id: newId('q'), trainId: train.id, date, seats: [] };
        db.quotas.push(row);
      }
      // 以车次席别为基准合并，未提交的席别保持原票额（默认定员）
      const next = (train.seats || []).map((s) => {
        const old = (row.seats || []).find((x) => x.type === s.type);
        const quota = input[s.type] !== undefined ? input[s.type] : old ? old.quota : s.total;
        return { type: s.type, quota };
      });
      row.seats = next;
      row.updatedAt = new Date().toISOString();
      saveDB();
      const view = ticketRows(db, date).find((t) => t.trainId === train.id);
      return ok(res, view, '票额已保存');
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 系统设置 ===== */
  if (root === 'settings') {
    if (method === 'GET') {
      return ok(res, db.settings || { ...DEFAULT_SETTINGS });
    }
    if (method === 'PUT') {
      if (!requireAccountRole(db, res, req, ['admin'])) return;
      const body = await readBody(req);
      const current = db.settings || { ...DEFAULT_SETTINGS };
      const next = { ...current };
      if (body.siteName !== undefined) {
        const v = String(body.siteName).trim();
        if (!v || v.length > 30) return fail(res, 400, '系统名称长度需在 1~30 个字符');
        next.siteName = v;
      }
      if (body.subtitle !== undefined) {
        const v = String(body.subtitle).trim();
        if (v.length > 30) return fail(res, 400, '副标题不能超过 30 个字符');
        next.subtitle = v;
      }
      if (body.announcement !== undefined) {
        const v = String(body.announcement).trim();
        if (v.length > 200) return fail(res, 400, '公告不能超过 200 个字符');
        next.announcement = v;
      }
      if (body.maxPassengersPerOrder !== undefined) {
        const v = Number(body.maxPassengersPerOrder);
        if (!Number.isInteger(v) || v < 1 || v > 20)
          return fail(res, 400, '单笔订单乘客数需为 1~20 的整数');
        next.maxPassengersPerOrder = v;
      }
      if (body.presaleDays !== undefined) {
        const v = Number(body.presaleDays);
        if (!Number.isInteger(v) || v < 1 || v > 90)
          return fail(res, 400, '预售天数需为 1~90 的整数');
        next.presaleDays = v;
      }
      if (body.paymentTimeoutMinutes !== undefined) {
        const v = Number(body.paymentTimeoutMinutes);
        if (!Number.isInteger(v) || v < 1 || v > 120)
          return fail(res, 400, '支付超时时间需为 1~120 分钟的整数');
        next.paymentTimeoutMinutes = v;
      }
      if (body.refundEnabled !== undefined) next.refundEnabled = Boolean(body.refundEnabled);
      if (body.servicePhone !== undefined) {
        const v = String(body.servicePhone).trim();
        if (v.length > 20) return fail(res, 400, '客服电话不能超过 20 个字符');
        next.servicePhone = v;
      }
      if (body.refundRules !== undefined) {
        if (!Array.isArray(body.refundRules) || !body.refundRules.length)
          return fail(res, 400, '退票手续费规则不能为空');
        const rules = [];
        for (const r of body.refundRules) {
          const hoursBefore = Number(r.hoursBefore);
          const feeRate = Number(r.feeRate);
          if (!Number.isFinite(hoursBefore) || hoursBefore < 0 || hoursBefore > 240)
            return fail(res, 400, '退票规则的提前小时数需在 0~240 之间');
          if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1)
            return fail(res, 400, '退票手续费率需在 0~1 之间');
          rules.push({ hoursBefore, feeRate });
        }
        next.refundRules = rules;
      }
      if (body.changeFeeRate !== undefined) {
        const v = Number(body.changeFeeRate);
        if (!Number.isFinite(v) || v < 0 || v > 1) return fail(res, 400, '改签手续费率需在 0~1 之间');
        next.changeFeeRate = v;
      }
      if (body.childDiscount !== undefined) {
        const v = Number(body.childDiscount);
        if (!Number.isFinite(v) || v <= 0 || v > 1) return fail(res, 400, '儿童票折扣需在 0~1 之间');
        next.childDiscount = v;
      }
      if (body.checkinMinutes !== undefined) {
        const v = Number(body.checkinMinutes);
        if (!Number.isInteger(v) || v < 5 || v > 120) return fail(res, 400, '开检提前分钟数需为 5~120 的整数');
        next.checkinMinutes = v;
      }
      /* 铁路品牌与模组票价参数 */
      if (body.systemName !== undefined) {
        const v = String(body.systemName).trim();
        if (!v || v.length > 40) return fail(res, 400, '铁路系统名称长度需在 1~40 个字符');
        next.systemName = v;
      }
      if (body.logoUrl !== undefined) {
        const v = String(body.logoUrl).trim();
        if (v.length > 200) return fail(res, 400, 'LOGO 地址不能超过 200 个字符');
        next.logoUrl = v;
      }
      if (body.railwayBureau !== undefined) {
        next.railwayBureau = String(body.railwayBureau).trim().slice(0, 40);
      }
      if (body.railwayCurrency !== undefined) {
        const currency = String(body.railwayCurrency || '').trim().slice(0, 32);
        next.railwayCurrency = currency || 'emerald';
      }
      if (body.farePerBlock !== undefined) {
        const v = Number(body.farePerBlock);
        if (!Number.isFinite(v) || v < 0.001 || v > 10) return fail(res, 400, '每格票价系数需在 0.001~10 之间');
        next.farePerBlock = v;
      }
      if (body.minFare !== undefined) {
        const v = Number(body.minFare);
        if (!Number.isFinite(v) || v < 0 || v > 64) return fail(res, 400, '最低票价需在 0~64 绿宝石之间');
        next.minFare = v;
      }
      if (body.maxFare !== undefined) {
        const v = Number(body.maxFare);
        if (!Number.isFinite(v) || v < 1 || v > 999) return fail(res, 400, '最高票价需在 1~999 绿宝石之间');
        next.maxFare = v;
      }
      if (body.railwayAdminToken !== undefined) {
        next.railwayAdminToken = String(body.railwayAdminToken).trim().slice(0, 80);
      }
      if (body.entryWelcomeText !== undefined) {
        const v = String(body.entryWelcomeText).trim();
        if (!v || v.length > 80) return fail(res, 400, '入站欢迎语长度需在 1~80 个字符');
        next.entryWelcomeText = v;
      }
      if (body.exitWelcomeText !== undefined) {
        const v = String(body.exitWelcomeText).trim();
        if (!v || v.length > 80) return fail(res, 400, '出站欢送语长度需在 1~80 个字符');
        next.exitWelcomeText = v;
      }
      if (body.announcementEnabled !== undefined) next.announcementEnabled = Boolean(body.announcementEnabled);
      if (body.announcementOnStart !== undefined) next.announcementOnStart = Boolean(body.announcementOnStart);
      if (body.announcementRepeat !== undefined) next.announcementRepeat = Boolean(body.announcementRepeat);
      if (body.announcementShowMode !== undefined) {
        next.announcementShowMode = body.announcementShowMode === 'modal' ? 'modal' : 'top';
      }
      if (body.footerCopyright !== undefined) {
        const v = String(body.footerCopyright).trim();
        if (v.length > 60) return fail(res, 400, '版权信息不能超过 60 个字符');
        next.footerCopyright = v;
      }
      if (body.footerIcp !== undefined) {
        const v = String(body.footerIcp).trim();
        if (v.length > 80) return fail(res, 400, 'ICP 备案号不能超过 80 个字符');
        next.footerIcp = v;
      }
      if (body.footerPolice !== undefined) {
        const v = String(body.footerPolice).trim();
        if (v.length > 80) return fail(res, 400, '公安备案号不能超过 80 个字符');
        next.footerPolice = v;
      }
      if (body.footerPoliceNo !== undefined) {
        const v = String(body.footerPoliceNo).trim();
        if (v.length > 30) return fail(res, 400, '公安备案编号不能超过 30 个字符');
        next.footerPoliceNo = v;
      }
      if (body.maintenanceText !== undefined) {
        const v = String(body.maintenanceText).trim();
        if (!v || v.length > 80) return fail(res, 400, '维修提示长度需在 1~80 个字符');
        next.maintenanceText = v;
      }
      if (body.liveDetection !== undefined) next.liveDetection = Boolean(body.liveDetection);
      if (body.showScanPreview !== undefined) next.showScanPreview = Boolean(body.showScanPreview);
      if (body.ticketQrRefreshSeconds !== undefined) {
        const v = Number(body.ticketQrRefreshSeconds);
        if (!Number.isInteger(v) || v < 10 || v > 180) return fail(res, 400, '二维码刷新间隔需为 10~180 秒');
        next.ticketQrRefreshSeconds = v;
      }
      db.settings = next;
      railwayRecalcAutoFares(db);
      saveDB();
      return ok(res, next, '设置已保存，自动票价已按新系数重算');
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 安全：IP 黑名单 ===== */
  if (root === 'security') {
    if (!requireAccountRole(db, res, req, ['admin'])) return;
    if (second === 'blacklist' && method === 'GET') {
      const sec = securityState(db);
      const now = Date.now();
      return ok(res, {
        blockedIps: sec.blockedIps.filter((row) => Number(row.until) > now),
        policy: Object.fromEntries(Object.entries(RATE_POLICIES).map(([k, p]) => [k, {
          capacity: p.capacity,
          refillPerSecond: p.refillPerSecond,
          blockAfter: p.blockAfter,
          blockMinutes: Math.round(p.blockMs / 60000),
        }])),
      });
    }
    if (second === 'blacklist' && method === 'POST') {
      const body = await readBody(req);
      const ip = String(body.ip || '').trim();
      const minutes = Math.min(1440, Math.max(1, Number(body.minutes) || 60));
      if (!/^[0-9a-zA-Z.:-]{1,64}$/.test(ip)) return fail(res, 400, 'IP 格式不正确');
      const sec = securityState(db);
      const now = Date.now();
      sec.blockedIps = sec.blockedIps.filter((row) => Number(row.until) > now && row.ip !== ip);
      sec.blockedIps.push({ ip, until: now + minutes * 60 * 1000, reason: String(body.reason || '管理员手动封禁').slice(0, 80), at: new Date(now).toISOString() });
      addLog(db, { action: 'security.ip_block', actor: 'admin', role: 'admin', target: ip, detail: `管理员封禁 ${minutes} 分钟`, level: 'warn' });
      saveDB();
      return ok(res, sec.blockedIps, 'IP 已加入黑名单');
    }
    if (second === 'blacklist' && method === 'DELETE') {
      const ip = String(query.ip || '').trim();
      const sec = securityState(db);
      const before = sec.blockedIps.length;
      sec.blockedIps = sec.blockedIps.filter((row) => row.ip !== ip);
      if (sec.blockedIps.length === before) return fail(res, 404, '该 IP 不在黑名单中');
      addLog(db, { action: 'security.ip_unblock', actor: 'admin', role: 'admin', target: ip, detail: '管理员解除封禁', level: 'info' });
      saveDB();
      return ok(res, sec.blockedIps, 'IP 已解封');
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== hCaptcha ===== */
  if (root === 'captcha') {
    if (method === 'GET') {
      if (!hcaptchaEnabled) {
        return fail(res, 503, 'hCaptcha 未完成配置，请先在 config.toml 的 [hCaptcha] 中填写 siteKey 与 secret');
      }
      return ok(res, {
        provider: 'hcaptcha',
        siteKey: hcaptchaSiteKey,
        prompt: '请完成 hCaptcha 人机验证',
        expiresIn: CAPTCHA_TOKEN_TTL / 1000,
      });
    }
    if (method === 'POST' && second === 'verify') {
      const body = await readBody(req);
      if (!hcaptchaEnabled) {
        return fail(res, 503, 'hCaptcha 未完成配置，请先在 config.toml 的 [hCaptcha] 中填写 siteKey 与 secret');
      }
      const response = String(body.response || '').trim();
      if (!response) return fail(res, 400, '请先完成 hCaptcha 验证');
      try {
        const result = await verifyHcaptcha(response, req);
        if (!result.success) {
          const code = Array.isArray(result['error-codes']) ? result['error-codes'].join(', ') : '';
          return fail(res, 400, 'hCaptcha 验证失败' + (code ? `：${code}` : ''));
        }
      } catch (err) {
        return fail(res, 502, `hCaptcha 校验服务暂时不可用：${err.message}`);
      }
      const token = newToken('capok');
      captchaTokens.set(token, Date.now() + CAPTCHA_TOKEN_TTL);
      return ok(res, { token, expiresIn: CAPTCHA_TOKEN_TTL / 1000 }, '人机验证通过');
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 动态电子客票二维码 ===== */
  if (root === 'qrcode' && second === 'ticket' && method === 'GET') {
    const orderNo = String(query.orderNo || '').trim();
    if (!orderNo) return fail(res, 400, '缺少订单号');
    const order = (db.orders || []).find((o) => o.orderNo === orderNo || o.id === orderNo);
    if (!order) return fail(res, 404, '订单不存在');
    if (order.status !== 'paid') return fail(res, 400, '该订单不可生成有效二维码');
    try {
      const paper = String(query.mode || '') === 'paper';
      const payload = paper ? `QJ|${order.orderNo}` : makePayload(QR_SECRET, order.orderNo);
      const buf = await QRCode.toBuffer(payload, {
        type: 'png',
        width: 320,
        margin: 1,
        color: { dark: '#123f78', light: '#ffffff' },
      });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
      return;
    } catch (e) {
      return fail(res, 500, '二维码生成失败');
    }
  }

  /* ===== 二维码 ===== */
  if (root === 'qrcode' && method === 'GET') {
    const text = String(query.text || '').slice(0, 500);
    if (!text) return fail(res, 400, '缺少二维码内容');
    try {
      const buf = await QRCode.toBuffer(text, {
        type: 'png',
        width: 320,
        margin: 1,
        color: { dark: '#123f78', light: '#ffffff' },
      });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
      return;
    } catch (e) {
      return fail(res, 500, '二维码生成失败');
    }
  }

  /* ===== 后台当前账号 ===== */
  if (root === 'admin_info' && method === 'GET') {
    const account = requireAccountRole(db, res, req);
    if (!account) return;
    return ok(res, {
      userId: account.id,
      username: account.username,
      realName: account.name,
      role: account.role,
      permissions: permissionsForRole(account.role),
    });
  }

  /* ===== 后台账号 ===== */
  if (root === 'accounts') {
    if (method === 'GET' && second === 'me') {
      const account = requireAccountRole(db, res, req);
      if (!account) return;
      return ok(res, {
        id: account.id,
        username: account.username,
        name: account.name,
        role: account.role,
        phone: account.phone || '',
        enabled: account.enabled !== false,
        permissions: permissionsForRole(account.role),
      });
    }
    if (method === 'POST' && second === 'login') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const account = db.accounts.find((a) => a.username === username);
      if (!account || account.password !== hashPassword(password))
        return fail(res, 400, '账号或密码不正确');
      if (account.enabled === false) return fail(res, 403, '该账号已停用，请联系管理员');
      const token = issueToken(adminTokens, account.id, { role: account.role });
      addLog(db, { action: 'account.login', actor: account.username, role: account.role, target: '后台', detail: '登录成功' });
      saveDB();
      return ok(
        res,
        {
          token,
          account: {
            id: account.id,
            username: account.username,
            name: account.name,
            role: account.role,
            phone: account.phone || '',
            enabled: account.enabled !== false,
            permissions: permissionsForRole(account.role),
          },
        },
        '登录成功'
      );
    }
    if (method === 'GET' && !second) {
      if (!requireAccountRole(db, res, req, ['admin'])) return;
      return ok(
        res,
        db.accounts.map((a) => ({
          id: a.id,
          username: a.username,
          name: a.name,
          role: a.role,
          phone: a.phone || '',
          enabled: a.enabled !== false,
          createdAt: a.createdAt,
        }))
      );
    }
    if (method === 'POST' && !second) {
      if (!requireAccountRole(db, res, req, ['admin'])) return;
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const name = String(body.name || '').trim() || username;
      const role = String(body.role || 'operator');
      const password = String(body.password || '');
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return fail(res, 400, '账号需为 3~20 位字母、数字或下划线');
      if (db.accounts.some((a) => a.username === username)) return fail(res, 400, '账号已存在');
      if (!['admin', 'operator', 'inspector'].includes(role)) return fail(res, 400, '角色不正确');
      if (password.length < 6 || password.length > 32) return fail(res, 400, '密码长度需为 6~32 位');
      const account = {
        id: newId('a'),
        username,
        name,
        role,
        phone: String(body.phone || '').trim(),
        enabled: true,
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      db.accounts.push(account);
      saveDB();
      return ok(res, { id: account.id, username, name, role, phone: account.phone, enabled: true }, '账号已创建');
    }
    if (second) {
      if (!requireAccountRole(db, res, req, ['admin'])) return;
      const account = db.accounts.find((a) => a.id === second);
      if (!account) return fail(res, 404, '账号不存在');
      if (method === 'PUT' && third === 'password') {
        const body = await readBody(req);
        const password = String(body.password || '');
        if (password.length < 6 || password.length > 32) return fail(res, 400, '密码长度需为 6~32 位');
        account.password = hashPassword(password);
        saveDB();
        return ok(res, null, '密码已修改');
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        if (body.name !== undefined) account.name = String(body.name).trim() || account.name;
        if (body.role !== undefined) {
          const role = String(body.role);
          if (!['admin', 'operator', 'inspector'].includes(role)) return fail(res, 400, '角色不正确');
          account.role = role;
        }
        if (body.password !== undefined) {
          const password = String(body.password || '');
          if (password.length < 6 || password.length > 32) return fail(res, 400, '密码长度需为 6~32 位');
          account.password = hashPassword(password);
        }
        saveDB();
        return ok(res, { id: account.id, username: account.username, name: account.name, role: account.role }, '账号已更新');
      }
      if (method === 'DELETE') {
        if (account.role === 'admin' && db.accounts.filter((a) => a.role === 'admin').length <= 1)
          return fail(res, 400, '至少保留一个管理员账号');
        db.accounts = db.accounts.filter((a) => a.id !== account.id);
        saveDB();
        return ok(res, null, '账号已删除');
      }
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 补票（车站窗口） ===== */
  if (root === 'supplement') {
    if (!requireAccountRole(db, res, req, ['admin'])) return;
    /* 越站补差报价与停靠站 */
    if (method === 'GET' && second === 'quote') {
      const train = db.trains.find((t) => t.id === String(query.trainId || ''));
      if (!train) return fail(res, 400, '车次不存在');
      const quote = quoteSegmentFare(
        db,
        train,
        String(query.seatType || ''),
        String(query.fromStationId || ''),
        String(query.toStationId || '')
      );
      if (quote.error) return fail(res, 400, quote.error);
      return ok(res, {
        fare: quote.fare,
        segmentKm: quote.segmentKm,
        totalKm: quote.totalKm,
        from: quote.from,
        to: quote.to,
        stops: quote.stops,
      });
    }
    /* 载入原票信息 */
    if (method === 'GET' && second === 'original') {
      const order = db.orders.find((o) => o.orderNo === String(query.orderNo || ''));
      if (!order) return fail(res, 404, '原订单号不存在');
      const view = orderView(db, order);
      return ok(res, {
        orderNo: order.orderNo,
        trainId: order.trainId,
        trainNo: order.trainNo,
        date: order.date,
        seatType: order.seatType,
        contactPhone: order.contactPhone,
        status: order.status,
        route: view.route,
        passengers: (order.passengers || []).map((p) => ({
          name: p.name,
          idType: p.idType,
          idNo: p.idNo,
          type: p.type,
          seatNo: p.seatNo || '',
        })),
      });
    }
    if (method === 'GET' && !second) {
      const kw = String(query.keyword || '').trim();
      let list = db.orders.filter((o) => o.source === 'supplement');
      if (kw) {
        list = list.filter(
          (o) =>
            o.orderNo.includes(kw) ||
            (o.contactPhone || '').includes(kw) ||
            (o.passengers || []).some((p) => p.name.includes(kw) || p.idNo.includes(kw))
        );
      }
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return ok(res, list.map((o) => orderView(db, o)));
    }
    if (method === 'POST' && !second) {
      const body = await readBody(req);
      const phone = String(body.phone || '').trim();
      const user = db.users.find((u) => u.phone === phone);
      if (!user) return fail(res, 400, '补票旅客需先注册前台账号并绑定手机号');
      const train = db.trains.find((t) => t.id === body.trainId);
      if (!train) return fail(res, 400, '车次不存在');
      const date = String(body.date || '');
      if (!isValidDate(date)) return fail(res, 400, '乘车日期格式不正确');
      if (date < todayStr()) return fail(res, 400, '乘车日期不能早于今天');
      const reason = String(body.reason || '无票补票').trim();
      const allowedReasons = ['无票补票', '无座补票', '越站补票', '丢失车票补票', '下车补票', '其他'];
      if (!allowedReasons.includes(reason)) return fail(res, 400, '补票原因不正确');
      const seat =
        (train.seats || []).find((s) => s.type === body.seatType) ||
        (reason === '无座补票' ? (train.seats || []).find((s) => s.type === '二等座') : null);
      if (!seat) return fail(res, 400, '该车次没有此席别');
      const presaleDays = (db.settings && db.settings.presaleDays) || 30;
      const latest = new Date();
      latest.setDate(latest.getDate() + presaleDays);
      const latestStr = `${latest.getFullYear()}-${pad(latest.getMonth() + 1)}-${pad(latest.getDate())}`;
      if (date > latestStr) return fail(res, 400, `最多只能补 ${presaleDays} 天内的车票`);

      const originalOrderNo = String(body.originalOrderNo || '').trim();
      const originalOrder = originalOrderNo
        ? db.orders.find((o) => o.orderNo === originalOrderNo)
        : null;
      if (originalOrderNo && !originalOrder) return fail(res, 400, '原订单号不存在');
      const isLost = reason === '丢失车票补票';
      const isOverTravel = reason === '越站补票';
      const isStanding = reason === '无座补票';
      if (isStanding && !(train.seats || []).some((s) => s.type === '二等座')) {
        return fail(res, 400, '该车次没有二等座，无法按二等座价为无座补票计价');
      }
      const isAfterTravel = reason === '下车补票';
      const noSeat = isStanding || isAfterTravel;
      const needsSeat = !isLost && !noSeat;

      let segment = null;
      if (isLost) {
        if (!originalOrder) return fail(res, 400, '挂失补办必须填写原订单号');
        if (originalOrder.status !== 'paid') return fail(res, 400, '原订单不是有效已支付车票');
        if (originalOrder.trainId !== train.id || originalOrder.date !== date) {
          return fail(res, 400, '原订单与本次补票车次或日期不一致');
        }
        const already = db.orders.some(
          (o) => o.source === 'supplement' && o.reissueOf === originalOrderNo && o.status === 'paid'
        );
        if (already) return fail(res, 400, '该原票已办理过挂失补办');
      }
      if (isOverTravel) {
        const fromStationId = String(body.fromStationId || '');
        const toStationId = String(body.toStationId || '');
        if (!fromStationId || !toStationId) return fail(res, 400, '越站补票需选择原到站和越站到站');
        const quote = quoteSegmentFare(db, train, seat.type, fromStationId, toStationId);
        if (quote.error) return fail(res, 400, quote.error);
        segment = quote;
      }

      const normalized = normalizePassenger(
        {
          name: body.name,
          idType: body.idType || '身份证',
          idNo: body.idNo,
          phone,
          type: body.type || '成人',
        },
        phone
      );
      if (normalized.error) return fail(res, 400, normalized.error);
      const passenger = normalized.value;

      let originalPassenger = null;
      if (isLost) {
        originalPassenger = (originalOrder.passengers || []).find(
          (p) => String(p.idNo || '').toUpperCase() === passenger.idNo
        );
        if (!originalPassenger) return fail(res, 400, '原订单中不存在该旅客，不能办理挂失补办');
      }

      if (!isLost && !isOverTravel) {
        const duplicate = db.orders.some(
          (o) =>
            o.status === 'paid' &&
            o.trainId === train.id &&
            o.date === date &&
            (o.passengers || []).some((p) => String(p.idNo || '').toUpperCase() === passenger.idNo)
        );
        if (duplicate) return fail(res, 400, '该旅客在此车次已有有效车票，无需重复补票');
      }

      if (needsSeat) {
        const remaining = quotaOf(db, train.id, date, seat.type, seat.total) - soldCount(db, train.id, date, seat.type);
        const needed = 1;
        if (remaining < needed) return fail(res, 400, `余票不足，${seat.type}已无票`);
      }

      const settings = db.settings || DEFAULT_SETTINGS;
      const savedPassenger = db.passengers.find(
        (p) => p.userId === user.id && String(p.idNo || '').toUpperCase() === passenger.idNo
      );
      const fareSeat = isStanding
        ? (train.seats || []).find((s) => s.type === '二等座') || seat
        : seat;
      const afterTravelFee = isAfterTravel ? 2 : 0;
      const ticketPrice = isLost
        ? 2
        : isOverTravel
          ? segment.fare
          : Number((passengerPrice(fareSeat, passenger.type, settings) + afterTravelFee).toFixed(2));
      const priced = [{
        ...passenger,
        price: Number(ticketPrice.toFixed(2)),
        passengerId: savedPassenger ? savedPassenger.id : '',
        faceDescriptor:
          savedPassenger && Array.isArray(savedPassenger.faceDescriptor) && savedPassenger.faceDescriptor.length === 128
            ? savedPassenger.faceDescriptor
            : undefined,
      }];

      if (isLost) {
        priced[0].seatNo = originalPassenger.seatNo || '';
        priced[0].seatIndex = Number.isInteger(originalPassenger.seatIndex) ? originalPassenger.seatIndex : undefined;
      } else if (noSeat) {
        priced[0].seatNo = '无座';
        priced[0].seatIndex = undefined;
        if (isAfterTravel) {
          priced[0].checkedIn = true;
          priced[0].checkedInAt = new Date().toISOString();
        }
      } else {
        const seatResult = assignSeatsToPassengers(db, train, date, seat.type, priced);
        if (seatResult && seatResult.error) return fail(res, 400, seatResult.error);
      }

      const order = {
        id: newId('o'),
        orderNo: genOrderNo(),
        userId: user.id,
        userPhone: user.phone,
        trainId: train.id,
        trainNo: train.trainNo,
        date,
        seatType: noSeat ? '无座' : seat.type,
        fareSeatType: noSeat ? fareSeat.type : seat.type,
        price: Number((noSeat ? passengerPrice(fareSeat, '成人', settings) : seat.price).toFixed(2)),
        totalPrice: Number(priced[0].price.toFixed(2)),
        status: 'paid',
        contactPhone: phone,
        passengers: priced,
        createdAt: new Date().toISOString(),
        source: 'supplement',
        supplementReason: reason,
        originalOrderNo,
        seatHolding: needsSeat,
        noSeat,
        afterTravel: isAfterTravel,
        afterTravelFee,
        reissueOf: isLost ? originalOrderNo : '',
        segment: isOverTravel
          ? {
              fromStationId: segment.from.stationId,
              fromStationName: segment.from.name,
              toStationId: segment.to.stationId,
              toStationName: segment.to.name,
              segmentKm: segment.segmentKm,
              totalKm: segment.totalKm,
            }
          : null,
        routeOverride: isOverTravel
          ? {
              fromStationName: segment.from.name,
              toStationName: segment.to.name,
              fromCityName: (findCity(db, (findStation(db, segment.from.stationId) || {}).cityId) || {}).name || '',
              toCityName: (findCity(db, (findStation(db, segment.to.stationId) || {}).cityId) || {}).name || '',
              durationText: `越站补差 ${segment.segmentKm} 公里`,
            }
          : null,
        agent: String(body.agent || 'operator').slice(0, 20),
        checkedIn: isAfterTravel,
        checkedInAt: isAfterTravel ? new Date().toISOString() : '',
        invoiceNo: '',
      };
      if (isLost) {
        originalOrder.lostReported = true;
        originalOrder.lostReportedAt = new Date().toISOString();
        originalOrder.lostReissueOrderNo = order.orderNo;
        originalOrder.voided = true;
        originalOrder.voidedReason = '挂失补办';
      }
      db.orders.push(order);
      addLog(db, {
        action: 'ticket.supplement',
        actor: 'operator',
        role: 'operator',
        target: order.orderNo,
        detail: `补票 ${train.trainNo} ${date} ${seat.type} ${passenger.name} ${reason}` +
          (isLost ? `（挂失补办，原票 ${originalOrderNo}，不占新座）` : '') +
          (isOverTravel ? `（${segment.from.name}→${segment.to.name}，补差 ¥${segment.fare.toFixed(2)}）` : '') +
          (isStanding ? '（无座，不占座）' : '') +
          (isAfterTravel ? '（下车补票，行程已完成，不占座）' : ''),
        level: 'info',
      });
      saveDB();
      broadcast('order', { orderNo: order.orderNo, status: order.status, source: order.source });
      const message = isLost
        ? `挂失补办成功，${priced[0].seatNo ? '沿用原座位 ' + priced[0].seatNo : '原票无座位信息'}，不占用新座位`
        : isOverTravel
          ? `越站补票成功，补差 ¥${segment.fare.toFixed(2)}`
          : isStanding
            ? '无座补票成功，已出无座票，不占用座位'
            : isAfterTravel
              ? '下车补票成功，已按已完成行程登记，不占用座位'
              : '补票成功';
      return ok(res, orderView(db, order), message);

    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 发票管理（后台） ===== */
  if (root === 'invoices') {
    if (!requireAccountRole(db, res, req, ['admin'])) return;
    const order = second ? db.orders.find((o) => o.id === second || o.orderNo === second) : null;
    if (method === 'GET' && !second) {
      let list = db.orders.filter((o) => o.invoiceNo || o.invoiceStatus).map((o) => orderView(db, o));
      if (query.status && query.status !== 'all') {
        list = list.filter((o) => (o.invoiceStatus || 'issued') === query.status);
      }
      list.sort((a, b) => (b.invoiceIssuedAt || b.createdAt || '').localeCompare(a.invoiceIssuedAt || a.createdAt || ''));
      return ok(res, list);
    }
    if (method === 'GET' && second && third === 'pdf') {
      if (!order) return fail(res, 404, '订单不存在');
      if (order.invoiceStatus === 'redFlushed') return fail(res, 400, '该发票已红冲，不能下载');
      try {
        await streamInvoice(db, res, order);
      } catch (e) {
        if (!res.headersSent) fail(res, 500, `发票生成失败：${e.message}`);
      }
      return;
    }
    if (method === 'POST' && second && third === 'red-flush') {
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status !== 'refunded') return fail(res, 400, '只有已退票订单可以红冲发票');
      const body = await readBody(req);
      const result = redFlushInvoice(order, body.reason || '订单退票');
      if (result.error) return fail(res, 400, result.error);
      saveDB();
      return ok(res, orderView(db, order), '发票已红冲');
    }
    return fail(res, 404, '接口不存在');
  }

  /* ===== 订单（后台） ===== */
  if (root === 'orders') {
    /* 代客购票（买票操作员） */
    if (method === 'POST' && !second) {
      if (!requireAccountRole(db, res, req, ['admin', 'operator'])) return;
      const body = await readBody(req);
      const userPhone = String(body.phone || '').trim();
      const user = userPhone ? db.users.find((u) => u.phone === userPhone) : null;
      if (userPhone && !user) return fail(res, 400, '该手机号尚未注册前台账号，请让乘客先注册');
      const counterSale = !userPhone;
      const train = db.trains.find((t) => t.id === body.trainId);
      if (!train) return fail(res, 400, '车次不存在');
      const date = String(body.date || '');
      if (!isValidDate(date)) return fail(res, 400, '乘车日期格式不正确');
      if (date < todayStr()) return fail(res, 400, '乘车日期不能早于今天');
      const runtime = trainRuntime(train, date);
      if (runtime.status === 'cancelled') return fail(res, 400, '该车次已停运，暂停售票');
      if (runtime.status === 'maintenance') return fail(res, 400, '该车次暂停检票，暂停售票');
      const seat = (train.seats || []).find((s) => s.type === body.seatType);
      if (!seat) return fail(res, 400, '该车次没有此席别');
      const presaleDays = (db.settings && db.settings.presaleDays) || 30;
      const latest = new Date();
      latest.setDate(latest.getDate() + presaleDays);
      const latestStr = `${latest.getFullYear()}-${pad(latest.getMonth() + 1)}-${pad(latest.getDate())}`;
      if (date > latestStr) return fail(res, 400, `最多只能预订 ${presaleDays} 天内的车票`);
      const contactPhone = String(body.contactPhone || userPhone || '').trim();
      if (contactPhone && !isValidPhone(contactPhone)) return fail(res, 400, '请输入正确的联系电话');
      const passengers = Array.isArray(body.passengers) ? body.passengers : [];
      if (!passengers.length) return fail(res, 400, '请至少填写一位乘客');
      if (passengers.length > 20) return fail(res, 400, '单笔最多 20 位乘客');
      const normalized = [];
      for (const p of passengers) {
        const parsed = normalizePassenger(p, contactPhone, { allowEmptyPhone: !contactPhone });
        if (parsed.error) return fail(res, 400, parsed.error);
        normalized.push(parsed.value);
      }
      if (new Set(normalized.map((p) => p.idNo)).size !== normalized.length)
        return fail(res, 400, '乘客证件号不能重复');
      const remaining = quotaOf(db, train.id, date, seat.type, seat.total) - soldCount(db, train.id, date, seat.type);
      if (remaining < normalized.length) return fail(res, 400, `余票不足，${seat.type}仅剩 ${Math.max(0, remaining)} 张`);
      const settings = db.settings || DEFAULT_SETTINGS;
      const priced = normalized.map((p) => ({ ...p, price: passengerPrice(seat, p.type, settings) }));
      const seatResult = assignSeatsToPassengers(db, train, date, seat.type, priced);
      if (seatResult && seatResult.error) return fail(res, 400, seatResult.error);
      const totalPrice = Number(priced.reduce((s, p) => s + p.price, 0).toFixed(2));
      const order = {
        id: newId('o'),
        orderNo: genOrderNo(),
        userId: user ? user.id : '',
        userPhone: user ? user.phone : '',
        trainId: train.id,
        trainNo: train.trainNo,
        date,
        seatType: seat.type,
        price: seat.price,
        totalPrice,
        status: 'paid',
        contactPhone,
        passengers: priced,
        createdAt: new Date().toISOString(),
        source: counterSale ? 'counter' : 'agent',
        counter: counterSale,
        agent: String(body.agent || 'operator').slice(0, 20),
        checkedIn: false,
        invoiceNo: '',
      };
      db.orders.push(order);
      addLog(db, {
        action: counterSale ? 'ticket.sale' : 'ticket.agent_sale',
        actor: account.username,
        role: account.role,
        target: order.orderNo,
        detail: `${order.trainNo} ${order.date} ${order.seatType} ${priced.length} 人 ￥${Number(order.totalPrice || 0).toFixed(2)}`,
      });
      saveDB();
      return ok(res, orderView(db, order), counterSale ? '售票成功' : '代客购票成功');
    }

    if (method === 'GET' && !second) {
      let list = db.orders.map((o) => orderView(db, o));
      if (query.status) list = list.filter((o) => o.status === query.status);
      if (query.keyword) {
        const kw = String(query.keyword).trim();
        list = list.filter(
          (o) =>
            o.orderNo.includes(kw) ||
            (o.contactPhone || '').includes(kw) ||
            (o.passengers || []).some((p) => p.name.includes(kw) || p.idNo.includes(kw))
        );
      }
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return ok(res, list);
    }
    if (method === 'GET' && second) {
      const order = db.orders.find((o) => o.id === second || o.orderNo === second);
      if (!order) return fail(res, 404, '订单不存在');
      return ok(res, orderView(db, order));
    }
    if (method === 'PUT' && second && third === 'status') {
      const account = requireAccountRole(db, res, req, ['admin', 'operator']);
      if (!account) return;
      const body = await readBody(req);
      const status = String(body.status || '');
      const order = db.orders.find((o) => o.id === second || o.orderNo === second);
      if (!order) return fail(res, 404, '订单不存在');
      if (!['paid', 'canceled', 'refunded'].includes(status)) return fail(res, 400, '不支持的订单状态');
      if (account.role === 'operator' && status !== 'refunded') return fail(res, 403, '购票员仅可办理退票');
      if (order.status !== 'paid') return fail(res, 400, '只有已支付订单可以改签/退票');
      if (status === 'refunded') {
        if (order.checkedIn) return fail(res, 400, '该订单已检票，不能退票');
        const train = db.trains.find((t) => t.id === order.trainId);
        const feeInfo = calcRefundFee(db, order, train);
        if (feeInfo.error) return fail(res, 400, feeInfo.error);
        order.refundFee = feeInfo.fee;
        order.refundAmount = feeInfo.refundAmount;
        order.refundRate = feeInfo.feeRate;
        order.refundedAt = new Date().toISOString();
      }
      order.status = status;
      order.updatedAt = new Date().toISOString();
      if (status === 'refunded' && order.invoiceNo) redFlushInvoice(order, '订单退票，发票自动红冲');
      addLog(db, {
        action: status === 'refunded' ? 'ticket.refund' : 'ticket.cancel',
        actor: account.username,
        role: account.role,
        target: order.orderNo,
        detail: status === 'refunded'
          ? `退票 ￥${Number(order.refundAmount || 0).toFixed(2)}，手续费 ￥${Number(order.refundFee || 0).toFixed(2)}`
          : '订单取消',
      });
      saveDB();
      return ok(
        res,
        orderView(db, order),
        status === 'refunded'
          ? `退票成功，扣除手续费 ¥${Number(order.refundFee || 0).toFixed(2)}`
          : '订单已取消'
      );
    }
    if (method === 'DELETE' && second) {
      if (!requireAccountRole(db, res, req, ['admin'])) return;
      const order = db.orders.find((o) => o.id === second);
      if (!order) return fail(res, 404, '订单不存在');
      db.orders = db.orders.filter((o) => o.id !== second);
      saveDB();
      return ok(res, null, '订单记录已删除');
    }
    return fail(res, 405, '不支持的请求方法');
  }

  /* ===== 前台接口 ===== */
  if (root === 'public') {
    /* 购票人脸录入 / 核验 */
    if (second === 'face') {
      const user = requireUser(db, res, req);
      if (!user) return;
      if (method === 'GET' && third === 'status') {
        return ok(
          res,
          {
            enrolled: !!user.faceDescriptor,
            enrolledAt: user.faceEnrolledAt || '',
            required: true,
          },
          '人脸状态'
        );
      }
      if (method === 'POST' && third === 'enroll') {
        const body = await readBody(req);
        const descriptor = normalizeFaceDescriptor(body.descriptor);
        if (!descriptor) return fail(res, 400, '人脸特征数据无效，请重新识别');
        if (user.faceDescriptor) return fail(res, 400, '该账号已录入人脸，请直接进行人脸核验');
        user.faceDescriptor = descriptor;
        user.faceEnrolledAt = new Date().toISOString();
        saveDB();
        return ok(res, { enrolled: true, faceToken: issueFaceToken(user.id) }, '人脸录入成功');
      }
      if (method === 'POST' && third === 'verify') {
        const body = await readBody(req);
        const descriptor = normalizeFaceDescriptor(body.descriptor);
        if (!descriptor) return fail(res, 400, '人脸特征数据无效，请重新识别');
        if (!user.faceDescriptor) return fail(res, 400, '该账号尚未录入人脸，请先录入');
        const distance = faceDistance(descriptor, user.faceDescriptor);
        if (distance > 0.58) {
          return fail(res, 400, `人脸与已录入信息不匹配（差异 ${distance.toFixed(2)}），请重试或联系工作人员`);
        }
        return ok(
          res,
          { verified: true, distance: Number(distance.toFixed(4)), faceToken: issueFaceToken(user.id) },
          '人脸核验通过'
        );
      }
      return fail(res, 405, '不支持的请求方法');
    }

    /* 注册 / 登录 / 当前用户 */
    if (second === 'auth') {
      if (method === 'POST' && third === 'register') {
        if (!requireCaptcha(res, req)) return;
        const body = await readBody(req);
        const phone = String(body.phone || '').trim();
        const name = String(body.name || '').trim();
        const password = String(body.password || '');
        if (!isValidPhone(phone)) return fail(res, 400, '请输入正确的 11 位手机号');
        if (!/^[\u4e00-\u9fa5a-zA-Z·]{2,20}$/.test(name)) return fail(res, 400, '姓名不合法');
        if (password.length < 6 || password.length > 32) return fail(res, 400, '密码长度需为 6~32 位');
        if (db.users.some((u) => u.phone === phone)) return fail(res, 400, '该手机号已注册，请直接登录');
        const user = {
          id: newId('u'),
          phone,
          name,
          password: hashPassword(password),
          createdAt: new Date().toISOString(),
        };
        db.users.push(user);
        saveDB();
        const token = issueToken(userTokens, user.id);
        return ok(res, { token, user: { id: user.id, phone: user.phone, name: user.name, faceEnrolled: !!user.faceDescriptor } }, '注册成功');
      }
      if (method === 'POST' && third === 'login') {
        if (!requireCaptcha(res, req)) return;
        const body = await readBody(req);
        const account = String(body.account || body.phone || '').trim();
        const password = String(body.password || '');
        const user = db.users.find((u) => u.phone === account || u.name === account);
        if (!user || user.password !== hashPassword(password)) return fail(res, 400, '账号或密码不正确');
        const token = issueToken(userTokens, user.id);
        return ok(res, { token, user: { id: user.id, phone: user.phone, name: user.name, faceEnrolled: !!user.faceDescriptor } }, '登录成功');
      }
      if (method === 'GET' && third === 'me') {
        const user = requireUser(db, res, req);
        if (!user) return;
        return ok(res, { id: user.id, phone: user.phone, name: user.name, faceEnrolled: !!user.faceDescriptor });
      }
      if (method === 'POST' && third === 'logout') {
        const token = readToken(req);
        if (token) userTokens.delete(token);
        return ok(res, null, '已退出登录');
      }
      if (method === 'PUT' && third === 'password') {
        const user = requireUser(db, res, req);
        if (!user) return;
        const body = await readBody(req);
        if (hashPassword(String(body.oldPassword || '')) !== user.password)
          return fail(res, 400, '原密码不正确');
        const password = String(body.password || '');
        if (password.length < 6 || password.length > 32) return fail(res, 400, '新密码长度需为 6~32 位');
        user.password = hashPassword(password);
        saveDB();
        return ok(res, null, '密码已修改');
      }
      return fail(res, 405, '不支持的请求方法');
    }

    if (second === 'settings' && method === 'GET') {
      const s = db.settings || { ...DEFAULT_SETTINGS };
      return ok(res, {
        siteName: s.siteName,
        subtitle: s.subtitle,
        systemName: s.systemName || '清江铁路',
        logoUrl: s.logoUrl || '',
        railwayCurrency: s.railwayCurrency || 'emerald',
        announcement: s.announcement,
        maxPassengersPerOrder: s.maxPassengersPerOrder,
        presaleDays: s.presaleDays,
        refundEnabled: s.refundEnabled,
        servicePhone: s.servicePhone,
        childDiscount: s.childDiscount,
        changeFeeRate: s.changeFeeRate,
        refundRules: s.refundRules,
        checkinMinutes: s.checkinMinutes,
        announcementEnabled: s.announcementEnabled !== false,
        announcementOnStart: s.announcementOnStart !== false,
        announcementRepeat: !!s.announcementRepeat,
        announcementShowMode: s.announcementShowMode || 'top',
        footerCopyright: s.footerCopyright || '© 2026 清江铁路',
        footerIcp: s.footerIcp || '',
        footerPolice: s.footerPolice || '',
        footerPoliceNo: s.footerPoliceNo || '',
        liveDetection: s.liveDetection !== false,
        showScanPreview: !!s.showScanPreview,
        ticketQrRefreshSeconds: Number(s.ticketQrRefreshSeconds || 30),
      });
    }

    /* 常用乘车人（按登录账号隔离） */
    if (second === 'passengers') {
      const user = requireUser(db, res, req);
      if (!user) return;
      if (method === 'GET' && !third) {
        return ok(
          res,
          db.passengers
            .filter((p) => p.userId === user.id)
            .slice()
            .reverse()
            .map((p) => {
              const { faceDescriptor, ...rest } = p;
              return { ...rest, faceEnrolled: !!faceDescriptor };
            })
        );
      }
      if (method === 'POST' && !third) {
        if (!requireCaptcha(res, req)) return;
        const body = await readBody(req);
        const p = normalizePassenger(body, body.phone);
        if (p.error) return fail(res, 400, p.error);
        const face = validatePassengerFaceDescriptor(body.faceDescriptor);
        if (face.error) return fail(res, 400, '请先为乘车人采集本人人脸');
        if (db.passengers.some((x) => x.userId === user.id && x.idNo === p.value.idNo))
          return fail(res, 400, '该证件号已存在常用乘车人');
        const passenger = {
          id: newId('p'),
          userId: user.id,
          ...p.value,
          faceDescriptor: face.value,
          faceEnrolledAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        db.passengers.push(passenger);
        saveDB();
        const { faceDescriptor, ...safe } = passenger;
        return ok(res, { ...safe, faceEnrolled: true }, '乘车人已添加');
      }
      if (third) {
        const passenger = db.passengers.find((x) => x.id === third);
        if (!passenger || passenger.userId !== user.id) return fail(res, 404, '乘车人不存在');
        if (method === 'PUT') {
          const body = await readBody(req);
          const p = normalizePassenger({ ...passenger, ...body }, body.phone || passenger.phone);
          if (p.error) return fail(res, 400, p.error);
          if (db.passengers.some((x) => x.id !== passenger.id && x.userId === user.id && x.idNo === p.value.idNo))
            return fail(res, 400, '该证件号已存在常用乘车人');
          let faceDescriptor = passenger.faceDescriptor;
          let faceEnrolledAt = passenger.faceEnrolledAt;
          if (body.faceDescriptor !== undefined) {
            const face = validatePassengerFaceDescriptor(body.faceDescriptor);
            if (face.error) return fail(res, 400, '人脸特征格式不正确，请重新采集');
            faceDescriptor = face.value;
            faceEnrolledAt = new Date().toISOString();
          }
          if (!Array.isArray(faceDescriptor)) return fail(res, 400, '请先为乘车人采集本人人脸');
          Object.assign(passenger, p.value, { faceDescriptor, faceEnrolledAt, updatedAt: new Date().toISOString() });
          saveDB();
          const { faceDescriptor: hiddenFace, ...safe } = passenger;
          return ok(res, { ...safe, faceEnrolled: true }, '乘车人已更新');
        }
        if (method === 'DELETE') {
          db.passengers = db.passengers.filter((x) => x.id !== passenger.id);
          saveDB();
          return ok(res, null, '乘车人已删除');
        }
      }
      return fail(res, 405, '不支持的请求方法');
    }

    if (second === 'cities' && method === 'GET') {
      return ok(
        res,
        db.cities
          .map((c) => ({
            ...c,
            stationCount: db.stations.filter((s) => s.cityId === c.id).length,
          }))
          .sort((a, b) => a.pinyin.localeCompare(b.pinyin))
      );
    }

    if (second === 'stations' && method === 'GET') {
      let list = db.stations;
      if (query.cityId) list = list.filter((s) => s.cityId === query.cityId);
      return ok(res, list.map((s) => ({ ...s, cityName: (findCity(db, s.cityId) || {}).name })));
    }

    if (second === 'search' && method === 'GET') {
      if (!requireCaptcha(res, req)) return;
      const fromCityId = query.fromCityId;
      const toCityId = query.toCityId;
      const date = isValidDate(query.date) ? query.date : todayStr();
      if (!fromCityId || !toCityId) return fail(res, 400, '请选择出发城市和到达城市');
      // 出发地与到达地允许相同（同城出行场景），同城若无可匹配车次返回空列表
      const fromStationIds = db.stations.filter((s) => s.cityId === fromCityId).map((s) => s.id);
      const toStationIds = db.stations.filter((s) => s.cityId === toCityId).map((s) => s.id);
      const list = db.trains
        .filter((t) => fromStationIds.includes(t.fromStationId) && toStationIds.includes(t.toStationId))
        .map((t) => trainView(db, t, date))
        .sort((a, b) => a.departTime.localeCompare(b.departTime));
      const transfers = planTransfers(db, fromCityId, toCityId, date).map((item, index) => {
        const first = trainView(db, item.first.train, date);
        const second = trainView(db, item.second.train, date);
        const hub = findStation(db, item.hubStationId) || {};
        return {
          id: 'tr_' + index,
          hubStationId: item.hubStationId,
          hubStationName: hub.name || '',
          waitMinutes: item.waitMinutes,
          totalMinutes: item.totalMinutes,
          totalDurationText: durationText(item.totalMinutes),
          transferText: `中转 ${hub.name || ''} · 等待 ${durationText(item.waitMinutes)}`,
          first,
          second,
        };
      });
      return ok(res, {
        date,
        fromCityId,
        toCityId,
        total: list.length,
        trains: list,
        transfers,
        transferTotal: transfers.length,
      });
    }

    if (second === 'orders' && third && fourth === 'cancel' && method === 'POST') {
      const user = requireUser(db, res, req);
      if (!user) return;
      const order = db.orders.find((o) => (o.orderNo === third || o.id === third) && o.userId === user.id);
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status === 'pending') {
        order.status = 'canceled';
        order.cancelReason = 'user_canceled';
        order.canceledAt = new Date().toISOString();
        order.updatedAt = order.canceledAt;
        saveDB();
        return ok(res, orderView(db, order), '待支付订单已取消');
      }
      if (order.status !== 'paid') return fail(res, 400, '该订单当前状态不可退票');
      if (order.checkedIn) return fail(res, 400, '该订单已检票，不能退票');
      if (db.settings && db.settings.refundEnabled === false) return fail(res, 400, '系统当前已关闭在线退票');
      const train = db.trains.find((t) => t.id === order.trainId);
      const feeInfo = calcRefundFee(db, order, train);
      if (feeInfo.error) return fail(res, 400, feeInfo.error);
      order.status = 'refunded';
      order.refundFee = feeInfo.fee;
      order.refundAmount = feeInfo.refundAmount;
      order.refundRate = feeInfo.feeRate;
      order.refundedAt = new Date().toISOString();
      order.updatedAt = order.refundedAt;
      saveDB();
      return ok(
        res,
        orderView(db, order),
        `退票成功，扣除手续费 ¥${feeInfo.fee.toFixed(2)}，退回 ¥${feeInfo.refundAmount.toFixed(2)}`
      );
    }

    /* 改签：换日期 / 车次 / 席别，按差价与改签手续费结算 */
    if (second === 'orders' && third && fourth === 'change' && method === 'POST') {
      const user = requireUser(db, res, req);
      if (!user) return;
      const order = db.orders.find((o) => (o.orderNo === third || o.id === third) && o.userId === user.id);
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status !== 'paid') return fail(res, 400, '只有已支付订单可以改签');
      if (order.checkedIn) return fail(res, 400, '该订单已检票，不能改签');
      const oldTrain = db.trains.find((t) => t.id === order.trainId);
      const hours = hoursToDeparture(order, oldTrain);
      if (hours !== null && hours < 0) return fail(res, 400, '列车已发车，不能改签');

      const body = await readBody(req);
      const date = isValidDate(body.date) ? body.date : order.date;
      const trainId = String(body.trainId || order.trainId);
      const seatType = String(body.seatType || order.seatType);
      const train = db.trains.find((t) => t.id === trainId);
      if (!train) return fail(res, 400, '目标车次不存在');
      if (date < todayStr()) return fail(res, 400, '乘车日期不能早于今天');
      const targetRuntime = trainRuntime(train, date);
      if (targetRuntime.status === 'cancelled') return fail(res, 400, '目标车次已停运，不能改签');
      if (targetRuntime.status === 'maintenance') return fail(res, 400, '目标车次暂停检票，不能改签');
      const presaleDays = (db.settings && db.settings.presaleDays) || 30;
      const latest = new Date();
      latest.setDate(latest.getDate() + presaleDays);
      const latestStr = `${latest.getFullYear()}-${pad(latest.getMonth() + 1)}-${pad(latest.getDate())}`;
      if (date > latestStr) return fail(res, 400, `最多只能预订 ${presaleDays} 天内的车票`);
      const seat = (train.seats || []).find((s) => s.type === seatType);
      if (!seat) return fail(res, 400, '目标车次没有该席别');

      const count = (order.passengers || []).length;
      const sold = soldCount(db, train.id, date, seatType);
      const ownSold = train.id === order.trainId && date === order.date && seatType === order.seatType ? count : 0;
      const remaining = quotaOf(db, train.id, date, seatType, seat.total) - (sold - ownSold);
      if (remaining < count) return fail(res, 400, `余票不足，${seatType}仅剩 ${Math.max(0, remaining)} 张`);

      const settings = db.settings || DEFAULT_SETTINGS;
      const newPassengers = (order.passengers || []).map((p) => ({
        ...p,
        price: passengerPrice(seat, p.type || '成人', settings),
      }));
      const newTotal = Number(newPassengers.reduce((sum, p) => sum + p.price, 0).toFixed(2));
      const diff = Number((newTotal - (order.totalPrice || 0)).toFixed(2));
      const changeFeeRate = Number(settings.changeFeeRate) || 0;
      const changeFee = diff > 0 ? Number((diff * changeFeeRate).toFixed(2)) : 0;
      const needPay = Number(Math.max(0, diff + changeFee).toFixed(2));
      const refund = Number(Math.max(0, -diff).toFixed(2));

      const old = {
        date: order.date,
        trainNo: order.trainNo,
        seatType: order.seatType,
        totalPrice: order.totalPrice,
        changedAt: new Date().toISOString(),
      };
      order.trainId = train.id;
      order.trainNo = train.trainNo;
      order.date = date;
      order.seatType = seatType;
      order.price = seat.price;
      order.totalPrice = newTotal;
      order.passengers = newPassengers;
      order.checkedIn = false;
      order.changeFee = Number(((order.changeFee || 0) + changeFee).toFixed(2));
      order.changes = [...(order.changes || []), old];
      order.updatedAt = new Date().toISOString();
      saveDB();
      const message = needPay > 0
        ? `改签成功，需补差价与手续费 ¥${needPay.toFixed(2)}`
        : `改签成功${refund > 0 ? `，退回差价 ¥${refund.toFixed(2)}` : ''}`;
      return ok(res, { order: orderView(db, order), diff, changeFee, needPay, refund }, message);
    }

    if (second === 'orders' && !third && method === 'POST') {
      const user = requireUser(db, res, req);
      if (!user) return;
      if (!requireCaptcha(res, req)) return;
      const body = await readBody(req);
      const trainId = String(body.trainId || '');
      const date = String(body.date || '');
      const seatType = String(body.seatType || '');
      const contactPhone = String(body.contactPhone || '').trim();
      const passengers = Array.isArray(body.passengers) ? body.passengers : [];

      const train = db.trains.find((t) => t.id === trainId);
      if (!train) return fail(res, 400, '车次不存在');
      if (!isValidDate(date)) return fail(res, 400, '乘车日期格式不正确');
      if (date < todayStr()) return fail(res, 400, '乘车日期不能早于今天');
      const runtime = trainRuntime(train, date);
      if (runtime.status === 'cancelled') return fail(res, 400, '该车次已停运，暂停售票');
      if (runtime.status === 'maintenance') return fail(res, 400, '该车次暂停检票，暂停售票');
      const seat = (train.seats || []).find((s) => s.type === seatType);
      if (!seat) return fail(res, 400, '该车次没有此席别');

      const maxPassengers = (db.settings && db.settings.maxPassengersPerOrder) || 5;
      const presaleDays = (db.settings && db.settings.presaleDays) || 30;
      const latest = new Date();
      latest.setDate(latest.getDate() + presaleDays);
      const latestStr = `${latest.getFullYear()}-${pad(latest.getMonth() + 1)}-${pad(latest.getDate())}`;
      if (date > latestStr) return fail(res, 400, `最多只能预订 ${presaleDays} 天内的车票`);

      if (passengers.length < 1) return fail(res, 400, '请至少添加一位乘客');
      if (passengers.length > maxPassengers) return fail(res, 400, `单笔订单最多 ${maxPassengers} 位乘客`);
      if (!isValidPhone(contactPhone)) return fail(res, 400, '请输入正确的手机号');

      const normalized = [];
      for (const p of passengers) {
        const parsed = normalizePassenger(p, contactPhone);
        if (parsed.error) return fail(res, 400, parsed.error);
        const saved = db.passengers.find(
          (x) => x.userId === user.id && String(x.idNo || '').toUpperCase() === parsed.value.idNo
        );
        if (!saved || !Array.isArray(saved.faceDescriptor) || saved.faceDescriptor.length !== 128) {
          return fail(res, 400, `请先为乘车人「${parsed.value.name}」录入本人人脸后再购票`);
        }
        normalized.push({
          ...parsed.value,
          passengerId: saved.id,
          faceDescriptor: saved.faceDescriptor,
        });
      }
      const dup = new Set(normalized.map((p) => p.idNo));
      if (dup.size !== normalized.length) return fail(res, 400, '同一订单中乘客证件号不能重复');

      const remaining = quotaOf(db, train.id, date, seatType, seat.total) - soldCount(db, train.id, date, seatType);
      if (remaining < normalized.length)
        return fail(res, 400, `余票不足，${seatType}仅剩 ${Math.max(0, remaining)} 张`);

      const settings = db.settings || DEFAULT_SETTINGS;
      const priced = normalized.map((p) => ({ ...p, price: passengerPrice(seat, p.type, settings) }));
      const seatResult = assignSeatsToPassengers(db, train, date, seatType, priced);
      if (seatResult && seatResult.error) return fail(res, 400, seatResult.error);
      const totalPrice = Number(priced.reduce((sum, p) => sum + p.price, 0).toFixed(2));
      const order = {
        id: newId('o'),
        orderNo: genOrderNo(),
        userId: user.id,
        userPhone: user.phone,
        trainId: train.id,
        trainNo: train.trainNo,
        date,
        seatType,
        price: seat.price,
        totalPrice,
        status: 'pending',
        paymentDeadline: new Date(Date.now() + paymentTimeoutMs(db)).toISOString(),
        contactPhone,
        passengers: priced,
        createdAt: new Date().toISOString(),
        source: 'web',
        checkedIn: false,
        invoiceNo: '',
      };
      db.orders.push(order);
      saveDB();
      return ok(res, orderView(db, order), '订单已创建，请在 15 分钟内完成支付');
    }

    /* 模拟支付回调 */
    if (second === 'orders' && third && fourth === 'pay' && method === 'POST') {
      const user = requireUser(db, res, req);
      if (!user) return;
      const order = db.orders.find((o) => (o.orderNo === third || o.id === third) && o.userId === user.id);
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status === 'paid') return ok(res, orderView(db, order), '订单已支付，无需重复支付');
      if (order.status !== 'pending') return fail(res, 400, '该订单当前状态不可支付');
      const deadline = Date.parse(order.paymentDeadline || '');
      if (Number.isFinite(deadline) && deadline <= Date.now()) {
        order.status = 'canceled';
        order.cancelReason = 'payment_timeout';
        order.canceledAt = new Date().toISOString();
        order.updatedAt = order.canceledAt;
        saveDB();
        return fail(res, 400, `订单已超过 ${Math.round(paymentTimeoutMs(db) / 60000)} 分钟支付时限，已自动取消`);
      }
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.paymentMethod = 'simulated';
      order.updatedAt = order.paidAt;
      addLog(db, {
        action: 'order.pay',
        actor: user.phone || user.name || 'user',
        role: 'passenger',
        target: order.orderNo,
        detail: `模拟支付成功 ¥${Number(order.totalPrice || 0).toFixed(2)}`,
        level: 'info',
      });
      saveDB();
      broadcast('order', { orderNo: order.orderNo, status: order.status, source: order.source });
      return ok(res, orderView(db, order), '支付成功');
    }

    if (second === 'orders' && third && !fourth && method === 'GET') {
      const user = requireUser(db, res, req);
      if (!user) return;
      const order = db.orders.find((o) => (o.orderNo === third || o.id === third) && o.userId === user.id);
      if (!order) return fail(res, 404, '订单不存在');
      return ok(res, orderView(db, order));
    }

    if (second === 'orders' && third === undefined && method === 'GET') {
      const user = requireUser(db, res, req);
      if (!user) return;
      let list = db.orders.filter((o) => o.userId === user.id);
      if (query.status) list = list.filter((o) => o.status === query.status);
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return ok(res, list.map((o) => orderView(db, o)));
    }

    /* 电子发票：申请开票 */
    if (second === 'orders' && third && fourth === 'invoice' && method === 'POST') {
      const token = readToken(req) || String(query.token || '');
      const item = token && userTokens.get(token);
      const user = item && item.expire > Date.now() ? db.users.find((u) => u.id === item.id) : null;
      if (!user) return fail(res, 401, '请先登录后申请发票');
      const order = db.orders.find((o) => (o.orderNo === third || o.id === third) && o.userId === user.id);
      if (!order) return fail(res, 404, '订单不存在');
      const body = await readBody(req);
      const issued = issueInvoice(order, body.title, body.taxNo);
      if (issued.error) return fail(res, 400, issued.error);
      saveDB();
      return ok(res, orderView(db, order), '发票开具成功');
    }

    /* 电子发票 PDF */
    if (second === 'orders' && third && fourth === 'invoice' && method === 'GET') {
      const token = readToken(req) || String(query.token || '');
      const item = token && userTokens.get(token);
      const user = item && item.expire > Date.now() ? db.users.find((u) => u.id === item.id) : null;
      if (!user) return fail(res, 401, '请先登录后下载发票');
      const order = db.orders.find((o) => (o.orderNo === third || o.id === third) && o.userId === user.id);
      if (!order) return fail(res, 404, '订单不存在');
      if (order.status !== 'paid') return fail(res, 400, '只有已支付订单可以开具发票');
      if (!order.invoiceNo) {
        const issued = issueInvoice(order);
        if (issued.error) return fail(res, 400, issued.error);
        saveDB();
      }
      if (order.invoiceStatus === 'redFlushed') return fail(res, 400, '该发票已红冲，不能下载');
      try {
        await streamInvoice(db, res, order);
      } catch (e) {
        if (!res.headersSent) fail(res, 500, `发票生成失败：${e.message}`);
      }
      return;
    }

    return fail(res, 404, '接口不存在');
  }

  /* ===== 后台检票监控 / 设备 / 复核 / 日志 ===== */
  if (root === 'monitor' && method === 'GET') {
    const account = requireAccountRole(db, res, req, ['admin', 'inspector']);
    if (!account) return;
    const fresh = refreshDB();
    return ok(res, liveSnapshot(fresh));
  }

  if (root === 'devices' && second === 'heartbeat' && method === 'POST') {
    const remote = String(req.socket.remoteAddress || '');
    if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(remote)) return fail(res, 403, '心跳只允许本机检票服务上报');
    const body = await readBody(req);
    if (!String(body.gateNo || '').trim()) return fail(res, 400, '闸机编号不能为空');
    const result = touchDevicePresence(db, body);
    if (!result) return fail(res, 400, '闸机编号不能为空');
    scheduleDeviceBroadcast(db);
    return ok(res, { online: true, serverTime: new Date().toISOString() }, '心跳已记录');
  }

  if (root === 'devices') {
    if (method === 'GET') {
      const account = requireAccountRole(db, res, req, ['admin', 'inspector']);
      if (!account) return;
      return ok(res, decoratedDevices(db));
    }
    const account = requireAccountRole(db, res, req, ['admin']);
    if (!account) return;
    if (method === 'POST') {
      const body = await readBody(req);
      const stationId = String(body.stationId || '');
      if (!findStation(db, stationId)) return fail(res, 400, '车站不存在');
      const gateNo = String(body.gateNo || '').trim().slice(0, 20);
      if (!gateNo) return fail(res, 400, '检票机编号不能为空');
      if ((db.devices || []).some((d) => d.stationId === stationId && d.gateNo === gateNo))
        return fail(res, 400, '该车站下已存在相同编号的检票机');
      const device = {
        id: newId('dev'),
        stationId,
        gateNo,
        name: String(body.name || gateNo).slice(0, 30),
        gateType: ['entry', 'exit', 'checkin'].includes(body.gateType) ? body.gateType : 'checkin',
        status: body.status === 'disabled' ? 'disabled' : body.status === 'maintenance' ? 'maintenance' : 'normal',
        maintenanceText: String(body.maintenanceText || (db.settings || {}).maintenanceText || '').slice(0, 80),
        lastSeenAt: '',
        configVersion: 0,
        remoteConfig: {
          mode: body.mode === 'manual' ? 'manual' : 'auto',
          cameraEnabled: body.cameraEnabled !== false,
          showScanPreview: !!body.showScanPreview,
          welcomeText: String(body.welcomeText || '').slice(0, 80),
        },
        createdAt: new Date().toISOString(),
      };
      db.devices.push(device);
      addLog(db, { action: 'device.create', actor: account.username, role: account.role, target: gateNo, detail: '新增检票机' });
      saveDB();
      broadcast('devices', db.devices);
      return ok(res, device, '检票机已新增');
    }
    if (method === 'PUT' && second) {
      const device = (db.devices || []).find((d) => d.id === second);
      if (!device) return fail(res, 404, '检票机不存在');
      const body = await readBody(req);
      let configChanged = false;
      const before = JSON.stringify({
        gateType: device.gateType,
        status: device.status,
        maintenanceText: device.maintenanceText,
        remoteConfig: device.remoteConfig || {},
      });
      ['name', 'gateNo', 'gateType', 'status', 'maintenanceText'].forEach((key) => {
        if (body[key] !== undefined) {
          device[key] = String(body[key]).slice(0, key === 'gateType' ? 10 : 80);
        }
      });
      device.remoteConfig = { ...(device.remoteConfig || {}) };
      if (body.mode !== undefined) device.remoteConfig.mode = body.mode === 'manual' ? 'manual' : 'auto';
      if (body.cameraEnabled !== undefined) device.remoteConfig.cameraEnabled = Boolean(body.cameraEnabled);
      if (body.showScanPreview !== undefined) device.remoteConfig.showScanPreview = Boolean(body.showScanPreview);
      if (body.welcomeText !== undefined) device.remoteConfig.welcomeText = String(body.welcomeText || '').slice(0, 80);
      const after = JSON.stringify({
        gateType: device.gateType,
        status: device.status,
        maintenanceText: device.maintenanceText,
        remoteConfig: device.remoteConfig || {},
      });
      configChanged = before !== after;
      if (configChanged) {
        device.configVersion = Number(device.configVersion || 0) + 1;
        device.configUpdatedAt = new Date().toISOString();
        device.configError = '';
      }
      device.updatedAt = new Date().toISOString();
      addLog(db, {
        action: configChanged ? 'device.config' : 'device.update',
        actor: account.username,
        role: account.role,
        target: device.gateNo,
        detail: configChanged
          ? `远程配置 v${device.configVersion}：${device.status} / ${device.remoteConfig.mode || 'auto'}`
          : `状态：${device.status}`,
      });
      saveDB();
      broadcast('devices', decoratedDevices(db));
      return ok(res, decorateDevice(device, db), configChanged ? '配置已下发，等待闸机确认' : '检票机已更新');
    }
    return fail(res, 405, '不支持的请求方法');
  }

  if (root === 'checkin_admin' && second === 'review' && method === 'POST') {
    const account = requireAccountRole(db, res, req, ['admin', 'inspector']);
    if (!account) return;
    const body = await readBody(req);
    const order = (db.orders || []).find((o) => o.orderNo === String(body.orderNo || '') || o.id === String(body.orderNo || ''));
    if (!order) return fail(res, 404, '订单不存在');
    const idNo = String(body.idNo || '').toUpperCase();
    const passenger = (order.passengers || []).find((p) => String(p.idNo || '').toUpperCase() === idNo);
    if (!passenger) return fail(res, 404, '乘车人不存在');
    if (body.action === 'approve') {
      passenger.checkedIn = true;
      passenger.checkedInAt = new Date().toISOString();
      passenger.checkinMode = 'manual-review';
      passenger.reviewedBy = account.username;
      passenger.exception = '';
      if ((order.passengers || []).every((p) => p.checkedIn)) {
        order.checkedIn = true;
        order.checkedInAt = passenger.checkedInAt;
        order.checkinMode = 'manual-review';
      }
      addLog(db, {
        action: 'checkin.review.approve',
        actor: account.username,
        role: account.role,
        target: order.orderNo,
        detail: `人工放行：${passenger.name} / ${passenger.idNo}`,
      });
      saveDB();
      broadcast('checkin', liveSnapshot(db));
      return ok(res, orderView(db, order), '已人工放行');
    }
    if (body.action === 'exception') {
      passenger.exception = String(body.reason || '人工标记异常').slice(0, 100);
      addLog(db, {
        action: 'checkin.review.exception',
        actor: account.username,
        role: account.role,
        target: order.orderNo,
        detail: `${passenger.name}：${passenger.exception}`,
        level: 'warn',
      });
      addAlert(db, {
        type: 'checkin_manual_exception',
        level: 'warn',
        title: '人工检票异常',
        detail: `${passenger.name} / ${passenger.idNo}：${passenger.exception}`,
        target: order.orderNo,
        source: account.username,
      });
      saveDB();
      broadcast('checkin', liveSnapshot(db));
      broadcast('alerts', alertsPayload(db));
      return ok(res, orderView(db, order), '已标记异常');
    }
    if (body.action === 'cancel') {
      if (!passenger.checkedIn && !order.checkedIn) return fail(res, 400, '该乘车人尚未检票，无需取消');
      passenger.checkedIn = false;
      delete passenger.checkedInAt;
      delete passenger.checkinMode;
      delete passenger.reviewedBy;
      passenger.exception = '';
      order.checkedIn = false;
      delete order.checkedInAt;
      delete order.checkinMode;
      addLog(db, {
        action: 'checkin.review.cancel',
        actor: account.username,
        role: account.role,
        target: order.orderNo,
        detail: `取消检票：${passenger.name} / ${passenger.idNo}`,
        level: 'warn',
      });
      saveDB();
      broadcast('checkin', liveSnapshot(db));
      return ok(res, orderView(db, order), '已取消检票');
    }
    return fail(res, 400, '不支持的人工复核操作');
  }

  if (root === 'logs' && second === 'print' && method === 'POST') {
    const account = requireAccountRole(db, res, req, ['admin', 'operator']);
    if (!account) return;
    const body = await readBody(req);
    const orderNo = String(body.orderNo || '').slice(0, 40);
    addLog(db, {
      action: 'ticket.print',
      actor: account.username,
      role: account.role,
      target: orderNo,
      detail: `打印车票${body.reprint ? '（补打）' : ''}`,
    });
    saveDB();
    return ok(res, null, '打印日志已记录');
  }

  if (root === 'logs' && method === 'GET') {
    const account = requireAccountRole(db, res, req, ['admin']);
    if (!account) return;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(1000, Math.max(10, Number(query.pageSize) || 30));
    const keyword = String(query.keyword || '').trim().toLowerCase();
    const level = String(query.level || '').trim();
    const role = String(query.role || '').trim();
    const from = String(query.from || '').trim();
    const to = String(query.to || '').trim();
    let all = db.logs || [];
    if (level) all = all.filter((row) => (row.level || 'info') === level);
    if (role) all = all.filter((row) => row.role === role);
    if (from) all = all.filter((row) => String(row.at || '') >= from);
    if (to) all = all.filter((row) => String(row.at || '') <= `${to}T23:59:59.999Z`);
    if (keyword) {
      all = all.filter((row) =>
        [row.actor, row.action, row.target, row.detail, row.role].filter(Boolean).join(' ').toLowerCase().includes(keyword)
      );
    }
    return ok(res, {
      total: all.length,
      page,
      pageSize,
      rows: all.slice((page - 1) * pageSize, page * pageSize),
    });
  }

  if (root === 'checkin_event' && second === 'report' && method === 'POST') {
    const body = await readBody(req);
    if (String(body.secret || '') !== QR_SECRET) return fail(res, 403, '内部事件密钥不正确');
    const event = {
      id: newId('evt'),
      at: new Date().toISOString(),
      stationId: String(body.stationId || ''),
      gateNo: String(body.gateNo || ''),
      type: String(body.type || 'unknown').slice(0, 40),
      level: body.level === 'error' ? 'error' : body.level === 'warn' ? 'warn' : 'info',
      detail: String(body.detail || '').slice(0, 200),
    };
    db.checkinEvents = [event, ...(db.checkinEvents || [])].slice(0, 500);
    if (event.level !== 'info') {
      addLog(db, {
        action: `checkin.${event.type}`,
        actor: event.gateNo || '闸机',
        target: event.stationId,
        detail: event.detail,
        level: event.level,
      });
      addAlert(db, {
        type: `checkin_${event.type}`,
        level: event.level,
        title: event.level === 'error' ? '检票异常' : '检票提醒',
        detail: event.detail || `闸机 ${event.gateNo} 上报异常`,
        target: `${event.stationId || ''}::${event.gateNo || ''}`,
        source: event.gateNo || '闸机',
      });
    }
    saveDB();
    broadcast('checkin', liveSnapshot(db));
    if (event.level !== 'info') broadcast('alerts', alertsPayload(db));
    return ok(res, event);
  }

  /* ===== 清空数据（管理员密码校验） ===== */
  if (root === 'admin' && second === 'reset' && method === 'POST') {
    const account = requireAccountRole(db, res, req, ['admin']);
    if (!account) return;
    const body = await readBody(req);
    if (hashPassword(String(body.password || '')) !== account.password) {
      return fail(res, 403, '管理员密码不正确');
    }
    addLog(db, {
      action: 'system.reset',
      actor: account.username,
      role: account.role,
      target: 'all',
      detail: '清空全部演示数据',
      level: 'warn',
    });
    saveDB();
    const fresh = resetDB();
    broadcast('reset', { message: '演示数据已清空' });
    return ok(res, null, '数据已清空，请重新登录后台');
  }

  return fail(res, 404, '接口不存在');
}

function normalizePassenger(input, fallbackPhone, options) {
  const name = String((input && input.name) || '').trim();
  const idType = String((input && input.idType) || '身份证');
  const idNo = String((input && input.idNo) || '').trim().toUpperCase();
  const phone = String((input && input.phone) || fallbackPhone || '').trim();
  const type = String((input && input.type) || '成人');
  if (!/^[\u4e00-\u9fa5a-zA-Z·]{2,20}$/.test(name)) return { error: `乘客姓名不合法：${name || '空'}` };
  if (!['成人', '儿童'].includes(type)) return { error: '票种只能是成人或儿童' };
  if (idType === '身份证' && !isValidIdCard(idNo)) return { error: `身份证号不合法：${idNo}` };
  if (idType !== '身份证' && !/^[A-Z0-9]{5,20}$/.test(idNo)) return { error: `证件号不合法：${idNo}` };
  const allowEmptyPhone = !!(options && options.allowEmptyPhone);
  if ((!allowEmptyPhone || phone) && !isValidPhone(phone)) return { error: `手机号不合法：${phone}` };
  return { value: { name, idType, idNo, phone, type } };
}

function validatePassengerFaceDescriptor(input) {
  if (!Array.isArray(input) || input.length !== 128) return { error: '人脸特征格式不正确，请重新采集' };
  const descriptor = input.map((n) => Number(n));
  if (descriptor.some((n) => !Number.isFinite(n))) return { error: '人脸特征格式不正确，请重新采集' };
  return { value: descriptor.map((n) => Number(n.toFixed(4))) };
}

/* ---------------- 批量导入 ---------------- */

function importPick(row, keys) {
  for (const key of keys) {
    const value = row && row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function importStation(db, value) {
  const v = String(value || '').trim();
  if (!v) return null;
  return (
    db.stations.find((s) => s.id === v) ||
    db.stations.find((s) => s.code.toUpperCase() === v.toUpperCase()) ||
    db.stations.find((s) => s.name === v) ||
    null
  );
}

function importColor(value) {
  const v = String(value || '').trim();
  if (!v) return '蓝色';
  return v.endsWith('色') ? v : `${v}色`;
}

function importTime(value) {
  const v = String(value || '').trim();
  if (/^\d{1,2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(':');
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  return v;
}

function importSeats(value) {
  if (Array.isArray(value)) return normalizeSeats(value);
  const text = String(value || '').trim();
  if (!text) return { error: '席别配置不能为空，示例：二等座:139.5:320' };
  if (text.startsWith('[')) {
    try {
      return normalizeSeats(JSON.parse(text));
    } catch {
      return { error: '席别配置 JSON 格式不正确' };
    }
  }
  const parts = text.split(/[|；;\n]+/).map((s) => s.trim()).filter(Boolean);
  const list = [];
  for (const part of parts) {
    const segs = part.split(/[:：]/).map((s) => s.trim());
    if (segs.length < 3) return { error: `席别配置格式不正确：${part}，示例：二等座:139.5:320` };
    list.push({ type: segs[0], price: Number(segs[1]), total: Number(segs[2]) });
  }
  return normalizeSeats(list);
}

async function handleImport(req, res, type, db) {
  const t = String(type || '').trim();
  if (!['cities', 'stations', 'trains'].includes(t)) return fail(res, 404, '不支持的导入类型');
  const body = await readBody(req);
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) return fail(res, 400, '导入数据不能为空');
  if (rows.length > 500) return fail(res, 400, '单次最多导入 500 条，请分批导入');

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const messages = [];
  const skip = (row, msg) => {
    skipped += 1;
    messages.push({ row, type: 'skip', message: msg });
  };
  const error = (row, msg) => {
    failed += 1;
    messages.push({ row, type: 'error', message: msg });
  };

  rows.forEach((raw, index) => {
    const rowNo = index + 1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return error(rowNo, '该行不是有效的数据对象');
    }
    try {
      if (t === 'cities') {
        const name = importPick(raw, ['name', '城市名称', '城市', 'city']);
        const pinyin = importPick(raw, ['pinyin', '拼音']).toLowerCase();
        const code = importPick(raw, ['code', '城市代码', '代码']).toUpperCase();
        if (!name) return error(rowNo, '城市名称不能为空');
        if (!pinyin) return error(rowNo, '拼音不能为空，例如：hangzhou');
        if (!/^[a-zA-Z\s]+$/.test(pinyin)) return error(rowNo, '拼音只能是英文字母');
        if (!code) return error(rowNo, '城市代码不能为空');
        if (db.cities.some((c) => c.name === name)) return skip(rowNo, `城市「${name}」已存在`);
        if (db.cities.some((c) => c.code === code)) return skip(rowNo, `城市代码「${code}」已存在`);
        db.cities.push({ id: newId('c'), name, pinyin, code });
        imported += 1;
        return;
      }

      if (t === 'stations') {
        const name = importPick(raw, ['name', '车站名称', '车站']);
        const code = importPick(raw, ['code', '电报码', '车站代码']).toUpperCase();
        const cityIdRaw = importPick(raw, ['cityId', '所属城市ID']);
        const cityName = importPick(raw, ['cityName', 'city', '所属城市', '城市']);
        const cityCode = importPick(raw, ['cityCode', '城市代码']).toUpperCase();
        if (!name) return error(rowNo, '车站名称不能为空');
        if (!code) return error(rowNo, '电报码不能为空');
        let city = null;
        if (cityIdRaw) city = findCity(db, cityIdRaw);
        if (!city && cityCode) city = db.cities.find((c) => c.code.toUpperCase() === cityCode);
        if (!city && cityName) city = db.cities.find((c) => c.name === cityName);
        if (!city) return error(rowNo, `所属城市不存在：${cityName || cityCode || cityIdRaw || '未填写'}（请先导入城市）`);
        if (db.stations.some((s) => s.code === code)) return skip(rowNo, `电报码「${code}」已存在`);
        if (db.stations.some((s) => s.name === name && s.cityId === city.id))
          return skip(rowNo, `${city.name}下已存在车站「${name}」`);
        db.stations.push({ id: newId('s'), name, cityId: city.id, code });
        imported += 1;
        return;
      }

      const trainNo = importPick(raw, ['trainNo', '车次号', '车次']).toUpperCase();
      const typeName = importPick(raw, ['type', '车型', '列车类型']) || '高速动车';
      const fromValue = importPick(raw, ['fromStationId', 'fromStation', 'from', '出发站', '始发站']);
      const toValue = importPick(raw, ['toStationId', 'toStation', 'to', '到达站', '终到站']);
      const departTime = importTime(importPick(raw, ['departTime', '出发时刻', '发车时间']));
      const arriveTime = importTime(importPick(raw, ['arriveTime', '到达时刻', '到达时间']));
      const platform = importPick(raw, ['platform', '站台', '站台号']) || '1';
      const gateInfo = normalizeTrainGates(importPick(raw, ['gates', 'gate', '检票口']));
      const landmarkColor = importColor(importPick(raw, ['landmarkColor', '地标颜色', '地标']));
      const seats = importSeats(raw.seats ?? raw['席别配置'] ?? raw['席别'] ?? raw['票价配置']);
      if (!trainNo) return error(rowNo, '车次号不能为空');
      if (!/^[GDCZKTLY]\d{1,4}$/.test(trainNo))
        return error(rowNo, `车次号格式不正确：${trainNo}，示例：G1、D2281`);
      if (db.trains.some((t2) => t2.trainNo === trainNo)) return skip(rowNo, `车次「${trainNo}」已存在`);
      const fromStation = importStation(db, fromValue);
      const toStation = importStation(db, toValue);
      if (!fromStation) return error(rowNo, `出发站不存在：${fromValue || '未填写'}`);
      if (!toStation) return error(rowNo, `到达站不存在：${toValue || '未填写'}`);
      if (fromStation.id === toStation.id) return error(rowNo, '出发站与到达站不能相同');
      if (!isValidTime(departTime)) return error(rowNo, `出发时刻格式应为 HH:MM：${departTime || '未填写'}`);
      if (!isValidTime(arriveTime)) return error(rowNo, `到达时刻格式应为 HH:MM：${arriveTime || '未填写'}`);
      if (!/^[0-9A-Za-z-]{1,10}$/.test(platform)) return error(rowNo, `站台号格式不正确：${platform}`);
      if (gateInfo.error) return error(rowNo, gateInfo.error);
      const COLORS = ['蓝色', '黄色', '绿色', '紫色', '红色', '白色'];
      if (!COLORS.includes(landmarkColor))
        return error(rowNo, `地标颜色需为：${COLORS.join(' / ')}`);
      if (seats.error) return error(rowNo, seats.error);
      db.trains.push({
        id: newId('t'),
        trainNo,
        type: typeName,
        fromStationId: fromStation.id,
        toStationId: toStation.id,
        departTime,
        arriveTime,
        platform,
        gates: gateInfo.gates,
        gate: gateInfo.gate,
        landmarkColor,
        status: 'normal',
        delayMinutes: 0,
        tempGates: [],
        tempGate: '',
        tempPlatform: '',
        runtimeNote: '',
        seats: seats.list,
      });
      imported += 1;
    } catch (e) {
      error(rowNo, e.message || '该行处理失败');
    }
  });

  if (imported > 0) saveDB();
  return ok(
    res,
    { total: rows.length, imported, skipped, failed, messages },
    `导入完成：成功 ${imported} 条，跳过 ${skipped} 条，失败 ${failed} 条`
  );
}

function normalizeTrainGates(input) {
  const list = (Array.isArray(input) ? input : String(input || 'A').split(/[,\/、，\s]+/))
    .map((v) => String(v).trim().toUpperCase())
    .filter(Boolean);
  if (!list.length) return { error: '请至少填写一个检票口' };
  if (list.length > 8) return { error: '检票口最多 8 个' };
  for (const gate of list) {
    if (!/^[0-9A-Za-z-]{1,10}$/.test(gate)) return { error: `检票口格式不正确：${gate}` };
  }
  const gates = Array.from(new Set(list));
  return { gates, gate: gates.join(' / ') };
}

function optionalTrainGates(input) {
  if (input === undefined || input === null) return { gates: [] };
  if (Array.isArray(input) && input.length === 0) return { gates: [] };
  if (typeof input === 'string' && !input.trim()) return { gates: [] };
  return normalizeTrainGates(input);
}

function buildRuntimeEntry(input, previous) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const rawStatus = input.status !== undefined ? input.status : prev.status || 'normal';
  const status = String(rawStatus || 'normal');
  if (!['normal', 'delayed', 'cancelled', 'maintenance'].includes(status))
    return { error: '运行状态仅支持 normal / delayed / cancelled / maintenance' };
  let delayMinutes = Number(input.delayMinutes !== undefined ? input.delayMinutes : prev.delayMinutes || 0) || 0;
  delayMinutes = Math.max(0, Math.min(240, delayMinutes));
  if (status === 'delayed' && delayMinutes < 1) return { error: '晚点分钟需为 1-240' };
  if (status !== 'delayed') delayMinutes = 0;
  const gateInput =
    input.tempGates !== undefined
      ? input.tempGates
      : input.tempGate !== undefined
        ? input.tempGate
        : prev.tempGates !== undefined
          ? prev.tempGates
          : prev.tempGate || '';
  const gateInfo = optionalTrainGates(gateInput);
  if (gateInfo.error) return { error: gateInfo.error };
  const tempPlatform = String(
    input.tempPlatform !== undefined ? input.tempPlatform : prev.tempPlatform || ''
  ).trim();
  if (tempPlatform && !/^[0-9A-Za-z-]{1,10}$/.test(tempPlatform)) return { error: '临时站台格式不正确' };
  const runtimeNote = String(input.runtimeNote !== undefined ? input.runtimeNote : prev.runtimeNote || '')
    .trim()
    .slice(0, 120);
  return {
    entry: {
      status,
      delayMinutes,
      tempGates: gateInfo.gates,
      tempGate: gateInfo.gate || '',
      tempPlatform,
      runtimeNote,
      updatedAt: new Date().toISOString(),
    },
  };
}

function isEmptyRuntimeEntry(entry) {
  return (
    entry.status === 'normal' &&
    !entry.delayMinutes &&
    !(entry.tempGates || []).length &&
    !entry.tempPlatform &&
    !entry.runtimeNote
  );
}

function shiftHHMM(value, minutes) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!m) return value || '';
  const total = ((Number(m[1]) * 60 + Number(m[2]) + Number(minutes || 0)) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function trainRuntime(train, date) {
  const allowed = ['normal', 'delayed', 'cancelled', 'maintenance'];
  const overrides = train && train.runtimeByDate && typeof train.runtimeByDate === 'object' ? train.runtimeByDate : {};
  const override = date && overrides[date] && typeof overrides[date] === 'object' ? overrides[date] : null;
  const source = override ? { ...train, ...override } : train;
  const status = allowed.includes(source.status) ? source.status : 'normal';
  const delayMinutes = status === 'delayed' ? Math.max(0, Math.min(240, Number(source.delayMinutes) || 0)) : 0;
  const baseGates = Array.isArray(train.gates) && train.gates.length ? train.gates : [train.gate || 'A'];
  const tempGates = Array.isArray(source.tempGates) ? source.tempGates.filter(Boolean) : [];
  const gates = tempGates.length ? tempGates : baseGates;
  const gate = gates.join(' / ');
  const platform = String(source.tempPlatform || train.platform || '');
  const departTime = delayMinutes ? shiftHHMM(train.departTime, delayMinutes) : train.departTime || '';
  const statusText =
    status === 'cancelled' ? '停运' : status === 'maintenance' ? '暂停检票' : status === 'delayed' ? `晚点 ${delayMinutes} 分钟` : '';
  return {
    status,
    statusText,
    delayMinutes,
    gates,
    gate,
    baseGates,
    baseGate: baseGates.join(' / '),
    tempGates,
    tempGate: tempGates.join(' / '),
    platform,
    basePlatform: train.platform || '',
    tempPlatform: source.tempPlatform || '',
    departTime,
    baseDepartTime: train.departTime || '',
    runtimeNote: source.runtimeNote || '',
    runtimeDate: date || '',
    overridden: Boolean(override),
  };
}

function normalizeSeats(input) {  if (!Array.isArray(input) || input.length === 0) return { error: '请至少配置一种席别' };
  const allowed = ['商务座', '一等座', '二等座', '硬卧', '软卧', '硬座', '无座'];
  const types = new Set();
  const list = [];
  for (const item of input) {
    const type = String(item.type || '').trim();
    const price = Number(item.price);
    const total = Number(item.total);
    if (!allowed.includes(type)) return { error: `不支持的席别：${type || '空'}` };
    if (types.has(type)) return { error: `席别重复：${type}` };
    if (!Number.isFinite(price) || price <= 0) return { error: `${type} 票价必须大于 0` };
    if (!Number.isInteger(total) || total <= 0) return { error: `${type} 座位数必须为正整数` };
    types.add(type);
    list.push({ type, price: Number(price.toFixed(2)), total });
  }
  return { list };
}

/* ---------------- 启动 ---------------- */

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    console.error('[fatal]', e);
    if (!res.headersSent) fail(res, 500, '服务器内部错误');
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket) => {
  wsClients.add(socket);
  try {
    socket.send(JSON.stringify({ type: 'hello', at: new Date().toISOString(), payload: liveSnapshot(getDB()) }));
  } catch (e) { /* ignore */ }
  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw || '{}'));
      if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
    } catch (e) { /* ignore */ }
  });
});

let lastDbChange = 0;
try {
  fs.watch(DB_PATH, { persistent: false }, () => {
    const now = Date.now();
    if (now - lastDbChange < 250) return;
    lastDbChange = now;
    setTimeout(() => {
      try {
        const fresh = refreshDB();
        broadcast('checkin', liveSnapshot(fresh));
      } catch (e) { /* ignore */ }
    }, 120);
  });
} catch (e) {
  console.error('数据库文件监听启动失败：', e.message);
}

const paymentTimer = setInterval(() => {
  try {
    const fresh = refreshDB();
    expirePendingOrders(fresh);
  } catch (e) {
    console.error('待支付订单超时检查失败：', e.message);
  }
}, 30000);
if (paymentTimer.unref) paymentTimer.unref();

/* 心跳批量落盘：每 30 秒集中写一次 lastSeenAt，避免高频小写入 */
const deviceFlushTimer = setInterval(() => {
  try {
    const db = getDB();
    let changed = false;
    const now = Date.now();
    for (const [key, row] of devicePresence.entries()) {
      if (now - lastSeenMs(row.lastSeenAt) > 5 * 60 * 1000) {
        devicePresence.delete(key);
        continue;
      }
      const device = (db.devices || []).find((d) => d.stationId === row.stationId && d.gateNo === row.gateNo);
      if (device && device.lastSeenAt !== row.lastSeenAt) {
        device.lastSeenAt = row.lastSeenAt;
        changed = true;
      }
    }
    if (changed) saveDB();
  } catch (e) {
    console.error('闸机心跳落盘失败：', e.message);
  }
}, 30000);
if (deviceFlushTimer.unref) deviceFlushTimer.unref();

/* 设备在线状态变化时推送；每 5 秒一次，避免每台闸机心跳都广播 */
let lastDeviceBroadcastKey = '';
const deviceBroadcastInterval = setInterval(() => {
  try {
    const db = getDB();
    const rows = decoratedDevices(db);
    const key = rows.map((d) => `${d.id}:${d.online ? 1 : 0}:${d.configAckVersion}:${d.configError}`).join('|');
    if (key !== lastDeviceBroadcastKey) {
      lastDeviceBroadcastKey = key;
      broadcast('devices', rows);
    }

    let alertChanged = false;
    for (const d of rows) {
      const deviceTarget = `${d.stationId}::${d.gateNo}`;
      const stationName = (db.stations || []).find((s) => s.id === d.stationId)?.name || d.stationId;
      const prev = deviceOnlineState.get(d.id);
      deviceOnlineState.set(d.id, d.online);
      if (d.online) {
        if (resolveAlerts(db, 'device_offline', deviceTarget)) alertChanged = true;
      } else if (d.status !== 'disabled' && d.lastSeenAt && prev !== false) {
        const r = addAlert(db, {
          type: 'device_offline',
          level: 'error',
          title: `${d.gateNo} 闸机离线`,
          detail: `${stationName} ${d.gateNo} 已超过 30 秒未上报心跳`,
          target: deviceTarget,
          source: stationName,
        });
        alertChanged = alertChanged || r.changed;
      }

      if (d.configError) {
        const r = addAlert(db, {
          type: 'device_config_error',
          level: 'error',
          title: `${d.gateNo} 配置应用失败`,
          detail: d.configError,
          target: deviceTarget,
          source: stationName,
        });
        alertChanged = alertChanged || r.changed;
      } else if (d.configVersion > (d.configAckVersion || 0)) {
        const updated = Date.parse(d.configUpdatedAt || '');
        if (Number.isFinite(updated) && Date.now() - updated > 90 * 1000) {
          const r = addAlert(db, {
            type: 'device_config_pending',
            level: 'warn',
            title: `${d.gateNo} 配置待确认`,
            detail: `配置 v${d.configVersion} 已下发超过 90 秒，闸机尚未确认`,
            target: deviceTarget,
            source: stationName,
          });
          alertChanged = alertChanged || r.changed;
        }
      } else {
        if (resolveAlerts(db, 'device_config_error', deviceTarget)) alertChanged = true;
        if (resolveAlerts(db, 'device_config_pending', deviceTarget)) alertChanged = true;
      }
    }
    if (alertChanged) {
      saveDB();
      broadcast('alerts', alertsPayload(db));
    }
  } catch (e) { /* ignore */ }
}, 5000);
if (deviceBroadcastInterval.unref) deviceBroadcastInterval.unref();

server.listen(PORT, () => {
  console.log(`\n  清江铁路12306 购票系统后端已启动`);
  console.log(`  前台购票页 : http://localhost:${PORT}`);
  console.log(`  接口地址   : http://localhost:${PORT}/api`);
  console.log(`  检票端     : 已停用（闸机改为游戏内刷身份证/车票，提示渲染在闸机上方）`);
  console.log(`  后台管理   : http://localhost:${ADMIN_PORT}  (naive-ui-admin，另开后端)\n`);
});
