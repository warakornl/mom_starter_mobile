/**
 * notificationService — local notification scheduling for calendar reminders and appointments.
 *
 * Wraps expo-notifications for schedule / cancel / reconcile operations.
 *
 * Schedule strategy:
 *   Reminders: expand occurrences via recurrenceExpander, schedule next ROLLING_WINDOW
 *   future occurrences.  iOS limits apps to 64 pending notifications, so
 *   ROLLING_WINDOW = 15 (4 active reminders × 15 = 60; leaves headroom for appointments).
 *   Appointments: one notification per item, fired APPOINTMENT_LEAD_MS (30 min) before.
 *
 * Idempotency:
 *   Reminder notifications use occurrenceId (uuidv5) as the Expo notification identifier.
 *   expo-notifications replaces an existing slot with the same identifier, so
 *   scheduling twice never fires twice.
 *   Appointment notifications use item.id as identifier.
 *
 * Cancellation:
 *   cancelNotificationsForReminder — fetches all scheduled, filters data.reminderId, cancels.
 *   cancelNotificationForOccurrence — cancels by occurrenceId directly.
 *   cancelNotificationsForAppointment — cancels by item.id directly.
 *
 * Reconcile (after sync pull):
 *   1. Build expected set from active reminders + upcoming appointments.
 *   2. Cancel stale (in OS scheduler but not expected).
 *   3. Schedule missing (expected but not yet in OS scheduler).
 *   Safe to call multiple times — idempotent.
 *
 * Deep-link data payload:
 *   Reminder: { type: 'reminder', reminderId, occurrenceId, scheduledLocalTime }
 *   Appointment: { type: 'appointment', itemId, scheduledAt }
 *   App.tsx reads this in addNotificationResponseReceivedListener → navigate('Calendar').
 *
 * Security:
 *   Notification title defaults to 'แจ้งเตือน' (generic) — opt-in privacy model (SD-11).
 *   displayTitle is shown ONLY when showDetailsOnLockScreen === true (user explicitly opts in).
 *   Do NOT log reminder content, appointment notes, or any health data here.
 */

import * as Notifications from 'expo-notifications';
import type { PermissionStatus } from 'expo-modules-core';
import { expand } from '../recurrence/recurrenceExpander';
import { computeOccurrenceId } from '../occurrence/occurrenceId';
import type { ReminderRecord, ChecklistItemRecord } from '../sync/syncTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of future occurrences to schedule per reminder (per-reminder
 * upper bound).  A global GLOBAL_NOTIFICATION_CAP further caps the total
 * across all reminders + appointments (see reconcileNotifications).
 */
export const ROLLING_WINDOW = 15;

/**
 * Lead time (milliseconds) before a scheduled appointment to fire the notification.
 * Default: 30 minutes.
 */
export const APPOINTMENT_LEAD_MS = 30 * 60 * 1000;

/**
 * Android notification channel ID for all health reminders and appointments.
 * Must match the channel created by setupAndroidNotificationChannel().
 * SD-11: channel is configured with VISIBILITY_PRIVATE so Android hides content
 * on the lock screen at the platform level.
 */
export const HEALTH_CHANNEL_ID = 'mom-starter-health';

/**
 * iOS hard limit: 64 pending notifications per app.
 * The total of scheduled reminder occurrences + appointment notifications
 * MUST NOT exceed this value — iOS silently drops notifications beyond slot 64.
 */
export const GLOBAL_NOTIFICATION_CAP = 64;

/**
 * Number of slots reserved for appointment notifications before the remainder
 * is distributed across reminder occurrences.  Appointments have fixed scheduled
 * times so they always take scheduling priority over repeating reminders.
 */
export const APPOINTMENT_HEADROOM = 8;

// ─── Helpers (exported for testing) ─────────────────────────────────────────

/**
 * Convert a floating-civil "YYYY-MM-DDTHH:mm" string to a JS Date in the
 * device's local timezone.
 *
 * Note: `new Date("YYYY-MM-DDTHH:mm")` is interpreted as UTC in V8 (no zone suffix).
 * We parse the components manually so the resulting Date is in local time, matching
 * the civil-day semantics used throughout the app.
 */
