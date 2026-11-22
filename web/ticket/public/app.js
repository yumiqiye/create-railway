/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/* 清江铁路12306 前台：账号 / 图形验证码 / 查票 / 勾选乘车人 / 儿童票 / 订单 / 退改 / 发票 / 二维码 */
(function () {
  'use strict';

  var API_BASE = '/api';
  var LS_USER = 'QJ-USER';
  var LS_CAPTCHA = 'QJ-CAPTCHA';

  var state = {
    settings: {
      siteName: '清江铁路12306',
      subtitle: '网上购票系统',
      announcement: '',
      maxPassengersPerOrder: 5,
      presaleDays: 30,
      refundEnabled: true,
      servicePhone: '12306',
      childDiscount: 0.5,
      changeFeeRate: 0.05,
      refundRules: [],
      checkinMinutes: 30,
    },
    cities: [],
    user: null,
    token: '',
    captchaToken: '',
    captchaProvider: '',
    hcaptchaScriptPromise: null,
    hcaptchaWidgetId: undefined,
    captchaChallenge: null,
    afterCaptcha: null,
    afterLogin: null,
    authMode: 'login',
    view: 'search',
    date: '',
    train: null,
    seat: null,
    savedPassengers: [],
    selectedIds: [],
    editingPassengerId: null,
    orders: [],
    detailOrder: null,
    changeOrder: null,
    changeTrains: [],
    faceStream: null,
    faceModelsReady: false,
    faceDescriptor: null,
    faceVerified: false,
    faceFaceToken: '',
    qrTimer: 0,
    paymentTimer: 0,
    faceRunning: false,
    faceLoopId: 0,
    faceSamples: [],
    faceProcessCanvas: null,
    faceBusy: false,
    faceMode: 'buyer',
    passengerFaceDescriptor: null,
    editingPassengerHasFace: false,
  };

  var STATUS_TEXT = { pending: '待支付', paid: '已支付', refunded: '已退票', canceled: '已取消' };

  /* ---------------- 基础工具 ---------------- */
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    var n = Number(value || 0);
    return '¥' + (Number.isInteger(n) ? n : n.toFixed(2));
  }

  function landmarkColorHex(value) {
    var map = {
      '黄色': '#f2c230',
      '绿色': '#35b56f',
      '蓝色': '#2f7de1',
      '红色': '#d94a4a',
      '紫色': '#8a5cd6',
      '橙色': '#ef8a2f',
      '白色': '#ffffff',
      '黑色': '#333333',
    };
    return map[String(value || '')] || '#9aa8bd';
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + week;
  }

  function formatDateTime(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function toast(message, duration) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      el.hidden = true;
    }, duration || 2600);
  }

  function api(path, options) {
    var opts = options || {};
    var headers = {};
    if (state.token) headers['X-Token'] = state.token;
    if (state.captchaToken) headers['X-Captcha'] = state.captchaToken;
    var config = { method: opts.method || 'GET', headers: headers };
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(opts.body);
    }
    return fetch(API_BASE + path, config)
      .then(function (res) {
        return res.json().catch(function () {
          throw new Error('服务返回异常（HTTP ' + res.status + '）');
        });
      })
      .then(function (json) {
        if (!json || json.code !== 200) {
          var message = (json && json.message) || '请求失败';
          var err = new Error(message);
          err.status = json && json.code;
          if (json && json.code === 401) clearUser();
          if (json && json.code === 400 && /hCaptcha|人机验证|验证码/.test(message)) {
            clearCaptchaToken();
            setTimeout(openCaptcha, 0);
          }
          throw err;
        }
        return json.result;
      });
  }

  /* ---------------- 用户与登录态 ---------------- */
  function saveUser(token, user) {
    state.token = token;
    state.user = user;
    var payload = { token: token, user: user };
    try {
      localStorage.setItem(LS_USER, JSON.stringify(payload));
    } catch (e) {}
    renderUser();
  }

  function clearUser() {
    state.token = '';
    state.user = null;
    try {
      localStorage.removeItem(LS_USER);
    } catch (e) {}
    renderUser();
    state.savedPassengers = [];
    state.orders = [];
    renderSavedPassengers();
    renderOrders([]);
    renderInvoices([]);
  }

  function renderUser() {
    var btn = $('userBtn');
    var logout = $('logoutBtn');
    if (state.user) {
      btn.textContent = state.user.name + '（' + state.user.phone.slice(-4) + '）';
      btn.classList.add('logged');
      logout.hidden = false;
    } else {
      btn.textContent = '登录 / 注册';
      btn.classList.remove('logged');
      logout.hidden = true;
    }
  }

  function requireLogin(cb) {
    if (state.user) return cb();
    state.afterLogin = cb;
    openAuth('login');
  }

  function openAuth(mode) {
    state.authMode = mode === 'register' ? 'register' : 'login';
    applyAuthMode();
    $('authMask').hidden = false;
    setTimeout(function () {
      $('authAccount').focus();
    }, 80);
  }

  function applyAuthMode() {
    var isReg = state.authMode === 'register';
    $('authTitle').textContent = isReg ? '注册清江铁路12306账号' : '登录清江铁路12306';
    $('authNameRow').hidden = !isReg;
    $('authSubmitBtn').textContent = isReg ? '注册并登录' : '登录';
    Array.prototype.forEach.call(document.querySelectorAll('[data-auth-tab]'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-auth-tab') === state.authMode);
    });
  }

  function submitAuth() {
    var account = $('authAccount').value.trim();
    var password = $('authPassword').value.trim();
    var name = $('authName').value.trim();
    if (state.authMode === 'register') {
      if (!/^[\u4e00-\u9fa5a-zA-Z·]{2,20}$/.test(name)) return toast('请输入 2~20 位中文/字母姓名');
      if (!/^1[3-9]\d{9}$/.test(account)) return toast('请输入正确的 11 位手机号');
    } else if (!account) {
      return toast('请输入手机号');
    }
    if (password.length < 6) return toast('密码至少 6 位');

    ensureCaptcha(function () {
      var path = state.authMode === 'register' ? '/public/auth/register' : '/public/auth/login';
      var body = state.authMode === 'register'
        ? { phone: account, password: password, name: name }
        : { account: account, password: password };
      var btn = $('authSubmitBtn');
      btn.disabled = true;
      api(path, { method: 'POST', body: body })
        .then(function (data) {
          saveUser(data.token, data.user);
          $('authMask').hidden = true;
          $('authAccount').value = '';
          $('authPassword').value = '';
          toast(state.authMode === 'register' ? '注册成功，已自动登录' : '登录成功');
          loadPassengers();
          var next = state.afterLogin;
          state.afterLogin = null;
          if (next) next();
        })
        .catch(function (err) {
          toast(err.message);
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  /* ---------------- 图形验证码 ---------------- */
  function clearCaptchaToken() {
    state.captchaToken = '';
    try {
      localStorage.removeItem(LS_CAPTCHA);
    } catch (e) {}
  }

  function ensureCaptcha(cb) {
    if (state.captchaToken) return cb();
    state.afterCaptcha = cb;
    openCaptcha();
  }

  function openCaptcha() {
    $('captchaMask').hidden = false;
    loadCaptchaChallenge();
  }

  function loadHcaptchaScript() {
    if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
    if (state.hcaptchaScriptPromise) return state.hcaptchaScriptPromise;
    if (!window.__qjHcaptchaOnLoad) {
      window.__qjHcaptchaOnLoad = function () {
        window.__qjHcaptchaReady = true;
        if (window.__qjHcaptchaResolve) window.__qjHcaptchaResolve(window.hcaptcha);
      };
    }
    state.hcaptchaScriptPromise = new Promise(function (resolve, reject) {
      window.__qjHcaptchaResolve = resolve;
      if (window.__qjHcaptchaReady && window.hcaptcha) {
        resolve(window.hcaptcha);
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&hl=zh-CN&onload=__qjHcaptchaOnLoad';
      script.async = true;
      script.defer = true;
      script.onerror = function () {
        state.hcaptchaScriptPromise = null;
        reject(new Error('hCaptcha 脚本加载失败'));
      };
      document.head.appendChild(script);
    });
    return state.hcaptchaScriptPromise;
  }

  function showHcaptcha(challenge) {
    state.captchaProvider = 'hcaptcha';
    $('captchaBrand').textContent = 'hCaptcha';
    $('captchaPrompt').textContent = '请完成下方 hCaptcha 人机验证';
    $('captchaFootText').textContent = '由 hCaptcha 提供验证服务';
    $('captchaImageWrap').hidden = true;
    $('captchaInputRow').hidden = true;
    $('captchaRefreshBtn').textContent = '重新验证';
    $('hcaptchaBox').hidden = false;
    $('hcaptchaBox').innerHTML = '';
    loadHcaptchaScript()
      .then(function (hcaptcha) {
        state.hcaptchaWidgetId = hcaptcha.render($('hcaptchaBox'), {
          sitekey: challenge.siteKey,
          theme: 'light',
          size: 'normal',
          callback: function (token) { verifyCaptcha(token); },
          'expired-callback': function () { toast('hCaptcha 验证已过期，请重新验证'); },
          'error-callback': function () {
            $('captchaPrompt').textContent = 'hCaptcha 验证遇到问题，请点击「重新验证」';
          },
        });
      })
      .catch(function (err) {
        $('captchaPrompt').textContent = err.message + '，请检查网络或浏览器设置后刷新页面';
      });
  }

  function loadCaptchaChallenge() {
    $('captchaPrompt').textContent = '正在加载验证码…';
    $('captchaBrand').textContent = 'hCaptcha';
    $('captchaImage').removeAttribute('src');
    $('captchaInput').value = '';
    $('captchaInput').disabled = true;
    $('hcaptchaBox').hidden = true;
    $('hcaptchaBox').innerHTML = '';
    $('captchaImageWrap').hidden = false;
    $('captchaInputRow').hidden = false;
    $('captchaRefreshBtn').textContent = '换一张';
    $('captchaFootText').textContent = '验证码用于保护查询、登录与购票';
    api('/captcha/challenge')
      .then(function (challenge) {
        state.captchaChallenge = challenge;
        state.captchaProvider = challenge.provider || 'image';
        if (challenge.provider === 'hcaptcha') {
          showHcaptcha(challenge);
          return;
        }
        $('captchaBrand').textContent = '图形验证码';
        $('captchaPrompt').textContent = challenge.prompt || '请输入图片中的字符';
        $('captchaImage').src = challenge.image;
        $('captchaInput').maxLength = challenge.length || 4;
        $('captchaInput').disabled = false;
        $('captchaInput').focus();
      })
      .catch(function (err) {
        $('captchaPrompt').textContent = '验证码加载失败：' + err.message;
      });
  }

  function verifyCaptcha(responseToken) {
    var challenge = state.captchaChallenge;
    if (!challenge) return toast('验证码未加载，请刷新');
    var body = {};
    if (state.captchaProvider === 'hcaptcha') {
      body.response = String(responseToken || '');
      if (!body.response) return toast('请先完成 hCaptcha 验证');
    } else {
      body.id = challenge.id;
      body.code = $('captchaInput').value.trim();
      if (!body.code) return toast('请输入图片中的字符');
    }
    var btn = $('captchaSubmitBtn');
    btn.disabled = true;
    $('captchaPrompt').textContent = '正在校验…';
    api('/captcha/verify', { method: 'POST', body: body })
      .then(function (data) {
        state.captchaToken = data.token;
        try {
          localStorage.setItem(LS_CAPTCHA, JSON.stringify({ token: data.token, at: Date.now() }));
        } catch (e) {}
        $('captchaMask').hidden = true;
        toast('hCaptcha 验证通过');
        var next = state.afterCaptcha;
        state.afterCaptcha = null;
        if (next) next();
      })
      .catch(function (err) {
        toast(err.message);
        if (state.captchaProvider === 'hcaptcha') {
          $('captchaPrompt').textContent = '请重新完成下方 hCaptcha 验证';
          if (state.hcaptchaWidgetId !== undefined && window.hcaptcha) {
            window.hcaptcha.reset(state.hcaptchaWidgetId);
          }
        } else {
          loadCaptchaChallenge();
        }
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  /* ---------------- 系统设置 ---------------- */
  function loadSettings() {
    return api('/public/settings')
      .then(function (settings) {
        if (settings) state.settings = settings;
        applySettings();
      })
      .catch(function () {});
  }

  function applySettings() {
    var s = state.settings;
    document.title = s.siteName + ' · ' + s.subtitle;
    if ($('brandName')) $('brandName').textContent = s.siteName;
    if ($('brandSub')) $('brandSub').textContent = s.subtitle;
    if ($('servicePhone')) $('servicePhone').textContent = s.servicePhone || '12306';
    if ($('maxPassengerTip')) {
      $('maxPassengerTip').textContent = '单笔订单最多可购买 ' + s.maxPassengersPerOrder + ' 张车票';
    }
    if ($('childDiscountText')) $('childDiscountText').textContent = Math.round((s.childDiscount || 0.5) * 100) + '%';
    if ($('childDiscountHint')) $('childDiscountHint').textContent = Math.round((s.childDiscount || 0.5) * 100) + '%';
    var notice = $('siteNotice');
    var enabled = s.announcementEnabled !== false && !!s.announcement;
    if (notice && $('noticeText')) {
      if (enabled && s.announcementShowMode === 'top') {
        $('noticeText').textContent = s.announcement;
        notice.hidden = false;
      } else {
        notice.hidden = true;
      }
    }
    if ($('footerCopyright')) $('footerCopyright').textContent = s.footerCopyright || '© 2026 清江铁路';
    if ($('footerIcp')) $('footerIcp').textContent = s.footerIcp || '';
    if ($('footerPolice')) {
      var police = s.footerPoliceNo
        ? (s.footerPolice || '公安备案') + ' ' + s.footerPoliceNo
        : (s.footerPolice || '');
      $('footerPolice').textContent = police;
    }
    if (enabled && s.announcementShowMode === 'modal' && s.announcementOnStart) {
      var seenKey = 'QJ-NOTICE-SEEN-' + String(s.announcement).slice(0, 24);
      var seen = false;
      try { seen = localStorage.getItem(seenKey) === '1'; } catch (e) {}
      if (!seen || s.announcementRepeat) {
        $('noticeModalText').textContent = s.announcement;
        $('noticeMask').hidden = false;
        try { localStorage.setItem(seenKey, '1'); } catch (e) {}
      }
    }
    var input = $('travelDate');
    if (input) {
      var latest = new Date();
      latest.setDate(latest.getDate() + (s.presaleDays || 30));
      input.max = latest.getFullYear() + '-' + pad(latest.getMonth() + 1) + '-' + pad(latest.getDate());
    }
  }

  /* ---------------- 视图切换 ---------------- */
  function showView(view) {
    state.view = view;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (el) {
      el.hidden = true;
    });
    var target = { search: 'viewSearch', orders: 'viewOrders', passengers: 'viewPassengers', invoices: 'viewInvoices' }[view];
    if (target && $(target)) $(target).hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-view') === view);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (view === 'orders') requireLogin(loadOrders);
    if (view === 'passengers') requireLogin(loadPassengers);
    if (view === 'invoices') requireLogin(loadInvoices);
  }

  /* ---------------- 城市与日期 ---------------- */
  function loadCities() {
    return api('/public/cities').then(function (cities) {
      state.cities = cities || [];
      var fromSel = $('fromCity');
      var toSel = $('toCity');
      var options = state.cities
        .map(function (c) {
          return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>';
        })
        .join('');
      fromSel.innerHTML = options;
      toSel.innerHTML = options;
      if (state.cities.length > 1) {
        fromSel.value = state.cities[0].id;
        toSel.value = state.cities[1].id;
      } else if (state.cities.length === 1) {
        fromSel.value = state.cities[0].id;
        toSel.value = state.cities[0].id;
      }
      state.fromCityId = fromSel.value;
      state.toCityId = toSel.value;

      if (!state.cities.length) {
        $('resultSection').hidden = false;
        $('resultTitle').textContent = '暂无车次数据';
        $('resultSub').textContent = '城市列表为空';
        var empty = $('emptyState');
        empty.querySelector('p').textContent = '请先在管理后台「城市管理 / 车站管理 / 车次管理」中添加数据';
        empty.querySelector('span').textContent = '数据添加完成后，回到本页面刷新即可查询购票';
        empty.hidden = false;
      }
    });
  }

  function initDate() {
    var today = new Date();
    state.date = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    var input = $('travelDate');
    input.min = state.date;
    input.value = state.date;
  }

  /* ---------------- 查询车票 ---------------- */
  function searchTrains() {
    state.fromCityId = $('fromCity').value;
    state.toCityId = $('toCity').value;
    state.date = $('travelDate').value;
    if (!state.fromCityId || !state.toCityId) return toast('请选择出发城市和到达城市');
    if (!state.date) return toast('请选择出发日期');
    if (!/search=1/.test(window.location.search)) {
      var target = '/?search=1&fromCityId=' + encodeURIComponent(state.fromCityId) +
        '&toCityId=' + encodeURIComponent(state.toCityId) +
        '&date=' + encodeURIComponent(state.date);
      window.open(target, '_blank');
      return;
    }
    ensureCaptcha(searchNow);
  }

  function searchNow() {
    var list = $('trainList');
    list.innerHTML = '<div class="empty" style="padding:26px">正在查询…</div>';
    $('resultSection').hidden = false;
    $('emptyState').hidden = true;
    api(
      '/public/search?fromCityId=' + encodeURIComponent(state.fromCityId) +
        '&toCityId=' + encodeURIComponent(state.toCityId) +
        '&date=' + encodeURIComponent(state.date)
    )
      .then(function (data) {
        var cityFrom = state.cities.find(function (c) { return c.id === state.fromCityId; });
        var cityTo = state.cities.find(function (c) { return c.id === state.toCityId; });
        $('resultTitle').textContent =
          (cityFrom ? cityFrom.name : '出发') + ' → ' + (cityTo ? cityTo.name : '到达');
        $('resultSub').textContent = formatDate(data.date) + ' · 直达 ' + data.total + ' 个车次' +
          (data.transfers && data.transfers.length ? ' · 中转 ' + data.transfers.length + ' 个方案' : '');
        renderTrains(data.trains || []);
        renderTransfers(data.transfers || []);
      })
      .catch(function (err) {
        list.innerHTML = '';
        $('emptyState').hidden = false;
        toast(err.message);
      });
  }

  function renderTrains(trains) {
    var list = $('trainList');
    var empty = $('emptyState');
    if (!trains.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = trains
      .map(function (train) {
        var seats = train.seats
          .map(function (seat) {
            return (
              '<button type="button" class="seat" data-train="' + escapeHtml(train.id) + '" data-seat="' +
              escapeHtml(seat.type) + '"' + (seat.remaining <= 0 ? ' disabled' : '') + '>' +
              '<span class="seat-type">' + escapeHtml(seat.type) + '</span>' +
              '<span class="seat-price">' + money(seat.price) + '</span>' +
              '<span class="seat-left">' + (seat.remaining > 0 ? '余票 ' + seat.remaining + ' 张' : '无票') + '</span>' +
              '</button>'
            );
          })
          .join('');
        return (
          '<div class="train-row">' +
          '<div class="train-no"><strong>' + escapeHtml(train.trainNo) + '</strong><span>' + escapeHtml(train.type) + '</span></div>' +
          '<div class="route">' +
          '<div class="time-block"><b>' + escapeHtml(train.departTime) + '</b><span>' + escapeHtml(train.fromStationName) + '</span></div>' +
          '<div class="arrow"><em>' + escapeHtml(train.durationText) + '</em><div class="line"></div></div>' +
          '<div class="time-block arrive"><b>' + escapeHtml(train.arriveTime) + '</b><span>' + escapeHtml(train.toStationName) + '</span></div>' +
          '</div>' +
          '<div class="train-extra">' +
          (train.statusText ? '<span class="pill runtime ' + escapeHtml(train.status) + '">' + escapeHtml(train.statusText) + '</span>' : '') +
          '<span class="pill">检票口 ' + escapeHtml(train.gate || '-') + '</span>' +
          '<span class="pill">站台 ' + escapeHtml(train.platform || '-') + '</span>' +
          '<span class="pill landmark" data-color="' + escapeHtml(train.landmarkColor || '') + '">地标 ' +
          escapeHtml(train.landmarkColor || '-') + '</span>' +
          '</div>' +
          '<div class="seats">' + seats + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderTransfers(transfers) {
    var box = $('transferList');
    if (!box) return;
    box.hidden = !transfers.length;
    if (!transfers.length) {
      box.innerHTML = '';
      return;
    }
    if (transfers.length) $('emptyState').hidden = true;
    box.innerHTML =
      '<div class="transfer-head"><strong>智能中转推荐</strong><span>直达无票时，图算法自动计算耗时最短的换乘方案</span></div>' +
      transfers.map(function (item) {
        var first = item.first || {};
        var second = item.second || {};
        return (
          '<div class="transfer-card">' +
          '<div class="transfer-badge">方案 ' + escapeHtml(String(item.totalDurationText || '')) + '</div>' +
          '<div class="transfer-seg">' +
          '<div class="seg-train"><b>' + escapeHtml(first.trainNo || '') + '</b><span>' +
          escapeHtml(first.fromStationName || '') + ' ' + escapeHtml(first.departTime || '') + ' → ' +
          escapeHtml(first.toStationName || '') + ' ' + escapeHtml(first.arriveTime || '') + '</span></div>' +
          '<div class="seg-wait">' + escapeHtml(item.transferText || '') + '</div>' +
          '<div class="seg-train"><b>' + escapeHtml(second.trainNo || '') + '</b><span>' +
          escapeHtml(second.fromStationName || '') + ' ' + escapeHtml(second.departTime || '') + ' → ' +
          escapeHtml(second.toStationName || '') + ' ' + escapeHtml(second.arriveTime || '') + '</span></div>' +
          '</div>' +
          '<div class="transfer-meta"><span>总耗时 ' + escapeHtml(item.totalDurationText || '') +
          '</span><span>换乘等待 ' + item.waitMinutes + ' 分钟</span></div>' +
          '</div>'
        );
      }).join('');
  }

  /* ---------------- 乘车人 ---------------- */
  function loadPassengers() {
    if (!state.user) return;
    return api('/public/passengers')
      .then(function (list) {
        state.savedPassengers = list || [];
        renderSavedPassengers();
      })
      .catch(function (err) {
        toast('乘车人加载失败：' + err.message);
      });
  }

  function passengerPriceOf(p) {
    if (!state.seat) return 0;
    return p.type === '儿童'
      ? Number((state.seat.price * (state.settings.childDiscount || 0.5)).toFixed(2))
      : Number(state.seat.price);
  }

  function renderSavedPassengers() {
    var list = $('savedPassengerList');
    var empty = $('passengerEmpty');
    if ($('passengerCount')) $('passengerCount').textContent = '共 ' + state.savedPassengers.length + ' 位乘车人';
    if (!state.savedPassengers.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = state.savedPassengers
      .map(function (p) {
        var isChild = p.type === '儿童';
        return (
          '<div class="saved-passenger">' +
          '<div class="sp-top"><strong>' + escapeHtml(p.name) +
          (isChild ? ' <span class="type-tag child">儿童</span>' : ' <span class="type-tag">成人</span>') +
          '</strong>' +
          '<div class="sp-actions">' +
          '<button type="button" class="btn-ghost btn-small" data-edit="' + escapeHtml(p.id) + '">编辑</button>' +
          '<button type="button" class="btn-ghost btn-small danger" data-del="' + escapeHtml(p.id) + '">删除</button>' +
          '</div></div>' +
          '<div class="sp-id">' + escapeHtml(p.idType || '身份证') + ' · ' + escapeHtml(p.idNo) + '</div>' +
          '<div class="sp-phone">手机号 ' + escapeHtml(p.phone) + '</div>' +
          '<div class="sp-phone">人脸 ' + (p.faceEnrolled ? '<span class="face-ok">已录入 · 一人一闸</span>' : '<span class="face-missing">未录入，请编辑采集</span>') + '</div>' +
          '</div>'
        );
      })
      .join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-edit]'), function (btn) {
      btn.addEventListener('click', function () {
        openPassengerModal(btn.getAttribute('data-edit'));
      });
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-del]'), function (btn) {
      btn.addEventListener('click', function () {
        deletePassenger(btn.getAttribute('data-del'));
      });
    });
  }

  function updatePassengerFaceCard() {
    var status = $('pFaceStatus');
    if (!status) return;
    status.classList.remove('enrolled');
    if (state.passengerFaceDescriptor) {
      status.textContent = '本次已采集，保存后与乘车人绑定';
      status.classList.add('enrolled');
    } else if (state.editingPassengerHasFace) {
      status.textContent = '已录入人脸，可重新采集';
      status.classList.add('enrolled');
    } else {
      status.textContent = '未采集，添加乘车人前必须采集本人人脸';
    }
  }

  function openPassengerModal(id) {
    var p = id ? state.savedPassengers.find(function (x) { return x.id === id; }) : null;
    state.editingPassengerId = p ? p.id : null;
    state.passengerFaceDescriptor = null;
    state.editingPassengerHasFace = !!(p && p.faceEnrolled);
    $('passengerModalTitle').textContent = p ? '编辑乘车人' : '新增乘车人';
    $('pName').value = p ? p.name : '';
    $('pIdType').value = p ? p.idType : '身份证';
    $('pIdNo').value = p ? p.idNo : '';
    $('pPhone').value = p ? p.phone : '';
    $('pType').value = p ? p.type || '成人' : '成人';
    updatePassengerFaceCard();
    $('passengerMask').hidden = false;
  }

  function savePassenger() {
    var body = {
      name: $('pName').value.trim(),
      idType: $('pIdType').value,
      idNo: $('pIdNo').value.trim(),
      phone: $('pPhone').value.trim(),
      type: $('pType').value,
    };
    if (!body.name) return toast('请填写乘车人姓名');
    if (!body.idNo) return toast('请填写证件号码');
    if (!/^1[3-9]\d{9}$/.test(body.phone)) return toast('请填写正确的 11 位手机号');
    if (!state.passengerFaceDescriptor && !state.editingPassengerHasFace)
      return toast('请先采集乘车人本人人脸，检票时须一人一闸刷脸通过');
    if (state.passengerFaceDescriptor) body.faceDescriptor = state.passengerFaceDescriptor;

    var btn = $('savePassengerBtn');
    btn.disabled = true;
    var request = state.editingPassengerId
      ? api('/public/passengers/' + encodeURIComponent(state.editingPassengerId), { method: 'PUT', body: body })
      : api('/public/passengers', { method: 'POST', body: body });
    request
      .then(function () {
        toast(state.editingPassengerId ? '乘车人已更新' : '乘车人已添加');
        state.passengerFaceDescriptor = null;
        $('passengerMask').hidden = true;
        return loadPassengers();
      })
      .catch(function (err) {
        toast(err.message);
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  function deletePassenger(id) {
    var p = state.savedPassengers.find(function (x) { return x.id === id; });
    if (!p) return;
    if (!window.confirm('确认删除乘车人「' + p.name + '」？')) return;
    api('/public/passengers/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function () {
        toast('乘车人已删除');
        state.selectedIds = state.selectedIds.filter(function (x) { return x !== id; });
        return loadPassengers();
      })
      .catch(function (err) {
        toast(err.message);
      });
  }

  /* ---------------- 购票 ---------------- */
  /* ---------------- 购票人脸录入 / 核验 ---------------- */
  function resetFaceCheck() {
    state.faceVerified = false;
    state.faceDescriptor = null;
    state.faceFaceToken = '';
    state.faceBusy = false;
    stopFaceCamera();
    updateBookingFaceCard();
  }

  function updateBookingFaceCard() {
    if (!$('bookingFaceCard')) return;
    var card = $('bookingFaceCard');
    var enrolled = !!(state.user && state.user.faceEnrolled);
    card.classList.toggle('is-ok', state.faceVerified);
    $('bookingFaceState').textContent = state.faceVerified ? '已核验' : '未核验';
    if (state.faceVerified) {
      $('bookingFaceHint').textContent = '人脸核验通过，可以提交订单';
      $('bookingFaceBtn').textContent = '重新核验';
    } else if (enrolled) {
      $('bookingFaceHint').textContent = '该账号已录入人脸，提交订单前需核验本人';
      $('bookingFaceBtn').textContent = '核验人脸';
    } else {
      $('bookingFaceHint').textContent = '首次购票必须录入本人人脸，之后购票需再次核验';
      $('bookingFaceBtn').textContent = '录入人脸';
    }
  }

  function setFaceResult(text, kind) {
    var box = $('faceResult');
    box.textContent = text;
    box.className = 'face-result' + (kind ? ' is-' + kind : '');
  }

  function openFaceModal() {
    if (!state.user) {
      state.afterLogin = openFaceModal;
      return openAuth('login');
    }
    if (state.faceMode === 'passenger') {
      $('faceMask').hidden = false;
      $('faceModalTitle').textContent = '录入乘车人本人人脸';
      $('faceStartBtn').textContent = '开始采集';
      setFaceResult('请正对摄像头，让人脸完整落在椭圆内；采集结果将与当前乘车人绑定，检票时只允许本人通过。');
      return;
    }
    $('faceMask').hidden = false;
    var enrolled = !!state.user.faceEnrolled;
    $('faceModalTitle').textContent = enrolled ? '购票人脸核验' : '录入购票人脸';
    $('faceStartBtn').textContent = enrolled ? '识别并核验' : '开始录入';
    setFaceResult(
      enrolled
        ? '该账号已录入人脸。点击「识别并核验」，正脸面对摄像头即可比对。'
        : '首次购票需要录入本人人脸。点击「开始录入」，正脸面对摄像头。'
    );
  }

  async function loadFaceModels() {
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
    var video = $('faceVideo');
    if (video) video.srcObject = null;
    var live = $('faceLive');
    if (live) live.classList.remove('is-live');
    var canvas = $('faceCanvas');
    if (canvas) {
      var ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    var btn = $('faceStartBtn');
    if (btn) btn.disabled = false;
  }

  function faceBox(item) {
    if (!item) return null;
    return item.box || (item.detection && item.detection.box) || null;
  }

  function drawFaceBox(detection, frameW, frameH) {
    var video = $('faceVideo');
    var live = $('faceLive');
    var canvas = $('faceCanvas');
    if (!video || !live || !canvas) return;
    var width = live.clientWidth;
    var height = live.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    var box = faceBox(detection);
    if (!box || !video.videoWidth) return;
    var srcW = frameW || video.videoWidth;
    var srcH = frameH || video.videoHeight;
    var scale = Math.max(width / srcW, height / srcH);
    var drawW = srcW * scale;
    var drawH = srcH * scale;
    var ox = (width - drawW) / 2;
    var oy = (height - drawH) / 2;
    ctx.strokeStyle = '#53e2a3';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + box.x * scale, oy + box.y * scale, box.width * scale, box.height * scale);
  }

  function pickFace(detections, source) {
    if (!detections || !detections.length) return { face: null, reason: 'none' };
    var best = null;
    detections.forEach(function (item) {
      var box = faceBox(item);
      if (!box) return;
      var area = box.width * box.height;
      if (!best || area > best.area) best = { item: item, area: area, box: box };
    });
    if (!best) return { face: null, reason: 'none' };
    var frameW = source.videoWidth || source.width;
    var frameH = source.videoHeight || source.height;
    var frameArea = frameW * frameH;
    if (!frameArea || best.area / frameArea < 0.015) return { face: null, reason: 'tooFar', best: best.item };
    var cx = best.box.x + best.box.width / 2;
    var cy = best.box.y + best.box.height / 2;
    if (cx < frameW * 0.03 || cx > frameW * 0.97) return { face: null, reason: 'offCenter', best: best.item };
    if (cy < frameH * 0.01 || cy > frameH * 0.99) return { face: null, reason: 'offCenter', best: best.item };
    return { face: best.item, reason: 'ok' };
  }

  function averageDescriptor(samples) {
    var out = new Array(128).fill(0);
    samples.forEach(function (sample) {
      for (var i = 0; i < 128; i += 1) out[i] += Number(sample[i] || 0);
    });
    for (var j = 0; j < 128; j += 1) out[j] /= samples.length;
    return out;
  }

  function enhancedFrame(video) {
    var canvas = state.faceProcessCanvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      state.faceProcessCanvas = canvas;
    }
    var scale = Math.min(1, 640 / video.videoWidth);
    var width = Math.round(video.videoWidth * scale);
    var height = Math.round(video.videoHeight * scale);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    var ctx = canvas.getContext('2d');
    if (!ctx) return video;
    ctx.filter = 'brightness(1.28) contrast(1.22) saturate(1.05)';
    ctx.drawImage(video, 0, 0, width, height);
    ctx.filter = 'none';
    return canvas;
  }

  async function detectFaceInFrame(video) {
    var frame = enhancedFrame(video);
    var options = new window.faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.2 });
    try {
      var full = await window.faceapi
        .detectAllFaces(frame, options)
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (full && full.length) return { detections: full, source: frame, landmarks: 'full' };
    } catch (e) {
      /* 完整关键点失败后降级 */
    }
    var tiny = await window.faceapi
      .detectAllFaces(frame, options)
      .withFaceLandmarks(true)
      .withFaceDescriptors();
    return { detections: tiny, source: frame, landmarks: 'tiny' };
  }

  async function faceDetectLoop() {
    if (!state.faceRunning) return;
    var video = $('faceVideo');
    if (video && video.readyState >= 2) {
      try {
        var result = await detectFaceInFrame(video);
        var picked = pickFace(result.detections, result.source);
        var detection = picked.face;
        drawFaceBox(detection, result.source.width, result.source.height);
        state.faceDiagnostic = picked.reason;
        if (detection && detection.descriptor) {
          state.faceSamples = state.faceSamples || [];
          if (state.faceSamples.length < 3) {
            state.faceSamples.push(Array.from(detection.descriptor));
          }
          setFaceResult(
            '已识别到人脸，采样 ' + state.faceSamples.length + '/3，请保持正对屏幕…',
            'ok'
          );
          if (state.faceSamples.length >= 3 && !state.faceBusy) {
            submitFaceDescriptor(averageDescriptor(state.faceSamples));
            return;
          }
        } else {
          var hint = '未识别到人脸。请后退到约一臂距离，露出完整头部和肩膀，并保持光线均匀。';
          if (picked.reason === 'tooFar') hint = '检测到人脸但距离偏远。请稍微靠近摄像头，让脸部约占画面 1/5。';
          if (picked.reason === 'offCenter') hint = '检测到人脸但偏出有效区域。请正对画面中央的大框。';
          if (picked.reason === 'none') {
            try {
              var probe = await window.faceapi.detectAllFaces(
                result.source,
                new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 })
              );
              if (probe && probe.length) {
                var probeBox = probe.reduce(function (a, b) {
                  return b.box.width * b.box.height > a.box.width * a.box.height ? b : a;
                });
                var frameW = result.source.width;
                var frameH = result.source.height;
                var ratio = (probeBox.box.width * probeBox.box.height) / (frameW * frameH);
                state.faceDiagnostic = ratio >= 0.45 ? 'tooClose' : 'tooFar';
                if (ratio >= 0.45) hint = '距离太近，只拍到了部分面部。请后退约一臂距离，露出完整头部和肩膀。';
                else if (ratio < 0.06) hint = '检测到人脸但距离偏远。请稍微靠近摄像头，让脸部约占画面 1/5。';
              }
            } catch (e) {
              /* 距离探测失败时使用通用提示 */
            }
          }
          setFaceResult(hint);
        }
      } catch (e) {
        setFaceResult('识别暂时失败，正在重试。请保持光线均匀、正对摄像头。');
      }
    }
    if (state.faceRunning) {
      state.faceLoopId = setTimeout(faceDetectLoop, 450);
    }
  }

  async function startFaceVerify() {    if (state.faceBusy && !state.faceRunning) return;
    if (state.faceRunning) return;
    var btn = $('faceStartBtn');
    btn.disabled = true;
    setFaceResult('正在加载人脸识别模型，约需数秒…');
    try {
      await loadFaceModels();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('当前浏览器不支持摄像头');
      }
      setFaceResult('正在开启摄像头…');
      var stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      state.faceStream = stream;
      var video = $('faceVideo');
      video.srcObject = stream;
      await video.play();
      $('faceLive').classList.add('is-live');
      state.faceSamples = [];
      state.faceRunning = true;
      btn.disabled = false;
      setFaceResult('请后退约一臂距离，让完整面部落在椭圆内；将自动采样 3 次…');
      faceDetectLoop();
    } catch (e) {
      btn.disabled = false;
      setFaceResult(e.message || '人脸识别启动失败，请检查摄像头权限', 'error');
    }
  }

  function submitFaceDescriptor(descriptor) {
    if (state.faceBusy) return;
    state.faceBusy = true;
    state.faceRunning = false;
    if (state.faceLoopId) {
      clearTimeout(state.faceLoopId);
      state.faceLoopId = 0;
    }
    if (state.faceMode === 'passenger') {
      state.passengerFaceDescriptor = Array.from(descriptor);
      state.editingPassengerHasFace = true;
      state.faceBusy = false;
      stopFaceCamera();
      setFaceResult('乘车人人脸采集成功，保存乘车人后生效', 'ok');
      updatePassengerFaceCard();
      toast('乘车人人脸已采集');
      setTimeout(function () { $('faceMask').hidden = true; }, 700);
      return;
    }
    var enrolled = !!(state.user && state.user.faceEnrolled);
    setFaceResult(enrolled ? '正在比对已录入的人脸…' : '正在保存人脸特征…');
    var path = enrolled ? '/public/face/verify' : '/public/face/enroll';
    api(path, { method: 'POST', body: { descriptor: descriptor } })
      .then(function (result) {
        state.faceDescriptor = descriptor;
        state.faceFaceToken = result.faceToken || '';
        state.faceVerified = true;
        state.faceBusy = false;
        if (!enrolled && state.user) {
          state.user.faceEnrolled = true;
          saveUser(state.token, state.user);
        }
        if ($('faceLive')) $('faceLive').classList.remove('is-live');
        if ($('faceVideo')) $('faceVideo').srcObject = null;
        if (state.faceStream) {
          state.faceStream.getTracks().forEach(function (track) { track.stop(); });
          state.faceStream = null;
        }
        setFaceResult(enrolled ? '人脸核验通过' : '人脸录入成功，可以提交订单', 'ok');
        $('faceStartBtn').disabled = false;
        updateBookingFaceCard();
        toast(enrolled ? '人脸核验通过' : '人脸录入成功');
        setTimeout(function () { $('faceMask').hidden = true; }, 700);
      })
      .catch(function (err) {
        state.faceBusy = false;
        setFaceResult(err.message || '人脸识别失败，请重试', 'error');
        if (state.faceStream) {
          state.faceStream.getTracks().forEach(function (track) { track.stop(); });
          state.faceStream = null;
        }
        $('faceVideo').srcObject = null;
        $('faceLive').classList.remove('is-live');
        $('faceStartBtn').disabled = false;
      });
  }

  function departureInfo(train) {
    if (!train || !train.departTime) return null;
    var date = train.date || state.date;
    if (!date) return null;
    var at = new Date(date + 'T' + train.departTime + ':00');
    if (isNaN(at.getTime())) return null;
    var minutes = Math.round((at.getTime() - Date.now()) / 60000);
    return { at: at, minutes: minutes, time: train.departTime, date: date };
  }

  function renderDepartureWarning(train) {
    var box = $('departureWarning');
    if (!box) return;
    var info = departureInfo(train);
    if (!info || info.minutes > 60) {
      box.hidden = true;
      box.className = 'departure-warning';
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.className = 'departure-warning' + (info.minutes <= 0 ? ' is-expired' : ' is-urgent');
    if (info.minutes <= 0) {
      box.textContent = '该车次已于 ' + formatDate(info.date) + ' ' + info.time +
        ' 发车，现在购票将无法乘车，请谨慎购买。';
      return;
    }
    box.textContent = '距离开车仅剩 ' + info.minutes + ' 分钟（' + formatDate(info.date) + ' ' + info.time +
      ' 开），请确认有充足时间完成人脸核验、检票和进站上车。';
  }

  function openBooking(trainId, seatType) {
    requireLogin(function () {
      ensureCaptcha(function () {
        api(
          '/public/search?fromCityId=' + encodeURIComponent(state.fromCityId) +
            '&toCityId=' + encodeURIComponent(state.toCityId) +
            '&date=' + encodeURIComponent(state.date)
        )
          .then(function (data) {
            var train = (data.trains || []).find(function (t) { return t.id === trainId; });
            if (!train) return toast('车次信息已失效，请重新查询');
            var seat = train.seats.find(function (s) { return s.type === seatType; });
            if (!seat) return toast('席别不存在');
            state.train = train;
            state.seat = seat;
            state.selectedIds = [];
            $('bookTrainInfo').innerHTML =
              '<div><div class="bt-no">' + escapeHtml(train.trainNo) + '</div>' +
              '<div class="bt-seat">' + formatDate(train.date) + ' · ' + seat.remaining + ' 张余票</div></div>' +
              '<div class="bt-route">' + escapeHtml(train.departTime) + ' ' + escapeHtml(train.fromStationName) +
              ' → ' + escapeHtml(train.arriveTime) + ' ' + escapeHtml(train.toStationName) + '</div>' +
              '<div class="bt-seat">' + escapeHtml(seat.type) + ' · <b>' + money(seat.price) + '</b>/成人</div>' +
              '<div class="bt-extra">检票口 ' + escapeHtml(train.gate || '-') + ' · 站台 ' +
              escapeHtml(train.platform || '-') + ' · 地标 ' + escapeHtml(train.landmarkColor || '-') + '</div>';
            var first = state.savedPassengers[0];
            $('contactPhone').value = state.user ? state.user.phone : first ? first.phone : '';
            resetFaceCheck();
            renderBookingPassengers();
            renderDepartureWarning(train);
            $('bookMask').hidden = false;
          })
          .catch(function (err) {
            toast(err.message);
          });
      });
    });
  }

  function renderBookingPassengers() {
    var box = $('bookingPassengers');
    var hint = $('bookingPassengerEmpty');
    if (!state.savedPassengers.length) {
      box.innerHTML = '';
      hint.hidden = false;
      updateTotal();
      return;
    }
    hint.hidden = true;
    box.innerHTML = state.savedPassengers
      .map(function (p) {
        var checked = state.selectedIds.indexOf(p.id) !== -1;
        var price = passengerPriceOf(p);
        var noFace = !p.faceEnrolled;
        return (
          '<label class="booking-passenger' + (checked ? ' checked' : '') + (noFace ? ' no-face' : '') + '">' +
          '<input type="checkbox" data-pid="' + escapeHtml(p.id) + '"' + (checked ? ' checked' : '') + (noFace ? ' disabled' : '') + ' />' +
          '<span class="bp-name">' + escapeHtml(p.name) +
          (p.type === '儿童' ? ' <span class="type-tag child">儿童</span>' : '') +
          (noFace ? ' <span class="face-missing">未录入人脸</span>' : '') + '</span>' +
          '<span class="bp-id">' + escapeHtml(p.idType || '身份证') + ' ' + escapeHtml(p.idNo) + '</span>' +
          '<span class="bp-price">' + money(price) + '</span>' +
          '</label>'
        );
      })
      .join('');
    Array.prototype.forEach.call(box.querySelectorAll('input[data-pid]'), function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-pid');
        if (cb.checked) {
          if (state.selectedIds.length >= state.settings.maxPassengersPerOrder) {
            cb.checked = false;
            return toast('单笔订单最多选择 ' + state.settings.maxPassengersPerOrder + ' 位乘车人');
          }
          state.selectedIds.push(id);
        } else {
          state.selectedIds = state.selectedIds.filter(function (x) { return x !== id; });
        }
        renderBookingPassengers();
      });
    });
    updateTotal();
  }

  function selectedPassengers() {
    return state.selectedIds
      .map(function (id) { return state.savedPassengers.find(function (p) { return p.id === id; }); })
      .filter(Boolean);
  }

  function updateTotal() {
    var total = selectedPassengers().reduce(function (sum, p) { return sum + passengerPriceOf(p); }, 0);
    $('totalPrice').textContent = money(total);
  }

  function submitOrder() {
    var phone = $('contactPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return toast('请输入正确的 11 位手机号');
    var selected = selectedPassengers();
    if (!selected.length) return toast('请至少选择一位乘车人');
    if (!state.user) {
      state.afterLogin = submitOrder;
      return openAuth('login');
    }
    if (selected.some(function (p) { return !p.faceEnrolled; })) {
      // 人脸模块已下线：购票与检票均不再校验人脸
    }
    var dep = departureInfo(state.train);
    if (dep && dep.minutes <= 60) {
      var confirmText = dep.minutes > 0
        ? '距离开车仅剩 ' + dep.minutes + ' 分钟（' + dep.date + ' ' + dep.time +
          ' 开）。请确保有充足时间完成检票和进站上车。是否继续购票？'
        : '该车次已于 ' + dep.date + ' ' + dep.time + ' 发车，现在购票将无法乘车。是否仍要提交订单？';
      if (!window.confirm(confirmText)) return;
    }
    var passengers = selected.map(function (p) {
      return { name: p.name, idType: p.idType, idNo: p.idNo, phone: p.phone || phone, type: p.type || '成人' };
    });
    var btn = $('submitOrderBtn');
    btn.disabled = true;
    btn.textContent = '提交中…';
    api('/public/orders', {
      method: 'POST',
      body: {
        trainId: state.train.id,
        date: state.date,
        seatType: state.seat.type,
        contactPhone: phone,
        passengers: passengers,
      },
    })
      .then(function (order) {
        state.faceVerified = false;
        state.faceFaceToken = '';
        $('bookMask').hidden = true;
        showPayment(order);
        if (state.view === 'orders') loadOrders();
      })
      .catch(function (err) {
        toast(err.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = '提交订单';
      });
  }

  function qrUrl(orderNo) {
    return '/api/qrcode/ticket?orderNo=' + encodeURIComponent(orderNo) + '&_=' + Date.now();
  }

  function startQrRefresh() {
    if (state.qrTimer) return;
    state.qrTimer = window.setInterval(function () {
      var imgs = document.querySelectorAll('img[data-order]');
      Array.prototype.forEach.call(imgs, function (img) {
        var orderNo = img.getAttribute('data-order');
        if (orderNo && img.offsetParent !== null) img.src = qrUrl(orderNo);
      });
    }, 30000);
  }

  function fillSuccessDetail(order) {
    var names = (order.passengers || []).map(function (p) {
      return p.name + (p.seatNo ? '（' + p.seatNo + '）' : '');
    }).join('、');
    var route = order.route || {};
    $('successDetail').innerHTML =
      '<div><span>订单号</span><strong id="successOrderNo">' + escapeHtml(order.orderNo) + '</strong></div>' +
      '<div><span>车次</span><strong>' + escapeHtml(order.trainNo) + '　' + escapeHtml(route.fromStationName || '') +
      ' → ' + escapeHtml(route.toStationName || '') + '</strong></div>' +
      '<div><span>乘车日期</span><strong>' + escapeHtml(order.date) + '　' + escapeHtml(route.departTime || '') + ' 开</strong></div>' +
      '<div><span>检票口 / 站台</span><strong>' + escapeHtml(route.gate || '-') + ' / ' + escapeHtml(route.platform || '-') + '</strong></div>' +
      '<div><span>席别</span><strong>' + escapeHtml(order.seatType) + '</strong></div>' +
      '<div><span>乘客</span><strong>' + escapeHtml(names) + '</strong></div>' +
      '<div><span>金额</span><strong>' + money(order.totalPrice) + '</strong></div>' +
      (order.paymentDeadline ? '<div><span>支付时限</span><strong>' + escapeHtml(formatDateTime(order.paymentDeadline)) + '</strong></div>' : '');
  }

  function stopPaymentCountdown() {
    if (state.paymentTimer) {
      window.clearInterval(state.paymentTimer);
      state.paymentTimer = 0;
    }
  }

  function startPaymentCountdown(order) {
    stopPaymentCountdown();
    var deadline = Date.parse(order.paymentDeadline || '');
    if (!deadline) {
      $('successSub').textContent = '请在规定时间内完成支付，超时订单将自动取消并释放座位';
      return;
    }
    function tick() {
      var left = deadline - Date.now();
      if (left <= 0) {
        stopPaymentCountdown();
        $('successSub').textContent = '支付时间已到，订单已取消，座位已释放';
        $('successPayBtn').disabled = true;
        return;
      }
      var total = Math.ceil(left / 1000);
      $('successSub').textContent = '剩余 ' + Math.floor(total / 60) + ':' + pad(total % 60) + '，超时订单将自动取消并释放座位';
    }
    tick();
    state.paymentTimer = window.setInterval(tick, 1000);
  }

  function showPayment(order) {
    state.pendingOrder = order;
    fillSuccessDetail(order);
    $('successMask').hidden = false;
    $('successIcon').textContent = '¥';
    $('successIcon').className = 'success-icon pending';
    $('successTitle').textContent = '订单待支付';
    startPaymentCountdown(order);
    $('successQrWrap').hidden = true;
    $('successPayBtn').hidden = false;
    $('successPayBtn').textContent = '游戏内支付 ' + money(order.totalPrice);
    $('successPayBtn').disabled = false;
    $('successCloseBtn').textContent = '稍后支付';
    $('successSub').textContent = '请在游戏内聊天栏执行 /railway pay ' + order.orderNo + ' 用绿宝石完成支付';
  }

  function showSuccess(order) {
    stopPaymentCountdown();
    state.pendingOrder = null;
    fillSuccessDetail(order);
    $('successMask').hidden = false;
    $('successIcon').textContent = '✓';
    $('successIcon').className = 'success-icon';
    $('successTitle').textContent = '购票成功';
    $('successSub').textContent = '请凭身份证件于发车前到站乘车';
    $('successQr').src = qrUrl(order.orderNo);
    $('successQr').setAttribute('data-order', order.orderNo);
    $('successQrWrap').hidden = false;
    $('successPayBtn').hidden = true;
    $('successCloseBtn').textContent = '完成';
    startQrRefresh();
  }

  function payCurrentOrder() {
    var order = state.pendingOrder;
    if (!order) return;
    var cmd = '/railway pay ' + order.orderNo;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).catch(function () {});
    }
    toast('请在游戏内执行：' + cmd + '（绿宝石支付）');
    var btn = $('successPayBtn');
    btn.textContent = '复制指令';
    window.setTimeout(function () {
      btn.textContent = '游戏内支付 ' + money(order.totalPrice);
    }, 4000);
    // 轮询订单状态，游戏内支付成功后自动显示取票二维码
    if (!state.railwayPollTimer) {
      state.railwayPollTimer = window.setInterval(function () {
        if (!state.pendingOrder) {
          window.clearInterval(state.railwayPollTimer);
          state.railwayPollTimer = 0;
          return;
        }
        api('/public/orders/' + encodeURIComponent(state.pendingOrder.orderNo))
          .then(function (latest) {
            if (latest && latest.status === 'paid') {
              window.clearInterval(state.railwayPollTimer);
              state.railwayPollTimer = 0;
              showSuccess(latest);
              toast('游戏内支付成功，车票已生效');
              if (state.user) loadOrders();
            }
          })
          .catch(function () {});
      }, 5000);
    }
  }

  /* ---------------- 订单 ---------------- */
  function loadOrders() {
    if (!state.user) return;
    var list = $('orderList');
    var empty = $('orderEmpty');
    list.innerHTML = '<div class="empty" style="padding:26px 16px">正在查询…</div>';
    empty.hidden = true;
    api('/public/orders')
      .then(function (rows) {
        state.orders = rows || [];
        renderOrders(state.orders);
      })
      .catch(function (err) {
        list.innerHTML = '';
        empty.hidden = false;
        toast(err.message);
      });
  }

  function orderCard(order) {
    var route = order.route || {};
    var names = (order.passengers || []).map(function (p) { return p.name + (p.type === '儿童' ? '(儿童)' : ''); }).join('、');
    var statusText = STATUS_TEXT[order.status] || order.status;
    var seats = (order.passengers || []).length;
    var paid = order.status === 'paid';
    var pending = order.status === 'pending';
    var canRefund = paid && state.settings.refundEnabled !== false && !order.checkedIn;
    var canChange = paid && !order.checkedIn;
    return (
      '<div class="order-card">' +
      '<div class="order-top"><div class="order-no">订单号 <b>' + escapeHtml(order.orderNo) + '</b>' +
      (order.source === 'agent' ? ' <span class="type-tag">代购</span>' : '') + '</div>' +
      '<span class="status ' + escapeHtml(order.status) + '">' + escapeHtml(statusText) + '</span></div>' +
      '<div class="order-main">' +
      '<span class="order-train">' + escapeHtml(order.trainNo) + '</span>' +
      '<span class="order-route">' + escapeHtml(route.fromStationName || '') + ' → ' + escapeHtml(route.toStationName || '') + '</span>' +
      '<span class="order-meta">' + escapeHtml(order.date) + '　' + escapeHtml(route.departTime || '') + ' 开</span>' +
      '<span class="order-meta">' + escapeHtml(order.seatType) + ' × ' + seats + '</span>' +
      (route.gate ? '<span class="order-meta">检票口 ' + escapeHtml(route.gate) + ' · 站台 ' + escapeHtml(route.platform || '-') + '</span>' : '') +
      (order.checkedIn ? '<span class="status paid">已检票</span>' : '') +
      '</div>' +
      '<div class="order-meta">乘客：' + escapeHtml(names) + '　联系电话：' + escapeHtml(order.contactPhone) + '</div>' +
      '<div class="order-foot">' +
      '<div class="order-price">' + (pending ? '应付 ' : '实付 ') + '<strong>' + money(order.totalPrice) + '</strong>' +
      (order.refundFee ? '<span class="muted">　退票手续费 ' + money(order.refundFee) + '，实退 ' + money(order.refundAmount) + '</span>' : '') + '</div>' +
      '<div class="order-actions">' +
      '<button type="button" class="btn-ghost btn-small" data-detail="' + escapeHtml(order.orderNo) + '">详情</button>' +
      (pending ? '<button type="button" class="btn-primary btn-small" data-pay="' + escapeHtml(order.orderNo) + '">支付</button>' : '') +
      (pending ? '<button type="button" class="btn-ghost btn-small danger" data-cancel-pending="' + escapeHtml(order.orderNo) + '">取消</button>' : '') +
      (paid ? '<button type="button" class="btn-ghost btn-small" data-invoice="' + escapeHtml(order.orderNo) + '">发票</button>' : '') +
      (canChange ? '<button type="button" class="btn-ghost btn-small" data-change="' + escapeHtml(order.orderNo) + '">改签</button>' : '') +
      (canRefund ? '<button type="button" class="btn-ghost btn-small danger" data-refund="' + escapeHtml(order.orderNo) + '">退票</button>' : '') +
      '</div></div></div>'
    );
  }

  function renderOrders(rows) {
    var list = $('orderList');
    var empty = $('orderEmpty');
    if (!rows.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = rows.map(orderCard).join('');
    bindOrderActions(list);
  }

  function bindOrderActions(container) {
    Array.prototype.forEach.call(container.querySelectorAll('[data-detail]'), function (btn) {
      btn.addEventListener('click', function () { openDetail(btn.getAttribute('data-detail')); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-refund]'), function (btn) {
      btn.addEventListener('click', function () { refundOrder(btn.getAttribute('data-refund')); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-pay]'), function (btn) {
      btn.addEventListener('click', function () {
        var order = findOrder(btn.getAttribute('data-pay'));
        if (order) showPayment(order);
      });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-cancel-pending]'), function (btn) {
      btn.addEventListener('click', function () { cancelPending(btn.getAttribute('data-cancel-pending')); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-change]'), function (btn) {
      btn.addEventListener('click', function () { openChange(btn.getAttribute('data-change')); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-invoice]'), function (btn) {
      btn.addEventListener('click', function () { downloadInvoice(btn.getAttribute('data-invoice')); });
    });
  }

  function findOrder(orderNo) {
    return state.orders.find(function (o) { return o.orderNo === orderNo; });
  }

  function openDetail(orderNo) {
    var order = findOrder(orderNo);
    if (!order) return toast('订单不存在，请刷新');
    state.detailOrder = order;
    var route = order.route || {};
    var passengers = order.passengers || [];
    $('detailBody').innerHTML =
      '<div class="detail-head">' +
      '<div><div class="detail-order">' + escapeHtml(order.orderNo) + '</div>' +
      '<div class="muted">' + escapeHtml(formatDateTime(order.createdAt)) + ' 下单 · 来源 ' +
      (order.source === 'agent' ? '后台代购' : '网页购票') + '</div></div>' +
      '<span class="status ' + escapeHtml(order.status) + '">' + (STATUS_TEXT[order.status] || order.status) + '</span></div>' +
      (route.statusText
        ? '<div class="runtime-tip ' + escapeHtml(route.status) + '"><b>' + escapeHtml(route.statusText) + '</b>' +
          (route.runtimeNote ? ' · ' + escapeHtml(route.runtimeNote) : '') + '</div>'
        : '') +
      '<div class="boarding-tip">' +
      '<div class="bt-gate">请前往 <b>' + escapeHtml(route.gate || '车站检票口') + '</b> 检票口</div>' +
      '<div class="bt-meta">站台 <b>' + escapeHtml(route.platform || '-') + '</b>' +
      (route.landmarkColor ? ' · 跟随 <span class="bt-dot" style="background:' + landmarkColorHex(route.landmarkColor) + '"></span><b>' + escapeHtml(route.landmarkColor) + '</b>地标' : '') +
      '</div>' +
      '<div class="bt-sub">开车前 ' + escapeHtml(state.settings.checkinMinutes || 30) + ' 分钟开始检票，请提前到达。</div>' +
      '</div>' +
      '<div class="detail-grid">' +
      '<div><span>车次</span><strong>' + escapeHtml(order.trainNo) + '</strong></div>' +
      '<div><span>行程</span><strong>' + escapeHtml(route.fromStationName || '') + ' → ' + escapeHtml(route.toStationName || '') + '</strong></div>' +
      '<div><span>乘车日期</span><strong>' + escapeHtml(order.date) + ' ' + escapeHtml(route.departTime || '') + ' 开</strong></div>' +
      '<div><span>检票口</span><strong>' + escapeHtml(route.gate || '-') + '</strong></div>' +
      '<div><span>站台</span><strong>' + escapeHtml(route.platform || '-') + '</strong></div>' +
      '<div><span>地标颜色</span><strong>' + escapeHtml(route.landmarkColor || '-') + '</strong></div>' +
      '<div><span>席别</span><strong>' + escapeHtml(order.seatType) + '</strong></div>' +
      '<div><span>联系电话</span><strong>' + escapeHtml(order.contactPhone) + '</strong></div>' +
      '</div>' +
      '<div class="detail-passengers">' +
      '<h4>乘客信息</h4>' +
      passengers.map(function (p) {
        return '<div class="detail-passenger"><span>' + escapeHtml(p.name) +
          (p.type === '儿童' ? ' <span class="type-tag child">儿童</span>' : '') +
          (p.seatNo ? ' <span class="type-tag">' + escapeHtml(p.seatNo) + '</span>' : '') + '</span>' +
          '<span>' + escapeHtml(p.idType || '身份证') + ' ' + escapeHtml(p.idNo) + '</span>' +
          '<strong>' + money(p.price) + '</strong></div>';
      }).join('') +
      '</div>' +
      '<div class="detail-total">合计 <strong>' + money(order.totalPrice) + '</strong>' +
      (order.refundFee ? '　退票手续费 ' + money(order.refundFee) + '，实退 ' + money(order.refundAmount) : '') +
      (order.changeFee ? '　累计改签手续费 ' + money(order.changeFee) : '') + '</div>' +
      (order.status === 'paid'
        ? '<div class="detail-qr"><img data-order="' + escapeHtml(order.orderNo) + '" src="' + qrUrl(order.orderNo) + '" alt="电子客票二维码" /><span>动态电子客票二维码（每 30 秒刷新，检票口扫码）</span></div>'
        : '') +
      '<div class="detail-actions">' +
      (order.status === 'paid' ? '<button type="button" class="btn-ghost" data-d-invoice="' + escapeHtml(order.orderNo) + '">下载电子发票</button>' : '') +
      '<button type="button" class="btn-primary" type="button" data-close="detailMask">关闭</button>' +
      '</div>';
    $('detailMask').hidden = false;
    startQrRefresh();
    var inv = $('detailBody').querySelector('[data-d-invoice]');
    if (inv) inv.addEventListener('click', function () { downloadInvoice(inv.getAttribute('data-d-invoice')); });
    var closeBtn = $('detailBody').querySelector('[data-close="detailMask"]');
    if (closeBtn) closeBtn.addEventListener('click', function () { $('detailMask').hidden = true; });
  }

  function cancelPending(orderNo) {
    if (!window.confirm('确定取消这笔待支付订单吗？座位将立即释放。')) return;
    api('/public/orders/' + encodeURIComponent(orderNo) + '/cancel', { method: 'POST' })
      .then(function () {
        toast('订单已取消');
        loadOrders();
      })
      .catch(function (err) { toast(err.message); });
  }

  function refundOrder(orderNo) {
    var order = findOrder(orderNo);
    if (!order) return;
    if (!window.confirm('确认退票？将按后台配置的退票手续费规则扣费。')) return;
    api('/public/orders/' + encodeURIComponent(orderNo) + '/cancel', { method: 'POST' })
      .then(function (data) {
        toast('退票成功，扣除手续费 ' + money(data.refundFee) + '，退回 ' + money(data.refundAmount), 4000);
        if (!$('detailMask').hidden) $('detailMask').hidden = true;
        loadOrders();
        if (!$('resultSection').hidden) searchTrains();
      })
      .catch(function (err) { toast(err.message); });
  }

  function openChange(orderNo) {
    var order = findOrder(orderNo);
    if (!order) return;
    state.changeOrder = order;
    $('changeDate').value = order.date;
    $('changeDate').min = new Date().toISOString().slice(0, 10);
    loadChangeTrains(order.date, order.trainId, order.seatType);
    $('changeMask').hidden = false;
  }

  function loadChangeTrains(date, selectedTrainId, selectedSeat) {
    api('/trains?date=' + encodeURIComponent(date))
      .then(function (trains) {
        state.changeTrains = trains || [];
        var select = $('changeTrain');
        select.innerHTML = state.changeTrains
          .map(function (t) {
            return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.trainNo) + '　' +
              escapeHtml(t.fromStationName) + ' → ' + escapeHtml(t.toStationName) + '　' +
              escapeHtml(t.departTime) + ' 开</option>';
          })
          .join('');
        if (selectedTrainId && state.changeTrains.some(function (t) { return t.id === selectedTrainId; })) {
          select.value = selectedTrainId;
        }
        fillChangeSeats(selectedSeat);
      })
      .catch(function (err) { toast(err.message); });
  }

  function fillChangeSeats(selectedSeat) {
    var train = state.changeTrains.find(function (t) { return t.id === $('changeTrain').value; });
    var select = $('changeSeat');
    if (!train) { select.innerHTML = ''; return; }
    select.innerHTML = (train.seats || [])
      .map(function (s) {
        return '<option value="' + escapeHtml(s.type) + '">' + escapeHtml(s.type) + '　' +
          money(s.price) + '　' + (s.remaining > 0 ? '余 ' + s.remaining : '无票') + '</option>';
      })
      .join('');
    if (selectedSeat && (train.seats || []).some(function (s) { return s.type === selectedSeat; })) {
      select.value = selectedSeat;
    }
  }

  function submitChange() {
    var order = state.changeOrder;
    if (!order) return;
    var date = $('changeDate').value;
    var trainId = $('changeTrain').value;
    var seatType = $('changeSeat').value;
    if (!date || !trainId || !seatType) return toast('请选择改签日期、车次和席别');
    $('submitChangeBtn').disabled = true;
    api('/public/orders/' + encodeURIComponent(order.orderNo) + '/change', {
      method: 'POST',
      body: { date: date, trainId: trainId, seatType: seatType },
    })
      .then(function (data) {
        toast(data.message || '改签成功', 4000);
        $('changeMask').hidden = true;
        $('detailMask').hidden = true;
        loadOrders();
        searchTrains();
      })
      .catch(function (err) { toast(err.message); })
      .finally(function () { $('submitChangeBtn').disabled = false; });
  }

  /* ---------------- 电子发票 ---------------- */
  function loadInvoices() {
    if (!state.user) return;
    var list = $('invoiceList');
    var empty = $('invoiceEmpty');
    list.innerHTML = '<div class="empty" style="padding:26px 16px">正在加载…</div>';
    empty.hidden = true;
    api('/public/orders')
      .then(function (rows) {
        state.orders = rows || [];
        renderInvoices(state.orders.filter(function (o) { return o.status === 'paid' || o.invoiceNo; }));
      })
      .catch(function (err) {
        list.innerHTML = '';
        empty.hidden = false;
        toast(err.message);
      });
  }

  function renderInvoices(rows) {
    var list = $('invoiceList');
    var empty = $('invoiceEmpty');
    if (!rows.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = rows
      .map(function (order) {
        var route = order.route || {};
        var invoiceStatus = order.invoiceStatus || (order.invoiceNo ? 'issued' : '');
        var statusText = invoiceStatus === 'redFlushed' ? '已红冲' : invoiceStatus === 'issued' ? '已开具' : '未开票';
        var action = invoiceStatus === 'redFlushed'
          ? '<span class="invoice-status red">已红冲</span>'
          : invoiceStatus === 'issued'
            ? '<button type="button" class="btn-primary btn-small" data-inv="' + escapeHtml(order.orderNo) + '" data-act="download">下载 PDF</button>'
            : '<button type="button" class="btn-primary btn-small" data-inv="' + escapeHtml(order.orderNo) + '" data-act="apply">申请开票</button>';
        return (
          '<div class="invoice-row">' +
          '<div class="invoice-info">' +
          '<div class="invoice-title">' + escapeHtml(order.trainNo) + '　' + escapeHtml(route.fromStationName || '') +
          ' → ' + escapeHtml(route.toStationName || '') +
          '　<span class="invoice-status' + (invoiceStatus === 'redFlushed' ? ' red' : '') + '">' + statusText + '</span></div>' +
          '<div class="muted">订单号 ' + escapeHtml(order.orderNo) + ' · ' + escapeHtml(order.date) + ' · ' +
          escapeHtml(order.seatType) + ' · ' + (order.passengers || []).length + ' 人' +
          (order.invoiceNo ? ' · 发票号 ' + escapeHtml(order.invoiceNo) : '') +
          (invoiceStatus === 'redFlushed' ? ' · 订单已退票' : '') + '</div>' +
          '</div>' +
          '<div class="invoice-amount">' + money(order.totalPrice) + '</div>' +
          action +
          '</div>'
        );
      })
      .join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-inv]'), function (btn) {
      btn.addEventListener('click', function () {
        var orderNo = btn.getAttribute('data-inv');
        if (btn.getAttribute('data-act') === 'apply') applyInvoice(orderNo);
        else downloadInvoicePdf(orderNo);
      });
    });
  }

  function applyInvoice(orderNo) {
    toast('正在申请电子发票…');
    fetch(API_BASE + '/public/orders/' + encodeURIComponent(orderNo) + '/invoice', {
      method: 'POST',
      headers: { 'X-Token': state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '个人' }),
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok || json.code !== 200) throw new Error(json.message || '申请发票失败');
          return json.result;
        });
      })
      .then(function () {
        toast('发票已开具');
        downloadInvoicePdf(orderNo);
        loadInvoices();
      })
      .catch(function (err) { toast(err.message); });
  }

  function downloadInvoicePdf(orderNo) {
    toast('正在生成电子发票…');
    fetch(API_BASE + '/public/orders/' + encodeURIComponent(orderNo) + '/invoice', {
      headers: { 'X-Token': state.token },
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (json) { throw new Error(json.message || '发票生成失败'); });
        }
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '清江铁路电子发票-' + orderNo + '.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
        toast('电子发票已生成');
      })
      .catch(function (err) { toast(err.message); });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $('searchBtn').addEventListener('click', searchTrains);
    $('travelDate').addEventListener('change', function () { state.date = $('travelDate').value; });
    $('swapBtn').addEventListener('click', function () {
      var from = $('fromCity').value;
      $('fromCity').value = $('toCity').value;
      $('toCity').value = from;
    });
    $('trainList').addEventListener('click', function (e) {
      var target = e.target.closest('[data-seat]');
      if (!target || target.disabled) return;
      openBooking(target.getAttribute('data-train'), target.getAttribute('data-seat'));
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        showView(el.getAttribute('data-view'));
      });
    });

    $('userBtn').addEventListener('click', function () {
      if (state.user) { showView('orders'); return; }
      openAuth('login');
    });
    $('logoutBtn').addEventListener('click', function () {
      api('/public/auth/logout', { method: 'POST' }).catch(function () {});
      clearUser();
      toast('已退出登录');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-auth-tab]'), function (btn) {
      btn.addEventListener('click', function () {
        state.authMode = btn.getAttribute('data-auth-tab');
        applyAuthMode();
      });
    });
    $('authSubmitBtn').addEventListener('click', submitAuth);
    $('authPassword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitAuth();
    });

    $('captchaImage').addEventListener('click', function () { loadCaptchaChallenge(); });
    $('captchaRefreshBtn').addEventListener('click', function () {
      if (state.captchaProvider === 'hcaptcha') {
        if (window.hcaptcha && state.hcaptchaWidgetId !== undefined) {
          window.hcaptcha.reset(state.hcaptchaWidgetId);
          $('captchaPrompt').textContent = '请完成下方 hCaptcha 人机验证';
        } else {
          loadCaptchaChallenge();
        }
        return;
      }
      loadCaptchaChallenge();
    });
    $('captchaSubmitBtn').addEventListener('click', verifyCaptcha);
    $('captchaInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') verifyCaptcha();
    });

    $('addPassengerBtn').addEventListener('click', function () { requireLogin(function () { openPassengerModal(null); }); });
    $('managePassengerBtn').addEventListener('click', function () { requireLogin(function () { openPassengerModal(null); }); });
    $('savePassengerBtn').addEventListener('click', savePassenger);
    $('submitOrderBtn').addEventListener('click', submitOrder);
    $('bookingFaceBtn').addEventListener('click', function () { state.faceMode = 'buyer'; openFaceModal(); });
    $('pFaceBtn').addEventListener('click', function () {
      state.faceMode = 'passenger';
      openFaceModal();
    });
    $('faceStartBtn').addEventListener('click', startFaceVerify);

    $('refreshOrdersBtn').addEventListener('click', loadOrders);
    $('refreshInvoicesBtn').addEventListener('click', loadInvoices);
    $('submitChangeBtn').addEventListener('click', submitChange);
    $('changeDate').addEventListener('change', function () {
      loadChangeTrains($('changeDate').value, null, null);
    });
    $('changeTrain').addEventListener('change', function () { fillChangeSeats(null); });

    $('successCloseBtn').addEventListener('click', function () { stopPaymentCountdown(); $('successMask').hidden = true; });
    $('successPayBtn').addEventListener('click', payCurrentOrder);
    $('copyOrderBtn').addEventListener('click', function () {
      var orderNo = ($('successOrderNo') || {}).textContent || '';
      if (!orderNo) return;
      if (navigator.clipboard) navigator.clipboard.writeText(orderNo).then(function () { toast('订单号已复制'); });
      else toast('订单号：' + orderNo);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-close');
        $(id).hidden = true;
        if (id === 'faceMask') stopFaceCamera();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.modal-mask'), function (mask) {
      mask.addEventListener('click', function (e) {
        if (e.target !== mask) return;
        // 登录、注册和验证码弹窗禁止点遮罩关闭，避免框选或误点时被关掉
        if (mask.id === 'authMask' || mask.id === 'captchaMask') return;
        mask.hidden = true;
        if (mask.id === 'faceMask') stopFaceCamera();
      });
    });
  }

  /* ---------------- 初始化 ---------------- */
  function restoreSession() {
    try {
      var saved = JSON.parse(localStorage.getItem(LS_USER) || 'null');
      if (saved && saved.token) {
        state.token = saved.token;
        state.user = saved.user;
        renderUser();
        api('/public/auth/me')
          .then(function (user) { state.user = user; renderUser(); loadPassengers(); })
          .catch(function () { clearUser(); });
      }
      var cap = JSON.parse(localStorage.getItem(LS_CAPTCHA) || 'null');
      if (cap && cap.token && Date.now() - cap.at < 15 * 60 * 1000) state.captchaToken = cap.token;
    } catch (e) {}
  }

  function applySearchQuery() {
    if (!/search=1/.test(window.location.search)) return;
    var params = new URLSearchParams(window.location.search);
    var from = params.get('fromCityId') || '';
    var to = params.get('toCityId') || '';
    var date = params.get('date') || '';
    if (from && state.cities.some(function (c) { return c.id === from; })) $('fromCity').value = from;
    if (to && state.cities.some(function (c) { return c.id === to; })) $('toCity').value = to;
    if (date) {
      $('travelDate').value = date;
      state.date = date;
    }
    state.fromCityId = $('fromCity').value;
    state.toCityId = $('toCity').value;
    if (state.fromCityId && state.toCityId && state.date) {
      window.setTimeout(function () { ensureCaptcha(searchNow); }, 300);
    }
  }

  function syncRuntimeLinks() {
    api('/runtime-config')
      .then(function (data) {
        var urls = (data && data.urls) || {};
        var checkLink = document.querySelector('nav a[href*="localhost:3001"]');
        if (checkLink && urls.checkin) checkLink.href = urls.checkin;
        var adminLink = $('adminLink');
        if (adminLink && urls.admin) adminLink.href = urls.admin;
      })
      .catch(function () { /* 配置接口失败时保留静态链接 */ });
  }

  function init() {
    initDate();
    bindEvents();
    restoreSession();
    syncRuntimeLinks();
    loadSettings();
    loadCities()
      .then(applySearchQuery)
      .catch(function (err) { toast('城市列表加载失败：' + err.message); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
