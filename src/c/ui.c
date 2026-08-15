#include "ui.h"
#include "messaging.h"

static Window *s_window;
static Layer *s_canvas;
static TrData *s_data;
static int s_focus = 0;      // focused interval row
static int s_scroll = 0;     // first visible row index

static const GPathInfo s_tri_up   = { 3, (GPoint[]) { { -4, 3 }, { 4, 3 }, { 0, -2 } } };
static const GPathInfo s_tri_down = { 3, (GPoint[]) { { -4, -2 }, { 4, -2 }, { 0, 3 } } };


// ---------------------------------------------------------------------------
// Layout (bounds-driven so it adapts to every screen size)
//   emery : 200x228 rectangular, 64-color
//   gabbro: 260x260 round, 64-color
// ---------------------------------------------------------------------------
#define SCREEN_INSET   (PBL_ROUND ? 24 : 10)
#define TOTAL_H        34
#define STATUS_H       18
#define ROW_H_MAX      30
#define ROW_H_MIN      24

typedef struct {
  int inset;
  int total_y;
  int rows_top;
  int row_height;
  int visible_rows;
  bool show_cash;
} TrLayout;

static TrLayout prv_layout_for(GRect bounds) {
  TrLayout l;
#if defined(PBL_ROUND)
  l.inset = 24;
  l.total_y = 16;
  l.show_cash = false;        // round screens: no cash line (space is tight)
#else
  l.inset = 10;
  l.total_y = 10;
  l.show_cash = true;
#endif

  int rows_top = l.total_y + TOTAL_H + (l.show_cash ? 22 : 8);
  int bottom_limit = bounds.size.h - l.inset - STATUS_H - 2;
  int rows_area = bottom_limit - rows_top;
  if (rows_area < 0) { rows_area = 0; }

  l.row_height = rows_area / 5;
  if (l.row_height > ROW_H_MAX) { l.row_height = ROW_H_MAX; }
  if (l.row_height < ROW_H_MIN) { l.row_height = ROW_H_MIN; }

  l.visible_rows = rows_area / l.row_height;
  if (l.visible_rows > 5) { l.visible_rows = 5; }
  if (l.visible_rows < 1) { l.visible_rows = 1; }

  l.rows_top = rows_top;
  return l;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
static void prv_draw_text(GContext *ctx, const char *text, GFont font, GRect rect,
                          GTextOverflowMode overflow, GTextAlignment align, GColor color) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, font, rect, overflow, align, NULL);
}


static bool prv_interval_positive(const TrInterval *iv) {
  if (!iv->available) { return true; }
  return iv->pct_str[0] != '-';
}

static GColor prv_interval_color(const TrInterval *iv) {
  if (!iv->available) { return GColorLightGray; }
  return prv_interval_positive(iv) ? GColorGreen : GColorRed;
}

static void prv_draw_centered_lines(GContext *ctx, GRect bounds, const char *line1,
                                    const char *line2, const char *line3,
                                    GColor color1, GColor color2, GColor color3,
                                    GFont font1, GFont font2, GFont font3) {
#if defined(PBL_ROUND)
  int inset = 24;
#else
  int inset = 10;
#endif
  int y = bounds.origin.y + bounds.size.h / 2;

  GSize s1 = graphics_text_layout_get_content_size(line1, font1, GRect(0, 0, bounds.size.w - 2 * inset, 200),
                                                   GTextOverflowModeWordWrap, GTextAlignmentCenter);
  if (line2) {
    GSize s2 = graphics_text_layout_get_content_size(line2, font2, GRect(0, 0, bounds.size.w - 2 * inset, 200),
                                                     GTextOverflowModeWordWrap, GTextAlignmentCenter);
    if (line3) {
      GSize s3 = graphics_text_layout_get_content_size(line3, font3, GRect(0, 0, bounds.size.w - 2 * inset, 200),
                                                       GTextOverflowModeWordWrap, GTextAlignmentCenter);
      int total_h = s1.h + s2.h + s3.h;
      y = bounds.origin.y + (bounds.size.h - total_h) / 2;
      prv_draw_text(ctx, line1, font1, GRect(inset, y, bounds.size.w - 2 * inset, s1.h),
                         GTextOverflowModeWordWrap, GTextAlignmentCenter, color1);
      y += s1.h;
      prv_draw_text(ctx, line2, font2, GRect(inset, y, bounds.size.w - 2 * inset, s2.h),
                         GTextOverflowModeWordWrap, GTextAlignmentCenter, color2);
      y += s2.h;
      prv_draw_text(ctx, line3, font3, GRect(inset, y, bounds.size.w - 2 * inset, s3.h),
                         GTextOverflowModeWordWrap, GTextAlignmentCenter, color3);
    } else {
      int total_h = s1.h + s2.h;
      y = bounds.origin.y + (bounds.size.h - total_h) / 2;
      prv_draw_text(ctx, line1, font1, GRect(inset, y, bounds.size.w - 2 * inset, s1.h),
                         GTextOverflowModeWordWrap, GTextAlignmentCenter, color1);
      y += s1.h;
      prv_draw_text(ctx, line2, font2, GRect(inset, y, bounds.size.w - 2 * inset, s2.h),
                         GTextOverflowModeWordWrap, GTextAlignmentCenter, color2);
    }
  } else {
    y = bounds.origin.y + (bounds.size.h - s1.h) / 2;
    prv_draw_text(ctx, line1, font1, GRect(inset, y, bounds.size.w - 2 * inset, s1.h),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, color1);
  }
}

