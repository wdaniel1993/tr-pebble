/**
 * config_page.js — self-contained HTML config page for TR Portfolio.
 *
 * Opened from pebble-js-app.js via Pebble.openURL() with a data: URI, so no
 * hosting is required. Lets the user:
 *   - enter their TR phone number + PIN once (stored in app-scoped localStorage;
 *     the PIN never crosses AppMessage to the watch)
 *   - toggle demo mode (mock data — used for qemu/offline testing)
 *   - clear credentials + session (escape hatch, per spec tr-auth 3.5)
 *
 * The page closes via the standard Pebble config protocol:
 *   - real app: location.href = 'pebblejs://close#<json>'
 *   - pypkjs emulator: return_to=<url> query param, appended with options
 */
(function (global) {
  'use strict';

  var CONFIG_HTML = '' +
    '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>TR Portfolio — Settings</title>' +
    '<style>' +
    'body{font-family:-apple-system,Helvetica,Arial,sans-serif;background:#1a1f24;color:#e8edf2;margin:0;padding:16px;}' +
    'h1{font-size:18px;margin:0 0 4px;}' +
    'p.hint{font-size:12px;color:#9aa7b4;margin:2px 0 16px;line-height:1.4;}' +
    'label{display:block;font-size:13px;color:#c4cdd6;margin:12px 0 4px;}' +
    'input{width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:1px solid #3a4550;' +
    'border:1px solid #3a4550;border-radius:6px;background:#11151a;color:#e8edf2;}' +
    'button{display:block;width:100%;margin-top:16px;padding:12px;font-size:15px;font-weight:600;' +
    'border:none;border-radius:6px;background:#2f7de1;color:#fff;}' +
    'button.secondary{margin-top:8px;background:#3a4550;}' +
    'button.danger{margin-top:8px;background:#a33;}' +
    'div.toggle{margin-top:14px;font-size:13px;color:#c4cdd6;}' +
    'div.toggle input{width:auto;margin-right:6px;}' +
    '#status{font-size:12px;margin-top:12px;color:#8fca6a;min-height:16px;}' +
    '</style></head><body>' +
    '<h1>TR Portfolio</h1>' +
    '<p class="hint">Enter your Trade Republic phone number and PIN. ' +
    'They are stored only on this phone (app sandbox) and are used only to log in. ' +
    'You confirm the login with a push in the Trade Republic app.</p>' +
    '<form id="f">' +
    '<label for="phone">Phone number (international, e.g. +491234567890)</label>' +
    '<input id="phone" type="tel" inputmode="tel" placeholder="+49..." autocomplete="off">' +
    '<label for="pin">PIN (5 digits)</label>' +
    '<input id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off">' +
    '<div class="toggle"><label><input id="demo" type="checkbox"> Demo mode (mock data, no network)</label></div>' +
    '<button type="submit" id="save">Save</button>' +
    '<button type="button" class="secondary" id="clear">Clear credentials &amp; session</button>' +
    '<div id="status"></div>' +
    '</form>' +
    '<script>' +
    '(function(){' +
    'var qs = {};' +
    'window.location.search.replace(/[?&]([^=&]+)=([^&]*)/g, function(_,k,v){ qs[k] = decodeURIComponent(v); });' +
    'var returnTo = qs.return_to || null;' +
    'function closeWith(options){' +
    '  var json = JSON.stringify(options);' +
    '  if (returnTo) { window.location.href = returnTo + encodeURIComponent(json); }' +
    '  else { window.location.href = "pebblejs://close#" + encodeURIComponent(json); }' +
    '}' +
    'var phone = document.getElementById("phone");' +
    'var pin = document.getElementById("pin");' +
    'var demo = document.getElementById("demo");' +
    'var status = document.getElementById("status");' +
    'var initial = {};' +
    'try { initial = JSON.parse(window.location.hash.replace(/^#/, "")) || {}; } catch(e) {}' +
    'if (initial.phone) phone.value = initial.phone;' +
    'if (initial.demo === true || initial.demo === "true") demo.checked = true;' +
    'document.getElementById("save").addEventListener("click", function(e){' +
    '  e.preventDefault();' +
    '  var p = phone.value.trim();' +
    '  var pi = pin.value.trim();' +
    '  if (!p || !pi) { status.textContent = "Phone and PIN are required."; status.style.color="#e88"; return; }' +
    '  closeWith({action:"save", phone:p, pin:pi, demo:demo.checked});' +
    '});' +
    'document.getElementById("clear").addEventListener("click", function(e){' +
    '  e.preventDefault();' +
    '  closeWith({action:"clear"});' +
    '});' +
    '})();' +
    '<\/script>' +
    '</body></html>';

  global.CONFIG_HTML = CONFIG_HTML;
})(typeof window !== 'undefined' ? window : this);
