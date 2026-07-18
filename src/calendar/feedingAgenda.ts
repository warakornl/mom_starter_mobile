/**
 * feedingAgenda.ts — pure helper for surfacing feeding sessions in the
 * CalendarScreen selected-day agenda.
 *
 * Bug fix (owner report "บันทึกการให้นมไม่ขึ้นในปฏิทิน" — feeding log doesn't
 * appear in the calendar). ROOT CAUSE: feedingSessionStore was written to by
 * FeedingLogScreen but never read anywhere else — CalendarScreen had no
 * concept of feeding sessions at all (no CalendarItem kind, no agenda row).
 * This mirrors kickCountAgenda.ts (the shipped precedent for surfacing an
 * independent local session store on the calendar's selected-day agenda).
 *
 * Design decisions (parity with kickCountAgenda.ts):
 *  - Pure function with no side-effects; injectable toCivilDate for testability.
 *  - Reuses bucketCivilDay (the same civil-date extractor used by CalendarScreen
 *    for checklist + occurrence + kick-count items — FLAG-1 consistency).
 *  - Sorted ascending by startedAt so earliest session appears first.
 *  - Excludes tombstoned sessions (deletedAt set) — immutable-event soft-delete.
 *  - Returns a minimal view-model: id + timeLabel + kind; no health quantities
 *    (amountSubUnits/volumeMl/durationSeconds) are surfaced (K-8 minimisation).
 *
 * Security (MOTHER-health K-8):
 *  - NEVER console.log amountSubUnits, volumeMl, durationSeconds, or note.
 *  - The view model exposes only kind (breastfeed/pump/formula) for the icon/label.
 *  - Route params MUST NOT carry health data (display-only rows; no navigation).
 */

import { bucketCivilDay } from './civilDayBucketer';
import type { FeedingSessionRecord } from '../sync/syncTypes';

// ─── View model ───────────────────────────────────────────────────────────────

/**
 * Minimal view model for one feeding session in the calendar agenda.
 * Only the fields needed for display are included (K-8: minimise health exposure).
 */
export interface FeedingAgendaItem {
  id: string;
  /**
   * HH:mm string derived from startedAt (floating-civil "YYYY-MM-DDTHH:mm").
   * Matches the time-display pattern in CalendarScreen (scheduledAt.slice(11,16)).
   */
  timeLabel: string;
  /** Feed kind — drives the agenda row's label/icon (breastfeed/pump/formula). */
  kind: 'breastfeed' | 'pump' | 'formula';
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Filter and map feeding sessions to the calendar agenda view model for a
 * given selected civil date.
 *
 * @param sessions     Array of sessions from feedingSessionStore.getAll().
 * @param selectedDate Civil date string "YYYY-MM-DD" (the day being viewed).
 * @param toCivilDate  Civil-date extractor — defaults to `bucketCivilDay`.
 *                     Injected as a parameter for unit-testability; CalendarScreen
 *                     passes the same bucketCivilDay it already uses for checklist/
 *                     occurrence/kick-count items (FLAG-1 consistency).
 *
 * @returns FeedingAgendaItem[] sorted by startedAt ascending.
 *          Returns [] when no sessions fall on selectedDate.
 *
 * Security: no health data is logged at any point (MOTHER-health K-8).
 */
export function getFeedingSessionsForDate(
  sessions: FeedingSessionRecord[],
  selectedDate: string,
  toCivilDate: (timestamp: string) => string = bucketCivilDay,
): FeedingAgendaItem[] {
  return sessions
    .filter((s) => !s.deletedAt)
    .filter((s) => toCivilDate(s.startedAt) === selectedDate)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => ({
      id: s.id,
      // slice(11,16) extracts "HH:mm" from "YYYY-MM-DDTHH:mm" (FLAG-1 floating-civil)
      // — same pattern CalendarScreen uses for scheduledAt and scheduledLocalTime.
      timeLabel: s.startedAt.slice(11, 16),
      kind: s.kind,
    }));
}
