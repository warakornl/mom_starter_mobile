/**
 * calendarAddCaptureHandler — pure helper for the Day-Detail "Add" → Capture hand-off.
 *
 * Spec refs:
 *   capture-ui.md §2     — when the generic "Add" is tapped (no pre-set type),
 *                          the Capture screen opens with the type segmented
 *                          control visible; date defaults to the selected civil day.
 *   calendar-home-screens §4.4 — the civil date is handed off as-is (YYYY-MM-DD);
 *                          no timezone conversion is performed.
 *   types.ts Capture     — { metricType?, loggedAtDate?, defaultTime? }
 *                          metricType absent  → type control shown (generic Add)
 *                          defaultTime absent → CaptureScreen computes default
 *                                              (now on today / 12:00 on non-today)
 *
 * Security: no health values in params (PDPA SD-9).
 */

/**
 * Builds the route params to pass to `navigation.navigate('Capture', params)`
 * when the user taps the Day-Detail "Add / บันทึกสุขภาพ" affordance.
 *
 * @param selectedCivilDate - The civil date currently shown in the Day-Detail
 *   (YYYY-MM-DD string from CalendarScreen state). Passed through unchanged.
 * @returns Capture route params with only `loggedAtDate` set so CaptureScreen
 *   shows the type segmented control (generic Add path).
 */
export function buildAddCaptureParams(selectedCivilDate: string): {
  loggedAtDate: string;
} {
  return { loggedAtDate: selectedCivilDate };
}
