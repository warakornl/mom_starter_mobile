/**
 * notificationService.test.ts — TDD tests for notification scheduling logic.
 *
 * All expo-notifications API calls are mocked; no native module required.
 * Tests cover:
 *   1. civilToLocalDate  — civil datetime string → local JS Date
 *   2. requestNotificationPermission — permission request flow
 *   3. scheduleReminderNotifications — rolling-window, idempotency, past-skip, inactive
 *   4. scheduleAppointmentNotification — lead-time, past-skip, no-scheduledAt
 *   5. cancelNotificationsForReminder — filters by data.reminderId
 *   6. cancelNotificationForOccurrence — cancels by occurrenceId
 *   7. cancelNotificationsForAppointment — cancels by item.id
 *   8. reconcileNotifications — cancel stale, schedule missing, idempotent
 *
 * Security: no real health data in tests (synthetic titles / IDs only).
 */

import {
  civilToLocalDate,
  requestNotificationPermission,
  scheduleReminderNotifications,
  scheduleAppointmentNotification,
  cancelNotificationsForReminder,
  cancelNotificationForOccurrence,
  cancelNotificationsForAppointment,
  reconcileNotifications,
  setupAndroidNotificationChannel,
  ROLLING_WINDOW,
  APPOINTMENT_LEAD_MS,
  HEALTH_CHANNEL_ID,
  GLOBAL_NOTIFICATION_CAP,
} from './notificationService';
import { computeOccurrenceId } from '../occurrence/occurrenceId';
import type { ReminderRecord, ChecklistItemRecord } from '../sync/syncTypes';

// ─── Mock expo-notifications ──────────────────────────────────────────────────

// Shared in-memory state simulating the OS scheduler
const mockScheduled = new Map<string, { identifier: string; content: Record<string, unknown>; trigger: unknown }>();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  // Enum values needed for SD-11 channel setup
  AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
  AndroidImportance: { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 },
}));

// Lazy import the mock after jest.mock() hoisting
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications = require('expo-notifications');

beforeEach(() => {
  mockScheduled.clear();
  jest.clearAllMocks();

  // Default: permission granted
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });

  // scheduleNotificationAsync stores into our mock map (idempotent by identifier)
  Notifications.scheduleNotificationAsync.mockImplementation(
    async (req: { identifier: string; content: Record<string, unknown>; trigger: unknown }) => {
      mockScheduled.set(req.identifier, {
        identifier: req.identifier,
        content: req.content,
        trigger: req.trigger,
      });
      return req.identifier;
    },
  );

  // cancelScheduledNotificationAsync removes from mock map
  Notifications.cancelScheduledNotificationAsync.mockImplementation(async (id: string) => {
    mockScheduled.delete(id);
  });

  // getAllScheduledNotificationsAsync returns current mock state
  Notifications.getAllScheduledNotificationsAsync.mockImplementation(async () =>
    Array.from(mockScheduled.values()),
  );
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeReminder(overrides: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: 'reminder-uuid-1',
    type: 'custom',
    displayTitle: 'Take vitamin',
    recurrenceRule: { freq: 'daily', timesOfDay: ['08:00'] },
    startAt: '2026-06-30T08:00',
    active: true,
    version: 1,
    createdAt: '2026-06-30T00:00:00Z',
    updatedAt: '2026-06-30T00:00:00Z',
    ...overrides,
  };
}

function makeAppointment(overrides: Partial<ChecklistItemRecord> = {}): ChecklistItemRecord {
  return {
    id: 'appt-uuid-1',
    category: 'appointment',
    title: 'Doctor visit',
    scheduledAt: '2026-07-10T10:00',
    done: false,
    version: 1,
    createdAt: '2026-06-30T00:00:00Z',
    updatedAt: '2026-06-30T00:00:00Z',
    ...overrides,
  };
}

// ─── 1. civilToLocalDate ──────────────────────────────────────────────────────