// ---------------------------------------------------------------------------
// state screens (no data)
// ---------------------------------------------------------------------------

static void prv_draw_state_screen(GContext *ctx, GRect bounds) {
  switch (s_data->state) {
    case TR_STATE_LOADING:
      prv_draw_centered_lines(ctx, bounds, "Refreshing...", NULL, NULL,
                              GColorWhite, GColorWhite, GColorWhite,
                              fonts_get_system_font(FONT_KEY_GOTHIC_24),
                              NULL, NULL);
      break;
    case TR_STATE_LOGIN_PROMPT:
      prv_draw_centered_lines(ctx, bounds, "Log in", "Press Select", NULL,
                              GColorWhite, GColorLightGray, GColorWhite,
                              fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18),
                              NULL);
      break;
    case TR_STATE_NEED_CREDS:
      prv_draw_centered_lines(ctx, bounds, "Open Settings", "in the Pebble app", "to enter phone + PIN",
                              GColorWhite, GColorLightGray, GColorLightGray,
                              fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18));
      break;
    case TR_STATE_AWAITING_CONFIRM:
      prv_draw_centered_lines(ctx, bounds, "Confirm login", "in the TR app", "...",
                              GColorYellow, GColorWhite, GColorLightGray,
                              fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18));
      break;
    case TR_STATE_SESSION_EXPIRED:
      prv_draw_centered_lines(ctx, bounds, "Session expired", "Press Select", "to re-login",
                              GColorOrange, GColorWhite, GColorLightGray,
                              fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18));
      break;
    case TR_STATE_ERROR:
      prv_draw_centered_lines(ctx, bounds, "Error", s_data->error_msg[0] ? s_data->error_msg : "Data unavailable",
                              "Select: retry",
                              GColorRed, GColorWhite, GColorLightGray,
                              fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18),
                              fonts_get_system_font(FONT_KEY_GOTHIC_14));
      break;
    default:
      prv_draw_centered_lines(ctx, bounds, "TR Portfolio", "Press Select", NULL,
                              GColorWhite, GColorLightGray, GColorWhite,
                              fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                              fonts_get_system_font(FONT_KEY_GOTHIC_18),
                              NULL);
      break;
  }
}

// ---------------------------------------------------------------------------
// data view
// ---------------------------------------------------------------------------

