/**
 * src/notifications/excludedIds.ts — Native-free helper: build the set of
 * occurrence IDs that must be excluded from the OS notification schedule.
 *
 * This module intentionally imports NOTHING from expo-notifications or any
 * other native/device module, so it can be unit-tested directly in Node.js
 * (Jest) without a real device or Expo dev-build.
 *
 * Public re-export: src/notifications/index.ts → buildExcludedIds
 */

import type { ReminderOccurrenceRecord } from '../sync/syncTypes';

/**
 * Build the set of occurrence IDs that should NOT be (re-)scheduled as OS
 * notifications on the next reanchor pass.
 *
 * Excluded statuses:
 *   - `done`    — terminal; must never be re-scheduled (MR-AC-11).
 *   - `snoozed` — the original alarm was cancelled via cancelForOccurrence();
 *                 the snooze RESCHEDULE at snoozedUntil is DEFERRED to Task 5.
 *                 Until Task 5 lands, a snoozed occurrence is effectively silent
 *                 (no alarm fires at either the original time or snoozedUntil).
 *
 * Ignored (not excluded):
 *   - tombstoned occurrences (`deletedAt` set) — the parent reminder was
 *     deleted; the reminder itself is already filtered by buildScheduleSet so
 *     there is nothing to exclude here.
 *   - `due` / `missed` occurrences — still eligible for scheduling.
 *
 * @param occurrences  All materialized ReminderOccurrenceRecords from the store.
 * @param _now         Reserved parameter (unused until Task 5 adds partial-snooze
 *                     logic); kept in signature to avoid a breaking API change.
 */
export function buildExcludedIds(
  occurrences: ReminderOccurrenceRecord[],
  _now: Date = new Date(),
): Set<string> {
  const excluded = new Set<string>();
  for (const occ of occurrences) {
    if (occ.deletedAt) continue; // tombstoned — ignore, not excluded
    if (occ.status === 'done' || occ.status === 'snoozed') {
      excluded.add(occ.id);
    }
  }
  return excluded;
}
