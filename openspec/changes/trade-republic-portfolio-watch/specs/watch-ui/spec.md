## ADDED Requirements

### Requirement: Overview screen with total and interval deltas
The watchapp SHALL render an overview screen showing the total portfolio value prominently and a list of interval deltas (name, absolute change, percentage change) for 1D, 1W, 1M, 1Y, MAX.

#### Scenario: Data displayed
- **WHEN** a data payload is available
- **THEN** the total value is shown large and the interval list shows each interval's name, absolute and percentage change with directional styling

#### Scenario: Negative changes
- **WHEN** an interval change is negative
- **THEN** it is visually distinguished from positive changes (e.g., down arrow / color)

#### Scenario: Missing data
- **WHEN** an interval is missing from the payload
- **THEN** the UI shows that interval as unavailable and keeps the rest readable

### Requirement: Round and rectangular layouts
The watchapp SHALL adapt its layout to both the round screen (Pebble Time Round, 180×180, `PBL_ROUND`) and rectangular screen (Pebble Time 2, 200×228, `PBL_RECT`), rendering the same data on both.

#### Scenario: Round layout
- **WHEN** running on a round watch
- **THEN** content is laid out within the circular viewport with appropriate insets

#### Scenario: Rectangular layout
- **WHEN** running on a rectangular watch
- **THEN** content uses the full rectangular viewport

### Requirement: Refresh on open and on demand
The watchapp SHALL trigger a data refresh when it opens and SHALL provide a manual refresh control (button press). While refreshing, the UI SHALL show a loading state; the previous values SHALL remain visible until new data arrives.

#### Scenario: Refresh on open
- **WHEN** the user opens the app
- **THEN** a refresh is requested and a loading indicator is shown until data or an error arrives

#### Scenario: Manual refresh
- **WHEN** the user presses the refresh button
- **THEN** a new refresh is requested without restarting the app

#### Scenario: Refresh failure
- **WHEN** a refresh fails and no previous data exists
- **THEN** the UI shows an error state with a retry option

### Requirement: Login and re-auth states
The watchapp SHALL show a login prompt when no session exists, a "confirm in Trade Republic app" prompt while awaiting push confirmation, and a re-login prompt when the session cannot be refreshed.

#### Scenario: First run
- **WHEN** the app opens with no stored session
- **THEN** the UI shows a login prompt and initiates login on user confirmation

#### Scenario: Awaiting confirmation
- **WHEN** a login process is pending phone confirmation
- **THEN** the UI instructs the user to confirm the login in the Trade Republic app

#### Scenario: Session expired
- **WHEN** the session cannot be refreshed
- **THEN** the UI shows a re-login state that triggers the full login flow on user action

### Requirement: Interval navigation
The watchapp SHALL allow scrolling through the interval list with the up/down buttons on both form factors.

#### Scenario: Scrolling
- **WHEN** the user presses up or down
- **THEN** the interval list scrolls and the focused interval is visually indicated
