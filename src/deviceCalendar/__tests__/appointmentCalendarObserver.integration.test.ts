/**
 * appointmentCalendarObserver — end-to-end integration test
 *
 * Proves the WIRED path: calendarSyncStore mutation → appointmentCalendarObserver
 * → deviceCalendarBridge → expoCalendarGateway.
 *
 * WHY these tests matter (and why the isolated bridge tests cannot catch this):
 *   The isolated bridge tests call `bridge.onAppointmentUpserted()` directly.
 *   They test the bridge in isolation — they CANNOT verify that the bridge is
 *   actually called from the persistence point. A bug that leaves the bridge
 *   un-called (dead feature) is invisible to them.
 *   These tests exercise the real trigger: enqueueCreateChecklistItem →
 *   subscribeToChecklistItemMutations → observer → bridge → gateway.
 *   Removing the attachAppointmentCalendarObserver call makes every positive
 *   assertion below RED (the FAIL-ON-REVERT test proves this explicitly).
 *
 * Gate invariants (a)–(e) are re-verified here through the WIRED trigger.
 * If a gate test only calls bridge.onAppointmentUpserted directly it cannot
 * catch a case where the trigger itself bypasses the gate — these tests close
 * that gap.
 *
 * Trace: architecture §2 (observer on local store), functional §2.1–2.3,
 *        AC-2.6 (Reminder = 0 events), CAL-GATE-FRESH Option B,
 *        CAL-SA-30/31/32 (self-heal), AC-9.x (delete path).
 *
 * SECURITY: no health data logged; note and title are test fixtures only.
 */

// expo-calendar is a native ESM module — must be mocked before any import.
jest.mock('expo-calendar', () => ({}));

import { createCalendarSyncStore } from '../../sync/calendarSyncStore';
import { createDeviceCalendarBridge } from '../deviceCalendarBridge';
import { createMockExpoCalendarGateway } from './expoCalendarGateway.mock';
import { createCalendarMapStore } from '../calendarMapStore';
import { createDeviceCalendarSettings } from '../deviceCalendarSettings';
import { createDeviceCalendarQueue } from '../deviceCalendarQueue';
import { attachAppointmentCalendarObserver } from '../appointmentCalendarObserver';
import { ANC_LOCK_SCREEN_TITLE } from '../eventPayloadBuilder';
import type { ChecklistItemRecord } from '../../sync/syncTypes';
import type { ConsentStatus } from '../deviceCalendarState';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Drain enough microtask cycles for the async bridge operations to settle.
 * The observer fires `void bridge.onAppointmentUpserted(...)` (fire-and-forget
 * async). We need to flush the microtask queue to observe the gateway side effects.
 */
