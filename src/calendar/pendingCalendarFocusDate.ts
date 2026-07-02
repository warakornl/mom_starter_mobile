/**
 * pendingCalendarFocusDate — module-level focus-date slot.
 *
 * Pattern: set on appointment/reminder save (before navigation.goBack()),
 * consumed in CalendarScreen useFocusEffect to auto-select the new item's date.
 *
 * This avoids threading focusDate through route params or adding it to
 * CalendarScreenProps. The slot is write-once-per-navigation: the form screen
 * sets it immediately before calling onSave() → navigation.goBack(), and
 * CalendarScreen consumes it on the very next focus event.
 *
 * Security: the date string is YYYY-MM-DD — no health data, no PII.
 */

let pending: string | null = null;

/**
 * Set the calendar date that should be auto-selected when CalendarScreen
 * next regains focus. Call this before invoking onSave() / navigation.goBack().
 */
export function setPendingCalendarFocusDate(date: string): void {
  pending = date;
}

/**
 * Consume (read and clear) the pending focus date.
 * Returns null if nothing is pending.
 * Idempotent — safe to call multiple times; only the first call gets the value.
 */
export function consumePendingCalendarFocusDate(): string | null {
  const d = pending;
  pending = null;
  return d;
}
