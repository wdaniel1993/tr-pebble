/**
 * tr_api.js — Trade Republic web protocol client for the PebbleKit JS sandbox.
 *
 * All TR wire logic lives here (endpoints, headers, login state machine,
 * WebSocket client, frame parsing, payload shaping). Nothing else in the app
 * talks to api.traderepublic.com.
 *
 * Flow (mirrors the proven community SDKs — erim32/trade-republic Python,
 * NightOwl07/trade-republic-api TypeScript, pytr/pytr):
 *   login  : POST /api/v2/auth/web/login  {phoneNumber, pin}  -> {processId}
 *   poll   : GET  /api/v2/auth/web/login/processes/{processId} -> {status}
 *            until CONFIRMED/COMPLETED (user confirms the push in the TR app)
 *   session: tr_session + tr_refresh arrive in Set-Cookie headers of the
 *            CONFIRMED poll response (or, if headers are not readable in the
 *            sandbox, in the response body — parsed defensively below).
 *   refresh: GET  /api/v1/auth/web/session with the stored cookies
 *   data   : WebSocket wss://api.traderepublic.com, `connect`/`sub`/`unsub`
 *            text protocol; session passed as `token` inside each sub payload
 *            (cookie-less WS handshake — the design's verified approach).
 *
 * Written in strict ES5; no external dependencies; no WebCrypto.
 *
 * NOTE: exact response shapes of portfolioAggregateHistory /
 * userPortfolioChartModifiedDietz are still being pinned by the hardware spike
 * (tasks 1.3/1.4). The parsers below handle every shape seen in the wild and
 * log raw frames when DEBUG is on, so the spike can capture them verbatim.
 */
