/**
 * notificationScheduler — unit tests (RED → GREEN TDD)
 *
 * Tests cover ADR Decision 2 (rolling-window, ≤60 shared budget, soonest-first,
 * deterministic ids) and functional-spec §1 (firing behavior, PRN→nothing,
 * permission-declined non-fatal).
 *
 * All tests mock the NotificationsAdapter so no native/device calls are made.
 * TZ: America/New_York (pinned by jest.setup.tz.js) — exercises UTC-vs-local.
 *
 * STEP 0 finding (recorded here for QA/reviewer):
 *   expo-notifications@0.28.x (SDK-51 tagged, installed ~0.28.3 → resolved 0.28.19)
 *   uses setExactAndAllowWhileIdle when alarmManager.canScheduleExactAlarms() is true
 *   (ExpoSchedulingDelegate.kt setupAlarm method — verified from package source).
 *   canScheduleExactAlarms() returns true on Android < 12 OR when USE_EXACT_ALARM is
 *   declared (auto-granted, install-time, no dialog). Default AndroidManifest.xml does
 *   NOT include USE_EXACT_ALARM — it must be declared in app.json android.permissions.
 *   Decision per ADR: USE_EXACT_ALARM DECLARED (library honors exact alarms).
 *   Fallback: setAndAllowWhileIdle (inexact/Doze-batched, never-early, late by Doze
 *   window) — acceptable per ADR Decision 1 fallback ladder rung 3.
 *   context7 MCP: NOT reachable in this session; verified via npm package inspection.
 */

import {
  buildScheduleSet,
  civilToFireAtMs,
  WINDOW_DAYS,
  PENDING_BUDGET,
  MEDICATION_TITLE_TH,
  type SnoozedOccurrenceEntry,
} from './notificationScheduler';
import type { NotificationsAdapter } from './notificationsAdapter';
import {
  scheduleUpcoming,
  cancelForOccurrence,
  reanchor,
  scheduleSnooze,
} from './notificationScheduler';
import type { ReminderRecord } from '../sync/syncTypes';
import { computeOccurrenceId } from '../occurrence/occurrenceId';

// ─── Helper factories ──────────────────────────────────────────────────────────

function makeReminder(
  partial: Partial<ReminderRecord> & { id: string },
): ReminderRecord {
  return {
    type: 'medication',
    displayTitle: 'ยา',
    hideOnLockScreen: true,
    sourceRefType: 'medication_plan',
    sourceRefId: 'plan-001',
    recurrenceRule: {
      freq: 'daily',
      timesOfDay: ['08:00'],
    },
    startAt: '2026-07-01T08:00',
    active: true,
    version: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    deletedAt: null,
    ...partial,
  };
}

