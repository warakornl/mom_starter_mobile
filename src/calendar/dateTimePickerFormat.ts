/**
 * dateTimePickerFormat — timezone-safe helpers for DateTimePicker integration.
 *
 * The app stores dates as FLOATING-CIVIL strings ("YYYY-MM-DD" / "HH:mm").
 * DateTimePicker requires Date objects. These helpers bridge the gap while
 * preserving the civil-date invariant: conversions use LOCAL date/time
 * components — never toISOString() or UTC methods — so a date string can never
 * shift to an adjacent day due to UTC offset or DST transitions.
 *
 * Safe:   new Date(y, m-1, d)  +  getFullYear/getMonth/getDate
 * Unsafe: new Date(isoString)  +  toISOString() (UTC shift risk)
 */

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a Date to a "YYYY-MM-DD" civil-date string using LOCAL components.
 * Safe at any UTC offset; never shifts the day at midnight.
 */
export function toCivilDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse a "YYYY-MM-DD" string into a Date at LOCAL midnight.
 * Uses the Date(y, m, d) constructor which produces local-midnight — the only
 * safe constructor for floating-civil dates.
 */
export function parseCivilDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a Date to a "HH:mm" civil-time string using LOCAL hours/minutes.
 * Seconds and milliseconds are ignored.
 */
export function toCivilTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Parse a "HH:mm" string into a Date with LOCAL hours/minutes set on today.
 * Only the time components of the returned Date are meaningful.
 */
export function parseCivilTime(s: string): Date {
  const [h, m] = s.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
