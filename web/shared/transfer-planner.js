/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/**
 * 中转方案规划
 * 以车站为图节点、车次为有向边，枚举“出发站 -> 中转站 -> 到达站”的两段路径。
 * 用 Dijkstra 的最短总耗时思想：总耗时 = 第一段运行时间 + 中转等待 + 第二段运行时间。
 * 只保留换乘时间 25 分钟以上、6 小时以内的可行组合。
 */

const MIN_TRANSFER_MINUTES = 25;
const MAX_TRANSFER_MINUTES = 360;
const MAX_RESULTS = 3;

function minutesOf(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function durationMinutes(train) {
  const dep = minutesOf(train.departTime);
  const arr = minutesOf(train.arriveTime);
  if (dep === null || arr === null) return null;
  return arr >= dep ? arr - dep : arr + 24 * 60 - dep;
}

function trainEdge(train) {
  const duration = durationMinutes(train);
  if (duration === null) return null;
  const dep = minutesOf(train.departTime);
  return { train, dep, duration, arr: dep + duration };
}

function planTransfers(db, fromCityId, toCityId, date) {
  const fromStations = (db.stations || []).filter((s) => s.cityId === fromCityId);
  const toStations = (db.stations || []).filter((s) => s.cityId === toCityId);
  const fromIds = new Set(fromStations.map((s) => s.id));
  const toIds = new Set(toStations.map((s) => s.id));
  if (!fromIds.size || !toIds.size) return [];

  const edges = (db.trains || [])
    .map(trainEdge)
    .filter(Boolean);

  const candidates = [];
  for (const first of edges) {
    if (!fromIds.has(first.train.fromStationId)) continue;
    const hubId = first.train.toStationId;
    if (!hubId || fromIds.has(hubId) || toIds.has(hubId)) continue;
    const secondLegs = edges.filter(
      (e) => e.train.fromStationId === hubId && toIds.has(e.train.toStationId) && e.train.id !== first.train.id
    );
    for (const second of secondLegs) {
      const wait = second.dep - first.arr;
      if (wait < MIN_TRANSFER_MINUTES || wait > MAX_TRANSFER_MINUTES) continue;
      const total = first.duration + wait + second.duration;
      candidates.push({
        hubStationId: hubId,
        first,
        second,
        waitMinutes: wait,
        totalMinutes: total,
      });
    }
  }

  return candidates
    .sort((a, b) => a.totalMinutes - b.totalMinutes)
    .slice(0, MAX_RESULTS);
}

module.exports = { planTransfers, durationMinutes, MIN_TRANSFER_MINUTES };