function makeMockAdapter(
  overrides: Partial<NotificationsAdapter> = {},
): jest.Mocked<NotificationsAdapter> {
  return {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    scheduleAsync: jest.fn().mockResolvedValue(undefined),
    cancelAsync: jest.fn().mockResolvedValue(undefined),
    getAllScheduledIdsAsync: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as jest.Mocked<NotificationsAdapter>;
}

// now = 2026-07-04T12:00 (noon) in America/New_York (UTC-4 in EDT)
// = 2026-07-04T16:00Z
const NOW_LOCAL = new Date(2026, 6, 4, 12, 0, 0, 0); // local noon in pinned TZ
const TODAY_CIVIL = '2026-07-04';
const WINDOW_END_CIVIL = '2026-07-11';

// ─── civilToFireAtMs ──────────────────────────────────────────────────────────

describe('civilToFireAtMs', () => {
  it('converts floating civil "YYYY-MM-DDTHH:mm" to local absolute ms', () => {
    // In America/New_York (UTC-4 EDT), 2026-07-04T08:00 local = 2026-07-04T12:00Z
    const ms = civilToFireAtMs('2026-07-04T08:00');
    const expected = new Date(2026, 6, 4, 8, 0, 0, 0).getTime();
    expect(ms).toBe(expected);
  });

  it('uses local time (not UTC) — local hour/minute are preserved', () => {
    // civilToFireAtMs must produce a Date whose LOCAL hour/minute match the civil string.
    // The UTC hour depends on the system TZ and is NOT asserted here (TZ varies by runner).
    const ms = civilToFireAtMs('2026-07-05T08:30');
    const d = new Date(ms);
    // Local hour and minute must match the civil string
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(30);
    // The result equals what new Date(y, m-1, d, h, min) would return (local ctor)
    const expected = new Date(2026, 6, 5, 8, 30, 0, 0);
    expect(ms).toBe(expected.getTime());
  });
});

// ─── buildScheduleSet — window boundary ───────────────────────────────────────

describe('buildScheduleSet — window boundary', () => {
  it('includes occurrences with fireAt strictly after now and within the 7-day window', () => {
    // Daily reminder at 08:00 — today 2026-07-04T08:00 is BEFORE now (noon), so excluded
    // Tomorrow 2026-07-05T08:00 is within window — included
    const reminder = makeReminder({ id: 'rem-boundary-1' });
    const entries = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    // 2026-07-04T08:00 < NOW_LOCAL (noon) → excluded
    const scheduledTimes = entries.map(e => e.scheduledLocalTime);
    expect(scheduledTimes).not.toContain('2026-07-04T08:00');
    // 2026-07-05T08:00 through 2026-07-11T08:00 are in window → included
    expect(scheduledTimes).toContain('2026-07-05T08:00');
    expect(scheduledTimes).toContain('2026-07-11T08:00');
  });

  it('excludes occurrences whose fireAt equals or is before now', () => {
    // One-off reminder at exactly NOW_LOCAL
    const nowCivil = '2026-07-04T12:00';
    const reminder = makeReminder({
      id: 'rem-boundary-now',
      recurrenceRule: { freq: 'one_off' },
      startAt: nowCivil,
    });
    const entries = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    // Fire at == now → excluded (must be strictly after now)
    const ids = entries.map(e => e.occurrenceId);
    const oid = computeOccurrenceId('rem-boundary-now', nowCivil);
    expect(ids).not.toContain(oid);
  });

  it('excludes occurrences beyond window end (now + windowDays)', () => {
    // Daily 08:00 — 2026-07-12 is day 8 → beyond 7-day window
    const reminder = makeReminder({ id: 'rem-boundary-end' });
    const entries = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    const scheduledTimes = entries.map(e => e.scheduledLocalTime);
    expect(scheduledTimes).not.toContain('2026-07-12T08:00');
  });
});

// ─── buildScheduleSet — budget cap ────────────────────────────────────────────

describe('buildScheduleSet — budget cap (≤60, soonest-first)', () => {
  it('caps total occurrences at the budget even when more are available', () => {
    // TID (3x/day) plan → 3 occurrences/day × 7 days = 21 occurrences per reminder
    // Two such reminders = 42 total → within budget
    const r1 = makeReminder({
      id: 'rem-budget-1',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '12:00', '18:00'] },
      startAt: '2026-07-01T08:00',
    });
    const r2 = makeReminder({
      id: 'rem-budget-2',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '12:00', '18:00'] },
      startAt: '2026-07-01T08:00',
    });
    const r3 = makeReminder({
      id: 'rem-budget-3',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '12:00', '18:00'] },
      startAt: '2026-07-01T08:00',
    });
    // 3 reminders × 3x/day × 7 days = 63 total → capped at budget (60)
    const entries = buildScheduleSet([r1, r2, r3], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries.length).toBeLessThanOrEqual(PENDING_BUDGET);
    expect(entries.length).toBe(60); // exactly hits the budget
  });

  it('with budget=5, picks the 5 soonest occurrences (ascending order)', () => {
    // Two daily reminders each with timesOfDay: ['08:00', '09:00']
    // NOW_LOCAL = 2026-07-04T12:00 → 08:00 and 09:00 today are past
    // Upcoming: 2026-07-05@08:00 (r1), 2026-07-05@08:00 (r2), 2026-07-05@09:00 (r1),
    //           2026-07-05@09:00 (r2), 2026-07-06@08:00 (r1 or r2), ...
    // Budget=5 → soonest 5; the 5th spills to 2026-07-06
    const r1 = makeReminder({
      id: 'rem-soonest-1',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '09:00'] },
      startAt: '2026-07-01T08:00',
    });
    const r2 = makeReminder({
      id: 'rem-soonest-2',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '09:00'] },
      startAt: '2026-07-01T08:00',
    });
    const entries = buildScheduleSet([r1, r2], new Set(), NOW_LOCAL, WINDOW_DAYS, 5);
    expect(entries.length).toBe(5);
    // All 5 entries must be in ascending fireAt order
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].fireAt.getTime()).toBeGreaterThanOrEqual(entries[i - 1].fireAt.getTime());
    }
    // First 4 entries are on 2026-07-05; 5th is on 2026-07-06
    expect(entries[0].scheduledLocalTime.startsWith('2026-07-05')).toBe(true);
    expect(entries[1].scheduledLocalTime.startsWith('2026-07-05')).toBe(true);
    expect(entries[2].scheduledLocalTime.startsWith('2026-07-05')).toBe(true);
    expect(entries[3].scheduledLocalTime.startsWith('2026-07-05')).toBe(true);
    expect(entries[4].scheduledLocalTime.startsWith('2026-07-06')).toBe(true);
  });

  it('no duplicate occurrenceIds in the schedule set (idempotency)', () => {
    const r1 = makeReminder({ id: 'rem-dedup' });
    const entries = buildScheduleSet([r1], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    const ids = entries.map(e => e.occurrenceId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ─── buildScheduleSet — inactive / tombstoned reminders ───────────────────────

describe('buildScheduleSet — inactive and tombstoned reminders', () => {
  it('excludes reminders with active=false', () => {
    const r = makeReminder({ id: 'rem-inactive', active: false });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries).toHaveLength(0);
  });

  it('excludes tombstoned reminders (deletedAt set)', () => {
    const r = makeReminder({ id: 'rem-tombstone', deletedAt: '2026-07-01T00:00:00Z' });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries).toHaveLength(0);
  });
});

// ─── buildScheduleSet — excludedIds (done/snoozed occurrences) ────────────────

describe('buildScheduleSet — excludedIds', () => {
  it('excludes occurrences whose id is in excludedIds (done/snoozed)', () => {
    const r = makeReminder({
      id: 'rem-excl',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '20:00'] },
      startAt: '2026-07-01T08:00',
    });
    // Mark the 08:00 occurrence on 2026-07-05 as "done" — its id in excludedIds
    const doneId = computeOccurrenceId('rem-excl', '2026-07-05T08:00');
    const entries = buildScheduleSet([r], new Set([doneId]), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    const ids = entries.map(e => e.occurrenceId);
    expect(ids).not.toContain(doneId);
    // But 20:00 on the same day is still included
    const eveningId = computeOccurrenceId('rem-excl', '2026-07-05T20:00');
    expect(ids).toContain(eveningId);
  });
});

// ─── buildScheduleSet — medication title (SD-11) ──────────────────────────────

describe('buildScheduleSet — SD-11 generic title', () => {
  // Fix I-3: displayTitle is set to a realistic drug-name string to confirm the
  // scheduler NEVER leaks a sensitive drug name into the notification payload.
  // Using a generic 'ยา' was too weak — it would not fail even if the title
  // mapping were accidentally changed to pass displayTitle through.
  it('medication reminder with a drug-name displayTitle emits ONLY the generic Thai constant — never the drug name', () => {
    const DRUG_NAME = 'Paracetamol 500mg'; // realistic drug-name — must NEVER appear in output
    const r = makeReminder({
      id: 'rem-sd11',
      type: 'medication',
      displayTitle: DRUG_NAME,
    });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(e => {
      // (a) title must be exactly the generic constant — never the drug name
      expect(e.title).toBe(MEDICATION_TITLE_TH);
      // (b) neither title nor body (if present in ScheduleEntry) contains the drug name
      expect(e.title).not.toContain(DRUG_NAME);
    });
    // Confirm the test WOULD fail if title mapping were wrong: a non-medication
    // reminder with the same displayTitle DOES emit the drug name (control check)
    const apptWithSameName = makeReminder({
      id: 'rem-appt-ctrl',
      type: 'appointment',
      displayTitle: DRUG_NAME,
      sourceRefType: undefined,
      sourceRefId: undefined,
    });
    const ctrlEntries = buildScheduleSet([apptWithSameName], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(ctrlEntries.length).toBeGreaterThan(0);
    ctrlEntries.forEach(e => {
      expect(e.title).toBe(DRUG_NAME); // appointment → displayTitle passes through
    });
  });

  // Minor (b) — US-20 exact wording: "no drug name AND no dose"
  // The existing check above uses DRUG_NAME='Paracetamol 500mg' and asserts not.toContain(DRUG_NAME).
  // That catches the full string but NOT a standalone dose substring if only the dose leaked.
  // This test adds explicit dose-substring guards: '500mg' and '1 เม็ด' must never appear.
  it('SD-11 dose-leak guard: scheduled notification title contains no dose-like substring (US-20 — no drug name OR dose)', () => {
    const DOSE_ONLY = '500mg';
    const DOSE_THAI = '1 เม็ด';
    const r = makeReminder({
      id: 'rem-sd11-dose',
      type: 'medication',
      // displayTitle embeds a realistic dose substring — must be scrubbed by the generic override
      displayTitle: `Amoxicillin ${DOSE_ONLY}`,
    });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(e => {
      // Title must be the generic constant; dose substrings must never appear.
      // These would FAIL if the medication title override were removed and dose leaked.
      expect(e.title).not.toContain(DOSE_ONLY);
      expect(e.title).not.toContain(DOSE_THAI);
      // body is always '' (empty string) per scheduleAsync call — no dose surface there
    });
    // Sanity: MEDICATION_TITLE_TH itself contains neither dose string
    expect(MEDICATION_TITLE_TH).not.toContain(DOSE_ONLY);
    expect(MEDICATION_TITLE_TH).not.toContain(DOSE_THAI);
  });

  it('non-medication reminders use displayTitle as notification title', () => {
    const r = makeReminder({
      id: 'rem-appt',
      type: 'appointment',
      displayTitle: 'นัดฝากครรภ์',
      sourceRefType: undefined,
      sourceRefId: undefined,
    });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(e => {
      expect(e.title).toBe('นัดฝากครรภ์');
    });
  });
});

// ─── buildScheduleSet — deterministic occurrence id ───────────────────────────

describe('buildScheduleSet — deterministic occurrence id', () => {
  it('occurrenceId matches computeOccurrenceId(reminderId, scheduledLocalTime)', () => {
    const r = makeReminder({ id: 'rem-det' });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(e => {
      const expected = computeOccurrenceId(e.reminderId, e.scheduledLocalTime);
      expect(e.occurrenceId).toBe(expected);
    });
  });
});

// ─── buildScheduleSet — PRN (no recurrence, invalid rule) ─────────────────────

describe('buildScheduleSet — PRN plan creates NO entries', () => {
  it('a reminder with no timesOfDay (PRN-like, misconfigured) produces no entries', () => {
    // PRN plans produce no linked Reminder (Task 1). This tests that even if a
    // misconfigured reminder with empty timesOfDay slips through, it generates nothing.
    const r = makeReminder({
      id: 'rem-prn',
      recurrenceRule: { freq: 'daily', timesOfDay: [] },
      startAt: '2026-07-01T08:00',
    });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries).toHaveLength(0);
  });
});

// ─── scheduleUpcoming ─────────────────────────────────────────────────────────

describe('scheduleUpcoming', () => {
  it('calls adapter.scheduleAsync for each entry when permission granted', async () => {
    const adapter = makeMockAdapter();
    const r = makeReminder({ id: 'rem-su-1' });
    await scheduleUpcoming([r], new Set(), NOW_LOCAL, adapter);
    // Should have scheduled at least 1 notification
    expect(adapter.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(adapter.scheduleAsync).toHaveBeenCalled();
    // Each call uses the occurrenceId as the notification id
    const calls = (adapter.scheduleAsync as jest.Mock).mock.calls;
    calls.forEach(([id, title, _body, _fireAt]) => {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(title).toBe(MEDICATION_TITLE_TH);
    });
  });

  it('does NOT schedule when permission is declined (non-fatal — no throw)', async () => {
    const adapter = makeMockAdapter({
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
    });
    const r = makeReminder({ id: 'rem-su-denied' });
    // Must not throw
    await expect(scheduleUpcoming([r], new Set(), NOW_LOCAL, adapter)).resolves.toBeUndefined();
    expect(adapter.scheduleAsync).not.toHaveBeenCalled();
  });

  it('does NOT throw when adapter.scheduleAsync rejects (resilience)', async () => {
    const adapter = makeMockAdapter({
      scheduleAsync: jest.fn().mockRejectedValue(new Error('native error')),
    });
    const r = makeReminder({ id: 'rem-su-err' });
    // Non-fatal
    await expect(scheduleUpcoming([r], new Set(), NOW_LOCAL, adapter)).resolves.toBeUndefined();
  });
});

// ─── cancelForOccurrence ──────────────────────────────────────────────────────

describe('cancelForOccurrence', () => {
  it('calls adapter.cancelAsync with the given occurrenceId', async () => {
    const adapter = makeMockAdapter();
    const oid = computeOccurrenceId('rem-cancel', '2026-07-05T08:00');
    await cancelForOccurrence(oid, adapter);
    expect(adapter.cancelAsync).toHaveBeenCalledWith(oid);
    expect(adapter.cancelAsync).toHaveBeenCalledTimes(1);
  });

  it('does NOT throw when adapter.cancelAsync rejects', async () => {
    const adapter = makeMockAdapter({
      cancelAsync: jest.fn().mockRejectedValue(new Error('cancel error')),
    });
    const oid = computeOccurrenceId('rem-cancel', '2026-07-05T08:00');
    await expect(cancelForOccurrence(oid, adapter)).resolves.toBeUndefined();
  });
});

// ─── reanchor ─────────────────────────────────────────────────────────────────

describe('reanchor', () => {
  it('cancels stale OS notifications not in the new schedule set', async () => {
    const r = makeReminder({ id: 'rem-reanchor' });
    const staleId = 'stale-notification-id-not-in-new-set';
    const adapter = makeMockAdapter({
      getAllScheduledIdsAsync: jest.fn().mockResolvedValue([staleId]),
    });
    await reanchor([r], new Set(), NOW_LOCAL, adapter);
    // staleId must be cancelled
    expect(adapter.cancelAsync).toHaveBeenCalledWith(staleId);
  });

  it('does NOT cancel notifications that are in the new schedule set', async () => {
    const r = makeReminder({ id: 'rem-reanchor-keep' });
    // Pre-build the expected schedule set to get the real occurrence ids
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    expect(entries.length).toBeGreaterThan(0);
    const existingId = entries[0].occurrenceId;
    const adapter = makeMockAdapter({
      getAllScheduledIdsAsync: jest.fn().mockResolvedValue([existingId]),
    });
    await reanchor([r], new Set(), NOW_LOCAL, adapter);
    // existingId should NOT be cancelled (it's in the new schedule set)
    const cancelCalls = (adapter.cancelAsync as jest.Mock).mock.calls.map(c => c[0]);
    expect(cancelCalls).not.toContain(existingId);
  });

  it('schedules new occurrences during reanchor when permission granted', async () => {
    const r = makeReminder({ id: 'rem-reanchor-sched' });
    const adapter = makeMockAdapter();
    await reanchor([r], new Set(), NOW_LOCAL, adapter);
    expect(adapter.scheduleAsync).toHaveBeenCalled();
  });

  it('is idempotent — calling reanchor twice schedules each occurrence only once (replace)', async () => {
    const r = makeReminder({ id: 'rem-reanchor-idem' });
    const adapter = makeMockAdapter();
    // First reanchor
    await reanchor([r], new Set(), NOW_LOCAL, adapter);
    const firstCallCount = (adapter.scheduleAsync as jest.Mock).mock.calls.length;
    // Reset mocks
    (adapter.scheduleAsync as jest.Mock).mockClear();
    (adapter.getAllScheduledIdsAsync as jest.Mock).mockResolvedValue(
      buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET)
        .map(e => e.occurrenceId),
    );
    // Second reanchor with same data — should try to schedule same ids (replace = no-op)
    await reanchor([r], new Set(), NOW_LOCAL, adapter);
    // scheduleAsync is still called (it's idempotent replace), but no duplicates in the set
    const secondCallIds = (adapter.scheduleAsync as jest.Mock).mock.calls.map(c => c[0]);
    expect(new Set(secondCallIds).size).toBe(secondCallIds.length); // no duplicate ids
    // Same number of schedule calls (same window, same reminders)
    expect(secondCallIds.length).toBe(firstCallCount);
  });

  it('permission declined during reanchor — non-fatal, no schedule', async () => {
    const r = makeReminder({ id: 'rem-reanchor-denied' });
    const staleId = 'stale-id-123';
    const adapter = makeMockAdapter({
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
      getAllScheduledIdsAsync: jest.fn().mockResolvedValue([staleId]),
    });
    // Must not throw
    await expect(reanchor([r], new Set(), NOW_LOCAL, adapter)).resolves.toBeUndefined();
    // Should still cancel stale ids (cleanup) even if permission is denied
    expect(adapter.cancelAsync).toHaveBeenCalledWith(staleId);
    // But should NOT schedule new ones
    expect(adapter.scheduleAsync).not.toHaveBeenCalled();
  });
});

// ─── iOS ≤60 cap coverage (integration: BID plan coverage) ────────────────────

describe('iOS 64-cap / ≤60 budget — BID plan coverage window', () => {
  it('a BID plan (2x/day) schedules 14 occurrences in 7 days (within budget)', () => {
    const r = makeReminder({
      id: 'rem-bid',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '20:00'] },
      startAt: '2026-07-01T08:00',
    });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    // today noon: 08:00 already passed, 20:00 still in future → 1 today
    // day 2-7: 2x each = 12
    // total: 13 (today has 1: 20:00 only; days 5-11: 2x each = 12) → 13
    // 2026-07-04: 20:00 (afternoon, past noon) → included
    // 2026-07-05 to 2026-07-11: 08:00, 20:00 each = 14
    // Total = 1 + 14 = 15 — wait let me think again:
    // NOW_LOCAL = 2026-07-04T12:00
    // 2026-07-04T08:00 → fireAt < now → excluded
    // 2026-07-04T20:00 → fireAt > now → included (1)
    // 2026-07-05 to 2026-07-11: 2 per day × 7 days = 14
    // Total = 15
    expect(entries.length).toBe(15);
    expect(entries.length).toBeLessThanOrEqual(PENDING_BUDGET);
  });

  it('a TID plan (3x/day) over 7 days fits within the 60-budget', () => {
    const r = makeReminder({
      id: 'rem-tid',
      recurrenceRule: { freq: 'daily', timesOfDay: ['08:00', '14:00', '20:00'] },
      startAt: '2026-07-01T08:00',
    });
    const entries = buildScheduleSet([r], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET);
    // 2026-07-04: 14:00, 20:00 (08:00 past noon) → 2
    // 2026-07-05 to 2026-07-11: 3 per day × 7 days = 21
    // Total = 23
    expect(entries.length).toBe(23);
    expect(entries.length).toBeLessThanOrEqual(PENDING_BUDGET);
  });
});

