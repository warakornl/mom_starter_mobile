/**
 * src/notifications/index.ts — Public API for the on-device notification firing layer.
 *
 * Wires the real NotificationsAdapter (expo-notifications) with the pure scheduler
 * logic (notificationScheduler.ts). Call these from CalendarScreen, boot handlers,
 * and timezone-change listeners.
 *
 * Task 5 update:
 *   - reanchor() now builds buildSnoozedUntilMap from occurrences and passes it to
 *     reanchorImpl, so snoozed occurrences are rescheduled at snoozedUntil on
 *     every foreground/boot/tz-change re-anchor (approach A — single source of truth).
 *   - scheduleSnooze() is exposed for immediate snooze-pick scheduling.
 *   - buildSnoozedUntilMap re-exported for callers that need it independently.
 *
 * Usage (app-lifecycle integration):
 *   import { reanchor, cancelForOccurrence, scheduleSnooze } from '../notifications';
 *   import { MEDICATION_TITLE_TH } from '../notifications';
 *
 *   // On app foreground:
 *   const reminders = calendarSyncStore.getReminders();
 *   const occurrences = calendarSyncStore.getOccurrences();
 *   await reanchor(reminders, occurrences, new Date());
 *
 *   // On snooze pick (medication, 10 min):
 *   const snoozedUntil = new Date(Date.now() + 10 * 60 * 1000);
 *   await scheduleSnooze(occurrenceId, snoozedUntil, MEDICATION_TITLE_TH);
 *
 *   // On mark-done / snooze:
 *   await cancelForOccurrence(occurrenceId);
 *
 * Note: expo-notifications native module is NOT available in Jest (Node.js test
 * environment). Tests import from notificationScheduler.ts directly and inject a
 * mock NotificationsAdapter. Do not call getAdapter() in tests.
 *
 * Security: No sensitive data (drug name, dose, personal health value) is ever
 *   passed to expo-notifications. Only the generic constants from
 *   notificationScheduler.ts are used as notification titles.
 */

import { createRealAdapter, type NotificationsAdapter } from './notificationsAdapter';
import {
  scheduleUpcoming,
  cancelForOccurrence as cancelForOccurrenceImpl,
  reanchor as reanchorImpl,
  scheduleSnooze as scheduleSnoozeImpl,
  MEDICATION_TITLE_TH,
  WINDOW_DAYS,
  PENDING_BUDGET,
} from './notificationScheduler';
import { buildExcludedIds, buildSnoozedUntilMap } from './excludedIds';
import type { ReminderRecord, ReminderOccurrenceRecord } from '../sync/syncTypes';

// ─── Adapter singleton ────────────────────────────────────────────────────────

let _adapter: NotificationsAdapter | null = null;

/**
 * Returns the shared real NotificationsAdapter, creating it once.
 * Lazy init so the native module is only touched at call-time, not import-time.
 */
export function getAdapter(): NotificationsAdapter {
  if (!_adapter) {
    _adapter = createRealAdapter();
  }
  return _adapter;
}

// ─── Excluded ids builder — re-exported from native-free excludedIds.ts ───────
//
// buildExcludedIds is implemented in src/notifications/excludedIds.ts which has
// NO native imports and can be unit-tested directly in Node.js / Jest.
// Re-exported here so callers can import from the single public API entry point.
export { buildExcludedIds, buildSnoozedUntilMap };

// ─── Public API (wired to real adapter) ──────────────────────────────────────

/**
 * Schedule OS notifications for near-term occurrences within the rolling window.
 * Called on app foreground and after boot.
 *
 * @param reminders   Active ReminderRecords from calendarSyncStore
 * @param occurrences Materialized ReminderOccurrenceRecords (for excludedIds + snoozedUntilMap)
 * @param now         Current wall-clock time (default: new Date())
 */
export async function scheduleUpcomingForReminders(
  reminders: ReminderRecord[],
  occurrences: ReminderOccurrenceRecord[],
  now: Date = new Date(),
): Promise<void> {
  const excludedIds = buildExcludedIds(occurrences, now);
  const snoozedUntilMap = buildSnoozedUntilMap(occurrences, now);
  await scheduleUpcoming(reminders, excludedIds, now, getAdapter(), snoozedUntilMap);
}

/**
 * Cancel the pending OS notification for a single occurrence.
 * Call immediately when mark-done or snooze is triggered.
 *
 * @param occurrenceId Deterministic uuidv5 occurrence id
 */
export async function cancelForOccurrence(occurrenceId: string): Promise<void> {
  await cancelForOccurrenceImpl(occurrenceId, getAdapter());
}

/**
 * Schedule exactly one snooze alarm at snoozedUntil for the given occurrence.
 *
 * Call immediately when the user picks a snooze duration so the OS alarm is set
 * right away (not on the next reanchor). Re-snooze calls this again with a new
 * snoozedUntil — scheduling the same occurrence id replaces the existing alarm
 * (idempotent OS replace — MR-E11 / INV-MR-5).
 *
 * SD-11: for medication occurrences, title MUST be MEDICATION_TITLE_TH (generic
 * constant — never the drug name). For non-medication, pass reminder.displayTitle.
 *
 * Permission-declined is non-fatal (spec §1.5 / §2.4).
 *
 * @param occurrenceId Deterministic uuidv5 occurrence id
 * @param snoozedUntil Absolute Date at which the snooze alarm should fire
 * @param title        Lock-screen title (MEDICATION_TITLE_TH or displayTitle)
 */
export async function scheduleSnooze(
  occurrenceId: string,
  snoozedUntil: Date,
  title: string,
): Promise<void> {
  await scheduleSnoozeImpl(occurrenceId, snoozedUntil, title, getAdapter());
}

/**
 * Re-materialize the rolling-window schedule.
 * Call on: app-foreground, boot (BOOT_COMPLETED), timezone-change.
 *
 * Task 5: also passes snoozedUntilMap to reanchorImpl so snoozed occurrences
 * are rescheduled at their snoozedUntil on every re-anchor pass.
 *
 * @param reminders   All ReminderRecords (active + inactive; function filters)
 * @param occurrences Materialized ReminderOccurrenceRecords (for excludedIds + snoozedUntilMap)
 * @param now         Current wall-clock time (default: new Date())
 */
export async function reanchor(
  reminders: ReminderRecord[],
  occurrences: ReminderOccurrenceRecord[],
  now: Date = new Date(),
): Promise<void> {
  const excludedIds = buildExcludedIds(occurrences, now);
  const snoozedUntilMap = buildSnoozedUntilMap(occurrences, now);
  await reanchorImpl(reminders, excludedIds, now, getAdapter(), snoozedUntilMap);
}

// ─── Re-exports for type-checking and QA ─────────────────────────────────────

export type { NotificationsAdapter };
export {
  MEDICATION_TITLE_TH,
  WINDOW_DAYS,
  PENDING_BUDGET,
};
