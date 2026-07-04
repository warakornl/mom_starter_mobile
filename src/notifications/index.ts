/**
 * src/notifications/index.ts — Public API for the on-device notification firing layer.
 *
 * Wires the real NotificationsAdapter (expo-notifications) with the pure scheduler
 * logic (notificationScheduler.ts). Call these from CalendarScreen, boot handlers,
 * and timezone-change listeners.
 *
 * Usage (app-lifecycle integration):
 *   import { reanchor, cancelForOccurrence } from '../notifications';
 *   import { calendarSyncStore } from '../sync/calendarSyncStore';
 *
 *   // On app foreground:
 *   const reminders = calendarSyncStore.getReminders();
 *   const doneIds = buildExcludedIds(calendarSyncStore.getOccurrences());
 *   await reanchor(reminders, doneIds, new Date(), getAdapter());
 *
 *   // On mark-done / snooze:
 *   await cancelForOccurrence(occurrenceId, getAdapter());
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
  MEDICATION_TITLE_TH,
  WINDOW_DAYS,
  PENDING_BUDGET,
} from './notificationScheduler';
import { buildExcludedIds } from './excludedIds';
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
export { buildExcludedIds };

// ─── Public API (wired to real adapter) ──────────────────────────────────────

/**
 * Schedule OS notifications for near-term occurrences within the rolling window.
 * Called on app foreground and after boot.
 *
 * @param reminders   Active ReminderRecords from calendarSyncStore
 * @param occurrences Materialized ReminderOccurrenceRecords (for excludedIds)
 * @param now         Current wall-clock time (default: new Date())
 */
export async function scheduleUpcomingForReminders(
  reminders: ReminderRecord[],
  occurrences: ReminderOccurrenceRecord[],
  now: Date = new Date(),
): Promise<void> {
  const excludedIds = buildExcludedIds(occurrences, now);
  await scheduleUpcoming(reminders, excludedIds, now, getAdapter());
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
 * Re-materialize the rolling-window schedule.
 * Call on: app-foreground, boot (BOOT_COMPLETED), timezone-change.
 *
 * @param reminders   All ReminderRecords (active + inactive; function filters)
 * @param occurrences Materialized ReminderOccurrenceRecords (for excludedIds)
 * @param now         Current wall-clock time (default: new Date())
 */
export async function reanchor(
  reminders: ReminderRecord[],
  occurrences: ReminderOccurrenceRecord[],
  now: Date = new Date(),
): Promise<void> {
  const excludedIds = buildExcludedIds(occurrences, now);
  await reanchorImpl(reminders, excludedIds, now, getAdapter());
}

// ─── Re-exports for type-checking and QA ─────────────────────────────────────

export type { NotificationsAdapter };
export {
  MEDICATION_TITLE_TH,
  WINDOW_DAYS,
  PENDING_BUDGET,
};