// ─── Task 5: buildScheduleSet — snoozedUntilMap ───────────────────────────────

describe('buildScheduleSet — snoozedUntilMap (Task 5)', () => {
  it('schedules a snoozed occurrence at its future snoozedUntil, not original scheduledLocalTime', () => {
    // Occurrence id for 2026-07-04T08:00 — which is in the past (before noon)
    const reminder = makeReminder({ id: 'rem-snooze-1', startAt: '2026-07-04T08:00' });
    const oid = computeOccurrenceId('rem-snooze-1', '2026-07-04T08:00');
    const snoozedUntil = new Date(NOW_LOCAL.getTime() + 30 * 60 * 1000); // 12:30 local

    const snoozedUntilMap = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil, reminderId: 'rem-snooze-1', scheduledLocalTime: '2026-07-04T08:00' }],
    ]);
    const entries = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET, snoozedUntilMap);

    const snoozedEntry = entries.find(e => e.occurrenceId === oid);
    expect(snoozedEntry).toBeDefined();
    // fireAt must be snoozedUntil, not the original past civil time
    expect(snoozedEntry!.fireAt.getTime()).toBe(snoozedUntil.getTime());
  });

  it('does NOT schedule a snoozed occurrence whose snoozedUntil is in the past', () => {
    const reminder = makeReminder({ id: 'rem-snooze-past', startAt: '2026-07-04T08:00' });
    const oid = computeOccurrenceId('rem-snooze-past', '2026-07-04T08:00');
    const pastSnoozedUntil = new Date(NOW_LOCAL.getTime() - 5 * 60 * 1000); // 5 min before now

    const snoozedUntilMap = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil: pastSnoozedUntil, reminderId: 'rem-snooze-past', scheduledLocalTime: '2026-07-04T08:00' }],
    ]);
    const entries = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET, snoozedUntilMap);

    const snoozedEntry = entries.find(e => e.occurrenceId === oid);
    expect(snoozedEntry).toBeUndefined();
  });

  it('does not schedule a done occurrence even if (hypothetically) in snoozedUntilMap', () => {
    // excludedIds (done) takes priority over snoozedUntilMap
    const reminder = makeReminder({ id: 'rem-snooze-done', startAt: '2026-07-04T08:00' });
    const oid = computeOccurrenceId('rem-snooze-done', '2026-07-04T08:00');
    const futureTime = new Date(NOW_LOCAL.getTime() + 30 * 60 * 1000);

    const excludedIds = new Set([oid]); // done
    const snoozedUntilMap = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil: futureTime, reminderId: 'rem-snooze-done', scheduledLocalTime: '2026-07-04T08:00' }],
    ]);
    const entries = buildScheduleSet([reminder], excludedIds, NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET, snoozedUntilMap);

    const snoozedEntry = entries.find(e => e.occurrenceId === oid);
    expect(snoozedEntry).toBeUndefined();
  });

  it('continues to schedule due occurrences normally when snoozedUntilMap is empty', () => {
    const reminder = makeReminder({ id: 'rem-normal' });
    const entries = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET, new Map());
    // same as without snoozedUntilMap — at least 6 future occurrences this week
    expect(entries.length).toBeGreaterThanOrEqual(6);
  });

  it('uses snoozedUntil as fireAt in sorted order (snoozed alarms are included in shared budget)', () => {
    const reminder = makeReminder({ id: 'rem-sort-snooze', startAt: '2026-07-04T08:00' });
    const oid = computeOccurrenceId('rem-sort-snooze', '2026-07-04T08:00');
    // snoozedUntil = now + 10 min → should appear early in sorted output
    const earlySnooze = new Date(NOW_LOCAL.getTime() + 10 * 60 * 1000);
    const snoozedUntilMap = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil: earlySnooze, reminderId: 'rem-sort-snooze', scheduledLocalTime: '2026-07-04T08:00' }],
    ]);
    const entries = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET, snoozedUntilMap);

    // Snooze entry should be first (earliest fireAt)
    expect(entries[0].occurrenceId).toBe(oid);
    expect(entries[0].fireAt.getTime()).toBe(earlySnooze.getTime());
  });

  it('re-snooze replaces the pending alarm (same oid, new snoozedUntil — no duplicates)', () => {
    const reminder = makeReminder({ id: 'rem-resnooze', startAt: '2026-07-04T08:00' });
    const oid = computeOccurrenceId('rem-resnooze', '2026-07-04T08:00');
    // First snooze: 10 min from now
    const firstSnooze = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil: new Date(NOW_LOCAL.getTime() + 10 * 60 * 1000), reminderId: 'rem-resnooze', scheduledLocalTime: '2026-07-04T08:00' }],
    ]);
    const entries1 = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET, firstSnooze);
    const count1 = entries1.filter(e => e.occurrenceId === oid).length;
    expect(count1).toBe(1); // exactly one alarm for this oid

    // Re-snooze: 30 min from now — only entry in new snoozedUntilMap
    const secondSnooze = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil: new Date(NOW_LOCAL.getTime() + 30 * 60 * 1000), reminderId: 'rem-resnooze', scheduledLocalTime: '2026-07-04T08:00' }],
    ]);
    const entries2 = buildScheduleSet([reminder], new Set(), NOW_LOCAL, WINDOW_DAYS, PENDING_BUDGET, secondSnooze);
    const count2 = entries2.filter(e => e.occurrenceId === oid).length;
    expect(count2).toBe(1); // still exactly one alarm — replaced, never two
    expect(entries2.find(e => e.occurrenceId === oid)!.fireAt.getTime())
      .toBe(NOW_LOCAL.getTime() + 30 * 60 * 1000);
  });
});

