/**
 * kickCountAgenda.ts — pure helper for surfacing completed kick-count sessions
 * in the CalendarScreen selected-day agenda.
 *
 * Design decisions:
 *  - Pure function with no side-effects; injectable toCivilDate for testability.
 *  - Reuses bucketCivilDay (the same civil-date extractor used by CalendarScreen
 *    for checklist + occurrence items — FLAG-1 consistency).
 *  - Sorted ascending by startedAt so earliest session appears first.
 *  - Returns a minimal view-model: CalendarScreen needs id + timeLabel + count;
 *    no health fields beyond movementCount are surfaced for display.
 *
 * Security (MOTHER-health K-8):
 *  - NEVER console.log movementCount or any session field.
 *  - The view model exposes movementCount solely for display ("นับลูกดิ้น: N ครั้ง").
 *  - Route params MUST NOT carry health data (display-only rows; no navigation).
 */

import { bucketCivilDay } from './civilDayBucketer';
import type { KickCountSessionRecord } from '../kickCount/kickCountTypes';

// ─── View model ───────────────────────────────────────────────────────────────

/**
 * Minimal view model for one kick-count session in the calendar agenda.
 * Only the fields needed for display are included (K-8: minimise health exposure).
 */
export interface KickCountAgendaItem {
  id: string;
  /**
   * HH:mm string derived from startedAt (floating-civil "YYYY-MM-DDTHH:mm").
   * Matches the time-display pattern in CalendarScreen (scheduledAt.slice(11,16)).
   */
  timeLabel: string;
  /**
   * Accumulated tap count.
   * Security: display-only — NEVER log this value (MOTHER-health K-8).
   */
  movementCount: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Filter and map kick-count sessions to the calendar agenda view model for
 * a given selected civil date.
 *
 * @param sessions     Array of active (non-tombstoned) sessions from
 *                     kickCountSyncStore.getActiveSessions().
 * @param selectedDate Civil date string "YYYY-MM-DD" (the day being viewed).
 * @param toCivilDate  Civil-date extractor — defaults to `bucketCivilDay`.
 *                     Injected as a parameter for unit-testability; CalendarScreen
 *                     passes the same bucketCivilDay it already uses for checklist +
 *                     occurrence items (FLAG-1 consistency).
 *
 * @returns KickCountAgendaItem[] sorted by startedAt ascending.
 *          Returns [] when no sessions fall on selectedDate.
 *
 * Security: no health data is logged at any point (MOTHER-health K-8).
 */
export function getKickCountSessionsForDate(
  sessions: KickCountSessionRecord[],
  selectedDate: string,
  toCivilDate: (timestamp: string) => string = bucketCivilDay,
): KickCountAgendaItem[] {
  return sessions
    .filter((s) => toCivilDate(s.startedAt) === selectedDate)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => ({
      id: s.id,
      // slice(11,16) extracts "HH:mm" from "YYYY-MM-DDTHH:mm" (FLAG-1 floating-civil)
      // — same pattern CalendarScreen uses for scheduledAt and scheduledLocalTime.
      timeLabel: s.startedAt.slice(11, 16),
      movementCount: s.movementCount,
    }));
}
