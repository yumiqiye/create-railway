/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/* 清江铁路12306 检票端服务：端口 3001，独立读取 ../ticket/data/db.json */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const QRCode = require('qrcode');
const { loadConfig } = require('../shared/config');
const { parsePayload } = require('../shared/ticket-qr');

const SERVER_DIR = __dirname;
const RUN_DIR = process.env.QJ_ROOT_DIR || (process.pkg ? path.dirname(process.execPath) : path.join(SERVER_DIR, '..'));
const CONFIG = loadConfig(process.env.QJ_CONFIG_DIR || (process.pkg ? RUN_DIR : path.join(__dirname, '..')));
const CHECK_CFG = CONFIG.check || {};
const SHARED_CFG = CONFIG.shared || {};
const PORT = Number(process.env.CHECKIN_PORT || CHECK_CFG.port || 3001);
const MAIN_PORT = Number((CONFIG.ticket || {}).port || 3000);
const QR_SECRET = String(SHARED_CFG.qr_secret || 'change-me-in-config');
const QR_TTL = Number(SHARED_CFG.qr_ttl || 90);
const DEFAULT_DATA_DIR = process.pkg
  ? path.join(RUN_DIR, 'data')
  : path.join(RUN_DIR, 'ticket', 'data');
const DATA_DIR = process.env.QJ_DATA_DIR || DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(RUN_DIR, 'check', 'public-checkin');
const DEFAULT_CHECKIN_MINUTES = 30;

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveDB(db) {
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

/* 设备配置缓存：避免每台闸机每 5 秒解析整份 db.json */
let deviceSnapshotAt = 0;
let deviceSnapshotCache = { devices: [], settings: {} };
function loadDeviceSnapshot() {
  const now = Date.now();
  if (now - deviceSnapshotAt < 3000) return deviceSnapshotCache;
  const db = loadDB();
  if (db) {
    deviceSnapshotCache = { devices: db.devices || [], settings: db.settings || {} };
    deviceSnapshotAt = now;
  }
  return deviceSnapshotCache;
}

/* 心跳只上报主服务内存，不在检票端写 db.json */
let lastHeartbeatAt = 0;
let lastHeartbeatKey = '';
function reportHeartbeat(payload) {
  const now = Date.now();
  const key = `${payload.stationId || ''}::${payload.gateNo || ''}`;
  if (now - lastHeartbeatAt < 3000 && key === lastHeartbeatKey) return;
  lastHeartbeatAt = now;
  lastHeartbeatKey = key;
  try {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: MAIN_PORT,
        path: '/api/devices/heartbeat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 1500,
      },
      (res) => { res.resume(); }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => {});
    req.end(body);
  } catch (e) { /* 主服务不可用时不影响检票 */ }
}

function reportEvent(db, type, detail, level) {
  try {
    db.checkinEvents = [
      {
        id: 'evt_' + Math.random().toString(36).slice(2, 10),
        at: new Date().toISOString(),
        type: String(type || 'unknown').slice(0, 40),
        level: level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info',
        detail: String(detail || '').slice(0, 200),
      },
      ...(db.checkinEvents || []),
    ].slice(0, 500);
    saveDB(db);
  } catch (e) { /* ignore */ }
}

