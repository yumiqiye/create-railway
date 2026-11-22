/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var stationId = params.get('stationId') || '';
  var date = params.get('date') || '';
  if (params.get('embed') === '1') document.body.classList.add('embed');
  try {
    stationId = stationId || localStorage.getItem('qj_guide_station') || '';
  } catch (e) { /* ignore */ }
  var data = null;
  var loading = false;

  var el = {
    stationName: document.getElementById('stationName'),
    stationCode: document.getElementById('stationCode'),
    clock: document.getElementById('clock'),
    dateText: document.getElementById('dateText'),
    dateHint: document.getElementById('dateHint'),
    guideList: document.getElementById('guideList'),
    stationSelect: document.getElementById('stationSelect'),
    footerText: document.getElementById('footerText'),
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function tick() {
    var now = new Date();
    el.clock.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    el.dateText.textContent =
      now.getFullYear() + '年' + pad(now.getMonth() + 1) + '月' + pad(now.getDate()) + '日 星期' +
      '日一二三四五六'.charAt(now.getDay());
  }

  function setText(node, text) {
    if (node) node.textContent = text == null ? '' : String(text);
  }

  function node(text, className) {
    var el = document.createElement('span');
    el.className = className || '';
    el.textContent = text == null ? '' : String(text);
    return el;
  }

  function renderStations(stations) {
    if (!el.stationSelect) return;
    el.stationSelect.innerHTML = '';
    if (!stations || !stations.length) {
      var option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无车站';
      el.stationSelect.appendChild(option);
      el.stationSelect.disabled = true;
      return;
    }
    el.stationSelect.disabled = false;
    stations.forEach(function (station) {
      var option = document.createElement('option');
      option.value = station.id;
      option.textContent = station.name + (station.code ? ' · ' + station.code : '');
      if (station.id === stationId) option.selected = true;
      el.stationSelect.appendChild(option);
    });
  }

  function renderRows(rows) {
    el.guideList.innerHTML = '';
    if (!rows || !rows.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '今日暂无列车，请稍后刷新';
      el.guideList.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var line = document.createElement('div');
      line.className = 'guide-row ' + (row.status || 'waiting');
      line.appendChild(node(row.trainNo, 'train-no'));
      line.appendChild(node(row.toStationName || row.fromStationName || '', 'train-dest'));
      line.appendChild(node(row.departTime || '', 'train-time'));

      var gateBlock = document.createElement('span');
      gateBlock.className = 'gate-block';
      gateBlock.appendChild(node('检票口', 'gate-label'));
      gateBlock.appendChild(node(row.gate || '-', 'gate-value'));
      var changed = Boolean(
        (row.tempGate && row.gate !== row.baseGate) ||
        (row.tempPlatform && row.platform !== row.basePlatform)
      );
      if (changed) gateBlock.appendChild(node('临时调整', 'change-badge'));
      line.appendChild(gateBlock);

      line.appendChild(node(row.platform || '-', 'platform-value'));

      var status = document.createElement('span');
      status.className = 'status ' + (row.status || 'waiting');
      status.textContent = row.statusText || '候车';
      line.appendChild(status);

      if (row.runtimeNote) {
        var note = document.createElement('span');
        note.className = 'note';
        note.textContent = '公告：' + row.runtimeNote;
        line.appendChild(note);
      }
      el.guideList.appendChild(line);
    });
  }

  function render() {
    if (!data) return;
    var station = data.station;
    setText(el.stationName, station ? station.name : '未设置车站');
    setText(el.stationCode, station && station.code ? station.code : '');
    setText(el.dateHint, (data.date || '') + ' · 每 10 秒刷新');
    setText(el.footerText, (data.settings && data.settings.footerCopyright) || '© 2026 清江铁路');
    renderStations(data.stations || []);
    renderRows(data.trains || []);
    document.title = (station ? station.name + ' · ' : '') + '清江铁路检票口引导屏';
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      var query = [];
      if (stationId) query.push('stationId=' + encodeURIComponent(stationId));
      if (date) query.push('date=' + encodeURIComponent(date));
      var resp = await fetch('/api/screen' + (query.length ? '?' + query.join('&') : ''), { cache: 'no-store' });
      var json = await resp.json();
      if (json.code !== 200) throw new Error(json.message || '引导屏数据读取失败');
      data = json.result;
      if (data.station && data.station.id && data.station.id !== stationId) {
        stationId = data.station.id;
        try { localStorage.setItem('qj_guide_station', stationId); } catch (e) { /* ignore */ }
      }
      render();
    } catch (e) {
      el.guideList.innerHTML = '<div class="empty">引导屏数据读取失败：' + String(e.message || e) + '</div>';
    } finally {
      loading = false;
    }
  }

  if (el.stationSelect) {
    el.stationSelect.addEventListener('change', function () {
      stationId = el.stationSelect.value;
      try { localStorage.setItem('qj_guide_station', stationId); } catch (e) { /* ignore */ }
      load();
    });
  }

  tick();
  setInterval(tick, 1000);
  load();
  setInterval(load, 10000);
})();