describe('civilToLocalDate', () => {
  it('parses "YYYY-MM-DDTHH:mm" to local JS Date', () => {
    const d = civilToLocalDate('2026-07-15T09:30');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July = month index 6
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('parses midnight correctly', () => {
    const d = civilToLocalDate('2026-01-01T00:00');
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('parses end-of-day correctly', () => {
    const d = civilToLocalDate('2026-12-31T23:59');
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });
});

// ─── 2. requestNotificationPermission ────────────────────────────────────────

describe('requestNotificationPermission', () => {
  it('returns "granted" immediately if permission already granted', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const status = await requestNotificationPermission();
    expect(status).toBe('granted');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('calls requestPermissionsAsync when not yet granted', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const status = await requestNotificationPermission();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(status).toBe('granted');
  });

  it('returns "denied" when user denies', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const status = await requestNotificationPermission();
    expect(status).toBe('denied');
  });
});

// ─── 3. scheduleReminderNotifications ────────────────────────────────────────

describe('scheduleReminderNotifications', () => {
  // "now" = 2026-06-30T07:00 (before first fire of 08:00 today)
  const now = new Date(2026, 5, 30, 7, 0, 0); // June 30 07:00 local

  it('schedules future daily occurrences with occurrenceId as identifier', async () => {
    const reminder = makeReminder();
    await scheduleReminderNotifications(reminder, now);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
    const calls = Notifications.scheduleNotificationAsync.mock.calls as Array<[{ identifier: string; content: Record<string, unknown>; trigger: unknown }]>;
    // All identifiers should be valid uuidv5 strings
    for (const [req] of calls) {
      expect(req.identifier).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('schedules at most ROLLING_WINDOW occurrences', async () => {
    const reminder = makeReminder({
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00'] },
    });
    await scheduleReminderNotifications(reminder, now);
    expect(Notifications.scheduleNotificationAsync.mock.calls.length).toBeLessThanOrEqual(ROLLING_WINDOW);
  });

  it('does not schedule past occurrences', async () => {
    // Reminder started 2 days ago; today's 08:00 is still future (now = 07:00)
    const reminder = makeReminder({ startAt: '2026-06-28T08:00' });
    const calls0 = Notifications.scheduleNotificationAsync.mock.calls.length;
    await scheduleReminderNotifications(reminder, now);
    const calls1 = Notifications.scheduleNotificationAsync.mock.calls.length;
    const scheduled = calls1 - calls0;
    expect(scheduled).toBeGreaterThan(0);
    // All scheduled dates must be in the future relative to `now`
    for (const [req] of (Notifications.scheduleNotificationAsync.mock.calls as Array<[{ identifier: string; content: Record<string, unknown>; trigger: { date: Date } }]>).slice(calls0)) {
      const triggerDate = (req.trigger as { date: Date }).date;
      expect(triggerDate.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('is idempotent — scheduling same reminder twice does not duplicate', async () => {
    const reminder = makeReminder();
    await scheduleReminderNotifications(reminder, now);
    const firstCount = mockScheduled.size;
    await scheduleReminderNotifications(reminder, now);
    // mockScheduled is a Map keyed by identifier — re-schedule overwrites, so size stays same
    expect(mockScheduled.size).toBe(firstCount);
  });

  it('skips scheduling when permission is denied', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await scheduleReminderNotifications(makeReminder(), now);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('uses generic title when hideOnLockScreen is true (legacy field, still safe)', async () => {
    // hideOnLockScreen: true → showDetailsOnLockScreen absent → generic title (same safe result)
    const reminder = makeReminder({ hideOnLockScreen: true });
    await scheduleReminderNotifications(reminder, now);
    const calls = Notifications.scheduleNotificationAsync.mock.calls as Array<[{ identifier: string; content: { title: string }; trigger: unknown }]>;
    for (const [req] of calls) {
      expect(req.content.title).toBe('แจ้งเตือน');
    }
  });

  // 🔴-2: SD-11 — generic title is the SECURE DEFAULT (opt-in to show detail)
  it('uses generic title by default when showDetailsOnLockScreen is absent (secure default, SD-11)', async () => {
    const reminder = makeReminder(); // no showDetailsOnLockScreen → default safe
    await scheduleReminderNotifications(reminder, now);
    const calls = Notifications.scheduleNotificationAsync.mock.calls as Array<[{ content: { title: string } }]>;
    for (const [req] of calls) {
      expect(req.content.title).toBe('แจ้งเตือน');
    }
  });

  it('uses displayTitle when showDetailsOnLockScreen is true (explicit privacy opt-in)', async () => {
    const reminder = makeReminder({ showDetailsOnLockScreen: true });
    await scheduleReminderNotifications(reminder, now);
    const calls = Notifications.scheduleNotificationAsync.mock.calls as Array<[{ content: { title: string } }]>;
    for (const [req] of calls) {
      expect(req.content.title).toBe('Take vitamin');
    }
  });

  it('stores occurrence data including reminderId and scheduledLocalTime', async () => {
    const reminder = makeReminder({ id: 'rem-abc' });
    await scheduleReminderNotifications(reminder, now);
    const calls = Notifications.scheduleNotificationAsync.mock.calls as Array<[{ identifier: string; content: { data: Record<string, unknown> }; trigger: unknown }]>;
    for (const [req] of calls) {
      expect(req.content.data.type).toBe('reminder');
      expect(req.content.data.reminderId).toBe('rem-abc');
      expect(req.content.data.occurrenceId).toBe(req.identifier);
      expect(typeof req.content.data.scheduledLocalTime).toBe('string');
    }
  });

  it('schedules a one_off reminder exactly once (if in future)', async () => {
    const future = '2026-07-05T14:30';
    const reminder = makeReminder({
      recurrenceRule: { freq: 'one_off' },
      startAt: future,
    });
    await scheduleReminderNotifications(reminder, now);
    const calls = Notifications.scheduleNotificationAsync.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].identifier).toBe(computeOccurrenceId('reminder-uuid-1', future));
  });

  it('does not schedule a past one_off reminder', async () => {
    const past = '2026-06-01T10:00'; // before `now`
    const reminder = makeReminder({
      recurrenceRule: { freq: 'one_off' },
      startAt: past,
    });
    await scheduleReminderNotifications(reminder, now);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

// ─── 4. scheduleAppointmentNotification ──────────────────────────────────────

describe('scheduleAppointmentNotification', () => {
  // "now" = 2026-06-30T07:00
  const now = new Date(2026, 5, 30, 7, 0, 0);

  it('schedules a notification at (scheduledAt − APPOINTMENT_LEAD_MS)', async () => {
    const appt = makeAppointment({ scheduledAt: '2026-07-10T10:00' });
    await scheduleAppointmentNotification(appt, now);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [req] = Notifications.scheduleNotificationAsync.mock.calls[0] as [{ identifier: string; content: Record<string, unknown>; trigger: { date: Date } }];
    expect(req.identifier).toBe(appt.id);
    const apptMs = civilToLocalDate('2026-07-10T10:00').getTime();
    expect((req.trigger as { date: Date }).date.getTime()).toBe(apptMs - APPOINTMENT_LEAD_MS);
  });

  it('uses item.id as notification identifier', async () => {
    const appt = makeAppointment({ id: 'appt-xyz', scheduledAt: '2026-07-10T10:00' });
    await scheduleAppointmentNotification(appt, now);
    const [req] = Notifications.scheduleNotificationAsync.mock.calls[0] as [{ identifier: string }];
    expect(req.identifier).toBe('appt-xyz');
  });

  it('skips when scheduledAt is null', async () => {
    const appt = makeAppointment({ scheduledAt: null });
    await scheduleAppointmentNotification(appt, now);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('skips when the fire date is already past', async () => {
    // Appointment at 2026-06-30T07:20 → fireDate = 2026-06-30T06:50 which is BEFORE now (07:00)
    const appt = makeAppointment({ scheduledAt: '2026-06-30T07:20' });
    await scheduleAppointmentNotification(appt, now);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('skips when permission is denied', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await scheduleAppointmentNotification(makeAppointment(), now);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('stores appointment data including itemId', async () => {
    const appt = makeAppointment({ id: 'appt-data-test', scheduledAt: '2026-07-10T10:00' });
    await scheduleAppointmentNotification(appt, now);
    const [req] = Notifications.scheduleNotificationAsync.mock.calls[0] as [{ content: { data: Record<string, unknown> } }];
    expect(req.content.data.type).toBe('appointment');
    expect(req.content.data.itemId).toBe('appt-data-test');
  });

  // 🔴-2: SD-11 — appointment must never expose clinic/doctor name on lock screen
  it('uses generic title "นัดหมาย" for appointment notification — not item.title (SD-11)', async () => {
    const appt = makeAppointment({ title: 'Check-up at clinic ABC', scheduledAt: '2026-07-10T10:00' });
    await scheduleAppointmentNotification(appt, now);
    const [req] = Notifications.scheduleNotificationAsync.mock.calls[0] as [{ content: { title: string } }];
    expect(req.content.title).toBe('นัดหมาย');
    expect(req.content.title).not.toBe(appt.title);
  });
});

// ─── 5. cancelNotificationsForReminder ───────────────────────────────────────

describe('cancelNotificationsForReminder', () => {
  it('cancels all scheduled notifications whose data.reminderId matches', async () => {
    // Pre-populate mock with two notifications for 'rem-1' and one for 'rem-2'
    mockScheduled.set('occ-a', {
      identifier: 'occ-a',
      content: { data: { type: 'reminder', reminderId: 'rem-1' } },
      trigger: {},
    });
    mockScheduled.set('occ-b', {
      identifier: 'occ-b',
      content: { data: { type: 'reminder', reminderId: 'rem-1' } },
      trigger: {},
    });
    mockScheduled.set('occ-c', {
      identifier: 'occ-c',
      content: { data: { type: 'reminder', reminderId: 'rem-2' } },
      trigger: {},
    });

    await cancelNotificationsForReminder('rem-1');

    expect(mockScheduled.has('occ-a')).toBe(false);
    expect(mockScheduled.has('occ-b')).toBe(false);
    // rem-2's notification must NOT be cancelled
    expect(mockScheduled.has('occ-c')).toBe(true);
  });

  it('does nothing when no notifications match', async () => {
    await cancelNotificationsForReminder('nonexistent');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  // 🟡-3: defensive — external notifications may have null/missing data
  it('does not throw when a scheduled notification has null data (external notification)', async () => {
    mockScheduled.set('ext-notif', {
      identifier: 'ext-notif',
      content: { data: null },
      trigger: {},
    });
    await expect(cancelNotificationsForReminder('rem-1')).resolves.toBeUndefined();
    // External notification is NOT cancelled (reminderId mismatch / null data)
    expect(mockScheduled.has('ext-notif')).toBe(true);
  });
});

// ─── 6. cancelNotificationForOccurrence ──────────────────────────────────────

describe('cancelNotificationForOccurrence', () => {
  it('calls cancelScheduledNotificationAsync with the occurrenceId', async () => {
    const occId = 'occ-uuid-test';
    await cancelNotificationForOccurrence(occId);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(occId);
  });

  it('is safe to call for a non-existent identifier (no throw)', async () => {
    await expect(cancelNotificationForOccurrence('does-not-exist')).resolves.toBeUndefined();
  });
});

// ─── 7. cancelNotificationsForAppointment ────────────────────────────────────

describe('cancelNotificationsForAppointment', () => {
  it('calls cancelScheduledNotificationAsync with the item.id', async () => {
    await cancelNotificationsForAppointment('appt-uuid-42');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('appt-uuid-42');
  });
});

// ─── 8. reconcileNotifications ────────────────────────────────────────────────

describe('reconcileNotifications', () => {
  const now = new Date(2026, 5, 30, 7, 0, 0); // June 30 07:00

  it('cancels stale notifications not in the expected set', async () => {
    // Pre-schedule a notification for a reminder that is no longer active
    mockScheduled.set('stale-occ', {
      identifier: 'stale-occ',
      content: { data: { type: 'reminder', reminderId: 'old-rem' } },
      trigger: {},
    });

    // Reconcile with no active reminders and no appointments
    await reconcileNotifications([], [], now);

    expect(mockScheduled.has('stale-occ')).toBe(false);
  });

  it('schedules missing notifications for active reminders', async () => {
    const reminder = makeReminder({ id: 'new-rem' });
    // No pre-existing notifications
    await reconcileNotifications([reminder], [], now);

    expect(mockScheduled.size).toBeGreaterThan(0);
    // All scheduled notifications should belong to this reminder
    for (const [, n] of mockScheduled) {
      expect((n.content as { data: Record<string, unknown> }).data.reminderId).toBe('new-rem');
    }
  });

  it('does not double-schedule already-scheduled notifications', async () => {
    const reminder = makeReminder({ id: 'stable-rem' });
    await reconcileNotifications([reminder], [], now);
    const firstCount = mockScheduled.size;
    const scheduleCalls1 = Notifications.scheduleNotificationAsync.mock.calls.length;

    // Reconcile again — same active reminders
    await reconcileNotifications([reminder], [], now);
    const scheduleCalls2 = Notifications.scheduleNotificationAsync.mock.calls.length;

    // No additional schedule calls on second reconcile (already scheduled)
    expect(scheduleCalls2).toBe(scheduleCalls1);
    expect(mockScheduled.size).toBe(firstCount);
  });

  it('skips inactive reminders', async () => {
    const inactive = makeReminder({ active: false });
    await reconcileNotifications([inactive], [], now);
    expect(mockScheduled.size).toBe(0);
  });

  it('schedules missing appointment notifications', async () => {
    const appt = makeAppointment({ scheduledAt: '2026-07-10T10:00' });
    await reconcileNotifications([], [appt], now);
    expect(mockScheduled.has(appt.id)).toBe(true);
  });

  it('does not schedule past or done appointments', async () => {
    const pastAppt = makeAppointment({ scheduledAt: '2026-06-30T07:20' }); // fireDate < now
    const doneAppt = makeAppointment({ id: 'done-appt', scheduledAt: '2026-07-10T10:00', done: true });
    await reconcileNotifications([], [pastAppt, doneAppt], now);
    expect(mockScheduled.size).toBe(0);
  });

  it('does nothing when permission is denied', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const reminder = makeReminder();
    await reconcileNotifications([reminder], [], now);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels tombstoned reminder notifications and schedules active ones', async () => {
    const activeReminder = makeReminder({ id: 'active-rem' });
    // Pre-populate with a stale notification from a deleted reminder
    mockScheduled.set('stale-occ-from-dead-rem', {
      identifier: 'stale-occ-from-dead-rem',
      content: { data: { type: 'reminder', reminderId: 'dead-rem' } },
      trigger: {},
    });

    await reconcileNotifications([activeReminder], [], now);

    // Stale notification removed
    expect(mockScheduled.has('stale-occ-from-dead-rem')).toBe(false);
    // Active reminder's notifications scheduled
    const activeCounts = Array.from(mockScheduled.values()).filter(
      (n) => (n.content as { data: Record<string, unknown> }).data.reminderId === 'active-rem',
    ).length;
    expect(activeCounts).toBeGreaterThan(0);
  });

  // 🔴-2: SD-11 — appointment must use generic title in reconcile too
  it('uses generic title "นัดหมาย" for appointment in reconcile (SD-11)', async () => {
    const appt = makeAppointment({ title: 'Sensitive clinic name', scheduledAt: '2026-07-10T10:00' });
    await reconcileNotifications([], [appt], now);
    const apptNotif = mockScheduled.get(appt.id);
    expect(apptNotif).toBeDefined();
    expect((apptNotif!.content as { title: string }).title).toBe('นัดหมาย');
  });

  // 🔴-2: SD-11 — reminder in reconcile uses generic title by default
  it('uses generic title by default for reminders in reconcile (SD-11 secure default)', async () => {
    const reminder = makeReminder({ id: 'privacy-rem' });
    await reconcileNotifications([reminder], [], now);
    for (const [, n] of mockScheduled) {
      if ((n.content as { data: Record<string, unknown> }).data?.['reminderId'] === 'privacy-rem') {
        expect((n.content as { title: string }).title).toBe('แจ้งเตือน');
      }
    }
    expect(mockScheduled.size).toBeGreaterThan(0);
  });
});

// ─── 9. Global notification budget (iOS 64-slot cap) — 🔴-1 ─────────────────

describe('global notification budget (iOS 64-slot cap)', () => {
  const now = new Date(2026, 5, 30, 7, 0, 0); // June 30 07:00

  it('6 active reminders: reconcile schedules ≤ GLOBAL_NOTIFICATION_CAP total', async () => {
    const reminders = Array.from({ length: 6 }, (_, i) =>
      makeReminder({
        id: `rem-cap-${i}`,
        recurrenceRule: { freq: 'daily', timesOfDay: ['08:00'] },
        startAt: '2026-06-30T08:00',
      }),
    );
    await reconcileNotifications(reminders, [], now);
    expect(mockScheduled.size).toBeLessThanOrEqual(GLOBAL_NOTIFICATION_CAP);
  });

  it('every active reminder gets at least 1 scheduled notification (fairness guarantee)', async () => {
    const reminders = Array.from({ length: 6 }, (_, i) =>
      makeReminder({
        id: `rem-fair-${i}`,
        recurrenceRule: { freq: 'daily', timesOfDay: ['08:00'] },
        startAt: '2026-06-30T08:00',
      }),
    );
    await reconcileNotifications(reminders, [], now);
    for (const reminder of reminders) {
      const count = Array.from(mockScheduled.values()).filter(
        (n) => (n.content as { data: Record<string, unknown> }).data?.['reminderId'] === reminder.id,
      ).length;
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('single high-frequency reminder does not starve other reminders (no slot monopoly)', async () => {
    // 1 reminder firing 8×/day + 5 sparse reminders → 6 reminders total
    const busyReminder = makeReminder({
      id: 'busy-rem',
      recurrenceRule: {
        freq: 'daily',
        timesOfDay: ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'],
      },
      startAt: '2026-06-30T06:00',
    });
    const others = Array.from({ length: 5 }, (_, i) =>
      makeReminder({
        id: `sparse-rem-${i}`,
        recurrenceRule: { freq: 'daily', timesOfDay: ['09:00'] },
        startAt: '2026-06-30T09:00',
      }),
    );
    await reconcileNotifications([busyReminder, ...others], [], now);

    // Every sparse reminder must have ≥1 slot despite the busy reminder wanting many
    for (const other of others) {
      const count = Array.from(mockScheduled.values()).filter(
        (n) => (n.content as { data: Record<string, unknown> }).data?.['reminderId'] === other.id,
      ).length;
      expect(count).toBeGreaterThanOrEqual(1);
    }
    // Total must stay within iOS hard limit
    expect(mockScheduled.size).toBeLessThanOrEqual(GLOBAL_NOTIFICATION_CAP);
  });
});

// ─── 10. setupAndroidNotificationChannel (SD-11) ──────────────────────────────

describe('setupAndroidNotificationChannel', () => {
  const Notif = require('expo-notifications');

  it('calls setNotificationChannelAsync with the health channel ID', async () => {
    await setupAndroidNotificationChannel();
    expect(Notif.setNotificationChannelAsync).toHaveBeenCalledWith(
      HEALTH_CHANNEL_ID,
      expect.anything(),
    );
  });

  it('sets lockscreenVisibility to PRIVATE (SD-11, Android)', async () => {
    await setupAndroidNotificationChannel();
    const [, channelConfig] = Notif.setNotificationChannelAsync.mock.calls[0] as [string, Record<string, unknown>];
    expect(channelConfig['lockscreenVisibility']).toBe(
      Notif.AndroidNotificationVisibility.PRIVATE,
    );
  });
});
