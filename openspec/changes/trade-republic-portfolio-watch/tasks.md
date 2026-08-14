## 1. Spike: Verify sandbox and TR protocol feasibility

- [ ] 1.1 Build a minimal test .pbw whose pebble-js-app.js opens a WebSocket to a public echo server and logs connection/echo results; install on the user's Android phone + watch and confirm WebSocket works in the Rebble JS sandbox
- [ ] 1.2 Extend the test .pbw to perform an XHR against an endpoint that sets a cookie and dump `getAllResponseHeaders()` to verify Set-Cookie visibility (or confirm token availability in response body)
- [ ] 1.3 Run the proven Python SDK (erim32 `trade-republic`) login flow once with the user's account; capture exact login request headers (incl. `x-tr-device-info`), confirm `processId` polling semantics and where `tr_session`/`tr_refresh` appear
- [ ] 1.4 From the captured session, subscribe to `portfolioAggregateHistory`, `userPortfolioChartModifiedDietz`, `cash` and record the exact response JSON shapes and frame format; verify a cookie-less WebSocket connect works from a plain client
- [ ] 1.5 Record findings (headers, frame format, response shapes, sandbox verdict) in the change's design.md Open Questions and decide: pure-sandbox architecture or slim-bridge fallback

## 2. Project scaffold

- [ ] 2.1 Create the Pebble project (pebble new-project) with app name, UUID, and both target platforms (chalk, emery)
- [ ] 2.2 Declare AppMessage keys in package.json (messageKeys) and configure build for SDK 4.18
- [ ] 2.3 Set up the module layout: src/c/ (C app), src/pkjs/ (pebble-js-app.js + tr_api.js + storage.js)
- [ ] 2.4 Verify `pebble build` succeeds for chalk and emery targets and the app installs in qemu emulator

## 3. tr-auth: TR session authentication

- [ ] 3.1 Implement login initiation (POST phone+PIN with required headers) and processId handling per spike findings
- [ ] 3.2 Implement push-confirmation polling (GET process status until CONFIRMED) with timeout/rejection handling
- [ ] 3.3 Implement session capture and persistence (tr_session/tr_refresh in localStorage) and load-on-start
- [ ] 3.4 Implement session refresh (POST /api/v1/auth/web/session) and fallback to full login on refresh failure
- [ ] 3.5 Implement credential storage/clearing (app-scoped localStorage; config-page clear option) ensuring the PIN never crosses AppMessage

## 4. tr-portfolio-data: TR WebSocket client and payload

- [ ] 4.1 Implement the WS client (connect with spike-verified handshake, sub/unsub with sequential ids, JSON frame parsing, retry-once on drop)
- [ ] 4.2 Implement data fetches: total value (aggregate history last point / cash + positions) and interval deltas (1d/5d/1m/1y/max via userPortfolioChartModifiedDietz or portfolioAggregateHistory)
- [ ] 4.3 Implement the compact payload builder ({total, cash, intervals[]}) with per-interval abs/pct and partial-data tolerance
- [ ] 4.4 Wire AppMessage delivery of the payload to the C app and handle sandbox-side errors (session expired → refresh/relogin hooks)

## 5. watch-ui: Pebble C app

- [ ] 5.1 Implement the overview screen: large total value, interval list (name + abs + pct) with directional styling
- [ ] 5.2 Implement round (PBL_ROUND) and rectangular (PBL_RECT) layout branches with proper insets
- [ ] 5.3 Implement button handling: up/down scroll with focus indication, select = refresh, long-press = re-login trigger
- [ ] 5.4 Implement states: loading (keep last values), error + retry, first-run login prompt, awaiting-confirmation prompt, session-expired re-login prompt
- [ ] 5.5 Handle AppMessage size limits (chunked payloads if needed) and message key mapping

## 6. Integration and testing

- [ ] 6.1 End-to-end run in qemu emulator for chalk and emery with mocked sandbox data (fake payload injector) covering all UI states
- [ ] 6.2 End-to-end test on physical Pebble Time Round and Pebble Time 2 with real TR login (user confirms push) and real data
- [ ] 6.3 Test session-expiry path (force refresh/relogin) and offline behavior (no network, TR API down)
- [ ] 6.4 Verify battery/behavior: data only fetched while app open; no background work; refresh-on-open timing acceptable
- [ ] 6.5 Final review against specs (tr-auth, tr-portfolio-data, watch-ui) and update specs/design if findings changed anything
