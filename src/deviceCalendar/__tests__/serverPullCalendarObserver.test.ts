/**
 * serverPullCalendarObserver — integration test for BLOCKER 2 fix.
 *
 * Proves that adoptChecklistItemServerRecord and upsertChecklistItem emit
 * ChecklistItemMutationEvents so that server-pulled appointment changes reach
 * the device calendar bridge — not just user-initiated writes.
 *
 * Root cause before fix:
 *   `adoptChecklistItemServerRecord` and `upsertChecklistItem` called the
 *   underlying map setter but never called `_notifyChecklistMutation()`, so
 *   a pulled appointment silently missed the device-calendar observer.
 *   Only the three `enqueueCreate/Update/DeleteChecklistItem` paths notified.
 *
 * FAIL-ON-REVERT structure:
 *   Each positive assertion is RED before the calendarSyncStore.ts fix.
 *   The negative assertion at the end is always GREEN and proves the observer
 *   is the necessary condition (removing it makes positives RED again).
 *
 * Trace: architecture §2 (reactive observer — ALL local writes), BLOCKER 2.
 * SECURITY: test fixture data only, no real health values.
 */

// expo-calendar is a native ESM module — mock before any import.
jest.mock('expo-calendar', () => ({}));

import { createCalendarSyncStore } from '../../sync/calendarSyncStore';
import { createDeviceCalendarBridge } from '../deviceCalendarBridge';
import { createMockExpoCalendarGateway } from './expoCalendarGateway.mock';
import { createCalendarMapStore } from '../calendarMapStore';
import { createDeviceCalendarSettings } from '../deviceCalendarSettings';
import { createDeviceCalendarQueue } from '../deviceCalendarQueue';
import { attachAppointmentCalendarObserver } from '../appointmentCalendarObserver';
import type { ChecklistItemRecord } from '../../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function makeApptRecord(overrides: Partial<ChecklistItemRecord> = {}): ChecklistItemRecord {
  return {
    id: 'pull-appt-001',
    category: 'appointment',
    title: 'นัดตรวจครรภ์',
    scheduledAt: '2027-09-10T10:00',
    note: 'โน้ต',
    source: 'user_created',
    done: false,
    version: 1,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildRig(withObserver = true) {
  const store    = createCalendarSyncStore();
  const gateway  = createMockExpoCalendarGateway();
  const mapStore = createCalendarMapStore();
  const settings = createDeviceCalendarSettings();
  const queue    = createDeviceCalendarQueue();

  settings.setFeatureEnabled(true);
  settings.setResolvedCalendarId('mock-cal-id');

  const bridge = createDeviceCalendarBridge({
    gateway,
    mapStore,
    settings,
    queue,
    consentSnapshot: {
      calendarSync:  { status: 'granted' },
      generalHealth: { status: 'granted' },
    },
    osPermissionGranted: true,
    postConsent: jest.fn().mockResolvedValue({ ok: true }),
  });

  const unsubscribe = withObserver
    ? attachAppointmentCalendarObserver(store, bridge)
    : () => {};

  return { store, bridge, gateway, mapStore, unsubscribe };
}

// ─── adoptChecklistItemServerRecord — BLOCKER 2a ─────────────────────────────

describe('adoptChecklistItemServerRecord → observer → bridge (BLOCKER 2 fix)', () => {
  it('newly adopted appointment from server → gateway.createEvent fires', async () => {
    // RED before fix: adoptChecklistItemServerRecord didn't call _notifyChecklistMutation
    // GREEN after fix: mutation is emitted → observer → bridge.onAppointmentUpserted → createEvent
    const { store, gateway } = buildRig();

    store.adoptChecklistItemServerRecord(makeApptRecord({ id: 'adopt-new-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(1);
  });

  it('server-adopted update of already-synced appointment → gateway.updateEvent fires', async () => {
    // Simulates: user creates appointment (user path) → event written to calendar
    // Server then returns the same appointment with a different scheduledAt (server-side edit)
    // → observer should emit → bridge → updateEvent (not create a duplicate)
    const { store, gateway } = buildRig();

    // Step 1: user creates, gets synced to calendar
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'adopt-update-1', scheduledAt: '2027-09-10T10:00' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // Step 2: server records the same appointment with a different scheduledAt
    store.adoptChecklistItemServerRecord(makeApptRecord({
      id: 'adopt-update-1',
      scheduledAt: '2027-09-11T09:00', // changed by server-side edit
      version: 2,
    }));
    await settled();

    // The observer fires → bridge sees existing map entry → updateEvent (not duplicate create)
    expect(gateway.calls.updateEvent).toHaveLength(1);
    expect(gateway.calls.createEvent).toHaveLength(1); // still 1, not 2
  });

  it('adopted non-appointment (checklist_task) → gateway receives NOTHING (AC-2.6)', async () => {
    const { store, gateway } = buildRig();

    store.adoptChecklistItemServerRecord(makeApptRecord({
      id: 'adopt-task-1',
      category: 'checklist_task',
    }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
    expect(gateway.calls.updateEvent).toHaveLength(0);
  });

  it('adopted tombstoned appointment (deletedAt set) → gateway receives NOTHING', async () => {
    const { store, gateway } = buildRig();

    store.adoptChecklistItemServerRecord(makeApptRecord({
      id: 'adopt-tombstone-1',
      deletedAt: new Date().toISOString(),
    }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
  });
});

// ─── upsertChecklistItem — BLOCKER 2b ────────────────────────────────────────

describe('upsertChecklistItem → observer → bridge (BLOCKER 2 fix)', () => {
  it('upsert of new appointment → gateway.createEvent fires', async () => {
    // RED before fix: upsertChecklistItem didn't call _notifyChecklistMutation
    const { store, gateway } = buildRig();

    store.upsertChecklistItem(makeApptRecord({ id: 'upsert-new-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(1);
  });

  it('upsert of existing appointment (higher version) → gateway.updateEvent fires', async () => {
    const { store, gateway } = buildRig();

    // First create via enqueue
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'upsert-upd-1', version: 1 }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // Upsert with higher version (different scheduledAt → different hash → update)
    store.upsertChecklistItem(makeApptRecord({
      id: 'upsert-upd-1',
      scheduledAt: '2027-10-20T14:00',
      version: 2,
    }));
    await settled();

    expect(gateway.calls.updateEvent).toHaveLength(1);
  });

  it('upsert of same-or-lower version → no-op → NO extra gateway call', async () => {
    // makeUpsert skips if existing.version >= incoming.version.
    // No notification should fire either (idempotent guard).
    const { store, gateway } = buildRig();

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'upsert-noop-1', version: 5 }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // Lower version — makeUpsert skips → no notification → no second call
    store.upsertChecklistItem(makeApptRecord({ id: 'upsert-noop-1', version: 3 }));
    await settled();

    // Still 1 createEvent, 0 updateEvent — the no-op was truly a no-op
    expect(gateway.calls.createEvent).toHaveLength(1);
    expect(gateway.calls.updateEvent).toHaveLength(0);
  });

  it('upsert of non-appointment → gateway receives NOTHING (AC-2.6)', async () => {
    const { store, gateway } = buildRig();

    store.upsertChecklistItem(makeApptRecord({ id: 'upsert-task-1', category: 'checklist_task' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
  });
});

// ─── FAIL-ON-REVERT: without observer the same store writes fire nothing ───────

describe('FAIL-ON-REVERT: without observer, server-pull writes are silent', () => {
  it('adoptChecklistItemServerRecord without observer → gateway receives NOTHING', async () => {
    // The observer is the wiring that connects store events to the bridge.
    // Without it (withObserver=false), even with notifications fixed in the store,
    // the bridge is never called.  This mirrors the dead-feature state.
    const { store, gateway } = buildRig(false);

    store.adoptChecklistItemServerRecord(makeApptRecord({ id: 'fov-adopt-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
  });

  it('upsertChecklistItem without observer → gateway receives NOTHING', async () => {
    const { store, gateway } = buildRig(false);

    store.upsertChecklistItem(makeApptRecord({ id: 'fov-upsert-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
  });
});