// ─── Fix B: cross-midnight snoozed occurrence ──────────────────────────────────

describe('buildScheduleSet — cross-midnight snoozed occurrence (Fix B)', () => {
  it('23:50 dose snoozed 60 min → alarm still scheduled at 00:50 after midnight (not cancelled as stale)', () => {
    // A daily 23:50 occurrence was snoozed 60 min on 2026-07-04 → snoozedUntil = 2026-07-05T00:50.
    // After midnight, now = 2026-07-05T00:30. The 2026-07-04T23:50 civil time is BEFORE
    // windowStart='2026-07-05' and is NOT re-emitted by the recurrence expander.
    // Without Fix B the snoozedUntilMap entry is never consulted → snooze alarm dropped.
    // With Fix B the orphan pass emits it as a first-class ScheduleEntry.
    const reminder = makeReminder({
      id: 'rem-crossmidnight',
      recurrenceRule: { freq: 'daily', timesOfDay: ['23:50'] },
      startAt: '2026-07-04T23:50',
    });

    const scheduledLocalTime = '2026-07-04T23:50'; // the snoozed civil occurrence
    const oid = computeOccurrenceId('rem-crossmidnight', scheduledLocalTime);

    // After midnight — 00:30 on 2026-07-05 (before the 00:50 snooze alarm)
    const afterMidnightNow = new Date(2026, 6, 5, 0, 30, 0, 0); // local 00:30
    const snoozedUntil     = new Date(2026, 6, 5, 0, 50, 0, 0); // local 00:50 (20 min in future)

    const snoozedUntilMap = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil, reminderId: 'rem-crossmidnight', scheduledLocalTime }],
    ]);

    const entries = buildScheduleSet(
      [reminder],
      new Set(),
      afterMidnightNow,
      WINDOW_DAYS,
      PENDING_BUDGET,
      snoozedUntilMap,
    );

    // The 2026-07-04T23:50 oid is NOT expanded (it's before windowStart=2026-07-05).
    // The orphan pass must emit it as a schedulable entry at 00:50.
    const snoozedEntry = entries.find(e => e.occurrenceId === oid);
    expect(snoozedEntry).toBeDefined();
    expect(snoozedEntry!.fireAt.getTime()).toBe(snoozedUntil.getTime());
    expect(snoozedEntry!.reminderId).toBe('rem-crossmidnight');
    expect(snoozedEntry!.scheduledLocalTime).toBe(scheduledLocalTime);
  });

  it('cross-midnight snooze: oid is NOT double-emitted if expansion also re-emits it (same-day snooze in window)', () => {
    // A 13:00 dose snoozed to 13:30 — same day, occurrence IS in the expansion window.
    // The expansion loop should handle it (processedSnoozedOids) and the orphan pass
    // must NOT add it again → exactly 1 entry for this oid.
    const reminder = makeReminder({
      id: 'rem-same-day-snooze',
      recurrenceRule: { freq: 'daily', timesOfDay: ['13:00'] },
      startAt: '2026-07-04T13:00',
    });
    const scheduledLocalTime = '2026-07-04T13:00';
    const oid = computeOccurrenceId('rem-same-day-snooze', scheduledLocalTime);
    const snoozedUntil = new Date(NOW_LOCAL.getTime() + 30 * 60 * 1000); // 12:30 (now=12:00)

    // now=12:00 → windowStart='2026-07-04' → 13:00 IS expanded (it's in today's window)
    // but 13:00 fireAt > now (12:00)... wait: 13:00 fireAt > now → it's a future occurrence.
    // But the occurrence is SNOOZED, so it's in snoozedUntilMap.
    // The expansion encounters 2026-07-04T13:00 → oid → snoozedUntilMap.has(oid) → handled.
    // processedSnoozedOids.add(oid). Orphan pass: processedSnoozedOids.has(oid) → skip. ✓
    const snoozedUntilMap = new Map<string, SnoozedOccurrenceEntry>([
      [oid, { snoozedUntil, reminderId: 'rem-same-day-snooze', scheduledLocalTime }],
    ]);

    const entries = buildScheduleSet(
      [reminder],
      new Set(),
      NOW_LOCAL,
      WINDOW_DAYS,
      PENDING_BUDGET,
      snoozedUntilMap,
    );

    const oidEntries = entries.filter(e => e.occurrenceId === oid);
    expect(oidEntries).toHaveLength(1); // exactly one — no double-emit
    expect(oidEntries[0].fireAt.getTime()).toBe(snoozedUntil.getTime());
  });
});

