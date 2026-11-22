/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/* 清江铁路12306 自助检票终端 */
(function () {
  'use strict';

  var state = {
    mode: 'auto',
    gateType: 'checkin',
    config: {
      siteName: '清江铁路12306',
      entryWelcomeText: '欢迎光临{station}',
      exitWelcomeText: '欢迎您再次乘坐清江铁路12306',
    },
    stations: [],
    stationId: '',
    stationName: '',
    trains: [],
    faceStream: null,
    faceDeviceId: '',
    facePausedByScan: false,
    faceModelsReady: false,
    faceStarting: false,
    faceRunning: false,
    faceLoopId: 0,
    faceSamples: [],
    faceDescriptor: null,
    faceArmed: false,
    faceFrameCanvas: null,
    pendingBody: null,
    pendingCode: '',
    finalizing: false,
    scanStream: null,
    scanDeviceId: '',
    scanCanvas: null,
    detector: null,
    scanning: false,
    scanStarting: false,
    cameraSyncTimer: null,
    firstRunSetup: false,
    deviceStatus: 'normal',
    deviceBlocked: false,
    deviceConfigVersion: 0,
    deviceConfig: null,
    cameraEnabled: true,
    liveDetection: true,
    liveness: 'wait',
    lastEyeRatio: 1,
    accessStream: null,
    accessScanning: false,
    accessLastCode: '',
    accessLastAt: 0,
    accessHoldUntil: 0,
    accessCanvas: null,
    accessTimer: null,
    lastCode: '',
    lastScanAt: 0,
    verifying: false,
    cameras: [],
    resultTimer: null,
    refreshTimer: null,
    cardBuffer: '',
    cardLastAt: 0,
    cardStartedAt: 0,
    cardTimer: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  var audioCtx = null;

  function getAudioCtx() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function playTone(freq, duration, volume) {
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var start = ctx.currentTime;
      var end = start + duration;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.setValueAtTime(volume, Math.max(start + 0.02, end - 0.08));
      gain.gain.linearRampToValueAtTime(0, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    } catch (e) {
      /* 音频不可用时忽略 */
    }
  }

  function playScanBeep() {
    playTone(1180, 0.09, 0.16);
  }

  function playGateOpenBeep() {
    playTone(880, 0.9, 0.2);
  }

  function resumeAudio() {
    var ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  document.addEventListener('pointerdown', resumeAudio, { passive: true });
  document.addEventListener('keydown', resumeAudio);

  var CARD_MIN_LENGTH = 8;

  function clearCardBuffer() {
    state.cardBuffer = '';
    state.cardLastAt = 0;
    state.cardStartedAt = 0;
    if (state.cardTimer) {
      clearTimeout(state.cardTimer);
      state.cardTimer = null;
    }
  }

  function submitCardCode() {
    var code = String(state.cardBuffer || '').trim();
    var startedAt = state.cardStartedAt;
    clearCardBuffer();
    if (code.length < CARD_MIN_LENGTH) return;
    var elapsed = Date.now() - startedAt;
    if (elapsed > 1200 || elapsed / Math.max(1, code.length - 1) > 45) return;
    playScanBeep();
    if (state.gateType === 'checkin') {
      $('codeInput').value = '';
      if (!hasOpenTrains()) {
        setFaceHint('当前没有开检车次，暂时无法检票');
        return;
      }
      $('cameraNote').textContent = '已读取IC卡/证件：' + code;
      verifyCode(code);
    } else {
      if ($('accessCodeInput')) $('accessCodeInput').value = '';
      setAccessResult('已读取IC卡/证件，正在验证…');
      verifyAccessCode(code);
    }
  }

  function cardKeyDown(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    var key = event.key;
    if (key === 'Enter') {
      if (state.cardBuffer.length >= CARD_MIN_LENGTH) {
        event.preventDefault();
        submitCardCode();
      } else {
        clearCardBuffer();
      }
      return;
    }
    if (key.length !== 1 || !/[0-9A-Za-z]/.test(key)) return;
    var now = Date.now();
    if (!state.cardBuffer || now - state.cardLastAt > 50) {
      state.cardBuffer = '';
      state.cardStartedAt = now;
    }
    state.cardBuffer += key;
    state.cardLastAt = now;
    if (state.cardBuffer.length > 40) state.cardBuffer = state.cardBuffer.slice(-40);
    if (state.cardTimer) {
      clearTimeout(state.cardTimer);
      state.cardTimer = null;
    }
  }

  document.addEventListener('keydown', cardKeyDown, true);

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readStorage(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }

  function api(path, options) {
    var opts = options || {};
    var config = { method: opts.method || 'GET', headers: {} };
    if (opts.body) {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(opts.body);
    }
    return fetch('/api' + path, config)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json || json.code !== 200) throw new Error((json && json.message) || '请求失败');
        return json.result;
      });
  }

  function showResult(kind, title, lines, meta) {
    var box = $('scanResult');
    box.hidden = false;
    box.className = 'scan-result ' + kind;
    if (kind === 'success' && meta) {
      box.innerHTML =
        '<div class="pass-band">' +
          '<div class="pass-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2.1"/><path d="M11 8.2 8.6 13h3l-2 8h2.2l2.1-6.2 2.7 3.1V21h2v-4.2l-3.4-4 1.4-4.1 2.6 1.7V8.1l-3.2-1.4z"/></svg></div>' +
          '<div class="pass-copy">' +
            '<b>检票通过</b>' +
            '<strong>' + escapeHtml(meta.trainNo || '') + '</strong>' +
            '<span>请快速通过闸机</span>' +
          '</div>' +
          '<div class="pass-extra">' +
            '<span>检票口 ' + escapeHtml(meta.gate || '-') + '</span>' +
            '<span>站台 ' + escapeHtml(meta.platform || '-') + '</span>' +
          '</div>' +
        '</div>';
    } else {
      box.innerHTML =
        '<div class="result-title">' + escapeHtml(title) + '</div>' +
        '<div class="result-lines">' + lines.map(function (line) {
          return '<div>' + line + '</div>';
        }).join('') + '</div>';
    }
    if (state.resultTimer) clearTimeout(state.resultTimer);
    state.resultTimer = setTimeout(function () {
      box.hidden = true;
    }, kind === 'success' ? 7000 : 5200);
  }

  function hideResult() {
    $('scanResult').hidden = true;
    if (state.resultTimer) clearTimeout(state.resultTimer);
  }

  function weekdayText(date) {
    return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
  }

  function renderToday(today) {
    var now = new Date();
    $('todayText').textContent = '今日 ' + (today || now.toISOString().slice(0, 10)) + ' ' + weekdayText(now);
  }

  function renderSummary(summary) {
    renderToday(summary.today);
    $('windowHint').textContent = '开检时间：发车前 ' + summary.checkinMinutes + ' 分钟 · 当前开检 ' + summary.openCount + ' 趟车 · 每 10 秒自动刷新';
  }

  function renderTrains(data) {
    state.trains = data.trains || [];
    if (state.gateType !== 'checkin') {
      document.body.classList.remove('idle-mode');
      $('noTrain').hidden = true;
      $('trainStage').hidden = true;
      $('actionPanel').hidden = true;
      $('trainStack').innerHTML = '';
      renderManualOptions();
      return;
    }
    var hasTrain = state.trains.length > 0;
    var idleNote = $('noTrain').querySelector('.idle-note');
    if (idleNote) idleNote.textContent = '当前没有处于开检时间窗口内的车次，请留意车站广播或稍后刷新。';
    $('noTrain').hidden = hasTrain;
    $('trainStage').hidden = !hasTrain;
    $('actionPanel').hidden = !hasTrain;
    document.body.classList.toggle('idle-mode', !hasTrain);
    $('facePanel').hidden = !hasTrain;

    var stack = $('trainStack');
    if (!hasTrain) {
      stack.innerHTML = '';
      if (state.scanning) stopCamera();
    } else {
      var cards = state.trains.map(function (train) {
        return (
          '<div class="train-card">' +
          '<div class="tc-top"><strong>' + escapeHtml(train.trainNo) + '</strong>' +
          '<span class="tc-type">' + escapeHtml(train.type || '') + '</span>' +
          '<span class="tc-live' + (train.status === 'delayed' ? ' delayed' : '') + '">' +
          escapeHtml(train.statusText || '正在检票') + '</span></div>' +
          '<div class="tc-route">' + escapeHtml(train.departTime) + '　' + escapeHtml(train.fromStationName) +
          ' → ' + escapeHtml(train.toStationName) + '</div>' +
          '<div class="tc-extra">检票口 ' + escapeHtml(train.gate || '-') + ' · 站台 ' +
          escapeHtml(train.platform || '-') + ' · 地标 ' + escapeHtml(train.landmarkColor || '-') + '</div>' +
          '<div class="tc-foot">开检 ' + escapeHtml(train.checkinStart) + ' ~ ' + escapeHtml(train.checkinEnd) +
          ' · 已检 ' + train.checkedCount + ' 单</div>' +
          '</div>'
        );
      }).join('');
      stack.innerHTML = cards;
    }
    renderManualOptions();
    syncCheckinCameras();
  }

  function hasOpenTrains() {
    return state.trains && state.trains.length > 0;
  }

  function syncCheckinCameras() {
    if (state.gateType !== 'checkin') return;
    if (state.deviceBlocked) {
      if (state.scanning || state.scanStream || state.scanStarting) stopCamera();
      if (state.faceStream || state.faceRunning) stopFaceCamera();
      $('faceStartBtn').hidden = true;
      $('startCameraBtn').hidden = true;
      $('stopCameraBtn').hidden = true;
      return;
    }
    if (state.firstRunSetup) {
      if (state.scanning || state.scanStream || state.scanStarting) stopCamera();
      if (state.faceStream || state.faceRunning) stopFaceCamera();
      $('faceStartBtn').hidden = true;
      $('startCameraBtn').hidden = true;
      $('stopCameraBtn').hidden = true;
      return;
    }
    if (!hasOpenTrains()) {
      if (state.scanning || state.scanStream || state.scanStarting) stopCamera();
      if (state.faceStream || state.faceRunning) stopFaceCamera();
      $('faceStartBtn').hidden = true;
      $('startCameraBtn').hidden = true;
      $('stopCameraBtn').hidden = true;
      setFaceHint('当前无列车开检，摄像头待机，开检后自动识别');
      $('cameraNote').textContent = '等待列车开检，开检后自动开启扫码';
      return;
    }
    $('faceStartBtn').hidden = true;
    $('startCameraBtn').hidden = true;
    $('stopCameraBtn').hidden = true;
    if (!state.faceStream && !state.faceStarting) startFaceCamera();
    if (!state.scanning && !state.scanStream && !state.scanStarting) startCamera();
  }

  function renderManualOptions() {
    var list = $('manualTrainList');
    list.innerHTML = state.trains.map(function (train) {
      return '<option value="' + escapeHtml(train.trainNo) + '">' + escapeHtml(train.fromStationName) + ' → ' + escapeHtml(train.toStationName) + '</option>';
    }).join('');
  }

  function updateIdleState(message) {
    state.trains = [];
    $('noTrain').hidden = false;
    $('trainStage').hidden = true;
    $('actionPanel').hidden = true;
    $('trainStack').innerHTML = '';
    document.body.classList.add('idle-mode');
    $('facePanel').hidden = true;
    if (message) {
      var note = $('noTrain').querySelector('.idle-note');
      if (note) note.textContent = message;
    }
    syncCheckinCameras();
  }

  function loadTrains() {
    if (!state.stationId) {
      updateIdleState('请先在右上角设置中选择本站车站，再查看开检车次。');
      return Promise.resolve();
    }
    return api('/checkin/trains' + stationQuery())
      .then(renderTrains)
      .catch(function (err) {
        updateIdleState('读取开检计划失败：' + err.message + '，请稍后刷新。');
      });
  }

  function loadSummary() {
    if (!state.stationId) {
      $('windowHint').textContent = '请先在右上角设置中选择本站车站';
      return Promise.resolve();
    }
    return api('/checkin/summary' + stationQuery()).then(renderSummary).catch(function () {
      renderToday();
    });
  }

  function loadConfig() {
    return api('/checkin/config')
      .then(function (config) {
        state.config = Object.assign({}, state.config, config || {});
        state.liveDetection = config.liveDetection !== false;
        applyKioskConfig();
        if (state.gateType !== 'checkin') renderWelcome();
      })
      .catch(function () {});
  }

  function applyKioskConfig() {
    var c = state.config || {};
    if ($('kioskCopyright')) $('kioskCopyright').textContent = c.footerCopyright || '© 2026 清江铁路';
    if ($('kioskIcp')) $('kioskIcp').textContent = c.footerIcp || '';
    if ($('kioskPolice')) {
      $('kioskPolice').textContent = c.footerPoliceNo ? (c.footerPolice || '公安备案') + ' ' + c.footerPoliceNo : (c.footerPolice || '');
    }
    applyScanPreview();
    renderDeviceBlocked();
  }

  function stationQuery() {
    return state.stationId ? '?stationId=' + encodeURIComponent(state.stationId) : '';
  }

  function fillStationSelect() {
    var select = $('stationSelect');
    var current = state.stationId || select.value;
    select.innerHTML =
      '<option value="">请选择车站</option>' +
      state.stations.map(function (station) {
        return '<option value="' + escapeHtml(station.id) + '">' +
          escapeHtml(station.name) + (station.cityName ? '（' + escapeHtml(station.cityName) + '）' : '') +
          '</option>';
      }).join('');
    if (current && state.stations.some(function (station) { return station.id === current; })) {
      select.value = current;
    } else {
      select.value = '';
    }
  }

  function loadStations() {
    return api('/checkin/stations')
      .then(function (rows) {
        state.stations = rows || [];
        var savedId = state.firstRunSetup ? '' : readStorage('qj_station_id', '');
        var targetId = state.stationId || savedId;
        var matched = state.stations.find(function (station) { return station.id === targetId; });
        if (!matched && state.stations.length && !state.firstRunSetup) {
          // 只有一台车站时自动选中；多车站时要求现场设置，避免显示错站车次
          matched = state.stations.length === 1 ? state.stations[0] : null;
        }
        state.stationId = matched ? matched.id : '';
        state.stationName = matched ? matched.name : '';
        if (state.stationId) writeStorage('qj_station_id', state.stationId);
        fillStationSelect();
        var hint = $('stationHint');
        if (hint) {
          hint.textContent = state.stationId
            ? '检票时只显示本站开检车次'
            : '请先选择本站车站，否则不会显示检票车次';
        }
        updateHeaderBadge();
        if (state.gateType !== 'checkin') renderWelcome();
      })
      .catch(function () {});
  }

  function refreshAll(keepResult) {
    if (!keepResult) hideResult();
    return loadStations().then(function () {
      return Promise.all([loadConfig(), loadSummary(), loadTrains()]);
    });
  }

  function manualTrainId() {
    var value = String($('manualTrainNo').value || '').trim().toUpperCase();
    if (!value) return { error: '人工检票请先输入列车编号，例如 G7022' };
    var matched = state.trains.find(function (train) {
      return String(train.trainNo || '').toUpperCase() === value;
    });
    if (!matched) return { error: '当前没有找到开检车次「' + value + '」，请核对车次或切换自动检票' };
    return { id: matched.id };
  }

  function checkinResultLines(result) {
    var lines = [
      '<span>车次</span><strong>' + escapeHtml(result.trainNo) + '　' + escapeHtml(result.fromStationName) +
        ' → ' + escapeHtml(result.toStationName) + '</strong>',
      '<span>发车</span><strong>' + escapeHtml(result.date) + ' ' + escapeHtml(result.departTime) + '</strong>',
      '<span>乘客</span><strong>' + escapeHtml(result.passenger ? result.passenger.name : '') +
        (result.passenger && result.passenger.type === '儿童' ? '（儿童票）' : '') +
        '　' + escapeHtml(result.seatType) + '</strong>',
      '<span>检票口</span><strong>' + escapeHtml(result.gate || '-') + ' · 站台 ' +
        escapeHtml(result.platform || '-') + ' · 地标 ' + escapeHtml(result.landmarkColor || '-') + '</strong>',
      '<span>订单号</span><strong>' + escapeHtml(result.orderNo) + '</strong>',
    ];
    if (Number(result.pendingCount) > 0) {
      lines.push('<span>本单</span><strong>还有 ' + Number(result.pendingCount) +
        ' 位乘车人未通过，一人一闸，请下一位继续刷脸</strong>');
    }
    return lines;
  }

  function completeCheckin() {
    if (!state.pendingBody || !state.faceDescriptor || state.finalizing) return;
    state.finalizing = true;
    state.verifying = true;
    var body = Object.assign({}, state.pendingBody, {
      faceDescriptor: state.faceDescriptor,
      prepare: false,
    });
    api('/checkin/verify', { method: 'POST', body: body })
      .then(function (result) {
        playGateOpenBeep();
        showResult('success', '检票通过', checkinResultLines(result), {
          trainNo: result.trainNo,
          gate: result.gate,
          platform: result.platform,
        });
        $('codeInput').value = '';
        $('cameraNote').textContent = '检票成功';
        state.pendingBody = null;
        state.pendingCode = '';
        state.faceDescriptor = null;
        state.faceSamples = [];
        state.faceArmed = false;
        stopFaceCamera();
        setFaceHint('检票成功，请下一位旅客');
        loadTrains();
        loadSummary();
        setTimeout(syncCheckinCameras, 1800);
      })
      .catch(function (err) {
        showResult('error', '检票失败', ['<span>提示</span><strong>' + escapeHtml(err.message) + '</strong>']);
        state.pendingBody = null;
        state.pendingCode = '';
        state.faceArmed = false;
        state.faceDescriptor = null;
        state.faceSamples = [];
        setFaceHint('核验未通过，请本人正对摄像头后重新扫码');
      })
      .finally(function () {
        state.finalizing = false;
        state.verifying = false;
      });
  }

  function verifyCode(code) {
    var raw = String(code || '').trim();
    if (!raw) {
      showResult('error', '检票失败', ['<span>提示</span><strong>请扫描二维码，或输入身份证号 / 订单号</strong>']);
      return;
    }
    if (state.pendingCode === raw && state.pendingBody) {
      if (!state.faceStream) startFaceCamera();
      else if (state.faceDescriptor) completeCheckin();
      return;
    }
    if (state.verifying) return;

    // 每一张新车票都必须重新采集人脸，不能复用开检前或上一位旅客的人脸样本
    state.faceDescriptor = null;
    state.faceSamples = [];
    state.faceArmed = false;

    var body = { mode: state.mode, code: raw };
    if (state.mode === 'manual') {
      var manual = manualTrainId();
      if (manual.error) {
        showResult('error', '检票失败', ['<span>提示</span><strong>' + escapeHtml(manual.error) + '</strong>']);
        return;
      }
      body.trainId = manual.id;
    }

    state.pendingCode = raw;
    state.pendingBody = body;
    state.verifying = true;
    api('/checkin/verify', { method: 'POST', body: Object.assign({}, body, { prepare: true }) })
      .then(function (result) {
        if (!result.faceEnrolled) {
          state.pendingBody = null;
          state.pendingCode = '';
          throw new Error('该订单购票账号尚未录入人脸，请先在购票端完成人脸录入');
        }
        state.pendingBody = { mode: state.mode, code: raw, trainId: result.trainId || body.trainId || '' };
        if (state.scanning) stopCamera();
        state.faceArmed = true;
        $('cameraNote').textContent = '车票已读取，正在核验人脸';
        setFaceHint('车票已读取，请正对摄像头完成人脸核验');
        startFaceCamera();
        if (state.faceDescriptor) completeCheckin();
      })
      .catch(function (err) {
        state.pendingBody = null;
        state.pendingCode = '';
        state.faceArmed = false;
        showResult('error', '检票失败', ['<span>提示</span><strong>' + escapeHtml(err.message) + '</strong>']);
      })
      .finally(function () {
        state.verifying = false;
      });
  }

  function gateTypeName(type) {
    if (type === 'entry') return '入站闸机';
    if (type === 'exit') return '出站闸机';
    return '检票闸机';
  }

  function updateHeaderBadge() {
    var badge = gateTypeName(state.gateType);
    if (state.gateType === 'checkin') {
      badge += ' · ' + (state.mode === 'manual' ? '人工检票' : '自动检票');
    }
    $('modeBadge').textContent = badge;
    var brandSub = document.getElementById('brandSub');
    if (brandSub) {
      brandSub.textContent = state.stationName || '清江铁路';
    }
  }

  function setMode(mode, silent) {
    state.mode = mode === 'manual' ? 'manual' : 'auto';
    updateHeaderBadge();
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === state.mode);
    });
    $('manualTrainWrap').hidden = state.mode !== 'manual';
    if (!silent) writeStorage('qj_checkin_mode', state.mode);
  }

  function renderWelcome() {
    var isEntry = state.gateType === 'entry';
    var template = isEntry ? state.config.entryWelcomeText : state.config.exitWelcomeText;
    var text = String(template || '').replace(/\{station\}/g, state.stationName || '本站');
    $('welcomeBadge').textContent = isEntry ? '入站闸机' : '出站闸机';
    $('welcomeText').textContent = text;
    $('welcomeSub').textContent = '请在下方扫码';
    $('passageTitle').textContent = '请通过闸机';
    $('passageSub').textContent = 'Please pass';
  }

  function resetAccessVerification() {
    clearTimeout(state.accessTimer);
    state.accessTimer = null;
    state.accessHoldUntil = 0;
    $('passageStatus').className = 'passage-status is-wait';
    $('passageStatusText').textContent = '请先扫码验证，验证通过后闸机开启';
    if ($('accessCodeInput')) $('accessCodeInput').value = '';
    setAccessResult('等待扫码…');
  }

  function toggleSettingsFields(type) {
    var target = type || state.gateType;
    var isCheckin = target === 'checkin';
    $('checkinModeField').hidden = !isCheckin;
    $('faceCameraField').hidden = !isCheckin;
    $('scanCameraField').hidden = false;
    if ($('scanPreviewSettingRow')) $('scanPreviewSettingRow').hidden = !isCheckin;
  }

  function applyGateType() {
    var isCheckin = state.gateType === 'checkin';
    updateHeaderBadge();
    toggleSettingsFields();
    Array.prototype.forEach.call(document.querySelectorAll('#gateTypeChoice [data-gate]'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-gate') === state.gateType);
    });
    applyScanPreview();
    $('facePanel').hidden = !isCheckin;
    $('welcomePanel').hidden = isCheckin;
    $('passageStage').hidden = isCheckin;
    if (!isCheckin) {
      document.body.classList.remove('idle-mode');
      state.facePausedByScan = false;
      if (state.scanning) stopCamera();
      stopFaceCamera();
      hideResult();
      $('noTrain').hidden = true;
      $('trainStage').hidden = true;
      $('actionPanel').hidden = true;
      renderWelcome();
      resetAccessVerification();
      startAccessCamera();
    } else {
      $('welcomePanel').hidden = true;
      $('passageStage').hidden = true;
      stopAccessCamera();
      $('faceStartBtn').hidden = true;
      $('startCameraBtn').hidden = true;
      $('stopCameraBtn').hidden = true;
      renderTrains({ trains: state.trains });
      syncCheckinCameras();
    }
  }

  function getSelectedFaceDevice() {
    return $('faceSelect').value || '';
  }

  function getSelectedScanDevice() {
    return $('scanSelect').value || '';
  }

  function fillCameraSelects() {
    var faceSelect = $('faceSelect');
    var scanSelect = $('scanSelect');
    var faceSaved = readStorage('qj_face_camera', '');
    var scanSaved = readStorage('qj_scan_camera', '');
    var faceCurrent = faceSelect.value || faceSaved;
    var scanCurrent = scanSelect.value || scanSaved;

    var optionHtml = state.cameras.length
      ? state.cameras.map(function (device, index) {
          return '<option value="' + escapeHtml(device.deviceId) + '">' +
            escapeHtml(device.label || ('摄像头 ' + (index + 1))) + '</option>';
        }).join('')
      : '<option value="">默认摄像头（等待授权）</option>';
    faceSelect.innerHTML = optionHtml;
    scanSelect.innerHTML = optionHtml;

    if (faceCurrent && state.cameras.some(function (d) { return d.deviceId === faceCurrent; })) {
      faceSelect.value = faceCurrent;
    }
    if (scanCurrent && state.cameras.some(function (d) { return d.deviceId === scanCurrent; })) {
      scanSelect.value = scanCurrent;
    } else if (state.cameras.length > 1) {
      scanSelect.value = state.cameras[1].deviceId;
    }
  }

  function refreshCameraDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      setCameraDetectNote('当前页面没有摄像头接口：请用 HTTPS 或 localhost 打开，HTTP + IP 会被浏览器禁用。', true);
      return Promise.resolve();
    }
    return navigator.mediaDevices.enumerateDevices()
      .then(function (devices) {
        state.cameras = devices.filter(function (device) { return device.kind === 'videoinput'; });
        fillCameraSelects();
        if (state.cameras.length) {
          var named = state.cameras.filter(function (device) { return !!device.label; }).length;
          setCameraDetectNote('已检测到 ' + state.cameras.length + ' 个摄像头' + (named ? '' : '；名称仍为空，请点上方按钮允许权限。'), false);
        } else {
          setCameraDetectNote('没有检测到摄像头；请确认设备已连接，点上方按钮允许权限后重试。', true);
        }
      })
      .catch(function (e) {
        setCameraDetectNote('读取摄像头列表失败：' + (e && e.message ? e.message : '未知错误'), true);
      });
  }

  function setCameraDetectNote(text, isError) {
    var el = $('cameraDetectNote');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#b42318' : '';
  }

  async function detectCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraDetectNote('当前页面没有摄像头接口：请用 HTTPS 或 localhost 打开，HTTP + IP 会被浏览器禁用。', true);
      return;
    }
    setCameraDetectNote('正在请求摄像头权限…', false);
    var stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      stream.getTracks().forEach(function (track) { track.stop(); });
      await refreshCameraDevices();
      if (state.cameras.length && !state.cameras.some(function (d) { return !!d.label; })) {
        setCameraDetectNote('已授权，但系统未返回摄像头名称；请关闭其他占用摄像头的程序后刷新页面。', true);
      }
    } catch (e) {
      var msg = e && e.name === 'NotAllowedError'
        ? '摄像头权限被拒绝，请在浏览器地址栏的权限设置中允许摄像头，然后重试。'
        : (e && e.message ? e.message : '摄像头启动失败');
      setCameraDetectNote(msg, true);
    }
  }

  function mediaSupported() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('facePlaceholderHint').textContent = '当前浏览器不支持摄像头调用';
      return false;
    }
    return true;
  }

  function faceBox(item) {
    if (!item) return null;
    return item.box || (item.detection && item.detection.box) || null;
  }

  function setFaceHint(text) {
    if ($('faceHint')) $('faceHint').textContent = text;
  }

  async function loadCheckinFaceModels() {
    if (state.faceModelsReady) return;
    if (typeof window.faceapi === 'undefined') throw new Error('人脸识别组件未加载');
    await Promise.all([
      window.faceapi.nets.tinyFaceDetector.loadFromUri('/face-models'),
      window.faceapi.nets.faceLandmark68Net.loadFromUri('/face-models'),
      window.faceapi.nets.faceLandmark68TinyNet.loadFromUri('/face-models'),
      window.faceapi.nets.faceRecognitionNet.loadFromUri('/face-models'),
    ]);
    state.faceModelsReady = true;
  }

  function checkinFaceFrame(video) {
    var canvas = state.faceFrameCanvas || (state.faceFrameCanvas = document.createElement('canvas'));
    var width = video.videoWidth || 640;
    var height = video.videoHeight || 480;
    var scale = Math.min(1, 640 / width);
    var w = Math.round(width * scale);
    var h = Math.round(height * scale);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.filter = 'brightness(1.2) contrast(1.15)';
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = 'none';
    return canvas;
  }

  async function detectCheckinFace(video) {
    var frame = checkinFaceFrame(video);
    var options = new window.faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.15 });
    try {
      var full = await window.faceapi.detectAllFaces(frame, options).withFaceLandmarks().withFaceDescriptors();
      if (full && full.length) return { faces: full, source: frame };
    } catch (e) {
      /* 降级轻量关键点 */
    }
    try {
      var tiny = await window.faceapi.detectAllFaces(frame, options).withFaceLandmarks(true).withFaceDescriptors();
      return { faces: tiny, source: frame };
    } catch (e) {
      return { faces: [], source: frame };
    }
  }

  function pickCheckinFace(faces, source) {
    if (!faces || !faces.length) return null;
    var best = null;
    faces.forEach(function (item) {
      var box = faceBox(item);
      if (!box) return;
      var area = box.width * box.height;
      if (!best || area > best.area) best = { item: item, area: area, box: box };
    });
    if (!best) return null;
    var frameW = source.width;
    var frameH = source.height;
    if (best.area / (frameW * frameH) < 0.03) return null;
    var cx = best.box.x + best.box.width / 2;
    var cy = best.box.y + best.box.height / 2;
    if (cx < frameW * 0.03 || cx > frameW * 0.97 || cy < frameH * 0.01 || cy > frameH * 0.99) return null;
    return best.item;
  }

  function averageFaceDescriptor(samples) {
    var out = new Array(128).fill(0);
    samples.forEach(function (sample) {
      for (var i = 0; i < 128; i += 1) out[i] += Number(sample[i] || 0);
    });
    for (var j = 0; j < 128; j += 1) out[j] /= samples.length;
    return out;
  }

  function eyeOpenness(face) {
    var pts = face && face.landmarks && face.landmarks.positions;
    if (!pts || pts.length < 68) return null;
    function one(a, b, c, d, e, f) {
      var v1 = Math.abs(pts[b].y - pts[f].y);
      var v2 = Math.abs(pts[c].y - pts[e].y);
      var h = Math.abs(pts[a].x - pts[d].x) || 1;
      return (v1 + v2) / (2 * h);
    }
    return (one(36, 37, 38, 39, 40, 41) + one(42, 43, 44, 45, 46, 47)) / 2;
  }

  function checkLiveness() {
    return true;
  }

  async function checkinFaceLoop() {
    if (!state.faceRunning || state.gateType !== 'checkin') return;
    var video = $('faceCamera');
    if (!state.faceArmed) {
      if (state.pendingBody) setFaceHint('请正对摄像头完成人脸核验');
      else setFaceHint('请扫描车票二维码后，正对摄像头扫脸');
      if (state.faceRunning) state.faceLoopId = setTimeout(checkinFaceLoop, 450);
      return;
    }
    if (video && video.readyState >= 2 && video.videoWidth >= 64 && video.videoHeight >= 64 && !state.finalizing) {
      try {
        var result = await detectCheckinFace(video);
        var face = pickCheckinFace(result.faces, result.source);
        if (face && face.descriptor) {
          if (!checkLiveness(face)) {
            state.faceLoopId = setTimeout(checkinFaceLoop, 450);
            return;
          }
          if (!state.faceDescriptor) {
            state.faceSamples.push(Array.from(face.descriptor));
            if (state.faceSamples.length > 3) state.faceSamples.shift();
            setFaceHint('已识别到人脸，采样 ' + state.faceSamples.length + '/3');
            if (state.faceSamples.length >= 3) {
              state.faceDescriptor = averageFaceDescriptor(state.faceSamples);
              setFaceHint('人脸已就绪，请扫描车票二维码');
              if (state.pendingBody) completeCheckin();
            }
          }
        } else if (!state.faceDescriptor) {
          setFaceHint('请正对摄像头，让面部完整落在椭圆内');
        }
      } catch (e) {
        if (!state.faceDescriptor) setFaceHint('人脸识别重试中，请正对摄像头');
      }
    }
    if (state.faceRunning) {
      state.faceLoopId = setTimeout(checkinFaceLoop, 450);
    }
  }

  function startFaceLoop() {
    if (state.faceRunning) return;
    state.faceRunning = true;
    checkinFaceLoop();
  }

  async function startFaceCamera() {
    if (state.gateType !== 'checkin') return;
    if (!hasOpenTrains()) return;
    if (!mediaSupported()) return;
    // 只有已经读取了车票、进入核验阶段才允许采样人脸；开检待机时只预览，不提前生成 faceDescriptor
    state.faceArmed = !!state.pendingBody;
    if (state.faceStream) {
      startFaceLoop();
      return;
    }
    if (state.faceStarting) return;
    state.faceStarting = true;
    try {
      setFaceHint('正在加载人脸模型…');
      await loadCheckinFaceModels();
      var selected = getSelectedFaceDevice();
      state.faceStream = await navigator.mediaDevices.getUserMedia({
        video: selected ? { deviceId: { exact: selected } } : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      var video = $('faceCamera');
      video.srcObject = state.faceStream;
      await video.play();
      if (!hasOpenTrains() || state.gateType !== 'checkin') {
        state.faceStream.getTracks().forEach(function (track) { track.stop(); });
        state.faceStream = null;
        video.srcObject = null;
        return;
      }
      var track = state.faceStream.getVideoTracks()[0];
      if (track) state.faceDeviceId = track.getSettings().deviceId || selected;
      document.querySelector('.face-panel').classList.add('is-live');
      state.faceArmed = !!state.pendingBody;
      setFaceHint(state.faceArmed ? '请正对摄像头完成人脸核验' : '请扫描车票二维码后，正对摄像头扫脸');
      await refreshCameraDevices();
      startFaceLoop();
    } catch (e) {
      state.faceStream = null;
      document.querySelector('.face-panel').classList.remove('is-live');
      var faceError = /(Device in use|NotReadable|Could not start)/i.test(String(e && (e.name + ' ' + e.message)))
        ? '人脸摄像头被占用，请关闭其他使用摄像头的页面或程序后重试'
        : (e && e.message ? e.message : '人脸摄像头启动失败');
      $('facePlaceholderHint').textContent = faceError;
      setFaceHint(faceError);
    } finally {
      state.faceStarting = false;
    }
  }

  function stopFaceCamera() {
    state.faceRunning = false;
    if (state.faceLoopId) {
      clearTimeout(state.faceLoopId);
      state.faceLoopId = 0;
    }
    if (state.faceStream) {
      state.faceStream.getTracks().forEach(function (track) { track.stop(); });
      state.faceStream = null;
    }
    state.faceDeviceId = '';
    state.faceArmed = false;
    state.liveness = 'wait';
    state.livenessAge = 0;
    var video = $('faceCamera');
    if (video) video.srcObject = null;
    document.querySelector('.face-panel').classList.remove('is-live');
    $('faceStartBtn').hidden = state.gateType === 'checkin';
    setFaceHint(state.gateType === 'checkin' ? '人脸摄像头待机，开检后自动识别' : '点击下方按钮开启人脸摄像头');
  }

  async function startCamera() {
    if (state.gateType !== 'checkin') return;
    if (state.scanning || state.scanStarting) return;
    if (!hasOpenTrains()) {
      syncCheckinCameras();
      return;
    }
    if (!mediaSupported()) {
      $('cameraNote').textContent = '当前浏览器不支持摄像头调用';
      return;
    }
    if (typeof window.jsQR !== 'function') {
      $('cameraNote').textContent = '二维码识别库未加载，请刷新页面后重试';
      return;
    }
    state.scanStarting = true;
    var selected = getSelectedScanDevice();
    if (!selected) {
      try {
        selected = readStorage('qj_scan_camera', '');
      } catch (e) {
        selected = '';
      }
    }

    // 只有一个摄像头时，扫码期间暂停人脸画面，避免同一设备被占用
    var sameDevice = (selected && selected === state.faceDeviceId) || (!selected && state.faceDeviceId);
    if (sameDevice && state.faceStream) {
      state.facePausedByScan = true;
      stopFaceCamera();
    }

    try {
      state.scanStream = await navigator.mediaDevices.getUserMedia({
        video: selected ? { deviceId: { exact: selected } } : { facingMode: 'environment' },
        audio: false,
      });
      var video = $('camera');
      video.srcObject = state.scanStream;
      await video.play();
      if (!hasOpenTrains() || state.gateType !== 'checkin') {
        state.scanStream.getTracks().forEach(function (track) { track.stop(); });
        state.scanStream = null;
        video.srcObject = null;
        state.scanStarting = false;
        return;
      }
      var track = state.scanStream.getVideoTracks()[0];
      if (track) state.scanDeviceId = track.getSettings().deviceId || selected;
      $('cameraPlaceholder').hidden = true;
      $('scanLine').hidden = false;
      $('startCameraBtn').hidden = state.gateType === 'checkin';
      $('stopCameraBtn').hidden = true;
      $('cameraNote').textContent = '扫码摄像头已开启，请将二维码对准摄像头';
      await refreshCameraDevices();

      state.scanCanvas = state.scanCanvas || document.createElement('canvas');
      state.lastCode = '';
      state.lastScanAt = 0;
      state.scanning = true;
      state.scanStarting = false;
      requestAnimationFrame(scanFrame);
    } catch (e) {
      state.scanStarting = false;
      $('cameraNote').textContent = /(Device in use|NotReadable|Could not start)/i.test(String(e && (e.name + ' ' + e.message)))
        ? '扫码摄像头被占用，请关闭其他使用摄像头的页面或程序后重试'
        : '扫码摄像头未就绪，请检查设备连接或权限设置';
      state.scanStream = null;
      if (state.facePausedByScan) {
        state.facePausedByScan = false;
        if (state.gateType === 'checkin') startFaceCamera();
      }
    }
  }

  function stopCamera() {
    state.scanning = false;
    if (state.scanStream) {
      state.scanStream.getTracks().forEach(function (track) { track.stop(); });
      state.scanStream = null;
    }
    state.scanDeviceId = '';
    $('camera').srcObject = null;
    $('cameraPlaceholder').hidden = false;
    $('scanLine').hidden = true;
    $('startCameraBtn').hidden = state.gateType === 'checkin';
    $('stopCameraBtn').hidden = true;
    $('cameraNote').textContent = state.gateType === 'checkin' ? '' : '';
    if (state.facePausedByScan) {
      state.facePausedByScan = false;
      if (state.gateType === 'checkin') startFaceCamera();
    }
  }

  function setAccessResult(text, kind) {
    var box = $('accessResult');
    if (!box) return;
    box.textContent = text;
    box.className = 'access-result' + (kind ? ' is-' + kind : '');
  }

  async function startAccessCamera() {
    if (state.gateType === 'checkin' || state.accessStream || !state.cameraEnabled) return;
    if (!mediaSupported()) {
      setAccessResult('当前浏览器不支持摄像头调用，请使用输入框验证', 'error');
      return;
    }
    var selected = getSelectedScanDevice() || readStorage('qj_scan_camera', '');
    try {
      state.accessStream = await navigator.mediaDevices.getUserMedia({
        video: selected ? { deviceId: { exact: selected } } : { facingMode: 'environment' },
        audio: false,
      });
      var video = $('accessScanVideo');
      video.srcObject = state.accessStream;
      await video.play();
      document.querySelector('.access-camera').classList.add('is-live');
      state.accessScanning = true;
      setAccessResult('扫码摄像头已开启，请将车票二维码对准扫码框');
      requestAnimationFrame(accessScanFrame);
      await refreshCameraDevices();
    } catch (e) {
      state.accessStream = null;
      setAccessResult('扫码摄像头未就绪，请检查设备或权限；也可手动输入验证', 'error');
    }
  }

  function stopAccessCamera() {
    state.accessScanning = false;
    if (state.accessStream) {
      state.accessStream.getTracks().forEach(function (track) { track.stop(); });
      state.accessStream = null;
    }
    var video = $('accessScanVideo');
    if (video) video.srcObject = null;
    var wrap = document.querySelector('.access-camera');
    if (wrap) wrap.classList.remove('is-live');
  }

  function accessScanFrame() {
    if (!state.accessScanning) return;
    if (Date.now() < state.accessHoldUntil) {
      requestAnimationFrame(accessScanFrame);
      return;
    }
    var video = $('accessScanVideo');
    if (video && video.readyState === video.HAVE_ENOUGH_DATA && typeof window.jsQR === 'function') {
      try {
        if (!state.accessCanvas) {
          state.accessCanvas = document.createElement('canvas');
        }
        var canvas = state.accessCanvas;
        var width = video.videoWidth;
        var height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, width, height);
          var image = ctx.getImageData(0, 0, width, height);
          var qr = window.jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' });
          if (qr && qr.data) {
            var now = Date.now();
            if (qr.data !== state.accessLastCode || now - state.accessLastAt > 3000) {
              state.accessLastCode = qr.data;
              state.accessLastAt = now;
              playScanBeep();
              verifyAccessCode(qr.data);
            }
          }
        }
      } catch (e) {
        /* 单帧失败忽略 */
      }
    }
    if (state.accessScanning) requestAnimationFrame(accessScanFrame);
  }

  function verifyAccessCode(code) {
    var raw = String(code || '').trim();
    if (!raw) {
      setAccessResult('请扫描车票二维码，或输入身份证号 / 订单号', 'error');
      return Promise.resolve();
    }
    if (!state.stationId) {
      setAccessResult('请先在设置中选择本站车站', 'error');
      return Promise.resolve();
    }
    setAccessResult('正在验证车票…');
    return api('/checkin/access', {
      method: 'POST',
      body: {
        code: raw,
        stationId: state.stationId,
        gateType: state.gateType,
        gateNo: $('gateNo').textContent,
      },
    })
      .then(function (result) {
        playGateOpenBeep();
        var passenger = result.passenger || {};
        var seat = passenger.seatNo ? ' ' + passenger.seatNo + '号' : '';
        var parts = [passenger.name || '旅客'];
        if (result.trainNo) parts.push(result.trainNo);
        if (result.fromStationName && result.toStationName) {
          parts.push(result.fromStationName + ' → ' + result.toStationName);
        }
        if (seat) parts.push(seat.trim());
        parts.push(result.gateType === 'entry' ? '进站验证通过' : '出站验证通过');
        setAccessResult(parts.join(' · '), 'ok');
        $('passageStatus').className = 'passage-status';
        $('passageStatusText').textContent = '验证通过，闸机已开启，请有序通过';
        if ($('accessCodeInput')) $('accessCodeInput').value = '';
        state.accessHoldUntil = Date.now() + 6000;
        clearTimeout(state.accessTimer);
        state.accessTimer = setTimeout(function () {
          if (state.gateType !== 'checkin') resetAccessVerification();
        }, 6000);
      })
      .catch(function (err) {
        setAccessResult(err.message || '验证失败', 'error');
        clearTimeout(state.accessTimer);
        $('passageStatus').className = 'passage-status is-wait';
        $('passageStatusText').textContent = '验证未通过，请检查车票或联系工作人员';
      });
  }

  function scanFrame() {
    if (!state.scanning) return;
    var video = $('camera');
    if (video && video.readyState === video.HAVE_ENOUGH_DATA && typeof window.jsQR === 'function') {
      try {
        var canvas = state.scanCanvas || (state.scanCanvas = document.createElement('canvas'));
        var width = video.videoWidth;
        var height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, width, height);
          var image = ctx.getImageData(0, 0, width, height);
          var qr = window.jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' });
          if (qr && qr.data) {
            var raw = qr.data;
            var now = Date.now();
            if (raw !== state.lastCode || now - state.lastScanAt > 3000) {
              state.lastCode = raw;
              state.lastScanAt = now;
              playScanBeep();
              verifyCode(raw);
            }
          }
        }
      } catch (e) {
        /* 忽略单帧识别失败 */
      }
    }
    if (state.scanning) requestAnimationFrame(scanFrame);
  }

  function tickClock() {
    var now = new Date();
    $('clockText').textContent =
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');
    if ($('headDate')) {
      $('headDate').textContent =
        now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
    }
    if ($('headGateNo') && $('gateNo')) $('headGateNo').textContent = $('gateNo').textContent;
    if (!$('todayText').textContent || $('todayText').textContent === '今日') renderToday();
  }

  function openSettings(firstRun) {
    if (firstRun) state.firstRunSetup = true;
    $('settingsTitle').textContent = state.firstRunSetup ? '首次使用 · 请设置本机车站和编号' : '设备设置';
    $('settingsCancel').hidden = state.firstRunSetup;
    $('settingsCloseBtn').hidden = state.firstRunSetup;
    $('settingsSave').textContent = state.firstRunSetup ? '保存并启用本机' : '保存设置';
    $('gateNoInput').value = $('gateNo').textContent;
    if ($('showScanPreviewInput')) {
      $('showScanPreviewInput').checked = state.firstRunSetup ? false : readStorage('qj_show_scan_preview', '0') === '1';
    }
    fillStationSelect();
    $('stationSelect').value = state.stationId || '';
    setMode(state.mode, true);
    Array.prototype.forEach.call(document.querySelectorAll('#gateTypeChoice [data-gate]'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-gate') === state.gateType);
    });
    toggleSettingsFields(state.gateType);
    refreshCameraDevices().then(function () {
      $('faceSelect').value = getSelectedFaceDevice() || readStorage('qj_face_camera', '');
      $('scanSelect').value = getSelectedScanDevice() || readStorage('qj_scan_camera', '');
    });
    $('settingsDialog').hidden = false;
  }

  function closeSettings() {
    if (state.firstRunSetup) return;
    $('settingsDialog').hidden = true;
  }

  function saveSettings() {
    var mode = document.querySelector('#modeChoice button.active');
    var gateChoice = document.querySelector('#gateTypeChoice button.active');
    var stationId = $('stationSelect').value;
    var station = state.stations.find(function (item) { return item.id === stationId; });
    if (!station) {
      $('stationHint').textContent = '请选择本站车站后再保存';
      return;
    }
    var gateNo = String($('gateNoInput').value || '').trim();
    if (!gateNo) {
      $('stationHint').textContent = '请填写检票机编号后再保存，例如 QJ-01';
      return;
    }
    var faceDevice = getSelectedFaceDevice();
    var scanDevice = getSelectedScanDevice();
    writeStorage('qj_face_camera', faceDevice);
    writeStorage('qj_scan_camera', scanDevice);
    writeStorage('qj_gate_no', gateNo);
    writeStorage('qj_gate_type', gateChoice ? gateChoice.getAttribute('data-gate') : state.gateType);
    writeStorage('qj_station_id', stationId);
    writeStorage('qj_device_configured', '1');
    writeStorage('qj_show_scan_preview', $('showScanPreviewInput') && $('showScanPreviewInput').checked ? '1' : '0');
    writeStorage('qj_device_disabled', '0');
    applyScanPreview();
    renderDeviceBlocked();
    state.firstRunSetup = false;
    $('settingsCancel').hidden = false;
    $('settingsCloseBtn').hidden = false;
    $('settingsSave').textContent = '保存设置';
    $('settingsTitle').textContent = '设备设置';
    state.stationId = stationId;
    state.stationName = station.name;
    $('gateNo').textContent = gateNo;
    setMode(mode ? mode.getAttribute('data-mode') : state.mode);

    state.gateType = gateChoice ? gateChoice.getAttribute('data-gate') : state.gateType;
    state.facePausedByScan = false;
    if (state.scanning) stopCamera();
    if (state.faceStream) stopFaceCamera();
    applyGateType();
    refreshAll(true);
    closeSettings();
  }

  function applyScanPreview() {
    var on = state.gateType === 'checkin' && readStorage('qj_show_scan_preview', '0') === '1';
    document.body.classList.toggle('scan-preview-on', on);
  }

  function renderDeviceBlocked() {
    var blocked = !!state.deviceBlocked;
    var el = $('deviceBlocked');
    if (!el) return;
    el.hidden = !blocked;
    if (!blocked) return;
    var status = state.deviceStatus || 'maintenance';
    if ($('deviceBlockedTitle')) {
      $('deviceBlockedTitle').textContent = status === 'disabled' ? '本机已停用' : '此闸机正在维修';
    }
    var text = status === 'disabled'
      ? '本机已在后台停用，请联系车站管理员恢复。'
      : (state.config && state.config.maintenanceText) || '此闸机正在维修，请使用其他闸机';
    $('deviceBlockedText').textContent = text;
    if (state.faceStream) stopFaceCamera();
    if (state.scanStream) stopCamera();
  }

  function applyRemoteConfig(config) {
    if (!config) return;
    if (config.gateType && ['checkin', 'entry', 'exit'].indexOf(config.gateType) >= 0 && config.gateType !== state.gateType) {
      state.gateType = config.gateType;
      writeStorage('qj_gate_type', state.gateType);
      if (state.scanning) stopCamera();
      stopFaceCamera();
      applyGateType();
    }
    if (config.mode && config.mode !== state.mode) {
      setMode(config.mode, false);
      writeStorage('qj_checkin_mode', state.mode);
    }
    if (config.cameraEnabled !== undefined && config.cameraEnabled !== state.cameraEnabled) {
      state.cameraEnabled = config.cameraEnabled !== false;
      if (!state.cameraEnabled) {
        if (state.scanning) stopCamera();
        stopFaceCamera();
        stopAccessCamera();
      }
      ['faceStartBtn', 'startCameraBtn'].forEach(function (id) {
        var el = $(id);
        if (el) el.disabled = !state.cameraEnabled;
      });
    }
    if (config.showScanPreview !== undefined) {
      writeStorage('qj_show_scan_preview', config.showScanPreview ? '1' : '0');
      applyScanPreview();
    }
    if (config.welcomeText) {
      if (state.gateType === 'entry') state.config.entryWelcomeText = config.welcomeText;
      else if (state.gateType === 'exit') state.config.exitWelcomeText = config.welcomeText;
      if (state.gateType !== 'checkin') renderWelcome();
    }
  }

  async function checkDeviceState() {
    if (!state.stationId) return;
    try {
      var data = await api('/checkin/device?stationId=' + encodeURIComponent(state.stationId) +
        '&gateNo=' + encodeURIComponent($('gateNo').textContent) +
        '&gateType=' + encodeURIComponent(state.gateType) +
        '&configVersion=' + encodeURIComponent(state.deviceConfigVersion || 0));
      state.deviceStatus = (data && data.status) || 'normal';
      state.deviceBlocked = state.deviceStatus !== 'normal';
      state.deviceConfig = (data && data.config) || null;
      state.deviceConfigVersion = (data && data.configVersion) || 0;
      if (data && data.maintenanceText) state.config.maintenanceText = data.maintenanceText;
      applyRemoteConfig(state.deviceConfig);
    } catch (e) {
      state.deviceStatus = 'normal';
      state.deviceBlocked = false;
    }
    renderDeviceBlocked();
  }

  function init() {
    var savedGateType = readStorage('qj_gate_type', 'checkin');
    state.gateType = ['checkin', 'entry', 'exit'].indexOf(savedGateType) >= 0 ? savedGateType : 'checkin';
    state.firstRunSetup = readStorage('qj_device_configured', '0') !== '1';
    if (readStorage('qj_device_disabled', '0') === '1') writeStorage('qj_device_disabled', '0');
    state.deviceStatus = 'normal';
    state.deviceBlocked = false;
    if (readStorage('qj_scan_preview_default_v2', '0') !== '1') {
      writeStorage('qj_show_scan_preview', '0');
      writeStorage('qj_scan_preview_default_v2', '1');
    }
    applyScanPreview();
    setMode(readStorage('qj_checkin_mode', 'auto'), true);
    $('gateNo').textContent = readStorage('qj_gate_no', 'QJ-01');
    tickClock();
    setInterval(tickClock, 1000);
    renderToday();
    refreshCameraDevices();
    $('passageGate').innerHTML = document.querySelector('.gate-art').outerHTML;
    applyGateType();

    refreshAll(true).then(function () {
      if (state.firstRunSetup || (!state.stationId && state.gateType === 'checkin')) openSettings(state.firstRunSetup);
      checkDeviceState();
    });
    setInterval(checkDeviceState, 5000);

    $('settingsBtn').addEventListener('click', openSettings);
    $('settingsCancel').addEventListener('click', closeSettings);
    $('settingsCloseBtn').addEventListener('click', closeSettings);
    $('settingsSave').addEventListener('click', saveSettings);
    $('settingsDialog').addEventListener('click', function (event) {
      if (event.target === $('settingsDialog')) closeSettings();
    });
    Array.prototype.forEach.call(document.querySelectorAll('#modeChoice [data-mode]'), function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.getAttribute('data-mode'), true);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#gateTypeChoice [data-gate]'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#gateTypeChoice [data-gate]'), function (item) {
          item.classList.toggle('active', item === btn);
        });
        toggleSettingsFields(btn.getAttribute('data-gate'));
      });
    });

    $('faceStartBtn').addEventListener('click', startFaceCamera);
    $('startCameraBtn').addEventListener('click', startCamera);
    $('stopCameraBtn').addEventListener('click', stopCamera);
    $('verifyBtn').addEventListener('click', function () { verifyCode($('codeInput').value); });
    $('codeInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') verifyCode($('codeInput').value);
    });
    if ($('accessScanBtn')) $('accessScanBtn').addEventListener('click', startAccessCamera);
    if ($('accessVerifyBtn')) {
      $('accessVerifyBtn').addEventListener('click', function () {
        verifyAccessCode($('accessCodeInput').value);
      });
      $('accessCodeInput').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') verifyAccessCode($('accessCodeInput').value);
      });
    }
    $('manualTrainNo').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') verifyCode($('codeInput').value);
    });
    $('emptyRefreshBtn').addEventListener('click', function () { refreshAll(false); });
    $('deviceBlockedRetry').addEventListener('click', checkDeviceState);
    if ($('showScanPreviewInput')) {
      $('showScanPreviewInput').addEventListener('change', function () {
        writeStorage('qj_show_scan_preview', this.checked ? '1' : '0');
        applyScanPreview();
      });
    }

    $('detectCamerasBtn').addEventListener('click', detectCameras);
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshCameraDevices);
    }

    $('faceSelect').addEventListener('change', function () {
      writeStorage('qj_face_camera', getSelectedFaceDevice());
      if (state.faceStream) {
        stopFaceCamera();
        startFaceCamera();
      } else {
        startFaceCamera();
      }
    });
    $('scanSelect').addEventListener('change', function () {
      writeStorage('qj_scan_camera', getSelectedScanDevice());
      if (state.gateType !== 'checkin') {
        stopAccessCamera();
        startAccessCamera();
      } else if (state.scanning) {
        stopCamera();
        startCamera();
      }
    });

    setTimeout(syncCheckinCameras, 700);
    state.cameraSyncTimer = setInterval(syncCheckinCameras, 5000);
    state.refreshTimer = setInterval(function () { refreshAll(true); }, 10000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
