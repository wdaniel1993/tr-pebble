/**
 * pebble-js-app.js — PebbleKit JS entry point for TR Portfolio.
 *
 * Glue between the watch C app (AppMessage) and the TR protocol module:
 *   C -> JS  : CMD (refresh / login / clear)
 *   JS -> C  : STATE, TOTAL, CASH, CURRENCY, INTERVAL_*, DONE, ERROR_MSG, VERSION
 *
 * Credentials and session tokens live only in app-scoped localStorage
 * (storage.js). The PIN never crosses the AppMessage boundary.
 *
 * ES5 only — the PebbleKit JS engine is an old JS core.
 */
require('./storage.js');
require('./tr_api.js');
// config page is hosted on GitHub Pages; see config/index.html
require('./mock.js');

(function () {
  'use strict';

  // --- AppMessage key names (must match package.json messageKeys) ----------
  var K = {
    CMD: 'CMD', STATE: 'STATE', TOTAL: 'TOTAL', CASH: 'CASH', CURRENCY: 'CURRENCY',
    INTERVAL_IDX: 'INTERVAL_IDX', INTERVAL_NAME: 'INTERVAL_NAME',
    INTERVAL_ABS: 'INTERVAL_ABS', INTERVAL_PCT: 'INTERVAL_PCT',
    DONE: 'DONE', ERROR_MSG: 'ERROR_MSG', VERSION: 'VERSION'
  };

  // --- state / command values (must match src/c/portfolio.h) ---------------
  var STATE = {
    UNKNOWN: 0, LOADING: 1, LOGIN_PROMPT: 2, AWAITING_CONFIRM: 3,
    ERROR: 4, SESSION_EXPIRED: 5, READY: 6, NEED_CREDS: 7
  };
  var CMD = { REFRESH: 1, LOGIN: 2, CLEAR: 3 };

  var APP_VERSION = '1.0.0';
  var loginHandle = null;
  var lastPayload = null;
  var busy = false;

  // ========================================================================
  // send helpers
  // ========================================================================

  function send(msg) {
    Pebble.sendAppMessage(msg, function () { /* ack */ }, function () { /* nack */ });
  }

  function sendState(state, errorMsg) {
    var m = {};
    m[K.STATE] = state;
    if (errorMsg) { m[K.ERROR_MSG] = String(errorMsg).slice(0, 60); }
    send(m);
  }

  function fmtSigned(n) {
    if (n === null || n === undefined || isNaN(n)) { return null; }
    var v = Number(n);
    var s = v < 0 ? '-' : '+';
    return s + Math.abs(v).toFixed(2);
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(n)) { return null; }
    return Number(n).toFixed(2);
  }

  /**
   * Deliver a payload to the watch. Each interval goes in its own message so
   * every message stays far below the AppMessage size limit (256 B default).
   */
  function sendPayload(payload) {
    lastPayload = payload;
    var m = {};
    m[K.STATE] = STATE.READY;
    if (payload.total !== null && payload.total !== undefined) { m[K.TOTAL] = fmtMoney(payload.total); }
    if (payload.cash !== null && payload.cash !== undefined) { m[K.CASH] = fmtMoney(payload.cash); }
    if (payload.currency) { m[K.CURRENCY] = payload.currency; }
    send(m);

    var intervals = payload.intervals || [];
    for (var i = 0; i < intervals.length; i++) {
      var iv = intervals[i];
      var im = {};
      im[K.INTERVAL_IDX] = i;
      im[K.INTERVAL_NAME] = iv.name || String(i);
      im[K.INTERVAL_ABS] = fmtSigned(iv.abs) || '+0.00';
      im[K.INTERVAL_PCT] = fmtSigned(iv.pct) || '+0.00';
      send(im);
    }

    var done = {};
    done[K.DONE] = 1;
    send(done);
  }

  // ========================================================================
  // data refresh
  // ========================================================================

  function sessionReady() {
    var s = Storage.getSession();
    return !!(s && s.tr_session);
  }

  function doRefresh() {
    if (busy) { return; }
    busy = true;
    sendState(STATE.LOADING);

    if (Storage.isDemoMode()) {
      var payload = Mock.next(lastPayload);
      sendPayload(payload);
      busy = false;
      return;
    }

    var session = Storage.getSession();
    if (!session) {
      busy = false;
      if (Storage.hasCredentials()) {
        sendState(STATE.LOGIN_PROMPT);
      } else {
        sendState(STATE.NEED_CREDS);
      }
      return;
    }

    TRApi.validateSession(session, function (valid, err) {
      if (valid) {
        fetchData(session);
        return;
      }
      // session invalid -> try refresh, then full login
      if (session.tr_refresh) {
        TRApi.refreshSession(session, {
          onSuccess: function (newSession) {
            Storage.setSession(newSession);
            fetchData(newSession);
          },
          onError: function () {
            relogin();
          }
        });
      } else {
        relogin();
      }
    });
  }

  function fetchData(session) {
    TRApi.fetchPortfolio(session, {
      onPayload: function (payload) {
        busy = false;
        sendPayload(payload);
      },
      onExpired: function () {
        // session died mid-fetch: refresh -> relogin
        if (session.tr_refresh) {
          TRApi.refreshSession(session, {
            onSuccess: function (ns) { Storage.setSession(ns); fetchData(ns); },
            onError: function () { relogin(); }
          });
        } else {
          relogin();
        }
      },
      onError: function (err) {
        busy = false;
        sendState(STATE.ERROR, err && err.message ? err.message : 'Data unavailable.');
      }
    });
  }

  function relogin() {
    busy = false;
    sendState(STATE.SESSION_EXPIRED);
  }

  // ========================================================================
  // login
  // ========================================================================

  function doLogin() {
    if (busy && loginHandle) { return; }
    if (!Storage.hasCredentials()) {
      sendState(STATE.NEED_CREDS);
      return;
    }
    if (loginHandle) {
      loginHandle.cancel();
      loginHandle = null;
    }
    busy = true;

    loginHandle = TRApi.login(Storage.getPhone(), Storage.getPin(), {
      onStatus: function (status) {
        if (status === 'pending') { sendState(STATE.AWAITING_CONFIRM); }
      },
      onSuccess: function (session) {
        loginHandle = null;
        Storage.setSession(session);
        busy = false;
        sendState(STATE.LOADING);
        fetchData(session);
      },
      onError: function (err) {
        loginHandle = null;
        busy = false;
        var msg = err && err.message ? err.message : 'Login failed.';
        sendState(STATE.ERROR, msg);
      }
    });
  }

  function doClear() {
    if (loginHandle) { loginHandle.cancel(); loginHandle = null; }
    Storage.clearCredentials();
    Storage.clearSession();
    busy = false;
    lastPayload = null;
    sendState(STATE.LOGIN_PROMPT);
  }

  // ========================================================================
  // AppMessage from the watch
  // ========================================================================

  Pebble.addEventListener('appmessage', function (e) {
    var cmd = e.payload && e.payload[K.CMD];
    if (cmd === undefined) { return; }
    if (cmd === CMD.REFRESH) {
      doRefresh();
    } else if (cmd === CMD.LOGIN) {
      doLogin();
    } else if (cmd === CMD.CLEAR) {
      doClear();
    }
  });

  // ========================================================================
  // lifecycle + configuration page
  // ========================================================================

  Pebble.addEventListener('ready', function () {
    var m = {};
    m[K.VERSION] = APP_VERSION;
    m[K.STATE] = Storage.isDemoMode() ? STATE.UNKNOWN
      : (sessionReady() ? STATE.LOADING : (Storage.hasCredentials() ? STATE.LOGIN_PROMPT : STATE.NEED_CREDS));
    send(m);
  });

  // The config page is hosted on GitHub Pages (same pattern as Pebblegram and
  // Lionel): the Pebble/Rebble app's webview opens a real https URL, which the
  // embedded data: URI approach does not reliably support.
  var CONFIG_PAGE_URL = 'https://wdaniel1993.github.io/tr-pebble/config/index.html';

  Pebble.addEventListener('showConfiguration', function () {
    var params = [];
    var phone = Storage.getPhone();
    if (phone) { params.push('phone=' + encodeURIComponent(phone)); }
    if (Storage.isDemoMode()) { params.push('demo=1'); }
    var url = CONFIG_PAGE_URL + (params.length ? '?' + params.join('&') : '');
    Pebble.openURL(url);
  });

  Pebble.addEventListener('webviewclosed', function (e) {
    if (!e || !e.response) { return; }
    var opts = null;
    try { opts = JSON.parse(decodeURIComponent(e.response)); } catch (err) { /* ignore */ }
    if (!opts) { return; }
    if (opts.action === 'save') {
      Storage.setCredentials(opts.phone, opts.pin);
      Storage.setDemoMode(opts.demo === true || opts.demo === 'true');
      sendState(Storage.isDemoMode() ? STATE.UNKNOWN : STATE.LOGIN_PROMPT);
    } else if (opts.action === 'clear') {
      doClear();
    }
  });

  // The sandbox kills the JS process when the app closes (no background work),
  // so no explicit WS close is required on exit.
})(typeof window !== 'undefined' ? window : this);
