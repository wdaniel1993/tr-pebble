#pragma once

#include "portfolio.h"

// AppMessage glue between the C app and pebble-js-app.js.
// The JS side owns all TR protocol traffic; the C side only ever receives
// the compact payload ({total, cash, currency, intervals[]}) plus a state.

void messaging_init(TrData *data);
void messaging_deinit(void);
void messaging_send_cmd(TrCmd cmd);
