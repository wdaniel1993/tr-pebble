#include <pebble.h>
#include "portfolio.h"
#include "messaging.h"
#include "ui.h"

static TrData s_data;

static void prv_refresh_timer_cb(void *context) {
  messaging_send_cmd(TR_CMD_REFRESH);
}

static void prv_init(void) {
  memset(&s_data, 0, sizeof(s_data));
  s_data.state = TR_STATE_LOADING;

  ui_init(&s_data);
  messaging_init(&s_data);

  // Refresh on open (spec: watch-ui "Refresh on open").
  // The JS sandbox may take a moment to boot, so give it a beat before
  // requesting data.
  app_timer_register(1500, prv_refresh_timer_cb, NULL);
}

static void prv_deinit(void) {
  messaging_deinit();
  ui_deinit();
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
