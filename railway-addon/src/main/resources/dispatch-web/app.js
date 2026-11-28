/* 机械动力：铁路增强 · 调度台前端（内置） */
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const S = {
  state: null,
  dim: 'minecraft:overworld',
  tracks: { dim: null, lines: [] },
  refreshMs: 1000,
  theme: 'dark',
  tab: 'trains',
  trainsTarget: {},
  trainsShow: {},
  stations: [],
  groups: [],
  signals: [],
  trains: [],
  selectedSignal: null,
  selectedTrain: null,
  online: false,
  failCount: 0,
  timer: null,
  form: {},
  logs: []
};

const view = { cx: 0, cz: 0, scale: 2, ready: false };
let focusPulse = null;
const sigOverride = {};   // 操作后的本地即时状态，避免快照延迟造成"点了没反应"

function sigForceRed(sig) {
  const ov = sigOverride[sig.id];
  if (ov && ov.until > Date.now()) return ov.forced;
  return !!sig.forced;
}

function setSignalOverride(id, forced, ms) {
  const win = ms || 6000;
  sigOverride[id] = { forced: !!forced, until: Date.now() + win };
  renderSignals();
  setTimeout(() => {
    const ov = sigOverride[id];
    if (ov && ov.until <= Date.now()) { delete sigOverride[id]; renderSignals(); }
  }, win + 100);
}

function clearSignalOverride(id) {
  delete sigOverride[id];
  renderSignals();
}

function focusSignal(sig) {
  S.selectedSignal = sig.id;
  view.cx = sig.x; view.cz = sig.z;
  if (view.scale < 3.5) view.scale = 3.5;
  view.ready = true;
  focusPulse = { x: sig.x, z: sig.z, t0: performance.now() };
  switchTab('signals');
  renderSignals();
}

