/**
 * NotificationsAdapter — thin wrapper over expo-notifications native API.
 *
 * The adapter interface is the seam between pure scheduler logic (testable in
 * Node.js with a mock) and the native expo-notifications module (device-only).
 * All unit tests inject a mock adapter; the real adapter is used in production.
 *
 * STEP-0 EXACT-ALARM FINDING (binding, per ADR Decision 1):
 *   expo-notifications@0.28.x (SDK-51 tagged, resolved 0.28.19) DOES honor exact
 *   alarms on Android 12+ via setExactAndAllowWhileIdle when canScheduleExactAlarms()
 *   returns true. Source: ExpoSchedulingDelegate.kt setupAlarm() — verified from npm
 *   package source (context7 MCP was not reachable in this session).
 *   canScheduleExactAlarms() is true when USE_EXACT_ALARM is declared (auto-granted,
 *   install-time, no dialog on Android 12+). DEFAULT manifest does NOT include it —
 *   declared in app.json android.permissions.
 *   DECISION: USE_EXACT_ALARM declared. Library uses setExactAndAllowWhileIdle (exact).
 *   FALLBACK: if canScheduleExactAlarms() is false (permission stripped, OEM policy)
 *   → setAndAllowWhileIdle (inexact/Doze-batched, never-early, late by Doze window)
 *   → acceptable per ADR Decision 1 fallback ladder rung 3. Task-6 on-device launch-
 *   gate must set explicit punctuality threshold and measure against it.
 *   Notifee carry-forward is DEFERRED (backlog) — not needed for MVP.
 *
 * TASK-6 LAUNCH-GATE — EXACT-ALARM ON-DEVICE VERIFICATION (greppable: LAUNCH_GATE_EXACT_ALARM):
 *   On-device testing MUST confirm expo-notifications issues EXACT alarms when
 *   USE_EXACT_ALARM is declared. If testing shows alarms are inexact only (permission
 *   rejected at runtime by OEM policy, or the installed expo-notifications build does
 *   not honor canScheduleExactAlarms()), the remediation is:
 *     1. REMOVE USE_EXACT_ALARM from app.json android.permissions.
 *     2. Drop to Notifee (carry-forward, backlog) for exact-alarm support.
 *   Declaring USE_EXACT_ALARM with no real exact-alarm benefit invites Google Play
 *   "Alarms & Reminders" permission scrutiny without reward. Do not ship with the
 *   permission declared unless on-device testing proves exact alarms are delivered.
 *
 * TASK-3 / TASK-6 FOLLOW-UP — ANDROID NOTIFICATION CHANNEL + CATEGORY (greppable: MISSING_ANDROID_CHANNEL):
 *   On Android 8+ (API 26+), notifications require a registered NotificationChannel.
 *   Without one, expo-notifications falls back to the default channel. This means:
 *     - No custom channel name/description visible to the user in system settings.
 *     - The action buttons (snooze/done — Task 3) and hideOnLockScreen category
 *       (iOS content-extension — Task 5) are both Task-3/5 work items.
 *   ACTION: Register a named channel (e.g. "medication_reminders") in Task-3 when
 *   notification action categories are added. Do NOT implement channel creation here.
 *
 * Security (SD-11): notification title NEVER contains drug name or dose. Only
 *   the generic constants from notificationScheduler.ts are passed to scheduleAsync.
 *   No sensitive data is logged.
 *
 * Required Expo native build: dev build / EAS build (not Expo Go). Exact-alarm
 *   behavior is asserted on-device (Task-6 launch-gate), not in CI unit tests.
 */

import * as Notifications from 'expo-notifications';

// ─── Interface (mockable seam) ────────────────────────────────────────────────

/**
 * Thin adapter over expo-notifications. Pure scheduler logic depends only on
 * this interface, never on the native module directly.
 */
export interface NotificationsAdapter {
  /**
   * Request notification permissions from the OS.
   * Returns { granted: true } if permission is granted (or already held).
   * Declined is non-fatal — callers must treat { granted: false } gracefully.
   */
  requestPermissionsAsync(): Promise<{ granted: boolean }>;

  /**
   * Schedule a local notification with a deterministic identifier.
   * Scheduling the same id twice is an idempotent replace (no duplicate alarms).
   * @param id      Deterministic occurrence uuidv5 string (used as OS notification id)
   * @param title   Lock-screen title (must be the generic constant, never drug name)
   * @param body    Notification body (generic; may be empty)
   * @param fireAt  Absolute local Date at which the OS should deliver the notification
   */
  scheduleAsync(id: string, title: string, body: string, fireAt: Date): Promise<void>;

  /**
   * Cancel a single pending scheduled notification by its deterministic id.
   * No-op if the id is not currently scheduled.
   */
  cancelAsync(id: string): Promise<void>;

  /**
   * Return the identifiers of all currently scheduled (pending) notifications.
   * Used by reanchor() to determine which stale ids to cancel.
   */
  getAllScheduledIdsAsync(): Promise<string[]>;
}

// ─── Real adapter (expo-notifications) ───────────────────────────────────────

/**
 * Creates the production adapter backed by expo-notifications.
 * Call once at app init; pass the returned adapter to scheduleUpcoming / reanchor.
 *
 * NOTE: expo-notifications native module is not available in Jest (Node.js).
 *   All tests use a mock adapter — do NOT import this file in test files.
 */
export function createRealAdapter(): NotificationsAdapter {
  return {
    async requestPermissionsAsync(): Promise<{ granted: boolean }> {
      const response = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });
      return { granted: response.granted };
    },

    async scheduleAsync(id: string, title: string, body: string, fireAt: Date): Promise<void> {
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title,
          body: body || undefined,
          // hideOnLockScreen would require notification category + content-extension;
          // the reminder's hideOnLockScreen flag is honoured by the OS category set
          // at notification-category registration time (ADR Decision 2 "iOS actionable").
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
        }, // DateTriggerInput: schedules at that exact local time
      });
    },

    async cancelAsync(id: string): Promise<void> {
      await Notifications.cancelScheduledNotificationAsync(id);
    },

    async getAllScheduledIdsAsync(): Promise<string[]> {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      return scheduled.map((n) => n.identifier);
    },
  };
}
