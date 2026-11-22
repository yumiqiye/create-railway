/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.QJ_DATA_DIR || path.join(process.pkg ? path.dirname(process.execPath) : __dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const DEFAULT_SETTINGS = {
  siteName: '清江铁路12306',
  subtitle: '网上购票系统',
  // 铁路系统品牌（模组售票机公告栏同步读取）
  systemName: '清江铁路',
  logoUrl: '',
  railwayBureau: '清江铁路',
  // 模组票务：绿宝石计价、距离自动票价
  railwayCurrency: 'emerald',
  railwayAdminToken: 'qingjiang-railway-mod',
  farePerBlock: 0.02,
  minFare: 1,
  maxFare: 64,
  autoFare: true,
  announcement: '欢迎使用清江铁路12306购票系统，购票请使用本人有效身份证件。',
  maxPassengersPerOrder: 5,
  presaleDays: 30,
  paymentTimeoutMinutes: 15,
  refundEnabled: true,
  servicePhone: '12306',
  // 退票手续费阶梯：距发车 hoursBefore 小时以上，收取 feeRate 比例
  refundRules: [
    { hoursBefore: 24, feeRate: 0.05 },
    { hoursBefore: 2, feeRate: 0.1 },
    { hoursBefore: 0, feeRate: 0.2 },
  ],
  changeFeeRate: 0.05,
  childDiscount: 0.5,
  checkinMinutes: 30,
  // 闸机显示：入站 / 出站欢迎语，{station} 会替换为检票端选择的站名
  entryWelcomeText: '欢迎光临{station}',
  exitWelcomeText: '欢迎您再次乘坐清江铁路12306',
  // 公告显示：顶部 / 弹窗；是否启动时显示；是否每次进入都弹
  announcementEnabled: true,
  announcementShowMode: 'top',
  announcementOnStart: true,
  announcementRepeat: false,
  // 全站页脚
  footerCopyright: '© 2026 清江铁路',
  footerIcp: '',
  footerPolice: '',
  footerPoliceNo: '',
  // 检票异常与设备
  maintenanceText: '此闸机正在维修，请使用其他闸机',
  liveDetection: true,
  showScanPreview: false,
  ticketQrRefreshSeconds: 30,
};

const DEFAULT_SECURITY = {
  blockedIps: [],
};

function hashPassword(password) {
  return crypto.createHash('sha256').update(`${password}::qingjiang`).digest('hex');
}

function defaultAccounts() {
  return [
    { id: 'a_admin', username: 'admin', name: '系统管理员', role: 'admin', password: hashPassword('123456'), createdAt: new Date().toISOString() },
    { id: 'a_operator', username: 'operator', name: '购票员', role: 'operator', password: hashPassword('123456'), createdAt: new Date().toISOString() },
    { id: 'a_inspector', username: 'inspector', name: '检票员', role: 'inspector', password: hashPassword('123456'), createdAt: new Date().toISOString() },
  ];
}

// 初始业务数据为空：城市、车站、车次、票额都需要在后台录入；账号有默认三个
function buildSeed() {
  return {
    version: 4,
    settings: { ...DEFAULT_SETTINGS },
    accounts: defaultAccounts(),
    users: [],
    cities: [],
    stations: [],
    trains: [],
    quotas: [],
    passengers: [],
    orders: [],
    seatMaps: [],
    devices: [],
    bureaus: [
      {
        id: 'b_qingjiang',
        name: '清江铁路',
        shortName: '清江铁路',
        color: '#1b64c4',
        remark: '默认铁路局，可在后台新建如“清江铁路上海局”',
        createdAt: new Date().toISOString(),
      },
    ],
    fares: [],
    tvms: [],
    security: { ...DEFAULT_SECURITY },
    logs: [],
    checkinEvents: [],
    alerts: [],
  };
}

function normalize(db) {
  const seed = buildSeed();
  if (!Array.isArray(db.cities)) db.cities = [];
  if (!Array.isArray(db.stations)) db.stations = [];
  if (!Array.isArray(db.trains)) db.trains = [];
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.quotas)) db.quotas = [];
  if (!Array.isArray(db.passengers)) db.passengers = [];
  if (!Array.isArray(db.seatMaps)) db.seatMaps = [];
  if (!db.security || typeof db.security !== 'object') db.security = { ...DEFAULT_SECURITY };
  if (!Array.isArray(db.security.blockedIps)) db.security.blockedIps = [];
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.devices)) db.devices = [];
  if (!Array.isArray(db.logs)) db.logs = [];
  if (!Array.isArray(db.checkinEvents)) db.checkinEvents = [];
  if (!Array.isArray(db.alerts)) db.alerts = [];
  if (!Array.isArray(db.bureaus) || !db.bureaus.length) {
    db.bureaus = [
      {
        id: 'b_qingjiang',
        name: '清江铁路',
        shortName: '清江铁路',
        color: '#1b64c4',
        remark: '默认铁路局',
        createdAt: new Date().toISOString(),
      },
    ];
  }
  if (!Array.isArray(db.fares)) db.fares = [];
  if (!Array.isArray(db.tvms)) db.tvms = [];
  if (!Array.isArray(db.accounts) || !db.accounts.length) db.accounts = defaultAccounts();
  db.settings = { ...seed.settings, ...(db.settings || {}) };
  delete db.settings.gateStationName;
  if (db.settings.entryWelcomeText === '欢迎光临，{station}') {
    db.settings.entryWelcomeText = '欢迎光临{station}';
  }
  if (!Array.isArray(db.settings.refundRules) || !db.settings.refundRules.length) {
    db.settings.refundRules = seed.settings.refundRules;
  }
  // 兼容旧车次：补齐站台、检票口、地标颜色
  db.stations.forEach((s) => {
    if (!s.status) s.status = 'normal';
    if (s.gateCount === undefined) s.gateCount = 1;
    if (s.platformCount === undefined) s.platformCount = 1;
    if (!s.address) s.address = '';
    // 模组车站范围与中心点
    if (!Number.isFinite(Number(s.x))) s.x = null;
    if (!Number.isFinite(Number(s.y))) s.y = null;
    if (!Number.isFinite(Number(s.z))) s.z = null;
    if (!s.dimension) s.dimension = '';
    if (!Array.isArray(s.gates)) s.gates = [];
    if (!Array.isArray(s.vendors)) s.vendors = [];
    if (!s.bureauId) s.bureauId = db.bureaus[0] ? db.bureaus[0].id : '';
  });
  db.trains.forEach((t) => {
    if (!t.platform) t.platform = '1';
    if (!Array.isArray(t.gates) || !t.gates.length) {
      t.gates = String(t.gate || 'A')
        .split(/[,\/、，\s]+/)
        .map((v) => String(v).trim().toUpperCase())
        .filter(Boolean);
    }
    t.gates = Array.from(new Set(t.gates.map((v) => String(v).trim().toUpperCase()).filter(Boolean))).slice(0, 8);
    if (!t.gates.length) t.gates = ['A'];
    t.gate = t.gates.join(' / ');
    if (!['normal', 'delayed', 'cancelled', 'maintenance'].includes(t.status)) t.status = 'normal';
    t.delayMinutes = Math.max(0, Math.min(240, Number(t.delayMinutes) || 0));
    if (!Array.isArray(t.tempGates)) {
      t.tempGates = String(t.tempGate || '')
        .split(/[,\/、，\s]+/)
        .map((v) => String(v).trim().toUpperCase())
        .filter(Boolean);
    }
    t.tempGates = Array.from(new Set(t.tempGates.map((v) => String(v).trim().toUpperCase()).filter(Boolean))).slice(0, 8);
    t.tempGate = t.tempGates.join(' / ');
    if (!t.tempPlatform) t.tempPlatform = '';
    if (!t.runtimeNote) t.runtimeNote = '';
    // 运行调整按日期保存；旧版全局状态首次加载时迁移到今天
    if (!t.runtimeByDate || typeof t.runtimeByDate !== 'object' || Array.isArray(t.runtimeByDate)) {
      t.runtimeByDate = {};
    }
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const legacyRuntime =
      t.status !== 'normal' || Number(t.delayMinutes) > 0 || t.tempGates.length > 0 || t.tempPlatform || t.runtimeNote;
    if (legacyRuntime && !t.runtimeByDate[todayKey]) {
      t.runtimeByDate[todayKey] = {
        status: t.status,
        delayMinutes: Number(t.delayMinutes) || 0,
        tempGates: t.tempGates,
        tempGate: t.tempGate,
        tempPlatform: t.tempPlatform,
        runtimeNote: t.runtimeNote,
        updatedAt: new Date().toISOString(),
      };
    }
    if (legacyRuntime) {
      t.status = 'normal';
      t.delayMinutes = 0;
      t.tempGates = [];
      t.tempGate = '';
      t.tempPlatform = '';
      t.runtimeNote = '';
    }
    Object.keys(t.runtimeByDate).forEach((date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        delete t.runtimeByDate[date];
        return;
      }
      const entry = t.runtimeByDate[date] || {};
      const status = ['normal', 'delayed', 'cancelled', 'maintenance'].includes(entry.status) ? entry.status : 'normal';
      const delayMinutes = status === 'delayed' ? Math.max(0, Math.min(240, Number(entry.delayMinutes) || 0)) : 0;
      const gates = Array.isArray(entry.tempGates)
        ? entry.tempGates
        : String(entry.tempGate || '')
            .split(/[,\/、，\s]+/)
            .filter(Boolean);
      const tempGates = Array.from(new Set(gates.map((v) => String(v).trim().toUpperCase()).filter(Boolean))).slice(0, 8);
      const tempPlatform = String(entry.tempPlatform || '').trim();
      const runtimeNote = String(entry.runtimeNote || '').trim().slice(0, 120);
      if (status === 'normal' && !delayMinutes && !tempGates.length && !tempPlatform && !runtimeNote) {
        delete t.runtimeByDate[date];
        return;
      }
      t.runtimeByDate[date] = {
        status,
        delayMinutes,
        tempGates,
        tempGate: tempGates.join(' / '),
        tempPlatform,
        runtimeNote,
        updatedAt: entry.updatedAt || new Date().toISOString(),
      };
    });
    if (!t.landmarkColor) t.landmarkColor = '蓝色';
  });
  // 兼容旧订单：补齐票种、检票与发票字段
  db.orders.forEach((o) => {
    if (!Array.isArray(o.passengers)) o.passengers = [];
    o.passengers.forEach((p) => {
      if (!p.type) p.type = '成人';
      if (!p.price) p.price = o.price;
    });
    if (o.checkedIn === undefined) o.checkedIn = false;
    if (o.invoiceNo === undefined) o.invoiceNo = '';
    // 模组票据字段
    if (o.printed === undefined) o.printed = false;
    if (o.printCount === undefined) o.printCount = 0;
    if (!o.coupon) o.coupon = 'ticket';
    if (!o.currency) o.currency = 'emerald';
  });
  db.version = 4;
  return db;
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    cache = normalize(JSON.parse(raw));
  } catch (e) {
    cache = buildSeed();
  }
  return cache;
}

function getDB() {
  return load();
}

/** 从磁盘重新读取，用于检票服务直接写库后主服务刷新监控数据 */
function refreshDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    cache = normalize(JSON.parse(raw));
  } catch (e) {
    /* 保留现有缓存 */
  }
  return cache;
}

/**
 * 原子落盘：先写临时文件再 rename，避免并发写造成半截文件。
 * Windows 上 rename 偶发 EPERM（杀毒/索引占用），做有限重试。
 */
function saveDB() {
  const db = load();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, DB_PATH);
      return db;
    } catch (e) {
      lastErr = e;
      const until = Date.now() + 50;
      while (Date.now() < until) {
        // 短暂自旋等待文件句柄释放
      }
    }
  }
  throw lastErr || new Error('数据写入失败');
}

function resetDB() {
  cache = buildSeed();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}

module.exports = {
  getDB,
  saveDB,
  refreshDB,
  resetDB,
  DB_PATH,
  DATA_DIR,
  DEFAULT_SETTINGS,
  hashPassword,
};