/* ---------------- 工具 ---------------- */
function fmtTime(sec) {
  if (sec == null || sec < 0) return '—';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? m + ' 分 ' + s + ' 秒' : s + ' 秒';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shortId(id) { return id ? id.slice(0, 8) : ''; }
function dimLabel(dim) {
  if (!dim) return '未知维度';
  const tail = dim.split(':').pop();
  const map = { overworld: '主世界', the_nether: '下界', the_end: '末地' };
  return map[tail] || tail;
}
function groupsForDim(dim) {
  return S.groups.filter(g => g.dimension === dim);
}
function platsForGroup(groupId, dim) {
  return S.stations.filter(p => p.groupId === groupId && p.dimension === dim);
}
function platformName(id) {
  const p = S.stations.find(s => s.id === id);
  return p ? p.name : id;
}
function trainDim(trainId) {
  const t = S.trains.find(x => x.id === trainId);
  return t ? t.dimension : S.dim;
}
function isEditing() {
  const el = document.activeElement;
  return el && el.closest && el.closest('.panels');
}

/* ---------------- 轮询 ---------------- */
async function poll() {
  try {
    const res = await fetch('/api/state?_=' + Date.now(), { cache: 'no-store' });
    const data = await res.json();
    applyState(data);
    S.failCount = 0;
    setOnline(true);
  } catch (e) {
    S.failCount++;
    if (S.failCount >= 2) setOnline(false);
  } finally {
    schedule();
  }
}

function schedule() {
  clearTimeout(S.timer);
  S.timer = setTimeout(poll, Math.max(300, S.refreshMs));
}

function setOnline(on) {
  if (on === S.online) return;
  S.online = on;
  $('#conn').classList.toggle('on', on);
  $('#connText').textContent = on ? '已连接' : '连接中断';
}

function applyState(data) {
  if (!data) return;
  const meta = data.meta || {};
  if (meta.refreshMs && !S.refreshLocked) S.refreshMs = meta.refreshMs;
  if (meta.theme && !S.themeLocked) applyTheme(meta.theme, false);
  if (meta.createPresent !== undefined) {
    let ver = meta.createVersion ? ('Create ' + meta.createVersion) : '未检测到 Create';
    const inst = [];
    if (meta.serverName) inst.push('存档 ' + meta.serverName);
    if (meta.port) inst.push(':' + meta.port);
    if (inst.length) ver += ' · ' + inst.join(' · ');
    $('#createVer').textContent = ver;
    $('#createVer').style.color = meta.createPresent ? '' : 'var(--danger)';
    $('#createVer').title = 'mod ' + (meta.modVersion || '?')
      + ' / 存档 ' + (meta.serverName || '?')
      + ' / 监听 ' + (meta.port || '?')
      + '（同时开多个版本时端口会自动顺延，看这里确认连的是哪个实例）';
  }
  if (meta.tps != null) $('#tps').textContent = 'TPS ' + meta.tps + ' / ' + (meta.tickMs || 0) + 'ms';

  S.state = data;
  S.trains = data.trains || [];
  S.stations = data.stations || [];
  S.groups = data.stationGroups || [];
  S.signals = data.signals || [];
  S.logs = data.logs || [];

  if (!view.ready && S.trains.length) fitView();
  syncDims(meta);

  trainMarkersUpdate();
  $('#nTrains').textContent = S.trains.length;
  $('#nSignals').textContent = S.signals.length;
  renderClock(data.clock);

  if (!isEditing()) {
    renderTrains();
    renderSignals();
    renderTimetable();
    renderLogs();
  }
  renderClock(data.clock);
}

function syncDims(meta) {
  const dims = new Set();
  (meta && meta.dimensions || []).forEach(d => dims.add(d));
  S.trains.forEach(t => dims.add(t.dimension));
  S.stations.forEach(t => dims.add(t.dimension));
  if (!dims.has(S.dim) && dims.size) S.dim = dims.has('minecraft:overworld') ? 'minecraft:overworld' : Array.from(dims)[0];
  const sel = $('#dimSelect');
  const options = Array.from(dims);
  const cur = sel.value;
  if (sel.options.length !== options.length || options.some((d, i) => sel.options[i].value !== d)) {
    sel.innerHTML = options.map(d => `<option value="${esc(d)}">${esc(dimLabel(d))}</option>`).join('');
  }
  sel.value = S.dim;
  if (S.tracks.dim !== S.dim) loadTracks(S.dim, true);
}

async function loadTracks(dim, autoFit) {
  try {
    const res = await fetch('/api/tracks?dim=' + encodeURIComponent(dim), { cache: 'no-store' });
    const data = await res.json();
    // 若期间维度已被切走，丢弃这次结果，避免覆盖
    if (S.dim !== dim) return;
    S.tracks = { dim: dim, lines: data.lines || [] };
    const pts = S.tracks.lines.reduce((a, l) => a + l.length / 2, 0);
    $('#mapStats').textContent = '线路 ' + S.tracks.lines.length + ' 段 / ' + pts + ' 点';
    // 定时刷新只换数据，不抢视野；只有首次加载或切换维度才重新适配
    if (autoFit || !view.ready) setTimeout(fitView, 60);
  } catch (e) {
    S.tracks = { dim: dim, lines: [] };
  }
}

function trainMarkersUpdate() {
  const now = performance.now();
  (S.trains || []).forEach(t => {
    const prev = S.trainsTarget[t.id];
    S.trainsTarget[t.id] = { x: t.x, z: t.z, at: now, name: t.name };
    if (!S.trainsShow[t.id]) S.trainsShow[t.id] = { x: t.x, z: t.z, ang: 0 };
    if (prev && (Math.abs(prev.x - t.x) > 0.05 || Math.abs(prev.z - t.z) > 0.05)) {
      S.trainsShow[t.id].ang = Math.atan2(t.z - prev.z, t.x - prev.x);
    }
  });
}

/* ---------------- 主题 ---------------- */
function applyTheme(theme, save) {
  S.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', S.theme);
  $('#themeBtn').textContent = S.theme === 'dark' ? '☀ 浅色' : '☾ 深色';
  localStorage.setItem('pyrail_theme', S.theme);
  if (save) postJSON('/api/config', { theme: S.theme }).then(() => { S.themeLocked = true; setTimeout(() => S.themeLocked = false, 3000); }).catch(() => {});
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return res.json();
}

/* ---------------- 时钟 ---------------- */
let localClockOffset = 0;
function renderClock(serverClock) {
  const box = $('#clock');
  if (!box || !serverClock) return;
  localClockOffset = 0;
  box.textContent = serverClock;
  setIntervalOnce();
}
let clockTimer = null;
function setIntervalOnce() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    const box = $('#clock');
    if (!box || !S.state || !S.state.clock) return;
    const last = S.state.updatedAt || Date.now();
    const d = new Date(last + (Date.now() - last));
    box.textContent = d.toTimeString().slice(0, 8);
  }, 500);
}

/* ---------------- 地图绘制 ---------------- */
const canvas = $('#map');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  const first = W === 0;
  const box = canvas.parentElement.getBoundingClientRect();
  DPR = window.devicePixelRatio || 1;
  W = Math.max(200, box.width); H = Math.max(200, box.height);
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // 首次才重新适配；窗口变化 / 浏览器缩放时保留用户当前的平移与缩放
  if (first) view.ready = false;
}
window.addEventListener('resize', resize);

function toScreen(x, z) {
  return [(x - view.cx) * view.scale + W / 2, (z - view.cz) * view.scale + H / 2];
}

