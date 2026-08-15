# TR Portfolio

A Trade Republic portfolio watch app for Pebble (revival-era PebbleOS), built with the
classic C + PebbleKit JS stack.

- **Watch app (C):** `src/c/` — UI, AppMessage, state machine (emery = Pebble Time 2,
  gabbro targets)
- **Protocol client (JS):** `src/pkjs/tr_api.js` — Trade Republic wire protocol: login
  state machine (v2 push-confirm, v1 SMS fallback), session refresh, WebSocket data path
- **Config/settings page:** `docs/index.html` — hosted on GitHub Pages
  (`https://wdaniel1993.github.io/tr-pebble/`), opened from the Pebble app
- **Build:** `pebble build` → `build/tr-pebble.pbw`

## ⚠️ Status: PAUSED (auth blocker)

**The app is paused at an authentication blocker. Do not resume without reading this.**

### What works
- TR web login **v2 flow** reaches `CONFIRMED` on a real device: phone + account PIN →
  push approval in the Trade Republic app → polling sees `CONFIRMED`.

### The blocker
- The **PebbleKit JS sandbox cannot read `Set-Cookie`** from cross-origin XHR responses
  (browser-like CORS header filtering; TR sends no `Access-Control-Expose-Headers` and no
  CORS headers at all). TR returns the session only in cookies, never in the response body.
  `extractSession()` in `src/pkjs/tr_api.js` therefore fails with
  *"Login confirmed but session token could not be captured"* on real hardware.
- This is a **known, documented platform limitation**: pebble/pebblejs#76 (open since 2015).
  `withCredentials = true` does not help. The emulator (pypkjs, Python-based) masks the bug
  because its XHR exposes headers — spike tests under pypkjs gave a false positive.
- TR has **no official consumer API** and its unofficial endpoints are actively tightening
  (v1 SMS flow removed, see pytr).

### Planned fix (not yet implemented)
- **Auth-only Cloudflare Worker bridge**: the worker forwards login/refresh to TR
  server-side (outbound fetches read `Set-Cookie` freely) and returns session tokens as
  JSON. Watch JS keeps its poll loop/UI; the WebSocket data path stays direct.
  Bonus: the worker's IP absorbs TR rate limits instead of the home IP.
- The real-account spike (auth flow task 1.3) is still pending and should confirm cookie
  capture end-to-end before shipping.
- Deployment requires a Cloudflare account + `wrangler deploy` (or Vercel/Deno Deploy
  one-file function with the same contract).

See the GitHub issue (auth blocker) for the full investigation trail.