static void prv_draw_data(GContext *ctx, GRect bounds) {
  GRect rect = bounds;
  TrLayout lay = prv_layout_for(bounds);
  int inset = lay.inset;

  // --- total value ---------------------------------------------------------
  GFont total_font = fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD);
  char total_line[TR_VALUE_LEN + TR_CURRENCY_LEN + 2];
  if (s_data->total[0]) {
    snprintf(total_line, sizeof(total_line), "%s %s", s_data->total, s_data->currency);
  } else {
    snprintf(total_line, sizeof(total_line), "--");
  }
  prv_draw_text(ctx, total_line, total_font,
                GRect(inset, lay.total_y, rect.size.w - 2 * inset, TOTAL_H),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, GColorWhite);

  // --- cash (rectangular screens only) --------------------------------------
  if (lay.show_cash) {
    char cash_line[TR_VALUE_LEN + 16];
    if (s_data->cash[0]) {
      snprintf(cash_line, sizeof(cash_line), "Cash  %s %s", s_data->cash, s_data->currency);
    } else {
      snprintf(cash_line, sizeof(cash_line), "Cash  --");
    }
    prv_draw_text(ctx, cash_line, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                  GRect(inset, lay.total_y + TOTAL_H + 2, rect.size.w - 2 * inset, 20),
                  GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, GColorLightGray);
  }

  int rows_top = lay.rows_top;

  // --- interval rows --------------------------------------------------------
  if (s_data->interval_count <= 0) {
    prv_draw_centered_lines(ctx, GRect(0, rows_top, rect.size.w, rect.size.h - rows_top),
                            "No interval data", NULL, NULL,
                            GColorLightGray, GColorWhite, GColorWhite,
                            fonts_get_system_font(FONT_KEY_GOTHIC_18),
                            NULL, NULL);
    return;
  }

  // clamp focus / scroll
  if (s_focus < 0) { s_focus = 0; }
  if (s_focus >= s_data->interval_count) { s_focus = s_data->interval_count - 1; }
  if (s_focus < s_scroll) { s_scroll = s_focus; }
  if (s_focus >= s_scroll + lay.visible_rows) { s_scroll = s_focus - lay.visible_rows + 1; }
  if (s_scroll > s_data->interval_count - 1) { s_scroll = s_data->interval_count - 1; }
  if (s_scroll < 0) { s_scroll = 0; }

  GFont name_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GFont abs_font  = fonts_get_system_font(FONT_KEY_GOTHIC_24);
  GFont pct_font  = fonts_get_system_font(FONT_KEY_GOTHIC_18);

  for (int row = 0; row < lay.visible_rows; row++) {
    int idx = s_scroll + row;
    if (idx >= s_data->interval_count) { break; }
    TrInterval *iv = &s_data->intervals[idx];
    int y = rows_top + row * lay.row_height;
    GRect row_rect = GRect(inset, y, rect.size.w - 2 * inset, lay.row_height);

    bool focused = (idx == s_focus);
    if (focused) {
      graphics_context_set_fill_color(ctx, GColorWhite);
      graphics_fill_rect(ctx, row_rect, 3, GCornersAll);
    }

    GColor text_color = focused ? GColorBlack : GColorWhite;

    // name
    prv_draw_text(ctx, iv->name, name_font,
                  GRect(row_rect.origin.x + 4, row_rect.origin.y + 1,
                        row_rect.size.w - 8, lay.row_height - 2),
                  GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, text_color);

    // abs (right block)
    char abs_disp[TR_VALUE_LEN + 2];
    snprintf(abs_disp, sizeof(abs_disp), "%s", iv->abs_str[0] ? iv->abs_str : "--");
    prv_draw_text(ctx, abs_disp, abs_font,
                  GRect(row_rect.origin.x + 4, row_rect.origin.y + 1,
                        row_rect.size.w - 46, lay.row_height - 2),
                  GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, text_color);

    // pct (far right) + direction triangle
    char pct_disp[TR_VALUE_LEN + 2];
    snprintf(pct_disp, sizeof(pct_disp), "%s%%", iv->pct_str[0] ? iv->pct_str : "--");

    int pct_w = 42;
    GRect pct_rect = GRect(row_rect.origin.x + row_rect.size.w - 4 - pct_w,
                           row_rect.origin.y + 2, pct_w, lay.row_height - 4);
    GColor pct_color = focused ? text_color : prv_interval_color(iv);
    prv_draw_text(ctx, pct_disp, pct_font, pct_rect,
                  GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, pct_color);

    // triangle indicator before the pct (only when not focused)
    if (!focused && iv->available) {
      bool positive = prv_interval_positive(iv);
      int tx = pct_rect.origin.x - 8;
      int ty = pct_rect.origin.y + (lay.row_height - 4) / 2;
      GPath *path = gpath_create(positive ? &s_tri_up : &s_tri_down);
      gpath_move_to(path, GPoint(tx, ty));
      graphics_context_set_fill_color(ctx, prv_interval_color(iv));
      gpath_draw_filled(ctx, path);
      gpath_destroy(path);
    }
  }

  // --- status banner while loading / error (keep last values) --------------
  if (s_data->state == TR_STATE_LOADING) {
    prv_draw_text(ctx, "Refreshing...", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                  GRect(inset, rect.size.h - inset - STATUS_H,
                        rect.size.w - 2 * inset, STATUS_H),
                  GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, GColorLightGray);
  } else if (s_data->state == TR_STATE_ERROR) {
    prv_draw_text(ctx, "Update failed — Select: retry", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                  GRect(inset, rect.size.h - inset - STATUS_H,
                        rect.size.w - 2 * inset, STATUS_H),
                  GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, GColorRed);
  } else if (s_data->state == TR_STATE_SESSION_EXPIRED) {
    prv_draw_text(ctx, "Session expired — Select: re-login", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                  GRect(inset, rect.size.h - inset - STATUS_H,
                        rect.size.w - 2 * inset, STATUS_H),
                  GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, GColorOrange);
  }
}
// ---------------------------------------------------------------------------
// canvas update
// ---------------------------------------------------------------------------

