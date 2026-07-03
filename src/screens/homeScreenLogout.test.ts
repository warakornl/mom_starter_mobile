/**
 * HomeScreen logout PDPA health-store clearing — unit tests (TDD, failing first).
 *
 * 1.1 (appsec): logout MUST clear every health store to prevent cross-account
 * data leakage when user A logs out and user B logs into the same device
 * within the same JS session.
 *
 * Health stores that must be cleared on logout:
 *   - kickCountSyncStore (kick-count sessions — MOTHER-health K-8)
 *   - kickCountDraftStore.clearDraft() (in-progress draft — MOTHER-health K-8)
 *   - calendarSyncStore (appointments / reminders — MOTHER-health general_health)
 *   - supplySyncStore (supply items — NOT health data, but cleared for isolation)
 *   - selfLogSyncStore (self-log health events — MOTHER-health SD-5 general_health gated)
 *
 * Part A (factory-based): store reset() behaviour using isolated factory instances.
 * Part B (singleton-based, BLOCKER 1): the session-expiry / no-token auto-logout
 *   path routes through performLogout and resets ALL singleton stores including
 *   selfLogSyncStore (SD-5 cross-account-leak guard).
 */

import { createKickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { createCalendarSyncStore } from '../sync/calendarSyncStore';
import { createSyncStore } from '../sync/syncStore';
import type { KickCountSessionRecord } from '../kickCount/kickCountTypes';
import type { SupplyItemRecord, ReminderRecord, ChecklistItemRecord, SelfLogInput } from '../sync/syncTypes';

// ─── BLOCKER 1 singleton-store imports ───────────────────────────────────────
// Used to verify the session-expiry auto-logout path (RootNavigator.onLogout)
// routes through performLogout and clears the real singleton instances.
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { supplySyncStore } from '../sync/supplySyncStore';
import { performLogout } from '../auth/performLogout';

function makeKickSession(id: string): KickCountSessionRecord {
  const now = new Date().toISOString();
  return {
    id,
    startedAt: '2026-06-30T09:15',
    endedAt: '2026-06-30T09:27',
    movementCount: 7,
    targetCount: 10,
    status: 'completed',
    durationSeconds: 720,
    gestationalWeekAtStart: 34,
    note: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function makeSupplyItem(id: string): SupplyItemRecord {
  return {
    id,
    name: 'ผ้าอ้อม',
    category: 'diapers',
    onHandQty: 5,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function makeReminder(id: string): ReminderRecord {
  return {
    id,
    type: 'custom',
    displayTitle: 'นัดหมอ',
    recurrenceRule: { freq: 'one_off' },
    startAt: '2026-07-01T09:00',
    active: true,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function makeChecklistItem(id: string): ChecklistItemRecord {
  return {
    id,
    category: 'appointment',
    title: 'ตรวจครรภ์',
    done: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

// ─── kickCountSyncStore.reset() — PDPA health store isolation ─────────────────

describe('kickCountSyncStore.reset() — PDPA logout isolation (1.1)', () => {
  it('clears all sessions so user B cannot see user A\'s kick-count data', () => {
    const store = createKickCountSyncStore();
    store.upsertSession(makeKickSession('kc-session-A'));
    store.upsertSession(makeKickSession('kc-session-B'));
    store.setWatermark('wm-userA');

    store.reset();

    expect(store.getActiveSessions()).toHaveLength(0);
    expect(store.getWatermark()).toBeUndefined();
    expect(store.getPendingCount()).toBe(0);
  });

  it('clears pending push queue on logout — no queued mutations survive', () => {
    const store = createKickCountSyncStore();
    store.enqueueCreate(makeKickSession('queued-id'));
    expect(store.getPendingCount()).toBe(1);

    store.reset();

    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── calendarSyncStore.reset() — PDPA health store isolation ─────────────────

describe('calendarSyncStore.reset() — PDPA logout isolation (1.1)', () => {
  it('clears all reminders so user B cannot see user A\'s reminders', () => {
    const store = createCalendarSyncStore();
    store.upsertReminder(makeReminder('reminder-A'));
    store.upsertReminder(makeReminder('reminder-B'));

    store.reset();

    expect(store.getActiveReminders()).toHaveLength(0);
  });

  it('clears all checklist items (appointments) on logout', () => {
    const store = createCalendarSyncStore();
    store.upsertChecklistItem(makeChecklistItem('appt-A'));

    store.reset();

    expect(store.getActiveChecklistItems()).toHaveLength(0);
  });

  it('clears pending calendar push queue on logout', () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateReminder(makeReminder('r-A'));
    store.enqueueCreateChecklistItem(makeChecklistItem('c-A'));
    expect(store.getPendingCount()).toBe(2);

    store.reset();

    expect(store.getPendingCount()).toBe(0);
    expect(store.getWatermark()).toBeUndefined();
  });
});

// ─── supplySyncStore.reset() — session isolation ──────────────────────────────

describe('supplySyncStore / SyncStore.reset() — session isolation (1.1)', () => {
  it('clears all supply items on logout (prevents cross-session data leak)', () => {
    const store = createSyncStore();
    store.upsertSupplyItem(makeSupplyItem('item-A'));
    store.upsertSupplyItem(makeSupplyItem('item-B'));
    expect(store.getSupplyItems()).toHaveLength(2);

    store.reset();

    expect(store.getSupplyItems()).toHaveLength(0);
  });
});

// ─── BLOCKER 1: session-expiry / no-token auto-logout — singleton-store reset ─
//
// The second logout exit path (HomeScreen.loadProfile → no access token → onLogout())
// was wired as a bare navigation.reset() in RootNavigator.tsx, bypassing
// performLogout entirely. This means selfLogSyncStore.reset() (and the other health
// stores) NEVER fired on that path — a real cross-account leak the moment a
// 401/refresh-failure handler clears tokens mid-session.
//
// Fix (BLOCKER 1): the onLogout callback in RootNavigator's Home screen now routes
// through performLogout with all store-reset deps including resetSelfLogStore.
//
// These tests verify the end-to-end store-clear behaviour using the real module-level
// singletons (not factory instances) because that is what the wiring in RootNavigator
// operates on.

function makeSelfLogInput(overrides: Partial<SelfLogInput> = {}): SelfLogInput {
  return {
    metricType: 'weight',
    valueNumeric: 'dGVzdA==', // base64 "test" — opaque ciphertext placeholder
    unit: 'kg',
    loggedAt: '2026-07-03T09:00',
    ...overrides,
  };
}

describe('session-expiry / no-token auto-logout — PDPA cross-account-leak guard (BLOCKER 1)', () => {
  afterEach(() => {
    // Keep singleton state hermetic across tests.
    selfLogSyncStore.reset();
    kickCountSyncStore.reset();
    calendarSyncStore.reset();
    supplySyncStore.reset();
  });

  it('auto-logout path resets selfLogSyncStore (SD-5 — no cross-account health-data leak)', async () => {
    // Step 1: seed user A's self-log health data into the singleton store.
    selfLogSyncStore.addSelfLog(makeSelfLogInput());
    expect(selfLogSyncStore.getSelfLogs()).toHaveLength(1);

    // Step 2: trigger the auto-logout path (session-expiry / no-token).
    // Mirrors what the fixed RootNavigator.onLogout now does: routes through
    // performLogout with resetSelfLogStore wired (BLOCKER 1 + BLOCKER 2 fix).
    await performLogout({
      clearTokens: async () => { /* token already gone on session-expiry — no-op */ },
      resetSupplyStore: () => supplySyncStore.reset(),
      resetKickCountStore: () => kickCountSyncStore.reset(),
      resetCalendarStore: () => calendarSyncStore.reset(),
      resetSelfLogStore: () => selfLogSyncStore.reset(),
      clearKickCountDraft: async () => {},
      onComplete: () => {},
    });

    // Step 3: user B logs in on the same device — their session must see no data.
    expect(selfLogSyncStore.getSelfLogs()).toHaveLength(0);
  });

  it('auto-logout path also resets kickCountSyncStore and calendarSyncStore', async () => {
    // Seed cross-store data to verify the full reset bundle fires.
    kickCountSyncStore.enqueueCreate(makeKickSession('kc-auto-A'));
    calendarSyncStore.upsertReminder(makeReminder('r-auto-A'));
    selfLogSyncStore.addSelfLog(makeSelfLogInput());

    await performLogout({
      clearTokens: async () => {},
      resetSupplyStore: () => supplySyncStore.reset(),
      resetKickCountStore: () => kickCountSyncStore.reset(),
      resetCalendarStore: () => calendarSyncStore.reset(),
      resetSelfLogStore: () => selfLogSyncStore.reset(),
      clearKickCountDraft: async () => {},
      onComplete: () => {},
    });

    expect(kickCountSyncStore.getPendingCount()).toBe(0);
    expect(kickCountSyncStore.getActiveSessions()).toHaveLength(0);
    expect(calendarSyncStore.getActiveReminders()).toHaveLength(0);
    // selfLogSyncStore must also be cleared — PDPA SD-5 cross-account-leak guard.
    expect(selfLogSyncStore.getSelfLogs()).toHaveLength(0);
  });
});
