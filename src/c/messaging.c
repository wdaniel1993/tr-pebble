#include "messaging.h"

static TrData *s_data = NULL;

// ---------------------------------------------------------------------------
// Inbox: JS -> C
// ---------------------------------------------------------------------------

static void prv_handle_state(DictionaryIterator *iter, TrData *data) {
  Tuple *t = dict_find(iter, MESSAGE_KEY_STATE);
  if (t) {
    data->state = (TrState)t->value->int32;
  }
}

static void prv_handle_total(DictionaryIterator *iter, TrData *data) {
  Tuple *t = dict_find(iter, MESSAGE_KEY_TOTAL);
  if (t) {
    snprintf(data->total, sizeof(data->total), "%s", t->value->cstring);
    data->has_data = true;
  }
}

static void prv_handle_cash(DictionaryIterator *iter, TrData *data) {
  Tuple *t = dict_find(iter, MESSAGE_KEY_CASH);
  if (t) {
    snprintf(data->cash, sizeof(data->cash), "%s", t->value->cstring);
  }
}

static void prv_handle_currency(DictionaryIterator *iter, TrData *data) {
  Tuple *t = dict_find(iter, MESSAGE_KEY_CURRENCY);
  if (t) {
    snprintf(data->currency, sizeof(data->currency), "%s", t->value->cstring);
  }
}

static void prv_handle_interval(DictionaryIterator *iter, TrData *data) {
  Tuple *idx_t = dict_find(iter, MESSAGE_KEY_INTERVAL_IDX);
  Tuple *name_t = dict_find(iter, MESSAGE_KEY_INTERVAL_NAME);
  Tuple *abs_t = dict_find(iter, MESSAGE_KEY_INTERVAL_ABS);
  Tuple *pct_t = dict_find(iter, MESSAGE_KEY_INTERVAL_PCT);
  if (!idx_t) { return; }
  int idx = (int)idx_t->value->int32;
  if (idx < 0 || idx >= TR_MAX_INTERVALS) { return; }
  TrInterval *iv = &data->intervals[idx];
  iv->available = true;
  if (name_t) { snprintf(iv->name, sizeof(iv->name), "%s", name_t->value->cstring); }
  if (abs_t)  { snprintf(iv->abs_str, sizeof(iv->abs_str), "%s", abs_t->value->cstring); }
  if (pct_t)  { snprintf(iv->pct_str, sizeof(iv->pct_str), "%s", pct_t->value->cstring); }
  if (idx + 1 > data->interval_count) { data->interval_count = idx + 1; }
}

static void prv_handle_error(DictionaryIterator *iter, TrData *data) {
  Tuple *t = dict_find(iter, MESSAGE_KEY_ERROR_MSG);
  if (t) {
    snprintf(data->error_msg, sizeof(data->error_msg), "%s", t->value->cstring);
  }
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  if (!s_data) { return; }
  TrData *data = s_data;

  prv_handle_state(iter, data);
  prv_handle_total(iter, data);
  prv_handle_cash(iter, data);
  prv_handle_currency(iter, data);
  prv_handle_interval(iter, data);
  prv_handle_error(iter, data);

  Tuple *done_t = dict_find(iter, MESSAGE_KEY_DONE);
  bool payload_complete = done_t != NULL;

  // state changes and payload updates both need a redraw
  extern void ui_refresh(void);
  ui_refresh();

  if (payload_complete) {
    // payload fully received: make sure we render as READY
    if (data->state != TR_STATE_ERROR && data->state != TR_STATE_LOGIN_PROMPT) {
      data->state = TR_STATE_READY;
    }
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Payload: total=%s cash=%s cur=%s intervals=%d state=%d",
            data->total, data->cash, data->currency, data->interval_count, (int)data->state);
    for (int i = 0; i < data->interval_count; i++) {
      TrInterval *iv = &data->intervals[i];
      APP_LOG(APP_LOG_LEVEL_DEBUG, "  [%d] %s abs=%s pct=%s avail=%d", i, iv->name, iv->abs_str, iv->pct_str, (int)iv->available);
    }
    ui_refresh();
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox message dropped: %d", (int)reason);
}

static void prv_outbox_sent(DictionaryIterator *iter, void *context) {
  // The outbox callback carries no status in this SDK; failures surface
  // through app_message_outbox_send() return values at send time.
}

// ---------------------------------------------------------------------------
// Init / deinit / outbox
// ---------------------------------------------------------------------------

void messaging_init(TrData *data) {
  s_data = data;

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  app_message_register_outbox_sent(prv_outbox_sent);

  // Larger buffers than the 256 B default so multi-key payload messages are
  // never dropped; each individual message stays small anyway.
  const uint32_t inbox_size = 1024;
  const uint32_t outbox_size = 512;
  app_message_open(inbox_size, outbox_size);
}

void messaging_deinit(void) {
  app_message_deregister_callbacks();
  s_data = NULL;
}

void messaging_send_cmd(TrCmd cmd) {
  DictionaryIterator *iter;
  AppMessageResult res = app_message_outbox_begin(&iter);
  if (res != APP_MSG_OK) { return; }
  dict_write_int32(iter, MESSAGE_KEY_CMD, (int32_t)cmd);
  res = app_message_outbox_send();
  if (res != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox begin/send failed: %d", (int)res);
  }
}
