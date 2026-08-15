/**
 * storage.js — app-scoped persistence for the PebbleKit JS sandbox.
 *
 * All TR credentials, session tokens and app preferences live in the
 * sandbox's app-scoped localStorage. Nothing here ever crosses the
 * AppMessage boundary (the watch C app never sees the PIN).
 *
 * Written in ES5 for the old PebbleKit JS engine. If localStorage is
 * unavailable (defensive), we degrade to an in-memory store so the app
 * still functions for the lifetime of the process.
 */
(function (global) {
  'use strict';

  var memoryStore = {};
  var store = null;

  function storageAvailable() {
    try {
      var k = '__tr_storage_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  if (storageAvailable()) {
    store = global.localStorage;
  } else {
    store = {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null; },
      setItem: function (key, value) { memoryStore[key] = String(value); },
      removeItem: function (key) { delete memoryStore[key]; }
    };
  }

  var KEYS = {
    PHONE: 'tr_phone',
    PIN: 'tr_pin',
    SESSION: 'tr_session_data',     // JSON: { tr_session, tr_refresh, captured_at }
    DEMO: 'tr_demo_mode',           // '1' = use mock data (qemu / offline testing)
    DEVICE_ID: 'tr_device_id'       // stable random id for the x-tr-device-info header
  };

  function get(key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }
  function set(key, value) {
    try { store.setItem(key, value); } catch (e) { /* quota / sandbox errors are non-fatal */ }
  }
  function remove(key) {
    try { store.removeItem(key); } catch (e) { /* ignore */ }
  }

  var Storage = {
    // --- credentials ---------------------------------------------------
    getPhone: function () { return get(KEYS.PHONE) || ''; },
    getPin: function () { return get(KEYS.PIN) || ''; },
    hasCredentials: function () { return !!get(KEYS.PHONE) && !!get(KEYS.PIN); },
    setCredentials: function (phone, pin) {
      set(KEYS.PHONE, String(phone || '').trim());
      set(KEYS.PIN, String(pin || '').trim());
    },
    clearCredentials: function () {
      remove(KEYS.PHONE);
      remove(KEYS.PIN);
    },

    // --- session ---------------------------------------------------------
    // session: { tr_session: string, tr_refresh: string|undefined, captured_at: number }
    getSession: function () {
      var raw = get(KEYS.SESSION);
      if (!raw) { return null; }
      try {
        var s = JSON.parse(raw);
        if (!s || !s.tr_session) { return null; }
        return s;
      } catch (e) {
        remove(KEYS.SESSION);
        return null;
      }
    },
    setSession: function (session) {
      if (!session || !session.tr_session) { return; }
      set(KEYS.SESSION, JSON.stringify({
        tr_session: session.tr_session,
        tr_refresh: session.tr_refresh || '',
        captured_at: Date.now()
      }));
    },
    clearSession: function () { remove(KEYS.SESSION); },

    // --- demo / mock mode ------------------------------------------------
    isDemoMode: function () { return get(KEYS.DEMO) === '1'; },
    setDemoMode: function (on) {
      if (on) { set(KEYS.DEMO, '1'); } else { remove(KEYS.DEMO); }
    },

    // --- stable device id (for x-tr-device-info) --------------------------
    getDeviceId: function () {
      var id = get(KEYS.DEVICE_ID);
      if (!id) {
        id = 'p' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        set(KEYS.DEVICE_ID, id);
      }
      return id;
    }
  };

  global.Storage = Storage;
})(typeof window !== 'undefined' ? window : this);
