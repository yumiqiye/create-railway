/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/* 电子客票动态二维码：QJ|订单号|时间戳|HMAC，防止截图长期复用 */
const crypto = require('crypto');

function sign(secret, orderNo, ts) {
  return crypto.createHmac('sha256', String(secret || '')).update(`${orderNo}|${ts}`).digest('hex').slice(0, 24);
}

function makePayload(secret, orderNo, now) {
  const ts = Math.floor((now ? new Date(now).getTime() : Date.now()) / 1000);
  return `QJ|${orderNo}|${ts}|${sign(secret, orderNo, ts)}`;
}

function parsePayload(secret, code, ttlSeconds) {
  const raw = String(code || '').trim();
  if (!raw.startsWith('QJ|')) return { orderNo: raw, signed: false, valid: true };
  const parts = raw.split('|');
  if (parts.length === 2) return { orderNo: parts[1], signed: false, valid: true };
  const orderNo = parts[1] || '';
  const ts = Number(parts[2] || 0);
  const sig = parts[3] || '';
  if (!orderNo || !ts || !sig) return { orderNo, signed: true, valid: false, error: '二维码格式无效' };
  if (sign(secret, orderNo, ts) !== sig) return { orderNo, signed: true, valid: false, error: '二维码签名无效，请重新打开电子客票' };
  const age = Date.now() / 1000 - ts;
  if (age > Number(ttlSeconds || 90)) return { orderNo, signed: true, valid: false, error: '二维码已过期，请刷新电子客票后重试', expired: true };
  if (age < -30) return { orderNo, signed: true, valid: false, error: '二维码时间异常' };
  return { orderNo, signed: true, valid: true, ts };
}

module.exports = { sign, makePayload, parsePayload };
