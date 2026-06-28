/**
 * FLAG-1: event-log timestamps are floating-civil. The calendar bucket is the
 * date part of the civil datetime, taken WITHOUT any time-zone conversion, so a
 * day's items never shift when the device crosses time zones / DST.
 */
export function bucketCivilDay(scheduledLocalCivil: string): string {
  // "YYYY-MM-DDTHH:mm" -> "YYYY-MM-DD"
  return scheduledLocalCivil.slice(0, 10);
}
