## ADDED Requirements

### Requirement: Initiate TR web login from the JS sandbox
The app SHALL initiate a Trade Republic web login by POSTing the user's phone number and PIN to `POST /api/v2/auth/web/login` (falling back to `/api/v1/auth/web/login` if required) with the required platform headers, and SHALL obtain a `processId` from the response.

#### Scenario: Login initiated
- **WHEN** the user triggers login and valid phone number and PIN are stored in sandbox storage
- **THEN** the sandbox posts the credentials and receives a `processId` for the login process

#### Scenario: Login initiation rejected
- **WHEN** the API rejects the login initiation (invalid credentials, missing header, rate limit)
- **THEN** the sandbox surfaces a readable error to the watch UI and does not store a session

### Requirement: Drive push-confirmation login
The app SHALL poll the login process status (`GET /api/v2/auth/web/login/processes/{processId}`) until it is `CONFIRMED`, while the watch UI instructs the user to confirm the login in the Trade Republic phone app.

#### Scenario: User confirms on phone
- **WHEN** the user taps "confirm" in the Trade Republic app while the process is pending
- **THEN** the poll observes `CONFIRMED` and the app proceeds to capture the session

#### Scenario: Confirmation timeout or rejection
- **WHEN** the process is not confirmed within its validity window or reports a terminal non-confirmed status
- **THEN** the app stops polling and shows a re-login error state on the watch

### Requirement: Capture and persist session
The app SHALL extract the `tr_session` token (and `tr_refresh` if present) from the confirmed login response and SHALL persist both in sandbox `localStorage` so subsequent app opens can reuse the session without a new login.

#### Scenario: Session captured
- **WHEN** the login process is confirmed and the response carries session tokens
- **THEN** the tokens are stored in `localStorage` and the app is ready to fetch data

#### Scenario: Session tokens absent
- **WHEN** the confirmed response does not contain session tokens
- **THEN** the app reports a session-capture failure and offers re-login

### Requirement: Refresh expired session
The app SHALL validate the stored session when data is needed and SHALL refresh it via `POST /api/v1/auth/web/session` when the server rejects the session (401/403/expired).

#### Scenario: Session refresh succeeds
- **WHEN** a data request fails with an expired-session error and a refresh token is available
- **THEN** the app refreshes the session, updates `localStorage`, and retries the data request

#### Scenario: Session refresh fails
- **WHEN** the refresh request fails or no refresh token is available
- **THEN** the app falls back to the full push-confirmation login flow

### Requirement: Keep credentials scoped to the app
The app SHALL store the TR phone number and PIN only in app-scoped sandbox `localStorage` and SHALL only transmit them to `api.traderepublic.com` login endpoints. The watch C app SHALL never receive or display the PIN.

#### Scenario: Credential isolation
- **WHEN** the watch requests login or data
- **THEN** the PIN never crosses the AppMessage boundary and the phone number/PIN are only read from the app's own storage

#### Scenario: Credential clearing
- **WHEN** the user chooses to clear credentials (via configuration)
- **THEN** phone number, PIN, and session tokens are removed from storage and the watch returns to the login state