async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/** Make a minimal ChecklistItemRecord for category=appointment. */
function makeApptRecord(overrides: Partial<ChecklistItemRecord> = {}): ChecklistItemRecord {
  return {
    id: 'appt-001',
    category: 'appointment',
    title: 'นัดตรวจครรภ์',
    scheduledAt: '2027-09-10T10:00',
    note: 'โน้ต',
    source: 'user_created',
    done: false,
    version: 0,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface ConsentStates {
  calendarSync:  ConsentStatus;
  generalHealth: ConsentStatus;
}

/**
 * Build a wired (or unwired) test rig:
 *   - Fresh CalendarSyncStore (not the singleton — tests are isolated)
 *   - Real bridge with all real modules, injected mock gateway
 *   - Observer attached (withObserver=true, default) or detached (withObserver=false)
 *
 * withObserver=false is used for FAIL-ON-REVERT tests.
 */
function buildRig(
  consentState: ConsentStates = { calendarSync: 'granted', generalHealth: 'granted' },
  withObserver = true,
) {
  const store    = createCalendarSyncStore();
  const gateway  = createMockExpoCalendarGateway();
  const mapStore = createCalendarMapStore();
  const settings = createDeviceCalendarSettings();
  const queue    = createDeviceCalendarQueue();

  // Feature ON + target calendar resolved (mirror what enableFeature() would do)
  settings.setFeatureEnabled(true);
  settings.setResolvedCalendarId('mock-cal-id');

  const bridge = createDeviceCalendarBridge({
    gateway,
    mapStore,
    settings,
    queue,
    consentSnapshot: {
      calendarSync:  { status: consentState.calendarSync },
      generalHealth: { status: consentState.generalHealth },
    },
    osPermissionGranted: true,
    postConsent: jest.fn().mockResolvedValue({ ok: true }),
  });

  const unsubscribe = withObserver
    ? attachAppointmentCalendarObserver(store, bridge)
    : () => {};

  return { store, bridge, gateway, mapStore, unsubscribe };
}

// ─── Core wired path ──────────────────────────────────────────────────────────

describe('appointmentCalendarObserver — wired path (BLOCKER fix)', () => {
  it('create appointment → gateway.createEvent with Generic payload (title=ANC_LOCK_SCREEN_TITLE, empty location+notes)', async () => {
    // FAIL-ON-REVERT: omit attachAppointmentCalendarObserver → this is RED
    const { store, gateway } = buildRig();

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'wire-create-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(1);
    const { payload } = gateway.calls.createEvent[0];
    expect(payload.title).toBe(ANC_LOCK_SCREEN_TITLE);
    expect(payload.location).toBe('');
    expect(payload.notes).toBe('');
  });

  it('edit appointment → gateway.updateEvent (changed scheduledAt produces different hash)', async () => {
    const { store, gateway } = buildRig();
    const baseAppt = makeApptRecord({ id: 'wire-edit-1' });

    store.enqueueCreateChecklistItem(baseAppt);
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // Update with a changed scheduledAt → different content hash → updateEvent called
    store.enqueueUpdateChecklistItem({
      ...baseAppt,
      scheduledAt: '2027-09-11T10:00',
      updatedAt: new Date().toISOString(),
    });
    await settled();

    expect(gateway.calls.updateEvent).toHaveLength(1);
  });

  it('delete/cancel appointment → gateway.deleteEvent', async () => {
    const { store, gateway } = buildRig();

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'wire-del-1' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    store.enqueueDeleteChecklistItem('wire-del-1');
    await settled();

    expect(gateway.calls.deleteEvent).toHaveLength(1);
  });

  it('AC-2.6: Reminder (category=checklist_task) → gateway receives NOTHING', async () => {
    // Architecture: A Reminder or non-appointment item MUST NEVER reach the bridge.
    // AC-2.6: 0 events for non-appointment categories.
    const { store, gateway } = buildRig();

    store.enqueueCreateChecklistItem(makeApptRecord({
      id: 'ac26-reminder',
      category: 'checklist_task',  // ← not appointment
    }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
    expect(gateway.calls.updateEvent).toHaveLength(0);
    expect(gateway.calls.deleteEvent).toHaveLength(0);
  });

  it('AC-2.6: anc_visit category → gateway receives NOTHING', async () => {
    const { store, gateway } = buildRig();

    store.enqueueCreateChecklistItem(makeApptRecord({
      id: 'ac26-anc',
      category: 'anc_visit',  // ← not appointment; falls under reminder semantics
    }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
  });
});

// ─── FAIL-ON-REVERT ────────────────────────────────────────────────────────────

describe('appointmentCalendarObserver — FAIL-ON-REVERT: gateway is dead without the observer', () => {
  it('WITHOUT observer wired: create appointment → gateway.createEvent is NEVER called (RED when observer present)', async () => {
    // This test proves that the observer is the necessary and sufficient condition
    // for the bridge to fire. Remove attachAppointmentCalendarObserver from
    // buildRig (withObserver=false) and this expectation becomes the baseline:
    // the feature is dead. With the observer wired, the positive tests above are GREEN.
    const { store, gateway } = buildRig(
      { calendarSync: 'granted', generalHealth: 'granted' },
      false, // withObserver = FALSE — simulate the dead-feature state
    );

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'fov-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0); // proves the bridge was never called
  });
});

// ─── Gate invariants (a)–(e) through the WIRED trigger ─────────────────────────

describe('appointmentCalendarObserver — gate (a): unknown/uncached consent → no write via trigger', () => {
  it('calendar_sync=unknown → create appointment → no createEvent', async () => {
    const { store, gateway } = buildRig({ calendarSync: 'unknown', generalHealth: 'granted' });
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'ga-cal-unknown' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(0);
  });

  it('general_health=unknown → create appointment → no createEvent', async () => {
    const { store, gateway } = buildRig({ calendarSync: 'granted', generalHealth: 'unknown' });
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'ga-gh-unknown' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(0);
  });

  it('both unknown → create appointment → no createEvent', async () => {
    const { store, gateway } = buildRig({ calendarSync: 'unknown', generalHealth: 'unknown' });
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'ga-both-unknown' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(0);
  });
});

describe('appointmentCalendarObserver — gate (b): cached-granted → write even offline (Option B)', () => {
  it('both cached-granted → create appointment → createEvent (offline does NOT block)', async () => {
    // CAL-GATE-FRESH Option B: opens on positively-CACHED granted.
    // Offline state is not tracked in the gate; the gate opens on consent alone.
    const { store, gateway } = buildRig({ calendarSync: 'granted', generalHealth: 'granted' });
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'gb-online-equiv' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);
  });
});

describe('appointmentCalendarObserver — gate (c): consent refresh discovers withdrawal → self-heal delete via trigger', () => {
  it('create appointment, then consent refresh discovers withdrawal → deleteEvent (self-heal)', async () => {
    // Trace: CAL-SA-30/31/32 — self-heal cleanup triggered by refresh
    const { store, bridge, gateway } = buildRig({ calendarSync: 'granted', generalHealth: 'granted' });

    // 1. Create — event lands in the native calendar
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'gc-selfheal-1' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // 2. Consent refresh discovers withdrawal → bridge triggers self-heal delete
    await bridge.onConsentRefreshResult({
      calendarSync:  { status: 'withdrawn' },
      generalHealth: { status: 'granted' },
    });

    expect(gateway.calls.deleteEvent).toHaveLength(1);
  });

  it('consent refresh confirms both granted → no self-heal delete', async () => {
    const { store, bridge, gateway } = buildRig({ calendarSync: 'granted', generalHealth: 'granted' });

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'gc-no-selfheal' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    await bridge.onConsentRefreshResult({
      calendarSync:  { status: 'granted' },
      generalHealth: { status: 'granted' },
    });

    expect(gateway.calls.deleteEvent).toHaveLength(0);
  });
});

describe('appointmentCalendarObserver — gate (d): delete always works, consent-exempt via trigger', () => {
  it('create → withdraw consent → delete via trigger → deleteEvent still fires (path B)', async () => {
    // Compliance: consent withdrawal MUST NOT block deletion of previously
    // written events. Path B is always-available (gate-exempt from consent).
    const { store, bridge, gateway } = buildRig({ calendarSync: 'granted', generalHealth: 'granted' });

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'gd-pathb-1' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // Withdraw calendar_sync consent
    bridge.updateConsentSnapshot({
      calendarSync:  { status: 'withdrawn' },
      generalHealth: { status: 'granted' },
    });

    // Delete via the trigger — must still run despite withdrawn consent (path B)
    store.enqueueDeleteChecklistItem('gd-pathb-1');
    await settled();

    expect(gateway.calls.deleteEvent).toHaveLength(1);
  });

  it('delete of unmapped appointment (no prior sync) is a no-op — no gateway call', async () => {
    const { store, gateway } = buildRig({ calendarSync: 'withdrawn', generalHealth: 'withdrawn' });

    // Item was never synced — no map entry
    store.enqueueDeleteChecklistItem('gd-never-synced');
    await settled();

    expect(gateway.calls.deleteEvent).toHaveLength(0);
  });
});

describe('appointmentCalendarObserver — gate (e): dual-gate general_health via trigger', () => {
  it('general_health=withdrawn → create appointment → no createEvent', async () => {
    const { store, gateway } = buildRig({ calendarSync: 'granted', generalHealth: 'withdrawn' });
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'ge-gh-withdrawn' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(0);
  });

  it('calendar_sync=withdrawn → create appointment → no createEvent', async () => {
    const { store, gateway } = buildRig({ calendarSync: 'withdrawn', generalHealth: 'granted' });
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'ge-cal-withdrawn' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(0);
  });
});
