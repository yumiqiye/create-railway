/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var stationId = params.get('stationId') || '';
  try {
    stationId = stationId || localStorage.getItem('qj_screen_station') || '';
  } catch (e) { /* ignore */ }
  var data = null;
  var loading = false;

  var el = {
    stationName: document.getElementById('stationName'),
    stationCode: document.getElementById('stationCode'),
    clock: document.getElementById('clock'),
    dateText: document.getElementById('dateText'),
    announcement: document.getElementById('announcement'),
    boardHint: document.getElementById('boardHint'),
    trainList: document.getElementById('trainList'),
    nextTrain: document.getElementById('nextTrain'),
    nextMeta: document.getElementById('nextMeta'),
    statPassengers: document.getElementById('statPassengers'),
    statChecked: document.getElementById('statChecked'),
    statRate: document.getElementById('statRate'),
    statDevices: document.getElementById('statDevices'),
    stationSelect: document.getElementById('stationSelect'),
    footerCopyright: document.getElementById('footerCopyright'),
    footerIcp: document.getElementById('footerIcp'),
  };

  var colorMap = {
    黄色: '#ffd400',
    绿色: '#36d17c',
    蓝色: '#4aa3ff',
    红色: '#ff5b5b',
    紫色: '#b689ff',
    橙色: '#ff9f43',
    白色: '#ffffff',
    黑色: '#222222',
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

  function cell(text, className) {
    var node = document.createElement('span');
    node.className = className || '';
    node.textContent = text == null ? '' : String(text);
    return node;
  }

  function renderRows(rows) {
    el.trainList.innerHTML = '';
    if (!rows || !rows.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = data && data.station ? '今日暂无列车' : '暂无车站数据，请先在后台添加车站';
      el.trainList.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var line = document.createElement('div');
      line.className = 'train-row ' + (row.status || 'waiting');
      line.appendChild(cell(row.trainNo, 'train-no'));
      line.appendChild(cell(row.toStationName || row.fromStationName || '', 'train-dest'));
      line.appendChild(cell(row.departTime, 'train-time'));
      line.appendChild(cell(row.gate || '-', 'train-gate'));
      line.appendChild(cell(row.platform || '-', 'train-platform'));

      var landmark = document.createElement('span');
      landmark.className = 'landmark';
      var dot = document.createElement('span');
      dot.className = 'landmark-dot';
      dot.style.background = colorMap[row.landmarkColor] || '#7e9ab3';
      dot.style.color = colorMap[row.landmarkColor] || '#7e9ab3';
      landmark.appendChild(dot);
      landmark.appendChild(document.createTextNode(row.landmarkColor || '未设置'));
      line.appendChild(landmark);

      var status = document.createElement('span');
      status.className = 'status ' + (row.status || 'waiting');
      status.textContent = row.statusText || '候车';
      line.appendChild(status);

      var count = document.createElement('span');
      count.className = 'checkin-count';
      var strong = document.createElement('strong');
      strong.textContent = String(row.checked || 0);
      count.appendChild(strong);
      count.appendChild(document.createTextNode(' / ' + (row.passengers || 0)));
      line.appendChild(count);
      el.trainList.appendChild(line);
    });
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

  function render() {
    if (!data) return;
    var station = data.station;
    setText(el.stationName, station ? station.name : '未设置车站');
    setText(el.stationCode, station && station.code ? station.code : '');
    setText(el.announcement, data.settings && data.settings.announcement ? data.settings.announcement : '欢迎使用清江铁路12306');
    setText(el.boardHint, data.date + ' · 数据每 5 秒刷新');
    setText(el.footerCopyright, (data.settings && data.settings.footerCopyright) || '© 2026 清江铁路');
    setText(el.footerIcp, (data.settings && data.settings.footerIcp) || '');
    renderStations(data.stations || []);
    renderRows(data.trains || []);

    var stats = data.stats || {};
    setText(el.statPassengers, stats.passengers || 0);
    setText(el.statChecked, stats.checked || 0);
    setText(el.statRate, (stats.checkinRate || 0) + '%');
    setText(el.statDevices, stats.onlineDevices || 0);

    var next = (data.trains || []).find(function (row) { return row.status === 'boarding'; });
    if (!next) next = (data.trains || []).find(function (row) { return row.status === 'waiting'; });
    if (next) {
      setText(el.nextTrain, next.trainNo);
      setText(
        el.nextMeta,
        next.departTime + ' 开 · ' + (next.gate ? next.gate + ' 检票口' : '未设检票口') +
          (next.platform ? ' · ' + next.platform + ' 站台' : '')
      );
    } else {
      setText(el.nextTrain, '--');
      setText(el.nextMeta, '暂无开检计划');
    }
    document.title = (station ? station.name + ' · ' : '') + '清江铁路候车大屏';
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      var query = stationId ? '?stationId=' + encodeURIComponent(stationId) : '';
      var resp = await fetch('/api/screen' + query, { cache: 'no-store' });
      var json = await resp.json();
      if (json.code !== 200) throw new Error(json.message || '大屏数据读取失败');
      data = json.result;
      if (data.station && data.station.id && data.station.id !== stationId) {
        stationId = data.station.id;
        try { localStorage.setItem('qj_screen_station', stationId); } catch (e) { /* ignore */ }
      }
      if (data.stations && data.stations.length && !data.station) {
        stationId = data.stations[0].id;
        loading = false;
        return load();
      }
      render();
    } catch (e) {
      el.trainList.innerHTML = '<div class="empty">大屏数据读取失败：' + String(e.message || e) + '</div>';
    } finally {
      loading = false;
    }
  }

  if (el.stationSelect) {
    el.stationSelect.addEventListener('change', function () {
      stationId = el.stationSelect.value;
      try { localStorage.setItem('qj_screen_station', stationId); } catch (e) { /* ignore */ }
      load();
    });
  }

  tick();
  setInterval(tick, 1000);
  load();
  setInterval(load, 5000);
})();
