## Context

Trade Republic's old JSON REST API (`app.trade-republic.de`) no longer resolves. The current API (`api.traderepublic.com`) uses a plain-WebSocket data protocol (`connect`/`sub`/`unsub` text frames) authenticated by a `tr_session` cookie obtained through a web-login flow: `POST /api/v2/auth/web/login` with phone + PIN, then polling the process status until the user confirms the login push notification in the Trade Republic phone app (no code entry required). Sessions are refreshable via `POST /api/v1/auth/web/session`. Community SDKs (erim32 `trade-republic` Python, NightOwl07 `trade-republic-api` TypeScript) prove the flow works with plain HTTP + WebSocket; one of them connects to the WebSocket with **no cookies**, passing the session token inside each `sub` payload.

The target hardware is Pebble Time 2 (`emery`, 200×228) and Pebble Time Round (`chalk`, 180×180 round). Neither watch has WiFi: all network access goes through the phone's Rebble Android app, whose PebbleKit JS sandbox (`pebble-js-app.js`, shipped inside the .pbw) provides `XMLHttpRequest`, `WebSocket` (documented; unverified in practice), and `localStorage`. The sandbox runs only while the watchapp is open. This repo has Pebble SDK 4.18 + pebble tool v5.0.39 + qemu-pebble installed.

## Goals / Non-Goals

**Goals:**
- A single .pbw whose `pebble-js-app.js` talks to the unofficial TR API directly — no companion app, no server, no credentials on the watch.
- Show total portfolio value and per-interval change (absolute + %) for 1D, 1W, 1M, 1Y, MAX on both round and rectangular screens.
- One-time login driven from the watch (tap "confirm" in the TR phone app), session persisted and refreshed automatically.
- Refresh on app open and on button press; clear loading / error / re-auth states.
- Isolate all TR protocol code so breakage is contained and the data contract stays stable.

**Non-Goals:**
- Position-level detail, charts/sparklines, orders, watchlist, savings plans.
- Background/periodic updates while the app is closed (sandbox lifetime forbids it anyway).
- iOS phone support (target: Rebble Android app).
- A self-hosted bridge server (fallback only if the sandbox WebSocket spike fails).

## Decisions

### 1. PebbleKit JS is the bridge (no server)
The sandbox performs login via XHR and data fetch via WebSocket, exactly mirroring the proven SDK flows. Decided over:
- **Self-hosted bridge server** — simpler sandbox code, but requires hosting, TR session lives outside the user's control, and it's unnecessary if the spike passes.
- **Third-party aggregator (Parqet/getquin)** — adds a dependency and their public pages aren't clean JSON APIs; rejected.
Fallback if the spike fails: a ~100-line slim bridge exposing the same JSON contract (`GET /portfolio`) so the sandbox/data/UI layers don't change.

### 2. Protocol module isolation
All TR wire logic lives in one ES5 module (`tr_api.js`): endpoint constants, login state machine, WS client (connect/sub/unsub with sequential ids), JSON frame parsing, and response shaping into a stable payload (`{ total, cash, intervals: [{range, abs, pct}] }`). The C app and UI only ever see that payload.

### 3. Auth flow (on-watch, push-confirm)
- First run: watch shows "Log in — press select". JS posts phone + PIN (stored in app-scoped `localStorage`), polls `GET /api/v2/auth/web/login/processes/{processId}` until `CONFIRMED`, captures `tr_session` + `tr_refresh`, stores them.
- Subsequent runs: validate session over WS; on 401/403 refresh via `/api/v1/auth/web/session`; only if refresh fails, re-run login (push confirm again).
- PIN storage accepted: `localStorage` is scoped per app in the sandbox; PIN is only used at login time and can be cleared via a config page (escape hatch).

### 4. Data messages
- Total + interval deltas: `portfolioAggregateHistory` (absolute EUR series → last point + deltas) and/or `userPortfolioChartModifiedDietz` (ranges `1d|5d|1m|1y|max`, percentage-based, Dietz-adjusted — mirrors the TR app's performance view).
- `cash` for cash balance; totals = cash + positions (from `compactPortfolioByType` if needed).
- One WS connection per app open; sequential sub/recv/unsub per message (pattern proven by erim32); close on app exit.

### 5. Watch UI
Single overview screen: total value large, interval list below (name + abs + %), scroll with up/down (round: fewer visible rows), select = refresh, long-press back = re-login. `PBL_ROUND`/`PBL_RECT` layout branches. AppMessage keys declared in `package.json` (`messageKeys`) and shared with C via `MESSAGE_KEY_*`. Loading (spinner/clock), error (retry), and "log in" states.

### 6. Build & test
Dev loop: `pebble build` → install on qemu (chalk + emery) for UI; protocol spike validated against real TR API from the phone. Sandbox-only behavior (WebSocket, headers) requires the physical phone/watch.

## Risks / Trade-offs

- **[WebSocket broken/unavailable in Rebble sandbox]** → Spike first with a minimal test .pbw. Fallback: slim bridge (same JSON contract, no UI/data changes).
- **[XHR cannot read `Set-Cookie`]** → Check confirm-response body for the token; else refresh endpoint; last resort: config-page token paste.
- **[TR API changes or enforces WAF/headers]** → All protocol code in one module with version constants; re-login path already built; API breakage accepted per user.
- **[PIN stored on phone]** → App-scoped localStorage, only used at login, clearable via config page. TR login additionally requires push confirmation (second factor on the user's own phone).
- **[Old JS engine (ES5)**]** → Write ES5, zero external libs, no WebCrypto (not needed: no request signing in the web-session flow).
- **[Data stale while app closed]** → Refresh on every open; sandbox lifetime makes background updates impossible (by design, also saves battery).
- **[Login requires TR phone app push]** → Re-login only happens after session expiry; phone must be nearby, which is inherent to Pebble anyway.

## Migration Plan

Green-field change in this repo (no existing code). Rollback = not shipping the app / keeping the previous watchapp installed. The .pbw is sideloaded via the Rebble Android app; no server or external account to migrate.

## Open Questions

- Exact login request headers (probe returned `MISSING_REQUIRED_HEADER` — likely `x-tr-device-info`; resolve by running the proven Python SDK or capturing the web app's requests).
- Whether the WS handshake needs the `tr_session` Cookie header (erim32 connects without it — verify on the phone).
- `userPortfolioChartModifiedDietz` response shape (spike).
- Interval set: use API ranges `1d/5d/1m/1y/max` or present as 1D/1W/1M/1Y/MAX (map `5d`→1W).
- Currency: default EUR; read account currency from `cash` response.