function fitView() {
  const pts = [];
  (S.tracks.lines || []).forEach(line => {
    for (let i = 0; i < line.length; i += 2) pts.push([line[i], line[i + 1]]);
  });
  S.stations.filter(s => s.dimension === S.dim).forEach(s => pts.push([s.x, s.z]));
  S.trains.filter(t => t.dimension === S.dim).forEach(t => pts.push([t.x, t.z]));
  if (!pts.length) { view.cx = 0; view.cz = 0; view.scale = 3; view.ready = true; return; }
  let minX = 1e18, maxX = -1e18, minZ = 1e18, maxZ = -1e18;
  pts.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); });
  view.cx = (minX + maxX) / 2;
  view.cz = (minZ + maxZ) / 2;
  const spanX = Math.max(30, maxX - minX), spanZ = Math.max(30, maxZ - minZ);
  view.scale = Math.min((W - 90) / spanX, (H - 90) / spanZ);
  view.scale = Math.max(0.02, Math.min(view.scale, 14));
  view.ready = true;
}

function drawFrame(ts) {
  requestAnimationFrame(drawFrame);
  if (!W) return;
  ctx.clearRect(0, 0, W, H);

  if (!view.ready) fitView();

  // 线路
  const lines = S.tracks.lines || [];
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    for (const line of lines) {
      if (line.length < 4) continue;
      ctx.beginPath();
      for (let i = 0; i < line.length; i += 2) {
        const [sx, sy] = toScreen(line[i], line[i + 1]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      if (pass === 0) {
        ctx.strokeStyle = 'rgba(60,150,170,0.22)';
        ctx.lineWidth = Math.max(3, view.scale * 0.9);
        ctx.shadowColor = 'rgba(60,180,200,0.25)';
        ctx.shadowBlur = 8;
      } else {
        ctx.strokeStyle = S.theme === 'dark' ? 'rgba(120,215,235,0.55)' : 'rgba(30,110,130,0.75)';
        ctx.lineWidth = Math.max(1.2, Math.min(3, view.scale * 0.4));
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;

  // 车站
  const t0 = ts / 1000;
  S.stations.filter(s => s.dimension === S.dim).forEach(st => {
    const [sx, sy] = toScreen(st.x, st.z);
    if (sx < -80 || sy < -80 || sx > W + 80 || sy > H + 80) return;
    const r = Math.max(3, Math.min(7, view.scale * 0.9));
    ctx.save();
    ctx.translate(sx, sy);
    if (st.present) {
      const pulse = 0.5 + 0.5 * Math.sin(t0 * 2.2);
      ctx.beginPath();
      ctx.arc(0, 0, r + 6 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,176,32,' + (0.45 - pulse * 0.3) + ')';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.fillStyle = st.present ? '#ffb020' : (st.imminent ? '#ffd166' : 'rgba(160,180,200,0.75)');
    ctx.beginPath();
    ctx.roundRect(-r, -r, r * 2, r * 2, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    drawLabel(st.name, sx + r + 4, sy - r - 2, st.present ? '#ffb020' : null);
  });

  // 信号机
  const blink = 0.55 + 0.45 * Math.sin(t0 * 3.4);
  S.signals.filter(s => s.dimension === S.dim).forEach(sig => {
    const [sx, sy] = toScreen(sig.x, sig.z);
    if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) return;
    const eff = sigForceRed(sig) ? 'RED' : sig.state;
    const color = eff === 'RED' ? (S.theme === 'dark' ? '#ff5a5f' : '#d13b40')
      : eff === 'GREEN' ? (S.theme === 'dark' ? '#39d98a' : '#0f9d63')
        : eff === 'YELLOW' ? '#ffd166' : '#7f95a5';
    const alpha = eff === 'RED' ? blink : 1;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6 + Math.min(2, view.scale * 0.3), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (sigForceRed(sig)) {
      ctx.beginPath();
      ctx.arc(sx, sy, 6 + 3 * blink, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,90,95,0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (S.selectedSignal === sig.id) {
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // 定位脉冲
  if (focusPulse) {
    const age = (performance.now() - focusPulse.t0) / 1000;
    if (age > 1.8) {
      focusPulse = null;
    } else {
      const [px, py] = toScreen(focusPulse.x, focusPulse.z);
      for (let k = 0; k < 2; k++) {
        const a = age - k * 0.35;
        if (a <= 0 || a > 1) continue;
        ctx.beginPath();
        ctx.arc(px, py, 8 + a * 42, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,214,90,' + (0.8 * (1 - a)) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // 列车
  S.trains.filter(t => t.dimension === S.dim).forEach(tr => {
    const shown = S.trainsShow[tr.id];
    if (!shown) return;
    const k = 1 - Math.pow(0.86, 1);
    shown.x += (tr.x - shown.x) * 0.12;
    shown.z += (tr.z - shown.z) * 0.12;
    const [sx, sy] = toScreen(shown.x, shown.z);
    if (sx < -60 || sy < -60 || sx > W + 60 || sy > H + 60) return;
    const ang = shown.ang || 0;
    const pulse = 0.5 + 0.5 * Math.sin(t0 * 2.6);
    ctx.beginPath();
    ctx.arc(sx, sy, 10 + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(57,217,138,' + (0.35 - pulse * 0.25) + ')';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.fillStyle = S.theme === 'dark' ? '#eaf6ff' : '#10202b';
    ctx.beginPath();
    ctx.roundRect(-8, -4.2, 16, 8.4, 2.4);
    ctx.fill();
    ctx.fillStyle = '#39d98a';
    ctx.beginPath();
    ctx.roundRect(4.2, -3.0, 2.6, 6.0, 1.2);
    ctx.fill();
    ctx.restore();

    drawLabel(tr.name + '  ' + Math.round(tr.speedKph) + ' km/h', sx + 11, sy - 8, '#39d98a');
  });
}

function drawLabel(text, x, y, color) {
  if (!text) return;
  ctx.font = '11px "Microsoft YaHei", sans-serif';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = S.theme === 'dark' ? 'rgba(6,14,20,0.72)' : 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.roundRect(x - 3, y - 10, w + 6, 14, 3);
  ctx.fill();
  ctx.fillStyle = color || (S.theme === 'dark' ? '#cfe3ee' : '#20303c');
  ctx.fillText(text, x, y);
}

/* ---------------- 地图交互 ---------------- */
let dragging = false, dragStart = null, movedFar = false;

canvas.addEventListener('mousedown', e => {
  dragging = true; movedFar = false;
  dragStart = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz };
  canvas.parentElement.classList.add('dragging');
});
window.addEventListener('mouseup', e => {
  canvas.parentElement.classList.remove('dragging');
  if (dragging && !movedFar && S.lastHoverSignal) selectSignal(S.lastHoverSignal);
  dragging = false;
});
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (dragging && dragStart) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedFar = true;
    view.cx = dragStart.cx - dx / view.scale;
    view.cz = dragStart.cz - dy / view.scale;
    return;
  }
  hoverEntity(mx, my, e);
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wx = (mx - W / 2) / view.scale + view.cx;
  const wz = (my - H / 2) / view.scale + view.cz;
  const factor = e.deltaY > 0 ? 1 / 1.16 : 1.16;
  view.scale = Math.max(0.02, Math.min(30, view.scale * factor));
  view.cx = wx - (mx - W / 2) / view.scale;
  view.cz = wz - (my - H / 2) / view.scale;
}, { passive: false });

function nearest(mx, my, items, limit) {
  let best = null, bestD = limit;
  items.forEach(it => {
    const [sx, sy] = toScreen(it.x, it.z);
    const d = Math.hypot(sx - mx, sy - my);
    if (d < bestD) { bestD = d; best = it; }
  });
  return best;
}

function hoverEntity(mx, my, e) {
  const tip = $('#tip');
  const sig = nearest(mx, my, S.signals.filter(s => s.dimension === S.dim), 12);
  const st = nearest(mx, my, S.stations.filter(s => s.dimension === S.dim), 14);
  const tr = nearest(mx, my, S.trains.filter(t => t.dimension === S.dim), 16);
  S.lastHoverSignal = sig ? sig.id : null;
  let html = '';
  if (tr) {
    html = '<b>' + esc(tr.name) + '</b><div><span class="k">状态 </span>' + esc(tr.status) + ' · ' + Math.round(tr.speedKph) + ' km/h</div>'
      + '<div><span class="k">下一站 </span>' + esc(tr.nextStationName || '—') + '</div>'
      + '<div><span class="k">距离 </span>' + (tr.distanceToDest >= 0 ? Math.round(tr.distanceToDest) + ' 格' : '—') + '</div>'
      + '<div><span class="k">载客 </span>' + tr.passengers + ' 人</div>';
  } else if (sig) {
    html = '<b>信号机 ' + esc(sig.type || '') + '</b><div><span class="k">状态 </span>' + esc(sig.state)
      + (sig.forced ? '（强制红）' : '') + '</div><div><span class="k">区间 </span>' + (sig.occupied ? '占用' : '空闲') + '</div>'
      + '<div><span class="k">坐标 </span>' + Math.round(sig.x) + ', ' + Math.round(sig.y) + ', ' + Math.round(sig.z) + '</div>';
  } else if (st) {
    html = '<b>' + esc(st.name) + '</b><div><span class="k">状态 </span>' + (st.present ? '有车停靠' : st.imminent ? '列车接近' : '空闲') + '</div>'
      + '<div><span class="k">坐标 </span>' + Math.round(st.x) + ', ' + Math.round(st.y) + ', ' + Math.round(st.z) + '</div>';
  }
  if (!html) return tip.classList.add('hidden');
  tip.innerHTML = html;
  const rect = canvas.getBoundingClientRect();
  tip.style.left = (e.clientX - rect.left) + 'px';
  tip.style.top = (e.clientY - rect.top) + 'px';
  tip.classList.remove('hidden');
}

/* ---------------- 面板：列车 ---------------- */
function renderTrains() {
  const box = $('#panel-trains');
  if (!S.trains.length) {
    box.innerHTML = '<div class="empty">当前没有 Create 列车<br><small>在游戏里组装火车并设置时刻表后会立即出现在这里</small></div>';
    return;
  }
  box.innerHTML = S.trains.map(t => {
    const badge = t.delayState === 'late' ? 'late' : t.delayState === 'early' ? 'early' : 'ok';
    const statusClass = t.derailed ? 'warn' : t.waitingSignal ? 'early' : 'ok';
    const form = S.form[t.id] || {};
    const dimGroups = groupsForDim(t.dimension);
    let selGroup = form.group || '';
    if (!dimGroups.some(g => g.id === selGroup)) {
      const cur = S.stations.find(s => s.id === (form.station || t.nextStationId));
      selGroup = cur ? cur.groupId : (dimGroups[0] ? dimGroups[0].id : '');
    }
    const plats = platsForGroup(selGroup, t.dimension);
    const selPlat = form.station || (plats.some(p => p.id === t.nextStationId) ? t.nextStationId : '');
    const grpOpts = dimGroups.map(g => `<option value="${esc(g.id)}"${g.id === selGroup ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    let platOpts = plats.map(p => `<option value="${esc(p.id)}"${p.id === selPlat ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    if (t.nextStationId && !plats.some(p => p.id === t.nextStationId)) {
      platOpts += `<option value="${esc(t.nextStationId)}">当前目的地：${esc(t.nextStationName)}</option>`;
    }
    const onBoard = (t.onBoard || []).length ? '（' + t.onBoard.map(esc).join('、') + '）' : '';
    return `<div class="card${S.selectedTrain === t.id ? ' sel' : ''}" data-train="${esc(t.id)}">
      <h3>${esc(t.name)}<span class="id">#${esc(shortId(t.id))}</span>
        <span class="badge ${statusClass}" style="margin-left:auto">${esc(t.status)}</span></h3>
      <div class="row"><span>速度</span><b>${Math.round(t.speedKph)} km/h</b></div>
      <div class="row"><span>下一站</span><b>${esc(t.nextStationName || '—')}</b></div>
      <div class="row"><span>剩余 / 预计到达</span><b>${t.distanceToDest >= 0 ? Math.round(t.distanceToDest) + ' 格' : '—'} · ${esc(t.etaClock)}</b></div>
      <div class="row"><span>计划时刻</span><b>${esc(t.plannedTime || '未排点')}</b>
        <span class="badge ${badge}">${esc(t.delayText || '—')}</span></div>
      <div class="row"><span>载客</span><b>${t.passengers} 人${onBoard}</b></div>
      <div class="actions">
        <select class="grpsel" data-train="${esc(t.id)}">${grpOpts || '<option value="">无车站</option>'}</select>
        <select class="stsel" data-train="${esc(t.id)}">${platOpts || '<option value="">无站台</option>'}</select>
        <button class="mini primary" data-act="dest" data-train="${esc(t.id)}">改派下一站</button>
      </div>
      <div class="actions">
        <input type="time" step="1" class="tin" data-train="${esc(t.id)}" value="${esc(form.time || t.plannedTime || '')}">
        <button class="mini" data-act="tt" data-train="${esc(t.id)}">设定本站计划时刻</button>
      </div>
    </div>`;
  }).join('');
}

/* ---------------- 面板：信号机 ---------------- */
function renderSignals() {
  const box = $('#panel-signals');
  const list = S.signals.filter(s => s.dimension === S.dim);
  if (!list.length) {
    box.innerHTML = '<div class="empty">本维度没有 Create 信号机<br><small>放置信号机并绑定轨道后自动识别</small></div>';
    return;
  }
  const forcedCount = list.filter(s => sigForceRed(s)).length;
  const rest = list.filter(s => !sigForceRed(s));
  const redCount = rest.filter(s => s.state === 'RED').length;
  const yellowCount = rest.filter(s => s.state === 'YELLOW').length;
  const greenCount = rest.filter(s => s.state === 'GREEN').length;
  const unloadedCount = rest.filter(s => s.state === 'UNLOADED').length;
  box.innerHTML = `<div class="actions"><button class="mini" data-act="allgreen">本维度全部恢复自动</button>
      <span class="pill">强制红 ${forcedCount} / 红 ${redCount} / 黄 ${yellowCount} / 绿 ${greenCount}${unloadedCount ? ' / 未加载 ' + unloadedCount : ''}</span></div>`
    + list.map(sig => {
      const forced = sigForceRed(sig);
      const eff = forced ? 'RED' : sig.state;
      const dot = eff === 'RED' ? 'red' : eff === 'GREEN' ? 'green' : eff === 'YELLOW' ? 'yellow' : 'gray';
      const stateText = forced ? '强制红' : eff === 'RED' ? '红灯' : eff === 'GREEN' ? '绿灯' : eff === 'YELLOW' ? '黄灯' : eff === 'UNLOADED' ? '未加载' : '未知';
      return `<div class="card sig-card${S.selectedSignal === sig.id ? ' sel' : ''}" data-sig="${esc(sig.id)}" title="点击在地图上定位该信号机">
        <h3><i class="dot dot-${dot}"></i>信号机 <span class="id">${esc(sig.type || '')}</span>
          <span class="badge ${eff === 'RED' ? 'late' : (eff === 'GREEN' ? 'ok' : 'warn')}" style="margin-left:auto">${stateText}</span></h3>
        <div class="row"><span>坐标</span><b>${Math.round(sig.x)}, ${Math.round(sig.y)}, ${Math.round(sig.z)}</b></div>
        <div class="row"><span>区间占用</span><b>${sig.occupied ? '被列车占用' : '空闲'}</b></div>
        <div class="actions">
          <button class="mini danger" data-act="sigred" data-sig="${esc(sig.id)}">强制红灯</button>
          <button class="mini" data-act="siggreen" data-sig="${esc(sig.id)}">恢复自动</button>
        </div>
      </div>`;
    }).join('');
}

/* ---------------- 面板：时刻表 ---------------- */
function renderTimetable() {
  const box = $('#panel-timetable');
  const rows = [];
  S.trains.forEach(t => {
    const tt = t.timetable || {};
    Object.keys(tt).forEach(stationId => {
      const isNext = stationId === t.nextStationId;
      const state = isNext ? t.delayText : '后续';
      const cls = isNext ? (t.delayState === 'late' ? 'late' : t.delayState === 'early' ? 'early' : 'ok') : 'ok';
      rows.push(`<tr><td>${esc(t.name)}</td><td>${esc(platformName(stationId))}</td><td>${esc(tt[stationId])}</td>
        <td>${isNext ? esc(t.etaClock) : '—'}</td><td><span class="badge ${cls}">${esc(state)}</span></td></tr>`);
    });
  });
  const trainOpts = S.trains.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  const grpOpts = groupsForDim(S.dim).map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  const firstGrp = groupsForDim(S.dim)[0];
  const firstPlats = firstGrp ? platsForGroup(firstGrp.id, firstGrp.dimension) : [];
  const platOpts = firstPlats.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  box.innerHTML = `<div class="section">排点</div>
    <div class="card">
      <div class="row"><span>列车</span><select id="ttTrain">${trainOpts || '<option value="">无列车</option>'}</select></div>
      <div class="row"><span>车站</span><select id="ttGroup">${grpOpts || '<option value="">无车站</option>'}</select></div>
      <div class="row"><span>站台</span><select id="ttPlatform">${platOpts || '<option value="">无站台</option>'}</select></div>
      <div class="row"><span>计划时刻</span><input type="time" step="1" id="ttTime"></div>
      <div class="actions"><button class="mini primary" id="ttSave">写入时刻表</button>
        <button class="mini" id="ttClear">删除该点</button></div>
    </div>
    <div class="section">时刻表 / 早晚点</div>
    ${rows.length ? `<div class="card" style="padding:8px"><table class="tbl">
      <tr><th>列车</th><th>车站</th><th>计划</th><th>预计</th><th>状态</th></tr>${rows.join('')}</table></div>`
      : '<div class="empty">还没有排点<br><small>排点后会自动按实际速度推算到达时间与早晚点</small></div>'}`;
}

/* ---------------- 面板：设置 ---------------- */
function renderConfig() {
  const box = $('#panel-config');
  const meta = (S.state && S.state.meta) || {};
  const addons = (meta.addons || []).slice(0, 8).map(a => `<div class="row"><span>${esc(a)}</span></div>`).join('');
  box.innerHTML = `<div class="section">调度台</div>
    <div class="card">
      <div class="row"><span>网页刷新间隔</span><b id="cfgRefreshVal">${S.refreshMs} ms</b></div>
      <div class="slider"><input type="range" id="cfgRefresh" min="300" max="5000" step="100" value="${S.refreshMs}"></div>
      <div class="row"><span>服务端采样间隔</span><b id="cfgBuildVal">${meta.buildIntervalTicks || 10} tick</b></div>
      <div class="slider"><input type="range" id="cfgBuild" min="2" max="40" step="1" value="${meta.buildIntervalTicks || 10}"></div>
      <div class="actions"><button class="mini primary" id="cfgSave">保存设置</button>
        <button class="mini" id="cfgTheme">切换深/浅色</button></div>
    </div>
    <div class="section">性能</div>
    <div class="card">
      <div class="kv"><span class="k">采样段数</span><span class="v">${meta.trackSampleSteps || 4}</span></div>
      <div class="kv"><span class="k">最大点数</span><span class="v">${meta.maxTrackPoints || 7000}</span></div>
      <div class="kv"><span class="k">服务端 TPS</span><span class="v">${meta.tps != null ? meta.tps : '—'}</span></div>
      <div class="kv"><span class="k">客户端同步</span><span class="v">${meta.syncToClients === false ? '关闭' : '开启'}</span></div>
    </div>
    <div class="section">版本</div>
    <div class="card">
      <div class="kv"><span class="k">模组</span><span class="v">${esc(meta.modVersion || '')}</span></div>
      <div class="kv"><span class="k">Create</span><span class="v">${esc(meta.createVersion || '未检测到')}</span></div>
      <div class="kv"><span class="k">端口</span><span class="v">${esc(meta.port || 2217)}</span></div>
      <div class="kv"><span class="k">服务端</span><span class="v">${meta.serverSide ? '是' : '客户端同步模式'}</span></div>
      ${addons ? '<div class="section" style="margin-top:10px">已识别附属</div>' + addons : ''}
    </div>`;
}

/* ---------------- 面板：日志 ---------------- */
function renderLogs() {
  const box = $('#panel-logs');
  const logs = (S.logs || []).slice().reverse();
  if (!logs.length) {
    box.innerHTML = '<div class="empty">暂无调度记录<br><small>强制信号机、改派列车、修改设置都会记录在这里</small></div>';
    return;
  }
  box.innerHTML = logs.map(l => `<div class="logline"><span class="t">${esc(l.time || '')}</span><span>${esc(l.text || '')}</span></div>`).join('');
}

/* ---------------- 交互 ---------------- */
function selectSignal(id) {
  S.selectedSignal = id;
  switchTab('signals');
  renderSignals();
  const el = $('[data-sig="' + id.replace(/"/g, '\\"') + '"]');
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function switchTab(tab) {
  S.tab = tab;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
  if (tab === 'trains') renderTrains();
  if (tab === 'signals') renderSignals();
  if (tab === 'timetable') renderTimetable();
  if (tab === 'config') renderConfig();
  if (tab === 'logs') renderLogs();
}

async function action(url, body, okText) {
  try {
    const r = await postJSON(url, body);
    toast(r.message || (r.ok ? (okText || '完成') : '操作失败'), r.ok);
    setTimeout(poll, 120);
    return r;
  } catch (e) {
    toast('请求失败：' + e.message, false);
    return { ok: false };
  }
}

let toastTimer = null;
function toast(text, ok) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);padding:9px 16px;border-radius:10px;'
      + 'background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow);font-size:12.5px;z-index:99;max-width:70vw;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.borderColor = ok ? 'var(--accent)' : 'var(--danger)';
  el.style.color = ok ? 'var(--text)' : 'var(--danger)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 3200);
}

/* ---------------- 初始化 ---------------- */
function bind() {
  $$('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#themeBtn').addEventListener('click', () => applyTheme(S.theme === 'dark' ? 'light' : 'dark', true));
  $('#fitBtn').addEventListener('click', () => { fitView(); toast('已缩放到全网', true); });
  $('#dimSelect').addEventListener('change', e => { S.dim = e.target.value; loadTracks(S.dim, true); });

  $('#panel-trains').addEventListener('change', e => {
    const grp = e.target.closest('.grpsel');
    if (grp) {
      const id = grp.dataset.train;
      S.form[id] = S.form[id] || {};
      S.form[id].group = grp.value;
      const stsel = $('.stsel[data-train="' + id + '"]', $('#panel-trains'));
      if (stsel) {
        const plats = platsForGroup(grp.value, trainDim(id));
        stsel.innerHTML = plats.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
          || '<option value="">无站台</option>';
        S.form[id].station = stsel.value;
      }
      return;
    }
    const sel = e.target.closest('.stsel');
    if (sel) {
      const id = sel.dataset.train;
      S.form[id] = S.form[id] || {};
      S.form[id].station = sel.value;
    }
    const tin = e.target.closest('.tin');
    if (tin) {
      const id = tin.dataset.train;
      S.form[id] = S.form[id] || {};
      S.form[id].time = tin.value;
    }
  });

  $('#panel-trains').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const trainId = btn.dataset.train;
    const train = S.trains.find(t => t.id === trainId);
    if (!train) return;
    if (btn.dataset.act === 'dest') {
      const sel = $('#panel-trains .stsel[data-train="' + trainId.replace(/"/g, '\\"') + '"]');
      const stationId = sel && sel.value;
      if (!stationId) return toast('请先选择车站与站台', false);
      action('/api/destination', { trainId, stationId, stationName: platformName(stationId) }, '已改派目的地');
    }
    if (btn.dataset.act === 'tt') {
      const input = $('#panel-trains .tin[data-train="' + trainId.replace(/"/g, '\\"') + '"]');
      const time = input && input.value;
      if (!time) return toast('请先填写计划时刻', false);
      const stationId = train.nextStationId || (S.form[trainId] && S.form[trainId].station);
      if (!stationId) return toast('该列车当前没有下一站', false);
      action('/api/timetable', { trainId, stationId, time }, '时刻表已写入');
    }
  });

  $('#panel-signals').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      if (btn.dataset.act === 'allgreen') {
        const ids = S.signals.filter(s => s.dimension === S.dim && sigForceRed(s)).map(s => s.id);
        if (!ids.length) return toast('本维度没有强制红灯的信号机', true);
        ids.forEach(id => setSignalOverride(id, false));
        ids.reduce((p, id) => p.then(() => postJSON('/api/signal', { id, mode: 'green' })), Promise.resolve())
          .then(() => { toast('已恢复自动', true); setTimeout(poll, 300); });
        return;
      }
      const id = btn.dataset.sig;
      const mode = btn.dataset.act === 'sigred' ? 'red' : 'green';
      S.selectedSignal = id;
      setSignalOverride(id, mode === 'red');   // 先本地变灯，不等下一次轮询
      action('/api/signal', { id, mode }, mode === 'red' ? '已强制红灯' : '已恢复自动')
        .then(r => { if (!r || !r.ok) clearSignalOverride(id); });
      return;
    }
    const card = e.target.closest('.card[data-sig]');
    if (card) {
      const sig = S.signals.find(s => s.id === card.dataset.sig);
      if (sig) {
        focusSignal(sig);
        toast('已定位 ' + Math.round(sig.x) + ', ' + Math.round(sig.y) + ', ' + Math.round(sig.z), true);
      }
    }
  });

  $('#panel-timetable').addEventListener('change', e => {
    if (e.target.id === 'ttGroup') {
      const plats = platsForGroup(e.target.value, S.dim);
      const plat = $('#ttPlatform');
      plat.innerHTML = plats.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
        || '<option value="">无站台</option>';
    }
  });

  $('#panel-timetable').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'ttSave' || id === 'ttClear') {
      const trainId = $('#ttTrain') && $('#ttTrain').value;
      const stationId = $('#ttPlatform') && $('#ttPlatform').value;
      const time = id === 'ttSave' ? ($('#ttTime') && $('#ttTime').value) : '';
      if (!trainId || !stationId) return toast('请选择列车与车站站台', false);
      if (id === 'ttSave' && !time) return toast('请填写计划时刻', false);
      action('/api/timetable', { trainId, stationId, time }, id === 'ttSave' ? '时刻表已写入' : '该点已删除');
    }
  });

  $('#panel-config').addEventListener('input', e => {
    if (e.target.id === 'cfgRefresh') $('#cfgRefreshVal').textContent = e.target.value + ' ms';
    if (e.target.id === 'cfgBuild') $('#cfgBuildVal').textContent = e.target.value + ' tick';
  });

  $('#panel-config').addEventListener('click', e => {
    if (e.target.id === 'cfgSave') {
      const refreshMs = Number($('#cfgRefresh').value);
      const buildIntervalTicks = Number($('#cfgBuild').value);
      S.refreshMs = refreshMs;
      S.refreshLocked = true;
      setTimeout(() => S.refreshLocked = false, 5000);
      action('/api/config', { refreshMs, buildIntervalTicks, theme: S.theme }, '设置已保存').then(() => schedule());
    }
    if (e.target.id === 'cfgTheme') applyTheme(S.theme === 'dark' ? 'light' : 'dark', true);
  });

  canvas.addEventListener('mouseleave', () => $('#tip').classList.add('hidden'));
}

function init() {
  resize();
  const saved = localStorage.getItem('pyrail_theme');
  applyTheme(saved || 'dark', false);
  bind();
  requestAnimationFrame(drawFrame);
  poll();
  setInterval(() => {
    if (S.online && S.tracks.dim === S.dim) loadTracks(S.dim, false);
  }, 20000);
}

document.addEventListener('DOMContentLoaded', init);

