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
 *
 * These tests verify the STORE behavior on reset(). The wiring of reset() calls
 * inside HomeScreen.handleLogout() is verified by TypeScript compilation + device
 * testing (requires @testing-library/react-native for component-level assertions).
 */

import { createKickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { createCalendarSyncStore } from '../sync/calendarSyncStore';
import { createSyncStore } from '../sync/syncStore';
import type { KickCountSessionRecord } from '../kickCount/kickCountTypes';
import type { SupplyItemRecord, ReminderRecord, ChecklistItemRecord } from '../sync/syncTypes';

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
