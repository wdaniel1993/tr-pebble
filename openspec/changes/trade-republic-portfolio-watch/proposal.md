## Why

A Pebble watchapp that shows the user's Trade Republic portfolio (total value + percentage change over intervals) directly on the wrist, with no companion app and no server. The old `app.trade-republic.de` REST API is dead; the current `api.traderepublic.com` API can be reached from the PebbleKit JS sandbox (XHR + WebSocket) inside the standard Rebble Android app, so the watch itself can act as its own bridge.

## What Changes

- New Pebble watchapp (C + `pebble-js-app.js`) targeting Pebble Time 2 (`emery`, 200×228) and Pebble Time Round (`chalk`, 180×180 round), built with Pebble SDK 4.18.
- The `pebble-js-app.js` sandbox talks to the unofficial Trade Republic web API directly:
  - Login via `POST /api/v2/auth/web/login` (phone + PIN) + push-confirmation polling (user taps "confirm" in the TR app on their phone) — no code entry on the watch.
  - Session (`tr_session` cookie, `tr_refresh`) persisted in sandbox `localStorage`; refresh via `/api/v1/auth/web/session` when expired; re-login fallback.
  - Data via WebSocket `wss://api.traderepublic.com` (`connect`/`sub`/`unsub` text protocol): total portfolio value and interval deltas (`1d`, `5d`, `1m`, `1y`, `max`) from `portfolioAggregateHistory` / `userPortfolioChartModifiedDietz` and `cash`.
- Watch UI: overview screen showing total value and per-interval change (absolute + %), refresh on open and on button press, loading/error/re-auth states, round-vs-rect layout handling.
- No companion app, no self-hosted server, no TR credentials on the watch itself.

## Capabilities

### New Capabilities
- `tr-auth`: Trade Republic web-session authentication from the PebbleKit JS sandbox — initiate login, drive push-confirmation, persist and refresh the session, recover from expiry.
- `tr-portfolio-data`: Fetch portfolio overview data (total value, interval deltas) from the unofficial TR WebSocket API and shape it into a compact payload for the watch.
- `watch-ui`: Pebble watchapp UI — overview screen (total + interval deltas), button interactions, refresh lifecycle, loading/error states, round and rectangular layouts.

### Modified Capabilities
<!-- none: openspec/specs/ is empty, this is a green-field change -->

## Impact

- **New code**: a Pebble watchapp under this repo (`src/` C sources, `pebble-js-app.js`, `appinfo.json`, `package.json` message keys) — no existing code is touched.
- **Toolchain**: Pebble SDK 4.18 + pebble tool v5.0.39 + qemu-pebble emulator (already installed locally).
- **External dependency (accepted risk)**: unofficial Trade Republic API (`api.traderepublic.com`) — undocumented, may change or break at any time; usage is outside TR's ToS. Mitigated by isolating all protocol code in one module.
- **Phone**: requires the Rebble Android app (PebbleKit JS sandbox with `XMLHttpRequest`, `WebSocket`, `localStorage`). Data only flows while the watchapp is open.
- **Sandbox unknowns to verify in a spike**: WebSocket availability in the Rebble JS sandbox, XHR response-header access (`Set-Cookie`), and exact login request headers (`x-tr-device-info` etc.).