// ─── Task 5: scheduleSnooze ────────────────────────────────────────────────────

describe('scheduleSnooze (Task 5)', () => {
  it('schedules the snooze alarm at snoozedUntil when permission is granted', async () => {
    const adapter = makeMockAdapter();
    const oid = 'test-occ-id-snooze';
    const snoozedUntil = new Date(NOW_LOCAL.getTime() + 10 * 60 * 1000);
    const title = MEDICATION_TITLE_TH;

    await scheduleSnooze(oid, snoozedUntil, title, adapter);

    expect(adapter.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(adapter.scheduleAsync).toHaveBeenCalledTimes(1);
    expect(adapter.scheduleAsync).toHaveBeenCalledWith(oid, title, '', snoozedUntil);
  });

  it('does NOT schedule when permission is declined (non-fatal)', async () => {
    const adapter = makeMockAdapter({
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
    });
    const oid = 'test-occ-id-declined';
    const snoozedUntil = new Date(NOW_LOCAL.getTime() + 30 * 60 * 1000);

    await scheduleSnooze(oid, snoozedUntil, MEDICATION_TITLE_TH, adapter);

    expect(adapter.scheduleAsync).not.toHaveBeenCalled();
  });

  it('is non-fatal when permission check throws', async () => {
    const adapter = makeMockAdapter({
      requestPermissionsAsync: jest.fn().mockRejectedValue(new Error('permission error')),
    });

    await expect(
      scheduleSnooze('occ-err', new Date(), MEDICATION_TITLE_TH, adapter),
    ).resolves.toBeUndefined();
    expect(adapter.scheduleAsync).not.toHaveBeenCalled();
  });

  it('is non-fatal when scheduleAsync throws', async () => {
    const adapter = makeMockAdapter({
      scheduleAsync: jest.fn().mockRejectedValue(new Error('schedule failed')),
    });

    await expect(
      scheduleSnooze('occ-err2', new Date(Date.now() + 60000), MEDICATION_TITLE_TH, adapter),
    ).resolves.toBeUndefined();
  });

  it('replacing a pending alarm — calling scheduleSnooze twice with same oid schedules the second time', async () => {
    // OS replaces same-id alarms; scheduling same oid twice = idempotent replace
    const adapter = makeMockAdapter();
    const oid = 'occ-replace';
    const first  = new Date(NOW_LOCAL.getTime() + 10 * 60 * 1000);
    const second = new Date(NOW_LOCAL.getTime() + 30 * 60 * 1000);

    await scheduleSnooze(oid, first,  MEDICATION_TITLE_TH, adapter);
    await scheduleSnooze(oid, second, MEDICATION_TITLE_TH, adapter);

    expect(adapter.scheduleAsync).toHaveBeenCalledTimes(2);
    // Second call uses the new time
    expect(adapter.scheduleAsync).toHaveBeenNthCalledWith(2, oid, MEDICATION_TITLE_TH, '', second);
  });
});
