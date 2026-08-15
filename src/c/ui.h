#pragma once

#include "portfolio.h"

// Overview screen: total value + interval deltas, round/rect layouts,
// button handling (up/down scroll, select = refresh, long-press = re-login),
// and the loading/error/login state screens.

void ui_init(TrData *data);
void ui_deinit(void);
void ui_refresh(void);