(function (global) {
  'use strict';

  var HOST = 'https://api.traderepublic.com';
  var WS_URL = 'wss://api.traderepublic.com';

  // --- endpoints ---------------------------------------------------------
  var LOGIN_PATH = '/api/v2/auth/web/login';
  var LOGIN_PATH_V1 = '/api/v1/auth/web/login';              // fallback (SMS/2FA-code flow)
  var PROCESS_PATH = '/api/v2/auth/web/login/processes/';    // + processId
  var REFRESH_PATH = '/api/v1/auth/web/session';

  // --- header constants (spike task 1.3 will confirm exact values) -------
  // Values proven against the live v2 endpoint by pytr (APP_VERSION 2.2631.13,
  // platform "web-pro") and NightOwl07 (app version 15.65.6, platform "web").
  var USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
  var TR_APP_VERSION = '2.2631.13';
  var TR_PLATFORM = 'web-pro';
  var LOCALE = 'en';

  // --- WebSocket connect config ------------------------------------------
  var WS_CONNECT_VERSION = '31';
  var WS_LOCALE_CONFIG = {
    locale: LOCALE,
    platformId: 'webtrading',
    platformVersion: 'chrome - 94.0.4606',
    clientId: 'app.traderepublic.com',
    clientVersion: '5582'
  };

  var POLL_INTERVAL_MS = 2000;       // push-confirmation poll interval
  var DEFAULT_POLL_TIMEOUT_MS = 120000; // v2 does not always send countdownInSeconds
  var WS_CONNECT_TIMEOUT_MS = 10000;
  var SUB_TIMEOUT_MS = 10000;        // per-subscription response timeout
  var DEBUG = true;                  // log raw frames/responses when true

  function log(level, msg) {
    try {
      if (DEBUG || level === 'error') {
        console.log('[tr_api] ' + level + ': ' + msg);
      }
    } catch (e) { /* console may be absent in some sandbox builds */ }
  }

  // ========================================================================
  // HTTP (XMLHttpRequest)
  // ========================================================================

  /**
   * xhr(method, url, headers, body, cb)
   * cb({ok, status, headers /* raw getAllResponseHeaders() string * /, body, error})
   */
  function xhr(method, url, headers, body, cb) {
    var x;
    try { x = new XMLHttpRequest(); } catch (e) {
      cb({ ok: false, status: 0, headers: '', body: '', error: 'no-xhr' });
      return;
    }
    x.open(method, url);
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) {
        try { x.setRequestHeader(k, headers[k]); } catch (e) { /* some sandboxes block certain headers */ }
      }
    }
    x.onreadystatechange = function () {
      if (x.readyState !== 4) { return; }
      var headersRaw = '';
      try { headersRaw = x.getAllResponseHeaders ? x.getAllResponseHeaders() : ''; } catch (e) { /* ignore */ }
      cb({
        ok: x.status >= 200 && x.status < 300,
        status: x.status,
        headers: headersRaw,
        body: x.responseText !== undefined ? x.responseText : (x.response || '')
      });
    };
    x.onerror = function () { cb({ ok: false, status: 0, headers: '', body: '', error: 'network' }); };
    x.ontimeout = function () { cb({ ok: false, status: 0, headers: '', body: '', error: 'timeout' }); };
    try { x.timeout = 15000; } catch (e) { /* ignore */ }
    x.send(body === null || body === undefined ? null : body);
  }

  function xhrJson(method, url, headers, jsonBody, cb) {
    var h = {};
    for (var k in headers) { if (Object.prototype.hasOwnProperty.call(headers, k)) { h[k] = headers[k]; } }
    h['Content-Type'] = 'application/json';
    h['Accept'] = 'application/json';
    xhr(method, url, h, jsonBody === null ? null : JSON.stringify(jsonBody), function (res) {
      var data = null;
      if (res.body) {
        try { data = JSON.parse(res.body); } catch (e) { /* not JSON */ }
      }
      res.data = data;
      cb(res);
    });
  }

  /**
   * Builds the X-TR-Device-Info header: base64(JSON) describing the device,
   * exactly as the TR web frontend does (pytr documents this set; without it
   * the v2 endpoints answer 400 MISSING_REQUIRED_HEADER).
   */
  function buildDeviceInfo() {
    var nav = (typeof navigator !== 'undefined') ? navigator : {};
    var ua = nav.userAgent || USER_AGENT;
    var chromeMatch = /Chrome\/([\d.]+)/.exec(ua);
    var tzOffset = 0;
    try { tzOffset = new Date().getTimezoneOffset(); } catch (e) { /* ignore */ }
    var cores = 4;
    try { cores = nav.hardwareConcurrency || 4; } catch (e) { /* ignore */ }
    var device = {
      stableDeviceId: global.Storage.getDeviceId(),
      browser: 'Chrome',
      browserVersion: chromeMatch ? chromeMatch[1] : '122.0.0.0',
      os: 'Android',
      osVersion: '10',
      timezone: 'Etc/UTC',
      timezoneOffset: -tzOffset,     // JS counts the offset the other way round
      screen: '240x240x24',
      preferredLanguages: [LOCALE],
      numberOfCores: cores
    };
    var raw = '';
    try { raw = btoa(JSON.stringify(device)); } catch (e) {
      // ES5-safe base64 fallback (btoa exists in PebbleKit JS, keep a guard anyway)
      raw = base64Encode(JSON.stringify(device));
    }
    return raw;
  }

  function base64Encode(str) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '', i = 0;
    while (i < str.length) {
      var c1 = str.charCodeAt(i++) & 0xff;
      var c2 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;
      var c3 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;
      var e1 = c1 >> 2;
      var e2 = ((c1 & 3) << 4) | (c2 >> 4);
      var e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
      var e4 = isNaN(c3) ? 64 : (c3 & 63);
      out += chars.charAt(e1) + chars.charAt(e2) + (e3 === 64 ? '=' : chars.charAt(e3)) + (e4 === 64 ? '=' : chars.charAt(e4));
    }
    return out;
  }

  // ========================================================================
  // Session extraction
  // ========================================================================

  /** Parse tr_session / tr_refresh out of a Set-Cookie header block. */
  function parseCookies(headersRaw) {
    var cookies = {};
    var lines = String(headersRaw || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var idx = line.indexOf(':');
      if (idx < 0) { continue; }
      var name = line.slice(0, idx).trim().toLowerCase();
      var value = line.slice(idx + 1).trim();
      if (name === 'set-cookie') {
        var parts = value.split(';');
        var kv = parts[0].split('=');
        if (kv.length === 2) { cookies[kv[0].trim()] = kv[1].trim(); }
      }
    }
    return cookies;
  }

  /** Best-effort session capture from the CONFIRMED login response. */
  function extractSession(res) {
    var session = null;
    var refresh = null;
    var cookies = parseCookies(res.headers);
    if (cookies.tr_session) {
      session = cookies.tr_session;
      refresh = cookies.tr_refresh || null;
    }
    // Fallback: token may appear in the response body
    if (!session && res.data && typeof res.data === 'object') {
      session = res.data.tr_session || res.data.sessionToken || res.data.session || null;
      refresh = res.data.tr_refresh || res.data.refreshToken || null;
    }
    return session ? { tr_session: session, tr_refresh: refresh || '' } : null;
  }

  // ========================================================================
  // Login state machine (v2 push-confirmation, v1 fallback)
  // ========================================================================

  function loginHeaders(extra) {
    var h = {
      'User-Agent': USER_AGENT,
      'X-TR-Device-Info': buildDeviceInfo(),
      'X-TR-App-Version': TR_APP_VERSION,
      'X-Tr-Platform': TR_PLATFORM,
      'Accept-Language': LOCALE
    };
    for (var k in (extra || {})) { if (Object.prototype.hasOwnProperty.call(extra, k)) { h[k] = extra[k]; } }
    return h;
  }

  /**
   * TRApi.login(phone, pin, hooks)
   *   hooks.onStatus('pending'|'confirmed'|'expired'|'rejected'|'login-error'|'session-captured', info)
   *   hooks.onSuccess(session)
   *   hooks.onError({code, message})
   * Returns { cancel: fn }.
   */
  function login(phone, pin, hooks) {
    var cancelled = false;
    var timer = null;

    function cleanup() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    function fail(code, message) {
      cleanup();
      if (cancelled) { return; }
      log('error', 'login failed: ' + code + ' — ' + message);
      if (hooks.onError) { hooks.onError({ code: code, message: message }); }
    }

    // --- step 1: initiate login (v2) -------------------------------------
    function initiateV2() {
      xhrJson('POST', HOST + LOGIN_PATH, loginHeaders(), { phoneNumber: phone, pin: pin }, function (res) {
        if (cancelled) { return; }
        log('debug', 'login POST ' + LOGIN_PATH + ' -> HTTP ' + res.status + ' body: ' + res.body);
        if (!res.ok || !res.data || !res.data.processId) {
          var msg = 'Login initiation rejected (HTTP ' + res.status + ')';
          if (res.data && res.data.errors && res.data.errors[0]) {
            msg = 'Login initiation rejected: ' + (res.data.errors[0].errorCode || res.data.errors[0].message || res.data.errors[0]);
          }
          // 404 / MISSING_REQUIRED_HEADER on v2 -> try v1 fallback once
          if (res.status === 404 || res.status === 405 || (res.data && /MISSING_REQUIRED_HEADER/i.test(JSON.stringify(res.data)))) {
            initiateV1();
          } else {
            fail('login-rejected', msg);
          }
          return;
        }
        startPolling(res.data.processId, res.data.countdownInSeconds || 120);
      });
    }

    // --- v1 fallback: POST /api/v1/auth/web/login (SMS/2FA-code flow) ----
    function initiateV1() {
      xhrJson('POST', HOST + LOGIN_PATH_V1, { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        { phoneNumber: phone, pin: pin }, function (res) {
          if (cancelled) { return; }
          if (!res.ok || !res.data || !res.data.processId) {
            fail('login-rejected', 'v1 login fallback also failed (HTTP ' + res.status + ')');
            return;
          }
          // v1 requires a 2FA code which cannot be typed on the watch; the
          // process id lets the user complete it from the config page if needed.
          if (hooks.onStatus) { hooks.onStatus('v1-needs-code', { processId: res.data.processId }); }
          fail('v1-needs-code', 'This account needs the legacy code flow; complete login from the phone app.');
        });
    }

    // --- step 2: poll process status until CONFIRMED ----------------------
    function startPolling(processId, countdownSeconds) {
      var timeoutMs = (countdownSeconds > 0 ? countdownSeconds : DEFAULT_POLL_TIMEOUT_MS / 1000) * 1000;
      var startedAt = Date.now();

      if (hooks.onStatus) { hooks.onStatus('pending', { processId: processId }); }

      function poll() {
        if (cancelled) { return; }
        if (Date.now() - startedAt > timeoutMs) {
          fail('timeout', 'Login not confirmed within ' + Math.round(timeoutMs / 1000) + 's.');
          return;
        }
        xhrJson('GET', HOST + PROCESS_PATH + processId, loginHeaders(), null, function (res) {
          if (cancelled) { return; }
          if (!res.ok || !res.data) {
            // transient poll errors: keep polling (the phone may be mid-handshake)
            timer = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }
          var status = res.data.status;
          if (status === 'CONFIRMED' || status === 'COMPLETED') {
            var session = extractSession(res);
            if (!session) {
              fail('session-capture', 'Login confirmed but session token could not be captured from the response.');
              return;
            }
            if (hooks.onStatus) { hooks.onStatus('confirmed', {}); }
            cleanup();
            if (hooks.onSuccess) { hooks.onSuccess(session); }
          } else if (status === 'PENDING') {
            timer = setTimeout(poll, POLL_INTERVAL_MS);
          } else {
            fail('rejected', 'Login process ended with status "' + status + '". Please try again.');
          }
        });
      }
      poll();
    }

    initiateV2();
    return {
      cancel: function () {
        cancelled = true;
        cleanup();
      }
    };
  }

  /**
   * TRApi.refreshSession(session, hooks)
   * GET /api/v1/auth/web/session with the stored cookies -> new cookies.
   * hooks.onSuccess(newSession) / hooks.onError(err)
   */
  function refreshSession(session, hooks) {
    var cookieHeader = 'tr_session=' + session.tr_session;
    if (session.tr_refresh) { cookieHeader += '; tr_refresh=' + session.tr_refresh; }
    xhrJson('GET', HOST + REFRESH_PATH, {
      'User-Agent': USER_AGENT,
      'Cookie': cookieHeader,
      'Accept': 'application/json'
    }, null, function (res) {
      if (!res.ok) {
        if (hooks.onError) { hooks.onError({ code: 'refresh-failed', message: 'Session refresh failed (HTTP ' + res.status + ')' }); }
        return;
      }
      var cookies = parseCookies(res.headers);
      var sessionNew = null;
      var refreshNew = null;
      if (cookies.tr_session) {
        sessionNew = cookies.tr_session;
        refreshNew = cookies.tr_refresh || session.tr_refresh || '';
      } else if (res.data) {
        sessionNew = res.data.tr_session || res.data.sessionToken || null;
        refreshNew = res.data.tr_refresh || res.data.refreshToken || session.tr_refresh || '';
      }
      if (!sessionNew) {
        if (hooks.onError) { hooks.onError({ code: 'refresh-failed', message: 'Refresh response contained no session token.' }); }
        return;
      }
      if (hooks.onSuccess) { hooks.onSuccess({ tr_session: sessionNew, tr_refresh: refreshNew }); }
    });
  }

  // ========================================================================
  // WebSocket client (connect/sub/unsub, JSON frames, delta handling)
  // ========================================================================

  var wsState = {
    socket: null,
    nextId: 1,
    pending: {},          // subId -> { payload, callback, timer }
    previous: {},         // subId -> last full payload string (for delta frames)
    connectHooks: null,   // {onReady, onError} for the current connect attempt
    retried: false        // retry-once-on-drop flag
  };

  function wsClose() {
    var ws = wsState.socket;
    if (ws) {
      try { ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); } catch (e) { /* ignore */ }
    }
    wsState.socket = null;
    // fail any pending subscriptions
    for (var id in wsState.pending) {
      if (Object.prototype.hasOwnProperty.call(wsState.pending, id)) {
        var p = wsState.pending[id];
        if (p.timer) { clearTimeout(p.timer); }
        if (p.callback) { p.callback(null, { code: 'ws-closed', message: 'WebSocket closed before response.' }); }
      }
    }
    wsState.pending = {};
    wsState.previous = {};
  }

  /** Connect to wss://api.traderepublic.com and send the `connect` frame. */
  function wsConnect(hooks) {
    wsState.connectHooks = hooks;
    var ws;
    try { ws = new WebSocket(WS_URL); } catch (e) {
      if (hooks.onError) { hooks.onError({ code: 'ws-unsupported', message: 'WebSocket unavailable in this sandbox.' }); }
      return;
    }
    wsState.socket = ws;

    var connectTimer = setTimeout(function () {
      wsClose();
      if (hooks.onError) { hooks.onError({ code: 'ws-timeout', message: 'WebSocket connection timed out.' }); }
    }, WS_CONNECT_TIMEOUT_MS);

    ws.onopen = function () {
      try { ws.send('connect ' + WS_CONNECT_VERSION + ' ' + JSON.stringify(WS_LOCALE_CONFIG)); } catch (e) { /* ignore */ }
    };
    ws.onmessage = function (evt) {
      var text = evt && evt.data !== undefined ? String(evt.data) : '';
      if (/^connected\b/.test(text)) {
        log('debug', 'WS connect ack: ' + text.slice(0, 120));
        clearTimeout(connectTimer);
        if (wsState.connectHooks) {
          var ready = wsState.connectHooks.onReady;
          wsState.connectHooks = null;
          if (ready) { ready(); }
        }
        return;
      }
      handleFrame(text);
    };
    ws.onerror = function () {
      clearTimeout(connectTimer);
      if (wsState.connectHooks) {
        var err = wsState.connectHooks.onError;
        wsState.connectHooks = null;
        if (err) { err({ code: 'ws-error', message: 'WebSocket error.' }); }
      }
    };
    ws.onclose = function () {
      clearTimeout(connectTimer);
      wsState.socket = null;
      var connectHooks = wsState.connectHooks;
      wsState.connectHooks = null;
      if (connectHooks) {
        if (connectHooks.onError) { connectHooks.onError({ code: 'ws-closed', message: 'WebSocket closed before connect.' }); }
        return;
      }
      // connection dropped mid-session: fail pending subs, retry once
      for (var id in wsState.pending) {
        if (Object.prototype.hasOwnProperty.call(wsState.pending, id)) {
          var p = wsState.pending[id];
          if (p.timer) { clearTimeout(p.timer); }
          if (p.callback) { p.callback(null, { code: 'ws-dropped', message: 'WebSocket dropped.' }); }
        }
      }
      wsState.pending = {};
      wsState.previous = {};
    };
  }

  /** Apply a TS-style delta frame to the previous full payload. */
  function applyDelta(previous, delta) {
    var out = [];
    var i = 0;
    var ops = String(delta).split('\t');
    for (var n = 0; n < ops.length; n++) {
      var op = ops[n];
      if (!op) { continue; }
      var sign = op.charAt(0);
      var rest = op.slice(1);
      if (sign === '=') {
        var len = parseInt(rest, 10);
        if (!isNaN(len)) { out.push(previous.slice(i, i + len)); i += len; }
      } else if (sign === '-') {
        var skip = parseInt(rest, 10);
        if (!isNaN(skip)) { i += skip; }
      } else if (sign === '+') {
        var chunk = rest;
        if (chunk.indexOf('%') !== -1) {
          try { chunk = decodeURIComponent(chunk); } catch (e) { /* keep raw */ }
        }
        out.push(chunk);
      }
    }
    return out.join('');
  }

  /** Parse "N A {json}" / "N D {delta}" / "N C" / "N E {json}" frames. */
  function parseFrame(text) {
    var m = /^(\d+)\s+([A-Z])\s?([\s\S]*)$/.exec(text);
    if (!m) { return null; }
    return { id: parseInt(m[1], 10), code: m[2], payload: m[3] || '' };
  }

  function handleFrame(text) {
    if (/^echo\b/.test(text)) { return; }
    if (/^connected\b/.test(text)) { return; }
    var frame = parseFrame(text);
    if (!frame) {
      log('warn', 'unparsed frame: ' + text.slice(0, 160));
      return;
    }
    log('debug', 'frame ' + frame.id + ' ' + frame.code + ' ' + frame.payload.slice(0, 160));
    var p = wsState.pending[frame.id];
    if (!p) { return; } // late/duplicate frame for an unsubscribed id

    var jsonStr = null;
    if (frame.code === 'A') {
      wsState.previous[frame.id] = frame.payload;
      jsonStr = frame.payload;
    } else if (frame.code === 'D') {
      var prev = wsState.previous[frame.id] || '';
      jsonStr = applyDelta(prev, frame.payload);
      wsState.previous[frame.id] = jsonStr;
    } else if (frame.code === 'C') {
      wsState.previous[frame.id] = '';
      return; // stream cleared; nothing to deliver yet
    } else if (frame.code === 'E') {
      if (p.timer) { clearTimeout(p.timer); }
      delete wsState.pending[frame.id];
      if (p.callback) { p.callback(null, { code: 'sub-error', message: frame.payload || 'subscription error' }); }
      return;
    } else {
      jsonStr = frame.payload || null;
    }

    if (p.timer) { clearTimeout(p.timer); }
    delete wsState.pending[frame.id];
    var data = null;
    if (jsonStr) {
      try { data = JSON.parse(jsonStr); } catch (e) {
        log('warn', 'JSON parse failed for sub ' + frame.id + ': ' + jsonStr.slice(0, 120));
      }
    }
    if (DEBUG) { log('debug', 'sub ' + frame.id + ' (' + (p.payload ? p.payload.type : '?') + ') -> ' + jsonStr); }
    if (p.callback) { p.callback(data, null); }
  }

  /** sub({type:...}, callback). callback(data, err). Returns subId or -1. */
  function wsSub(payload, callback) {
    if (!wsState.socket) { callback(null, { code: 'ws-not-open', message: 'WebSocket not connected.' }); return -1; }
    var id = wsState.nextId++;
    var p = {
      payload: payload,
      callback: callback,
      timer: setTimeout(function () {
        delete wsState.pending[id];
        log('warn', 'sub ' + id + ' (' + payload.type + ') timed out after ' + SUB_TIMEOUT_MS + 'ms');
        if (callback) { callback(null, { code: 'sub-timeout', message: 'No response for ' + payload.type + '.' }); }
      }, SUB_TIMEOUT_MS)
    };
    wsState.pending[id] = p;
    try {
      wsState.socket.send('sub ' + id + ' ' + JSON.stringify(payload));
    } catch (e) {
      clearTimeout(p.timer);
      delete wsState.pending[id];
      if (callback) { callback(null, { code: 'ws-send', message: 'Failed to send sub.' }); }
      return -1;
    }
    if (DEBUG) { log('debug', 'sub ' + id + ' ' + JSON.stringify({ type: payload.type, range: payload.range })); }
    return id;
  }

  function wsUnsub(id) {
    try {
      if (wsState.socket) { wsState.socket.send('unsub ' + id); }
    } catch (e) { /* ignore */ }
    delete wsState.pending[id];
    delete wsState.previous[id];
  }

  /** Ensure an open WS connection; callbacks.onReady / callbacks.onError. */
  function wsEnsure(onReady, onError) {
    if (wsState.socket) {
      try {
        if (wsState.socket.readyState === 1) { onReady(); return; } // OPEN
      } catch (e) { /* ignore */ }
    }
    wsConnect({
      onReady: onReady,
      onError: onError
    });
  }

  // ========================================================================
  // Data fetch -> compact payload
  // ========================================================================

  var INTERVAL_DEFS = [
    { range: '1d',  name: '1D' },
    { range: '5d',  name: '1W' },
    { range: '1m',  name: '1M' },
    { range: '1y',  name: '1Y' },
    { range: 'max', name: 'MAX' }
  ];

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Extract the last value from a portfolioAggregateHistory response.
   * Defensive: handles {data:[{timestamp,value},...]}, {timestamps:[],values:[]},
   * and flat arrays.
   */
  function historyLastValue(resp) {
    if (!resp) { return null; }
    if (Array.isArray(resp)) {
      // array of {timestamp, value} or plain numbers
      for (var i = resp.length - 1; i >= 0; i--) {
        var item = resp[i];
        if (item && typeof item === 'object') {
          if (item.value !== undefined && item.value !== null) { return Number(item.value); }
          if (item.price !== undefined && item.price !== null) { return Number(item.price); }
          if (item.close !== undefined && item.close !== null) { return Number(item.close); }
        } else if (typeof item === 'number') {
          return item;
        }
      }
      return null;
    }
    if (typeof resp === 'object') {
      if (Array.isArray(resp.data) && resp.data.length) { return historyLastValue(resp.data); }
      if (Array.isArray(resp.values) && resp.values.length) {
        return Number(resp.values[resp.values.length - 1]);
      }
      if (resp.value !== undefined && resp.value !== null) { return Number(resp.value); }
      if (resp.last !== undefined && resp.last !== null) { return Number(resp.last); }
    }
    return null;
  }

  /** First value of a history response (for delta math). */
  function historyFirstValue(resp) {
    if (!resp) { return null; }
    if (Array.isArray(resp)) {
      for (var i = 0; i < resp.length; i++) {
        var item = resp[i];
        if (item && typeof item === 'object') {
          if (item.value !== undefined && item.value !== null) { return Number(item.value); }
          if (item.price !== undefined && item.price !== null) { return Number(item.price); }
        } else if (typeof item === 'number') {
          return item;
        }
      }
      return null;
    }
    if (typeof resp === 'object') {
      if (Array.isArray(resp.data) && resp.data.length) { return historyFirstValue(resp.data); }
      if (Array.isArray(resp.values) && resp.values.length) { return Number(resp.values[0]); }
    }
    return null;
  }

  /**
   * Extract a percentage change from a userPortfolioChartModifiedDietz response.
   * Defensive: handles {data:[...], relativePerformance}, {performance},
   * {yields: [...]}, or {data: {pctChange}}.
   */
  function dietzPct(resp) {
    if (!resp) { return null; }
    function num(v) {
      if (v === undefined || v === null) { return NaN; }
      var n = Number(v);
      return isNaN(n) ? NaN : n;
    }
    var candidates = [];
    if (typeof resp === 'object') {
      if (resp.relativePerformance !== undefined) { candidates.push(num(resp.relativePerformance)); }
      if (resp.performance !== undefined) { candidates.push(num(resp.performance)); }
      if (resp.percentageChange !== undefined) { candidates.push(num(resp.percentageChange)); }
      if (resp.pct !== undefined) { candidates.push(num(resp.pct)); }
      if (resp.yields !== undefined && Array.isArray(resp.yields)) {
        var n = resp.yields[resp.yields.length - 1];
        if (typeof n === 'object' && n) { candidates.push(num(n.value)); } else { candidates.push(num(n)); }
      }
      if (Array.isArray(resp.data) && resp.data.length) {
        var last = resp.data[resp.data.length - 1];
        if (typeof last === 'object' && last) {
          candidates.push(num(last.value));
          candidates.push(num(last.pct));
          candidates.push(num(last.percentage));
        } else { candidates.push(num(last)); }
      }
    }
    for (var i = 0; i < candidates.length; i++) {
      if (!isNaN(candidates[i]) && isFinite(candidates[i])) { return candidates[i]; }
    }
    return null;
  }

  /**
   * TRApi.fetchPortfolio(session, hooks)
   *   hooks.onPayload(payload)  payload = {total, cash, currency, intervals:[{range,name,abs,pct}]}
   *   hooks.onError(err)
   *   hooks.onExpired()         session invalid -> caller should refresh/relogin
   */
  var NETWORK_ERR_CODES = {
    'ws-not-open': 1, 'ws-closed': 1, 'ws-dropped': 1, 'ws-timeout': 1,
    'ws-error': 1, 'ws-send': 1, 'sub-timeout': 1,
    'network': 1, 'timeout': 1, 'no-xhr': 1
  };

  function isNetworkErr(err) {
    return !!(err && err.code && NETWORK_ERR_CODES[err.code]);
  }

  function fetchPortfolio(session, hooks) {
    var results = {
      cash: null,
      currency: null,
      total: null,
      history: {},   // range -> {first, last}
      dietz: {}      // range -> pct
    };
    var outstanding = 0;
    var done = false;
    var wsRetried = false;

    function finish() {
      if (done) { return; }
      done = true;
      buildPayload();
    }

    function fail(err) {
      if (done) { return; }
      // spec tr-portfolio-data: retry once on connection drop, then report
      if (!wsRetried && isNetworkErr(err)) {
        wsRetried = true;
        wsClose();               // drop any half-dead connection
        done = false;
        setTimeout(run, 500);    // reconnect and re-run the fetch once
        return;
      }
      done = true;
      if (hooks.onError) { hooks.onError(err); }
    }

    function isExpiredError(err) {
      if (!err) { return false; }
      var msg = String(err.message || err.code || '').toLowerCase();
      return msg.indexOf('401') !== -1 || msg.indexOf('403') !== -1 ||
             msg.indexOf('unauthorized') !== -1 || msg.indexOf('expired') !== -1 ||
             msg.indexOf('invalid session') !== -1 || msg.indexOf('session') !== -1;
    }

    function guard(cb) {
      return function (data, err) {
        if (err) {
          if (isExpiredError(err) && hooks.onExpired) { hooks.onExpired(err); }
          // treat as interval/data failure; total/cash failures handled per message
          cb(null, err);
          return;
        }
        cb(data, null);
      };
    }

    function buildPayload() {
      var intervals = [];
      // total: from max aggregate history if available
      if (results.total === null && results.history.max) {
        results.total = results.history.max.last;
      }
      // max interval delta from aggregate history
      if (results.history.max && results.history.max.first !== null && results.history.max.last !== null) {
        var absMax = round2(results.history.max.last - results.history.max.first);
        var pctMax = results.history.max.first !== 0 ? round2((results.history.max.last - results.history.max.first) / results.history.max.first * 100) : 0;
        intervals.push({ range: 'max', name: 'MAX', abs: absMax, pct: pctMax });
      }
      // 1d/5d/1m/1y from Dietz pct (abs derived from total) or history fallback
      for (var i = 0; i < INTERVAL_DEFS.length; i++) {
        var def = INTERVAL_DEFS[i];
        if (def.range === 'max') { continue; }
        var pct = results.dietz[def.range];
        if (pct !== undefined && pct !== null && !isNaN(pct) && results.total !== null) {
          var abs = round2(results.total * pct / (100 + pct));
          intervals.push({ range: def.range, name: def.name, abs: abs, pct: round2(pct) });
        } else if (results.history[def.range] && results.history[def.range].first !== null && results.history[def.range].last !== null) {
          var f = results.history[def.range].first, l = results.history[def.range].last;
          var a2 = round2(l - f);
          var p2 = f !== 0 ? round2((l - f) / f * 100) : 0;
          intervals.push({ range: def.range, name: def.name, abs: a2, pct: p2 });
        }
        // else: interval omitted (partial-data tolerance per spec)
      }

      var payload = {
        total: results.total !== null ? round2(results.total) : null,
        cash: results.cash !== null ? round2(results.cash) : null,
        currency: results.currency || 'EUR',
        intervals: intervals
      };
      if (hooks.onPayload) { hooks.onPayload(payload); }
    }

    function run() {
    // --- cash --------------------------------------------------------------
    outstanding++;
    wsSub({ type: 'cash', token: session.tr_session }, guard(function (data) {
      if (Array.isArray(data) && data.length) {
        var sum = 0;
        for (var i = 0; i < data.length; i++) {
          var a = Number(data[i].amount);
          if (!isNaN(a)) { sum += a; }
          if (!results.currency && data[i].currencyId) { results.currency = data[i].currencyId; }
        }
        results.cash = sum;
      }
      outstanding--;
      if (outstanding === 0) { finish(); }
    }));

    // --- portfolio aggregate history (max + interval fallbacks) ------------
    var historyRanges = ['max'];
    for (var h = 0; h < INTERVAL_DEFS.length; h++) {
      if (INTERVAL_DEFS[h].range !== 'max') { historyRanges.push(INTERVAL_DEFS[h].range); }
    }
    historyRanges.forEach(function (range) {
      outstanding++;
      wsSub({ type: 'portfolioAggregateHistory', range: range, token: session.tr_session }, guard(function (data) {
        var first = historyFirstValue(data);
        var last = historyLastValue(data);
        if (first !== null && last !== null) {
          results.history[range] = { first: first, last: last };
          if (range === 'max' && results.total === null) { results.total = last; }
        }
        outstanding--;
        if (outstanding === 0) { finish(); }
      }));
    });

    // --- Dietz chart (1d/5d/1m/1y) -----------------------------------------
    ['1d', '5d', '1m', '1y'].forEach(function (range) {
      outstanding++;
      wsSub({ type: 'userPortfolioChartModifiedDietz', range: range, token: session.tr_session }, guard(function (data) {
        var pct = dietzPct(data);
        if (pct !== null && !isNaN(pct)) { results.dietz[range] = pct; }
        outstanding--;
        if (outstanding === 0) { finish(); }
      }));
    });

    // safety net: if everything times out silently
    setTimeout(function () {
      if (!done) {
        if (outstanding > 0 && results.total === null && results.cash === null) {
          fail({ code: 'data-timeout', message: 'No data received from Trade Republic.' });
        } else {
          finish();
        }
      }
    }, 15000);
    }

    run();
  }

  /** Validate a session with a lightweight subscription. cb(valid:boolean, err) */
  function validateSession(session, cb) {
    wsEnsure(function () {
      wsSub({ type: 'availableCash', token: session.tr_session }, function (data, err) {
        if (err) { cb(false, err); return; }
        cb(Array.isArray(data), null);
      });
    }, function (err) { cb(false, err); });
  }

  /** Close the WS (app exit). */
  function close() { wsClose(); }

  // --- demo/mock data (for qemu & offline testing) -------------------------
  function demoPayload() {
    return {
      total: 12345.67,
      cash: 1234.56,
      currency: 'EUR',
      intervals: [
        { range: '1d',  name: '1D',  abs: 123.45,  pct: 1.01 },
        { range: '5d',  name: '1W',  abs: -234.56, pct: -1.89 },
        { range: '1m',  name: '1M',  abs: 345.67,  pct: 2.88 },
        { range: '1y',  name: '1Y',  abs: 1234.56, pct: 11.11 },
        { range: 'max', name: 'MAX', abs: 5678.90, pct: 85.2 }
      ]
    };
  }

  var TRApi = {
    HOST: HOST,
    login: login,
    refreshSession: refreshSession,
    validateSession: validateSession,
    fetchPortfolio: fetchPortfolio,
    wsEnsure: wsEnsure,
    close: close,
    demoPayload: demoPayload,
    setDebug: function (on) { DEBUG = !!on; },
    constants: {
      POLL_INTERVAL_MS: POLL_INTERVAL_MS,
      LOGIN_PATH: LOGIN_PATH,
      PROCESS_PATH: PROCESS_PATH,
      REFRESH_PATH: REFRESH_PATH
    }
  };

  global.TRApi = TRApi;
})(typeof window !== 'undefined' ? window : this);