function ok(res, result, message) {
  const body = JSON.stringify({ code: 200, result: result === undefined ? null : result, message: message || '操作成功' });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function fail(res, code, message) {
  const body = JSON.stringify({ code, result: null, message });
  res.writeHead(code === 401 ? 401 : code === 404 ? 404 : 400, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function departureOf(date, departTime) {
  const d = new Date(`${date}T${departTime}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shiftHHMM(value, minutes) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!m) return value || '';
  const total = ((Number(m[1]) * 60 + Number(m[2]) + Number(minutes || 0)) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function runtimeTrain(train, date) {
  const allowed = ['normal', 'delayed', 'cancelled', 'maintenance'];
  const overrides = train && train.runtimeByDate && typeof train.runtimeByDate === 'object' ? train.runtimeByDate : {};
  const override = date && overrides[date] && typeof overrides[date] === 'object' ? overrides[date] : null;
  const source = override ? { ...train, ...override } : train;
  const status = allowed.includes(source.status) ? source.status : 'normal';
  const delayMinutes = status === 'delayed' ? Math.max(0, Math.min(240, Number(source.delayMinutes) || 0)) : 0;
  const baseGates = Array.isArray(train.gates) && train.gates.length ? train.gates : [train.gate || 'A'];
  const tempGates = Array.isArray(source.tempGates) ? source.tempGates.filter(Boolean) : [];
  const gates = tempGates.length ? tempGates : baseGates;
  const platform = String(source.tempPlatform || train.platform || '');
  const departTime = delayMinutes ? shiftHHMM(train.departTime, delayMinutes) : train.departTime || '';
  return {
    ...train,
    status,
    delayMinutes,
    gates,
    gate: gates.join(' / '),
    baseGate: baseGates.join(' / '),
    basePlatform: train.platform || '',
    tempGate: tempGates.join(' / '),
    tempPlatform: source.tempPlatform || '',
    platform,
    departTime,
    baseDepartTime: train.departTime || '',
    runtimeNote: source.runtimeNote || '',
    statusText:
      status === 'cancelled' ? '停运' : status === 'maintenance' ? '暂停检票' : status === 'delayed' ? `晚点 ${delayMinutes} 分钟` : '',
  };
}

function checkinWindow(train, date, checkinMinutes) {
  const dep = departureOf(date, train.departTime);
  if (!dep) return { open: false, reason: '发车时间无效' };
  const start = new Date(dep.getTime() - checkinMinutes * 60000);
  const end = new Date(dep.getTime() + 10 * 60000);
  const now = new Date();
  if (now < start) return { open: false, dep, start, end, reason: '未到开检时间' };
  if (now > end) return { open: false, dep, start, end, reason: '已停止检票' };
  return { open: true, dep, start, end, reason: '正在检票' };
}

function openTrains(db, stationId) {
  const settings = db.settings || {};
  const minutes = Number(settings.checkinMinutes || DEFAULT_CHECKIN_MINUTES);
  const today = todayStr();
  const rows = [];
  (db.trains || []).forEach((train) => {
    if (stationId && train.fromStationId !== stationId) return;
    const runtime = runtimeTrain(train, today);
    if (runtime.status === 'cancelled' || runtime.status === 'maintenance') return;
    const win = checkinWindow(runtime, today, minutes);
    if (!win.open) return;
    const from = (db.stations || []).find((s) => s.id === train.fromStationId);
    const to = (db.stations || []).find((s) => s.id === train.toStationId);
    const sold = (db.orders || []).filter(
      (o) => o.trainId === train.id && o.date === today && o.status === 'paid'
    ).reduce((sum, o) => sum + (o.passengers || []).length, 0);
    rows.push({
      id: train.id,
      trainNo: train.trainNo,
      type: train.type,
      fromStationName: from ? from.name : '',
      toStationName: to ? to.name : '',
      departTime: runtime.departTime,
      baseDepartTime: runtime.baseDepartTime,
      arriveTime: train.arriveTime,
      platform: runtime.platform,
      gates: runtime.gates,
      gate: runtime.gate,
      status: runtime.status,
      statusText: runtime.statusText,
      delayMinutes: runtime.delayMinutes,
      landmarkColor: train.landmarkColor || '',
      date: today,
      checkinStart: win.start ? win.start.toTimeString().slice(0, 5) : '',
      checkinEnd: win.end ? win.end.toTimeString().slice(0, 5) : '',
      checkinMinutes: minutes,
      checkedCount: (db.orders || [])
        .filter((o) => o.trainId === train.id && o.date === today)
        .reduce((sum, o) => {
          const ps = o.passengers || [];
          const personal = ps.filter((p) => p.checkedIn === true).length;
          return sum + (personal || (o.checkedIn ? ps.length : 0));
        }, 0),
      soldCount: sold,
    });
  });
  rows.sort((a, b) => a.departTime.localeCompare(b.departTime));
  return { today, checkinMinutes: minutes, trains: rows };
}

function orderNoFromCode(code) {
  const parsed = parsePayload(QR_SECRET, code, QR_TTL);
  return parsed.orderNo || '';
}

function codeCheck(code) {
  const parsed = parsePayload(QR_SECRET, code, QR_TTL);
  if (!parsed.valid) return { error: parsed.error || '二维码无效或已过期，请刷新电子客票后重试' };
  return { orderNo: parsed.orderNo, signed: parsed.signed };
}

function safePassenger(passenger) {
  if (!passenger) return null;
  const { faceDescriptor, ...rest } = passenger;
  return rest;
}

function verify(db, body) {
  const mode = body.mode === 'manual' ? 'manual' : 'auto';
  const code = String(body.code || '').trim();
  const trainId = String(body.trainId || '');
  const today = todayStr();
  if (!code) return { error: '请扫描电子客票二维码，或输入身份证号 / 订单号' };

  const codeInfo = codeCheck(code);
  if (codeInfo.error) return { error: codeInfo.error };
  const orderNo = codeInfo.orderNo;
  let order = (db.orders || []).find((o) => o.orderNo === orderNo || o.id === orderNo);
  let matchedPassenger = null;
  let matchedBy = '二维码';
  if (!order) {
    const idNo = code.toUpperCase();
    const candidates = (db.orders || []).filter((o) =>
      (o.passengers || []).some((p) => String(p.idNo || '').toUpperCase() === idNo)
    );
    const active = candidates.filter((o) => !o.lostReported && !o.voided);
    order =
      active.find((o) => o.date === today && o.status === 'paid' && !o.checkedIn) ||
      active.find((o) => o.date === today && o.status === 'paid') ||
      active[0] ||
      candidates[0];
    if (order) {
      matchedPassenger = order.passengers.find((p) => String(p.idNo || '').toUpperCase() === idNo) || null;
      matchedBy = '身份证';
    }
  }
  if (!order) return { error: '未找到对应车票，请确认二维码 / 身份证号是否正确' };
  if (order.status !== 'paid') return { error: `该订单状态为「${order.status === 'refunded' ? '已退票' : '已取消'}」，不能检票` };
  if (order.lostReported || order.voided) return { error: '该车票已挂失作废，请使用补办后的新车票检票' };
  if (order.checkedIn) {
    return {
      error: `该订单已于 ${order.checkedInAt ? new Date(order.checkedInAt).toLocaleString('zh-CN') : ''} 完成检票，请勿重复检票`,
      duplicate: true,
    };
  }
  if (order.date !== today) return { error: `该车票乘车日期为 ${order.date}，不是今日（${today}），不能检票` };

  if (matchedPassenger && matchedPassenger.checkedIn) {
    return {
      error: `乘车人「${matchedPassenger.name}」已检票通过，一人一闸，请勿重复通行`,
      duplicate: true,
    };
  }

  const settings = db.settings || {};
  const minutes = Number(settings.checkinMinutes || DEFAULT_CHECKIN_MINUTES);
  const train = (db.trains || []).find((t) => t.id === order.trainId);
  if (!train) return { error: '车次信息不存在，无法检票' };
  const runtime = runtimeTrain(train, order.date);
  if (runtime.status === 'cancelled') return { error: '该车次已停运，不能检票' };
  if (runtime.status === 'maintenance') return { error: '该车次暂停检票' };
  const win = checkinWindow(runtime, today, minutes);
  if (!win.open) {
    if (win.reason === '未到开检时间') return { error: `该车次尚未开始检票（提前 ${minutes} 分钟开检）` };
    return { error: '该车次已停止检票' };
  }

  if (mode === 'manual') {
    if (!trainId) return { error: '手动检票模式下请先选择当前开检车次' };
    if (trainId !== train.id) return { error: '所选车次与车票不一致，请核对' };
  } else if (trainId && trainId !== train.id) {
    return { error: '所选车次与车票不一致，请核对' };
  }

  const passengers = order.passengers || [];
  const uncheckedPassengers = passengers.filter((p) => !p.checkedIn);
  const displayPassenger = matchedPassenger || uncheckedPassengers[0] || null;
  const faceCandidates = matchedPassenger
    ? [matchedPassenger]
    : uncheckedPassengers.filter((p) => Array.isArray(p.faceDescriptor) && p.faceDescriptor.length === 128);
  const storedFaceReady = faceCandidates.length > 0;

  const from = (db.stations || []).find((s) => s.id === train.fromStationId);
  const to = (db.stations || []).find((s) => s.id === train.toStationId);

  // 第一阶段：仅校验车票，不核销、不写检票时间，等待人脸识别
  if (body.prepare) {
    if (!storedFaceReady) {
      return { error: '该订单乘车人尚未录入人脸，请先在购票端「乘车人管理」采集本人人脸后再购票' };
    }
    return {
      ok: true,
      prepared: true,
      mode,
      matchedBy,
      orderNo: order.orderNo,
      trainId: train.id,
      passenger: safePassenger(displayPassenger),
      passengerCount: passengers.length,
      pendingCount: uncheckedPassengers.length,
      seatType: order.seatType,
      date: order.date,
      trainNo: train.trainNo,
      fromStationName: from ? from.name : '',
      toStationName: to ? to.name : '',
      departTime: runtime.departTime,
      platform: runtime.platform,
      gates: runtime.gates,
      gate: runtime.gate,
      status: runtime.status,
      statusText: runtime.statusText,
      delayMinutes: runtime.delayMinutes,
      landmarkColor: train.landmarkColor || '',
      faceRequired: true,
      faceEnrolled: storedFaceReady,
      onePassPerGate: true,
    };
  }

  if (!storedFaceReady) {
    return { error: '该订单乘车人尚未录入人脸，请先在购票端「乘车人管理」采集本人人脸' };
  }
  const faceDescriptor = Array.isArray(body.faceDescriptor)
    ? body.faceDescriptor.map((n) => Number(n))
    : null;
  if (!faceDescriptor || faceDescriptor.length !== 128 || faceDescriptor.some((n) => !Number.isFinite(n))) {
    return { error: '请先完成人脸识别，再进行检票' };
  }

  let best = null;
  for (const candidate of faceCandidates) {
    const stored = candidate.faceDescriptor;
    if (!Array.isArray(stored) || stored.length !== 128) continue;
    let sum = 0;
    for (let i = 0; i < 128; i += 1) {
      const diff = Number(stored[i]) - faceDescriptor[i];
      sum += diff * diff;
    }
    const distance = Math.sqrt(sum);
    if (!best || distance < best.distance) best = { passenger: candidate, distance };
  }
  if (!best) {
    return { error: '未找到该车票对应乘车人的人脸信息，请先重新采集乘车人人脸' };
  }
  if (best.distance > 0.58) {
    return { error: '人脸与该车票乘车人不一致，请本人正对摄像头后重试' };
  }

  const now = new Date().toISOString();
  matchedPassenger = best.passenger;
  matchedPassenger.checkedIn = true;
  matchedPassenger.checkedInAt = now;
  matchedPassenger.checkinMode = mode;
  matchedPassenger.faceDistance = Number(best.distance.toFixed(4));
  order.checkinMode = mode;
  order.lastCheckinAt = now;
  order.checkedIn = passengers.every((p) => p.checkedIn === true);
  if (order.checkedIn) order.checkedInAt = now;
  saveDB(db);

  return {
    ok: true,
    mode,
    matchedBy,
    orderNo: order.orderNo,
    passenger: safePassenger(matchedPassenger),
    passengerCount: passengers.length,
    orderCheckedIn: !!order.checkedIn,
    pendingCount: passengers.filter((p) => !p.checkedIn).length,
    seatType: order.seatType,
    date: order.date,
    trainNo: train.trainNo,
    fromStationName: from ? from.name : '',
    toStationName: to ? to.name : '',
    departTime: runtime.departTime,
    platform: runtime.platform,
    gates: runtime.gates,
    gate: runtime.gate,
    status: runtime.status,
    statusText: runtime.statusText,
    delayMinutes: runtime.delayMinutes,
    landmarkColor: train.landmarkColor || '',
    faceMatched: true,
    faceDistance: Number(best.distance.toFixed(4)),
    checkedInAt: now,
  };
}

function verifyAccess(db, body) {
  const gateType = body.gateType === 'exit' ? 'exit' : 'entry';
  const code = String(body.code || '').trim();
  const stationId = String(body.stationId || '');
  const gateNo = String(body.gateNo || '').slice(0, 20);
  if (!code) return { error: '请扫描电子客票二维码，或输入身份证号 / 订单号' };
  if (!stationId) return { error: '闸机尚未选择本站车站，请先在设置中选择' };

  let order = null;
  let passenger = null;
  const codeInfo = codeCheck(code);
  if (codeInfo.error) return { error: codeInfo.error };
  const orderNo = codeInfo.orderNo;
  order = (db.orders || []).find((o) => o.orderNo === orderNo || o.id === orderNo) || null;
  if (!order) {
    const idNo = code.toUpperCase();
    order = (db.orders || []).find((o) =>
      (o.passengers || []).some((p) => String(p.idNo || '').toUpperCase() === idNo)
    ) || null;
  }
  if (!order) return { error: '未找到对应车票，请确认二维码 / 身份证号是否正确' };
  if (order.status !== 'paid') return { error: '该订单不是有效已支付车票，不能通行' };
  if (order.lostReported || order.voided) return { error: '该车票已挂失作废，请使用补办后的新车票通行' };
  if (order.date !== todayStr()) return { error: `该车票乘车日期为 ${order.date}，不是今日，不能通行` };

  const train = (db.trains || []).find((t) => t.id === order.trainId) || null;
  const runtime = train ? runtimeTrain(train, order.date) : null;
  const from = train ? (db.stations || []).find((s) => s.id === train.fromStationId) : null;
  const to = train ? (db.stations || []).find((s) => s.id === train.toStationId) : null;
  const station = (db.stations || []).find((s) => s.id === stationId);
  if (!station) return { error: '闸机所选车站不存在，请重新选择' };
  if (gateType === 'exit') {
    if (!train) return { error: '车次信息不存在，无法验证' };
    if (train.toStationId !== stationId) {
      return { error: `该车票到达 ${to ? to.name : '其他车站'}，不能在本站出站` };
    }
  }

  passenger = (order.passengers || []).find((p) => String(p.idNo || '').toUpperCase() === String(code || '').toUpperCase())
    || (order.passengers || [])[0] || null;
  const now = new Date().toISOString();
  if (gateType === 'entry') {
    order.entryGateAt = now;
    order.entryGateNo = gateNo;
    order.entryGateCount = Number(order.entryGateCount || 0) + 1;
  } else {
    order.exitGateAt = now;
    order.exitGateNo = gateNo;
    order.exitGateCount = Number(order.exitGateCount || 0) + 1;
  }
  saveDB(db);

  return {
    ok: true,
    gateType,
    orderNo: order.orderNo,
    passenger: safePassenger(passenger),
    passengerCount: (order.passengers || []).length,
    seatType: order.seatType,
    date: order.date,
    trainNo: train ? train.trainNo : (order.trainNo || ''),
    fromStationName: from ? from.name : '',
    toStationName: to ? to.name : '',
    departTime: runtime ? runtime.departTime : '',
    platform: runtime ? runtime.platform : '',
    gate: runtime ? runtime.gate : '',
    gateNo,
    verifiedAt: now,
    repeatEntry: gateType === 'entry',
    entryGateCount: Number(order.entryGateCount || 0),
    exitGateCount: Number(order.exitGateCount || 0),
  };
}

function recentRecords(db) {
  return (db.orders || [])
    .filter((o) => o.checkedIn)
    .sort((a, b) => String(b.checkedInAt || '').localeCompare(String(a.checkedInAt || '')))
    .slice(0, 20)
    .map((o) => {
      const train = (db.trains || []).find((t) => t.id === o.trainId);
      return {
        orderNo: o.orderNo,
        trainNo: train ? train.trainNo : o.trainNo,
        date: o.date,
        seatType: o.seatType,
        passengers: (o.passengers || []).map((p) => ({ name: p.name, type: p.type || '成人' })),
        checkinMode: o.checkinMode || 'auto',
        checkedInAt: o.checkedInAt,
      };
    });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, '')));
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(resolved));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    const needsDb = pathname !== '/api/checkin/device';
    const db = needsDb ? loadDB() : null;
    if (needsDb && !db) return fail(res, 500, '数据库读取失败，请确认主服务已初始化数据');

    if (pathname === '/api/checkin/stations' && req.method === 'GET') {
      const cities = db.cities || [];
      return ok(res, (db.stations || []).map((s) => {
        const city = cities.find((c) => c.id === s.cityId);
        return {
          id: s.id,
          name: s.name,
          code: s.code || '',
          cityId: s.cityId || '',
          cityName: city ? city.name : '',
        };
      }));
    }

    if (pathname === '/api/checkin/config' && req.method === 'GET') {
      const s = db.settings || {};
      return ok(res, {
        siteName: s.siteName || '清江铁路12306',
        entryWelcomeText: s.entryWelcomeText || '欢迎光临{station}',
        exitWelcomeText: s.exitWelcomeText || '欢迎您再次乘坐清江铁路12306',
        checkinMinutes: Number(s.checkinMinutes || DEFAULT_CHECKIN_MINUTES),
        maintenanceText: s.maintenanceText || '此闸机正在维修，请使用其他闸机',
        liveDetection: s.liveDetection !== false,
        showScanPreview: !!s.showScanPreview,
        footerCopyright: s.footerCopyright || '© 2026 清江铁路',
        footerIcp: s.footerIcp || '',
        footerPolice: s.footerPolice || '',
        footerPoliceNo: s.footerPoliceNo || '',
        announcement: s.announcement || '',
        announcementEnabled: s.announcementEnabled !== false,
        announcementShowMode: s.announcementShowMode || 'top',
      });
    }

    if (pathname === '/api/checkin/device' && req.method === 'GET') {
      const stationId = String(parsed.query.stationId || '');
      const gateNo = String(parsed.query.gateNo || '');
      const gateType = String(parsed.query.gateType || 'checkin');
      const appliedVersion = Number(parsed.query.configVersion || 0);
      const snapshot = loadDeviceSnapshot();
      const device = (snapshot.devices || []).find(
        (d) => (d.stationId === stationId || !stationId) && (d.gateNo === gateNo || !gateNo)
      );
      const remote = (device && device.remoteConfig) || {};
      const config = {
        gateType: (device && device.gateType) || gateType || 'checkin',
        status: (device && device.status) || 'normal',
        maintenanceText: (device && device.maintenanceText) || (snapshot.settings || {}).maintenanceText || '',
        mode: remote.mode === 'manual' ? 'manual' : 'auto',
        cameraEnabled: remote.cameraEnabled !== false,
        showScanPreview: !!remote.showScanPreview,
        welcomeText: remote.welcomeText || '',
        configVersion: Number((device && device.configVersion) || 0),
        configUpdatedAt: (device && device.configUpdatedAt) || '',
      };
      reportHeartbeat({
        stationId,
        gateNo,
        gateType: config.gateType,
        clientVersion: 'web-checkin-1',
        configVersion: appliedVersion,
        configError: '',
      });
      return ok(res, {
        found: !!device,
        id: device ? device.id : '',
        status: config.status,
        maintenanceText: config.maintenanceText,
        name: device ? device.name : '',
        config: config,
        configVersion: config.configVersion,
        configUpdatedAt: config.configUpdatedAt,
      });
    }

    if (pathname === '/api/checkin/qrcode' && req.method === 'GET') {
      const text = String(parsed.query.text || 'qingjiang-railway-checkin').slice(0, 200);
      QRCode.toBuffer(text, {
        type: 'png',
        width: 360,
        margin: 1,
        color: { dark: '#0b3f8f', light: '#ffffff' },
      })
        .then((buffer) => {
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
          res.end(buffer);
        })
        .catch(() => fail(res, 500, '二维码生成失败'));
      return;
    }

    if (pathname === '/api/checkin/trains' && req.method === 'GET') {
      return ok(res, openTrains(db, String(parsed.query.stationId || '')));
    }

    if (pathname === '/api/checkin/records' && req.method === 'GET') {
      return ok(res, recentRecords(db));
    }

    if (pathname === '/api/checkin/access' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = verifyAccess(db, body);
        if (result.error) {
          reportEvent(db, 'access-failed', result.error, 'warn');
          return fail(res, 400, result.error);
        }
        reportEvent(db, 'access-ok', `${result.orderNo || ''} ${result.passenger && result.passenger.name ? result.passenger.name : ''}`, 'info');
        return ok(res, result, '验证通过');
      } catch (e) {
        return fail(res, 500, '验证处理失败：' + e.message);
      }
    }

    if (pathname === '/api/checkin/verify' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = verify(db, body);
        if (result.error) {
          reportEvent(db, result.duplicate ? 'duplicate' : 'verify-failed', result.error, 'warn');
          return fail(res, 400, result.error);
        }
        if (!body.prepare) {
          reportEvent(db, 'checkin-ok', `${result.trainNo || ''} ${result.orderNo || ''} ${result.passenger && result.passenger.name ? result.passenger.name : ''}`, 'info');
        }
        return ok(res, result, body.prepare ? '车票已读取，请完成人脸核验' : '检票成功');
      } catch (e) {
        reportEvent(db, 'verify-error', e.message, 'error');
        return fail(res, 500, '检票处理失败：' + e.message);
      }
    }

    if (pathname === '/api/checkin/summary' && req.method === 'GET') {
      const open = openTrains(db, String(parsed.query.stationId || ''));
      const allToday = (db.orders || []).filter((o) => o.date === todayStr() && o.status === 'paid').length;
      return ok(res, {
        today: open.today,
        checkinMinutes: open.checkinMinutes,
        openCount: open.trains.length,
        todayOrderCount: allToday,
        checkedCount: (db.orders || []).filter((o) => o.date === todayStr() && o.checkedIn).length,
      });
    }

    return fail(res, 404, '接口不存在');
  }

  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`[checkin] 检票服务已启动：http://localhost:${PORT}`);
});
