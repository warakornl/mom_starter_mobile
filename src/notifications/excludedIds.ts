/**
 * src/notifications/excludedIds.ts — Native-free helper: build the set of
 * occurrence IDs excluded from the OS notification schedule, and the map of
 * snoozed occurrences that must be scheduled at their snoozedUntil instead
 * of their original scheduledLocalTime.
 *
 * This module intentionally imports NOTHING from expo-notifications or any
 * other native/device module, so it can be unit-tested directly in Node.js
 * (Jest) without a real device or Expo dev-build.
 *
 * Task 5 update:
 *   buildExcludedIds now excludes ONLY `done` occurrences. Snoozed occurrences
 *   are rescheduled at their snoozedUntil by buildScheduleSet (approach A) —
 *   they must NOT be globally excluded or the snooze alarm would never be set
 *   on re-anchor. The old Task-2 comment "snoozed reschedule DEFERRED to Task 5"
 *   is now resolved: Task 5 implements it here via buildSnoozedUntilMap.
 *
 * Public re-exports: src/notifications/index.ts → buildExcludedIds, buildSnoozedUntilMap
 */

import type { ReminderOccurrenceRecord } from '../sync/syncTypes';
import type { SnoozedOccurrenceEntry } from './notificationScheduler';

/**
 * Build the set of occurrence IDs that should NOT be (re-)scheduled as OS
 * notifications on the next reanchor pass.
 *
 * Excluded statuses (Task 5 update):
 *   - `done`    — terminal; must never be re-scheduled (MR-AC-11).
 *
 * NOT excluded (Task 5 change from Task 2):
 *   - `snoozed` — the original alarm is cancelled immediately at snooze-pick
 *                 time; the replacement alarm at snoozedUntil is scheduled via
 *                 buildSnoozedUntilMap + buildScheduleSet. buildExcludedIds must
 *                 NOT exclude snoozed or reanchor() would cancel the snooze alarm.
 *
 * Ignored (not excluded):
 *   - tombstoned occurrences (`deletedAt` set) — the parent reminder was
 *     deleted; the reminder itself is already filtered by buildScheduleSet.
 *   - `due` / `missed` occurrences — still eligible for scheduling.
 *
 * @param occurrences  All materialized ReminderOccurrenceRecords from the store.
 * @param _now         Reserved parameter; kept for API compatibility with callers
 *                     that pass `new Date()`. Task 5: snooze past/future distinction
 *                     is now handled by buildSnoozedUntilMap, not here.
 */
export function buildExcludedIds(
  occurrences: ReminderOccurrenceRecord[],
  _now: Date = new Date(),
): Set<string> {
  const excluded = new Set<string>();
  for (const occ of occurrences) {
    if (occ.deletedAt) continue; // tombstoned — ignore, not excluded
    if (occ.status === 'done') {
      excluded.add(occ.id);
    }
    // NOTE: snoozed occurrences are intentionally NOT excluded here (Task 5).
    // They are rescheduled at snoozedUntil via buildSnoozedUntilMap passed to
    // buildScheduleSet. Excluding them here would cause reanchor() to cancel
    // the snooze alarm on the next foreground trigger.
  }
  return excluded;
}

/**
 * Build a map of occurrence IDs → their snoozedUntil Date, for active snoozed
 * occurrences where the snooze alarm has not yet fired.
 *
 * Used by buildScheduleSet (Task 5) to schedule snoozed occurrences at their
 * snoozedUntil instead of their original scheduledLocalTime (which is in the
 * past for a snoozed occurrence).
 *
 * Included: active (non-tombstoned) `snoozed` occurrences with a non-null
 *           snoozedUntil that is strictly in the future (> now).
 *
 * Not included:
 *   - `snoozedUntil` is null or in the past (alarm already fired/missed)
 *   - tombstoned occurrences (deletedAt set)
 *   - `done`, `due`, `missed` statuses
 *
 * Single-pending-alarm guarantee (MR-E11 / INV-MR-5):
 *   The occurrence id is the OS notification identifier. Scheduling the same
 *   id at a new time replaces the existing alarm (ADR Decision 2 "Idempotency").
 *   buildSnoozedUntilMap + buildScheduleSet ensure at most ONE alarm per oid.
 *
 * Fix B (cross-midnight): the SnoozedOccurrenceEntry carries reminderId and
 *   scheduledLocalTime so buildScheduleSet can emit an orphaned snoozed alarm
 *   even when the original civil time is no longer re-emitted by the expander
 *   (e.g. a 23:50 dose snoozed to 00:50 next day — after midnight the 23:50
 *   slot is before windowStart and not expanded).
 *
 * @param occurrences  All materialized ReminderOccurrenceRecords from the store.
 * @param now          Current wall-clock time (used to filter out past snoozedUntil).
 */
export function buildSnoozedUntilMap(
  occurrences: ReminderOccurrenceRecord[],
  now: Date,
): Map<string, SnoozedOccurrenceEntry> {
  const map = new Map<string, SnoozedOccurrenceEntry>();
  const nowMs = now.getTime();
  for (const occ of occurrences) {
    if (occ.deletedAt) continue; // tombstoned
    if (occ.status !== 'snoozed') continue;
    if (!occ.snoozedUntil) continue;
    const snoozedUntilMs = new Date(occ.snoozedUntil).getTime();
    if (snoozedUntilMs <= nowMs) continue; // alarm already fired/missed
    map.set(occ.id, {
      snoozedUntil: new Date(occ.snoozedUntil),
      reminderId: occ.reminderId,
      scheduledLocalTime: occ.scheduledLocalTime,
    });
  }
  return map;
}
