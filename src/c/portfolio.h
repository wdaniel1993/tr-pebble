#pragma once

#include <pebble.h>

// ---------------------------------------------------------------------------
// TR Portfolio — shared data model between the C app and the JS sandbox.
// Values mirror the AppMessage contract in package.json ("messageKeys") and
// the constants in src/pkjs/pebble-js-app.js. Keep both in sync!
// ---------------------------------------------------------------------------

#define TR_MAX_INTERVALS 5
#define TR_NAME_LEN      4        // "1D", "1W", "1M", "1Y", "MAX" + NUL
#define TR_VALUE_LEN     16       // "+12345.67" / "1234.56" + NUL
#define TR_CURRENCY_LEN  8
#define TR_ERROR_LEN     64

// JS -> C states (STATE key)
typedef enum {
  TR_STATE_UNKNOWN           = 0,
  TR_STATE_LOADING           = 1,
  TR_STATE_LOGIN_PROMPT      = 2,
  TR_STATE_AWAITING_CONFIRM  = 3,
  TR_STATE_ERROR             = 4,
  TR_STATE_SESSION_EXPIRED   = 5,
  TR_STATE_READY             = 6,
  TR_STATE_NEED_CREDS        = 7
} TrState;

// C -> JS commands (CMD key)
typedef enum {
  TR_CMD_REFRESH = 1,
  TR_CMD_LOGIN   = 2,
  TR_CMD_CLEAR   = 3
} TrCmd;

typedef struct {
  char name[TR_NAME_LEN];     // e.g. "1D"
  char abs_str[TR_VALUE_LEN]; // signed, e.g. "+123.45"
  char pct_str[TR_VALUE_LEN]; // signed, e.g. "-1.89"
  bool available;
} TrInterval;

typedef struct {
  bool has_data;              // any payload has ever been received
  char total[TR_VALUE_LEN];   // e.g. "12345.67"
  char cash[TR_VALUE_LEN];    // e.g. "1234.56"
  char currency[TR_CURRENCY_LEN];
  TrInterval intervals[TR_MAX_INTERVALS];
  int interval_count;
  char error_msg[TR_ERROR_LEN];
  TrState state;
} TrData;