static void prv_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornersAll);

  bool show_data = s_data->has_data &&
                   (s_data->state == TR_STATE_READY ||
                    s_data->state == TR_STATE_LOADING ||
                    s_data->state == TR_STATE_ERROR ||
                    s_data->state == TR_STATE_SESSION_EXPIRED);

  if (show_data && s_data->total[0]) {
    prv_draw_data(ctx, bounds);
  } else {
    prv_draw_state_screen(ctx, bounds);
  }
}

// ---------------------------------------------------------------------------
// buttons
// ---------------------------------------------------------------------------

static void prv_up_click(ClickRecognizerRef recognizer, void *context) {
  if (s_data->state != TR_STATE_READY || s_data->interval_count <= 0) { return; }
  if (s_focus > 0) { s_focus--; }
  layer_mark_dirty(s_canvas);
}

static void prv_down_click(ClickRecognizerRef recognizer, void *context) {
  if (s_data->state != TR_STATE_READY || s_data->interval_count <= 0) { return; }
  if (s_focus < s_data->interval_count - 1) { s_focus++; }
  layer_mark_dirty(s_canvas);
}

static void prv_select_click(ClickRecognizerRef recognizer, void *context) {
  switch (s_data->state) {
    case TR_STATE_LOGIN_PROMPT:
    case TR_STATE_NEED_CREDS:
    case TR_STATE_AWAITING_CONFIRM:
    case TR_STATE_SESSION_EXPIRED:
      messaging_send_cmd(TR_CMD_LOGIN);
      break;
    case TR_STATE_READY:
    case TR_STATE_LOADING:
    case TR_STATE_ERROR:
    default:
      messaging_send_cmd(TR_CMD_REFRESH);
      break;
  }
}

static void prv_select_long_click(ClickRecognizerRef recognizer, void *context) {
  // long-press = re-login trigger
  messaging_send_cmd(TR_CMD_LOGIN);
}

static void prv_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, prv_up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 700, prv_select_long_click, NULL);
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

void ui_refresh(void) {
  if (s_canvas) { layer_mark_dirty(s_canvas); }
}

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  s_canvas = layer_create(bounds);
  layer_set_update_proc(s_canvas, prv_update_proc);
  layer_add_child(window_layer, s_canvas);
}

static void prv_window_unload(Window *window) {
  layer_destroy(s_canvas);
  s_canvas = NULL;
}

void ui_init(TrData *data) {
  s_data = data;
  s_focus = 0;
  s_scroll = 0;

  s_window = window_create();
  window_set_click_config_provider(s_window, prv_click_config_provider);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  window_set_background_color(s_window, GColorBlack);
  const bool animated = true;
  window_stack_push(s_window, animated);
}

void ui_deinit(void) {
  window_destroy(s_window);
  s_window = NULL;
}