export function civilToLocalDate(civil: string): Date {
  const [datePart, timePart] = civil.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Format a JS Date as "YYYY-MM-DD" using the device's local timezone. */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Add `n` civil days to a "YYYY-MM-DD" string (UTC epoch math to avoid DST shifts). */
function addDaysCivil(isoDate: string, n: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Return true if the device has notification permission granted. */
async function hasGrantedPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

// ─── Internal slot types ─────────────────────────────────────────────────────

/** Candidate scheduling slot for a single reminder occurrence. */
type ReminderSlot = { reminder: ReminderRecord; civil: string; date: Date; occId: string };

/** Candidate scheduling slot for a single appointment notification. */
type ApptSlot = { item: ChecklistItemRecord; fireDate: Date };

// ─── Global budget allocation (🔴-1) ─────────────────────────────────────────

/**
 * Allocate notification slots within the global iOS 64-slot budget.
 *
 * Priority order:
 *   1. Appointments (soonest-first, up to APPOINTMENT_HEADROOM slots).
 *   2. Reminder fairness pass: each active reminder is guaranteed its
 *      earliest upcoming slot (prevents any one reminder monopolising budget).
 *   3. Remaining budget filled chronologically from all remaining candidates.
 *
 * This is the enforcement point for the global cap — called by reconcileNotifications
 * before building the expected ID set.
 *
 * @param reminderSlots  All candidate reminder slots (may exceed budget).
 * @param apptSlots      All candidate appointment slots.
 * @param cap            Total slot cap (default GLOBAL_NOTIFICATION_CAP = 64).
 */
function allocateGlobalBudget(
  reminderSlots: ReminderSlot[],
  apptSlots: ApptSlot[],
  cap: number = GLOBAL_NOTIFICATION_CAP,
): { selectedReminders: ReminderSlot[]; selectedAppts: ApptSlot[] } {
  // ── Step 1: Appointments take priority (chronological, capped at headroom) ─
  const sortedAppts = [...apptSlots].sort((a, b) => a.fireDate.getTime() - b.fireDate.getTime());
  const apptCap = Math.min(APPOINTMENT_HEADROOM, cap);
  const selectedAppts = sortedAppts.slice(0, apptCap);

  // ── Step 2: Reminder budget = remainder after appointments ────────────────
  const reminderBudget = cap - selectedAppts.length;
  if (reminderBudget <= 0 || reminderSlots.length === 0) {
    return { selectedReminders: [], selectedAppts };
  }

  // ── Step 3: Fairness pass — 1 earliest slot guaranteed per reminder ───────
  //
  // Group slots by reminder.id, sort each group by date, take the earliest.
  // This prevents a single high-frequency reminder from consuming all slots
  // and starving less-frequent reminders.
  const groupedByReminder = new Map<string, ReminderSlot[]>();
  for (const slot of reminderSlots) {
    const group = groupedByReminder.get(slot.reminder.id) ?? [];
    group.push(slot);
    groupedByReminder.set(slot.reminder.id, group);
  }
  for (const group of groupedByReminder.values()) {
    group.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  const guaranteed: ReminderSlot[] = [];
  const guaranteedOccIds = new Set<string>();
  for (const group of groupedByReminder.values()) {
    if (guaranteed.length >= reminderBudget) break;
    const earliest = group[0];
    guaranteed.push(earliest);
    guaranteedOccIds.add(earliest.occId);
  }

  // ── Step 4: Fill remaining budget chronologically ─────────────────────────
  const remainingBudget = reminderBudget - guaranteed.length;
  const extraCandidates = reminderSlots
    .filter((s) => !guaranteedOccIds.has(s.occId))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const extra = extraCandidates.slice(0, remainingBudget);

  return { selectedReminders: [...guaranteed, ...extra], selectedAppts };
}

// ─── Android notification channel (SD-11) ────────────────────────────────────

/**
 * Create (or update) the Android notification channel for health reminders
 * and appointments.
 *
 * MUST be called once at app startup (App.tsx useEffect) before any
 * notifications are scheduled.  Safe to call multiple times — expo-notifications
 * is idempotent on channel creation (updates configuration if channel exists).
 *
 * SD-11: lockscreenVisibility = PRIVATE so Android hides notification content
 * on the lock screen at the channel level (complements the generic-title
 * approach used in notification content).
 *
 * No-op on iOS (setNotificationChannelAsync is Android-only; expo-notifications
 * stubs it as a no-op on other platforms).
 */
export async function setupAndroidNotificationChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(HEALTH_CHANNEL_ID, {
    name: 'แจ้งเตือนสุขภาพ',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: 'default',
  });
}

// ─── Permission ───────────────────────────────────────────────────────────────

/**
 * Request notification permission from the OS.
 *
 * Returns 'granted' immediately if already authorised; otherwise prompts the
 * user and returns their decision ('granted' | 'denied' | 'undetermined').
 *
 * Call this before the first reminder save or on first calendar open.
 * Callers should handle 'denied' gracefully — scheduling is silently skipped.
 */
export async function requestNotificationPermission(): Promise<PermissionStatus> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return existing.status as PermissionStatus;
  const result = await Notifications.requestPermissionsAsync();
  return result.status as PermissionStatus;
}

// ─── Schedule reminder notifications ─────────────────────────────────────────

/**
 * Schedule the next ROLLING_WINDOW future occurrences of a reminder.
 *
 * Steps:
 *   1. Expand occurrences for the next ROLLING_WINDOW × 2 civil days (generous
 *      window so sparse every_n_days rules still fill ROLLING_WINDOW slots).
 *   2. Filter to strictly future occurrences (trigger > now).
 *   3. Take the first ROLLING_WINDOW entries.
 *   4. Schedule each via expo-notifications using occurrenceId as identifier
 *      (idempotent: Expo replaces an existing slot with the same identifier).
 *
 * SD-11 privacy: title is generic ('แจ้งเตือน') by default.
 * Only when reminder.showDetailsOnLockScreen === true is displayTitle used.
 * This is OPT-IN, not opt-out — health data never appears on the lock screen
 * unless the user explicitly enables it.
 *
 * No-ops if permission is not granted.
 *
 * @param reminder  Active ReminderRecord with recurrenceRule + startAt
 * @param now       Optional override for "now" (used in tests)
 */
export async function scheduleReminderNotifications(
  reminder: ReminderRecord,
  now?: Date,
): Promise<void> {
  if (!(await hasGrantedPermission())) return;

  const nowDate = now ?? new Date();
  const today = localDateStr(nowDate);
  const windowEnd = addDaysCivil(today, ROLLING_WINDOW * 2);

  const civils = expand(
    { ...reminder.recurrenceRule, startAt: reminder.startAt },
    today,
    windowEnd,
  );

  const future = civils
    .map((c) => ({ civil: c, date: civilToLocalDate(c) }))
    .filter(({ date }) => date.getTime() > nowDate.getTime())
    .slice(0, ROLLING_WINDOW);

  // SD-11: opt-in model — generic title unless user explicitly enabled details
  const title = reminder.showDetailsOnLockScreen ? reminder.displayTitle : 'แจ้งเตือน';

  await Promise.all(
    future.map(async ({ civil, date }) => {
      const occId = computeOccurrenceId(reminder.id, civil);

      await Notifications.scheduleNotificationAsync({
        identifier: occId,
        content: {
          title,
          body: civil.slice(11, 16), // "HH:mm" display time
          data: {
            type: 'reminder',
            reminderId: reminder.id,
            occurrenceId: occId,
            scheduledLocalTime: civil,
          },
        },
        trigger: { date, channelId: HEALTH_CHANNEL_ID },
      });
    }),
  );
}

// ─── Schedule appointment notification ───────────────────────────────────────

/**
 * Schedule a single notification for a ChecklistItem appointment.
 *
 * Fires APPOINTMENT_LEAD_MS (30 min by default) before scheduledAt.
 * Uses item.id as the notification identifier → idempotent re-schedule
 * on update (Expo replaces the existing slot).
 *
 * SD-11 privacy: title is ALWAYS the generic 'นัดหมาย' — clinic name,
 * doctor name, and appointment details are NEVER shown on the lock screen.
 * There is no per-appointment opt-in; PDPA ruling 3 treats appointment titles
 * as sensitive health data that must not be disclosed on the lock screen.
 *
 * Skips silently when:
 *   - scheduledAt is absent (undated tasks)
 *   - fireDate is in the past or within lead time of now
 *   - permission is not granted
 *
 * @param item  ChecklistItemRecord with category=appointment and scheduledAt
 * @param now   Optional override for "now" (used in tests)
 */
export async function scheduleAppointmentNotification(
  item: ChecklistItemRecord,
  now?: Date,
): Promise<void> {
  if (!item.scheduledAt) return;
  if (!(await hasGrantedPermission())) return;

  const apptDate = civilToLocalDate(item.scheduledAt);
  const fireDate = new Date(apptDate.getTime() - APPOINTMENT_LEAD_MS);
  const nowMs = (now ?? new Date()).getTime();
  if (fireDate.getTime() <= nowMs) return;

  await Notifications.scheduleNotificationAsync({
    identifier: item.id,
    content: {
      // SD-11: generic title — appointment details must not appear on lock screen
      title: 'นัดหมาย',
      body: item.scheduledAt.slice(11, 16), // "HH:mm"
      data: {
        type: 'appointment',
        itemId: item.id,
        scheduledAt: item.scheduledAt,
      },
    },
    trigger: { date: fireDate, channelId: HEALTH_CHANNEL_ID },
  });
}

// ─── Cancel notifications ─────────────────────────────────────────────────────

/**
 * Cancel all scheduled notifications belonging to a reminder.
 *
 * Fetches the full scheduled list, filters by data.reminderId, and cancels
 * each match. Safe to call even if no notifications exist for this reminder.
 *
 * Call this when:
 *   - A reminder is deleted (enqueueDeleteReminder)
 *   - A reminder is updated (cancel then re-schedule)
 *   - A reminder is tombstoned from sync pull (reconcile handles this too)
 */
export async function cancelNotificationsForReminder(reminderId: string): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = all.filter(
    // 🟡-3: optional chaining — external notifications may have null/absent data
    (n) => n.content.data?.['reminderId'] === reminderId,
  );
  await Promise.all(
    toCancel.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * Cancel a single reminder occurrence notification by its occurrenceId.
 *
 * Safe to call even if the notification has already fired or been cancelled
 * (expo-notifications treats unknown identifiers as no-ops).
 *
 * Call this when the user marks an occurrence as done or snoozes it from
 * within the app (CalendarScreen.handleOccurrenceAction).
 */
export async function cancelNotificationForOccurrence(occurrenceId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(occurrenceId);
}

/**
 * Cancel the scheduled notification for a ChecklistItem appointment.
 *
 * Safe to call even if the notification has already fired.
 *
 * Call this when:
 *   - An appointment is deleted
 *   - An appointment is marked done
 *   - An appointment is tombstoned from sync pull (reconcile handles this too)
 */
export async function cancelNotificationsForAppointment(itemId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(itemId);
}

// ─── Reconcile after sync pull ────────────────────────────────────────────────

/**
 * Module-level serialization queue for reconcileNotifications (🟡-2).
 *
 * Concurrent saves and reconcile calls can race:
 *   1. reconcile starts, fetches OS state (no reminder A in scheduler yet)
 *   2. save reminder A fires scheduleReminderNotifications (adds A to OS)
 *   3. reconcile finishes cancel-stale pass → cancels A (it wasn't expected
 *      because it wasn't in the OS state snapshot taken in step 1)
 *
 * Serialising via a promise queue ensures only one reconcile runs at a time.
 * Errors are absorbed on the shared tail (_reconcileQueue) so the queue does
 * not deadlock; the calling promise (thisCall) still propagates the error to
 * its caller so callers can handle failures.
 */
let _reconcileQueue: Promise<void> = Promise.resolve();

/**
 * Internal reconcile implementation — do not call directly; use reconcileNotifications.
 */
async function _doReconcile(
  activeReminders: ReminderRecord[],
  activeAppointments: ChecklistItemRecord[],
  now?: Date,
): Promise<void> {
  if (!(await hasGrantedPermission())) return;

  const nowDate = now ?? new Date();
  const today = localDateStr(nowDate);
  const windowEnd = addDaysCivil(today, ROLLING_WINDOW * 2);

  // ── Build candidate slots ─────────────────────────────────────────────────

  const allReminderSlots: ReminderSlot[] = [];
  const allApptSlots: ApptSlot[] = [];

  for (const reminder of activeReminders) {
    if (!reminder.active) continue;
    const civils = expand(
      { ...reminder.recurrenceRule, startAt: reminder.startAt },
      today,
      windowEnd,
    );
    const future = civils
      .map((c) => ({ civil: c, date: civilToLocalDate(c) }))
      .filter(({ date }) => date.getTime() > nowDate.getTime())
      .slice(0, ROLLING_WINDOW);

    for (const { civil, date } of future) {
      const occId = computeOccurrenceId(reminder.id, civil);
      allReminderSlots.push({ reminder, civil, date, occId });
    }
  }

  for (const appt of activeAppointments) {
    if (!appt.scheduledAt || appt.done) continue;
    const fireDate = new Date(civilToLocalDate(appt.scheduledAt).getTime() - APPOINTMENT_LEAD_MS);
    if (fireDate.getTime() > nowDate.getTime()) {
      allApptSlots.push({ item: appt, fireDate });
    }
  }

  // ── Apply global budget (🔴-1) — cap + fairness ───────────────────────────
  const { selectedReminders, selectedAppts } = allocateGlobalBudget(
    allReminderSlots,
    allApptSlots,
  );

  // Build expected identifier set from BUDGETED slots only
  const expectedIds = new Set<string>();
  for (const slot of selectedReminders) expectedIds.add(slot.occId);
  for (const slot of selectedAppts) expectedIds.add(slot.item.id);

  // ── Fetch current OS state ────────────────────────────────────────────────

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledIds = new Set(scheduled.map((n) => n.identifier));

  // ── Cancel stale (not in expected set) ───────────────────────────────────

  await Promise.all(
    scheduled
      .filter((n) => !expectedIds.has(n.identifier))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  // ── Schedule missing reminder occurrences ─────────────────────────────────

  await Promise.all(
    selectedReminders
      .filter(({ occId }) => !scheduledIds.has(occId))
      .map(async ({ reminder, civil, date, occId }) => {
        // SD-11: opt-in model — generic title unless user explicitly enabled details
        const title = reminder.showDetailsOnLockScreen ? reminder.displayTitle : 'แจ้งเตือน';
        await Notifications.scheduleNotificationAsync({
          identifier: occId,
          content: {
            title,
            body: civil.slice(11, 16),
            data: {
              type: 'reminder',
              reminderId: reminder.id,
              occurrenceId: occId,
              scheduledLocalTime: civil,
            },
          },
          trigger: { date, channelId: HEALTH_CHANNEL_ID },
        });
      }),
  );

  // ── Schedule missing appointment notifications ─────────────────────────────

  await Promise.all(
    selectedAppts
      .filter(({ item }) => !scheduledIds.has(item.id))
      .map(async ({ item, fireDate }) => {
        await Notifications.scheduleNotificationAsync({
          identifier: item.id,
          content: {
            // SD-11: generic title — appointment details never on lock screen
            title: 'นัดหมาย',
            body: item.scheduledAt!.slice(11, 16),
            data: {
              type: 'appointment',
              itemId: item.id,
              scheduledAt: item.scheduledAt,
            },
          },
          trigger: { date: fireDate, channelId: HEALTH_CHANNEL_ID },
        });
      }),
  );
}

/**
 * Reconcile scheduled OS notifications against the current store state.
 *
 * Public entry point — serialises execution via _reconcileQueue (🟡-2) to
 * prevent concurrent reconcile+save races where cancel-stale could wipe a
 * notification just added by a parallel save operation.
 *
 * See _doReconcile for the full algorithm.
 *
 * Idempotent — safe to call multiple times with the same inputs.
 * Serialised — concurrent calls are queued; each call awaits the previous one.
 * No-ops if permission is not granted.
 *
 * @param activeReminders    calendarSyncStore.getActiveReminders() (non-tombstoned)
 * @param activeAppointments calendarSyncStore.getActiveChecklistItems() (all, filtered here)
 * @param now                Optional override for "now" (used in tests)
 */
export function reconcileNotifications(
  activeReminders: ReminderRecord[],
  activeAppointments: ChecklistItemRecord[],
  now?: Date,
): Promise<void> {
  // 🟡-2: serialise concurrent calls via a promise queue
  const thisCall = _reconcileQueue.then(() =>
    _doReconcile(activeReminders, activeAppointments, now),
  );
  // Absorb errors on the shared tail so later callers are not blocked by
  // a previous failure; thisCall still propagates the error to THIS caller.
  _reconcileQueue = thisCall.catch(() => {});
  return thisCall;
}
