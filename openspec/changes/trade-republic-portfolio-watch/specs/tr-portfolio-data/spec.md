## ADDED Requirements

### Requirement: Provide total portfolio value
The app SHALL compute the user's total portfolio value (invested positions plus cash, in the account currency) from the TR WebSocket API and SHALL deliver it to the watch in the data payload.

#### Scenario: Portfolio fetched
- **WHEN** a data refresh is triggered and a valid session exists
- **THEN** the payload delivered to the watch contains the current total portfolio value

#### Scenario: Portfolio fetch fails
- **WHEN** the data request fails (network, API error, session expiry)
- **THEN** the app reports an error state to the watch UI and keeps the last known values if any

### Requirement: Provide interval deltas
The app SHALL provide the change of the portfolio for the intervals 1D, 1W, 1M, 1Y and MAX, each as absolute change and percentage change, derived from TR history/chart messages (`portfolioAggregateHistory` and/or `userPortfolioChartModifiedDietz`).

#### Scenario: Deltas computed
- **WHEN** interval history data is received from the TR API
- **THEN** the payload contains one entry per interval with name, absolute change, and percentage change

#### Scenario: Partial interval data
- **WHEN** history for one interval is unavailable or fails
- **THEN** the app omits that interval from the payload and the UI shows it as unavailable rather than failing the whole refresh

### Requirement: Single WebSocket protocol client
The app SHALL speak the TR WebSocket text protocol (`connect`, `sub N {...}`, `unsub N`) with sequential message ids, SHALL include the session token in `sub` payloads, and SHALL parse JSON payloads from response frames.

#### Scenario: Message round-trip
- **WHEN** the sandbox subscribes to a message type
- **THEN** it receives the parsed JSON response and unsubscribes, mirroring the proven SDK flow

#### Scenario: Connection failure
- **WHEN** the WebSocket cannot connect or drops mid-request
- **THEN** the app retries once, then reports a data-unavailable error to the watch

### Requirement: Stable compact payload contract
The app SHALL deliver data to the watch via AppMessage using a stable, compact schema (`total`, `cash`, `intervals[]`) declared as message keys in `package.json`, independent of TR API response shapes.

#### Scenario: Payload delivered
- **WHEN** a refresh completes successfully
- **THEN** the watch receives the compact payload through declared AppMessage keys

#### Scenario: Payload size limits
- **WHEN** building the payload
- **THEN** it stays within AppMessage size limits (256 bytes per message; chunked if needed)
