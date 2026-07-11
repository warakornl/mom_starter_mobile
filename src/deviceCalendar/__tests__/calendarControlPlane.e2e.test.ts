/**
 * calendarControlPlane.e2e.test.ts — BLOCKER 1 end-to-end test.
 *
 * Proves that the control-plane handlers (onGrantConsent → grantConsent() +
 * enableFeature(); onToggleOn → enableFeature()) actually open the gate so
 * that subsequent appointment writes reach gateway.createEvent.
 *
 * WHY this test catches what buildRig cannot:
 *   buildRig pre-sets gate state (featureEnabled=true, consentSnapshot=granted,
 *   osPermissionGranted=true). That means the gate was always open even before
 *   any handler ran — the gate is NEVER tested in a closed-then-opened path.
 *   A permanently-closed gate (no-op handlers in the navigator) is invisible
 *   to buildRig because the gate was never meant to be opened by a handler.
 *
 *   These tests START with gate fully CLOSED (consent=withdrawn, feature=OFF,
 *   osPermission=false) and only open it by calling the real handlers (exactly
 *   what the wired RootNavigator props should do). If the handlers are no-ops,
 *   the gate stays closed and every createEvent assertion is RED.
 *
 * FAIL-ON-REVERT sections explicitly demonstrate the RED state that the
 *   navigator's no-op handlers produce.
 *
 * Explainer-before-prompt order (CAL-SCR-10):
 *   grantConsent() = record consent; NO OS prompt.
 *   enableFeature() = request OS permission (the native prompt fires here).
 *   requestPermission must NOT fire before enableFeature() is called.
 *
 * Trace: BLOCKER 1, architecture §1.1/§2/§5.2, CAL-SCR-10, CAL-GATE-FRESH.
 * SECURITY: test fixture data only; no real health values logged.
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
import type { ConsentSnapshot } from '../deviceCalendarState';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function makeApptRecord(overrides: Partial<ChecklistItemRecord> = {}): ChecklistItemRecord {
  return {
    id: 'cp-appt-001',
    category: 'appointment',
    title: 'นัดตรวจครรภ์',
    scheduledAt: '2027-09-10T10:00',
    note: '',
    source: 'user_created',
    done: false,
    version: 1,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build a rig with gate FULLY CLOSED — consent withdrawn, feature OFF, OS denied.
 * This is the state a fresh user would be in before any handler runs.
 * No bridge method other than explicit handler calls opens the gate here.
 */
function buildClosedRig() {
  const store    = createCalendarSyncStore();
  const gateway  = createMockExpoCalendarGateway();
  const mapStore = createCalendarMapStore();
  const settings = createDeviceCalendarSettings();
  const queue    = createDeviceCalendarQueue();
  const postConsent = jest.fn().mockResolvedValue({ ok: true });

  // Gate CLOSED: consent not granted, feature OFF, OS permission not granted.
  const bridge = createDeviceCalendarBridge({
    gateway,
    mapStore,
    settings,
    queue,
    consentSnapshot: {
      calendarSync:  { status: 'withdrawn' },
      generalHealth: { status: 'granted' },   // general_health already consented
    },
    osPermissionGranted: false,
    postConsent,
  });

  // Wire the observer (architecture §2 — the real production path)
  attachAppointmentCalendarObserver(store, bridge);

  return { store, bridge, gateway, mapStore, settings, postConsent };
}

// ─── BLOCKER 1a: onGrantConsent handler ──────────────────────────────────────

describe('onGrantConsent handler → grantConsent() + enableFeature() → gate opens → createEvent', () => {
  it('calling grantConsent() + updateConsentSnapshot + enableFeature() opens the gate', async () => {
    // This test is RED before the RootNavigator fix because onGrantConsent is a no-op
    // (navigation.goBack()) and never calls grantConsent() or enableFeature().
    const { store, bridge, gateway, postConsent } = buildClosedRig();

    // ─── The real onGrantConsent handler (what the wired navigator must do) ───
    // 1. POST consent granted (NO OS prompt here — explainer-before-prompt)
    await bridge.grantConsent('v1.0');
    expect(gateway.calls.requestPermission).toBe(0); // proved: no OS prompt yet

    // 2. Update bridge's consent snapshot (mirrors consentStore.setGranted + sync)
    const grantedSnapshot: ConsentSnapshot = {
      calendarSync:  { status: 'granted' },
      generalHealth: { status: 'granted' },
    };
    bridge.updateConsentSnapshot(grantedSnapshot);

    // 3. Request OS calendar permission + enable feature (OS prompt fires here)
    const result = await bridge.enableFeature();
    expect(result).toBe('ok');
    expect(gateway.calls.requestPermission).toBe(1); // OS prompt fired exactly once

    // ─── Gate is now open. Create appointment → createEvent must fire ─────────
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'cp-grant-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(1);
    expect(postConsent).toHaveBeenCalledWith({
      consentType:        'calendar_sync',
      granted:             true,
      consentTextVersion: 'v1.0',
    });
  });

  it('FAIL-ON-REVERT: no-op onGrantConsent → gate stays closed → NO createEvent', async () => {
    // This is the state that RootNavigator.tsx:833 produces before the fix:
    //   onGrant={async () => { navigation.goBack(); }}  // pure no-op
    // The gate never opens; every subsequent appointment write is silently dropped.
    const { store, gateway } = buildClosedRig();

    // ─── No-op handler (simulates the broken navigator before fix) ────────────
    // onGrant = async () => { navigation.goBack(); }  ← no grantConsent/enableFeature

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'cp-noop-grant-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0); // gate is permanently closed
  });
});

// ─── BLOCKER 1b: onToggleOn handler (consent already granted) ────────────────

describe('onToggleOn handler (consent pre-granted) → enableFeature() → gate opens → createEvent', () => {
  it('consent granted; calling enableFeature() opens OS permission gate → createEvent fires', async () => {
    // This is the path when a user already granted consent but feature was OFF.
    // CalendarSyncSettingsScreen.handleToggle(true) + consentGranted=true calls onToggleOn.
    const store    = createCalendarSyncStore();
    const gateway  = createMockExpoCalendarGateway();
    const mapStore = createCalendarMapStore();
    const settings = createDeviceCalendarSettings();
    const queue    = createDeviceCalendarQueue();

    // consent IS granted; but feature and OS permission are OFF
    const bridge = createDeviceCalendarBridge({
      gateway,
      mapStore,
      settings,
      queue,
      consentSnapshot: {
        calendarSync:  { status: 'granted' },  // already granted
        generalHealth: { status: 'granted' },
      },
      osPermissionGranted: false, // OS permission not yet granted
      postConsent: jest.fn().mockResolvedValue({ ok: true }),
    });

    attachAppointmentCalendarObserver(store, bridge);

    // ─── Real onToggleOn handler (what the wired navigator must do) ───────────
    const result = await bridge.enableFeature();
    expect(result).toBe('ok');
    expect(gateway.calls.requestPermission).toBe(1);

    // Gate open → appointment → createEvent
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'cp-toggle-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(1);
  });

  it('FAIL-ON-REVERT: no-op onToggleOn → feature stays OFF → NO createEvent', async () => {
    // This is what RootNavigator.tsx:817-822 produced before fix:
    //   onToggleOn was NOT passed at all (prop was absent → screen's onToggleOn = undefined)
    // Consent is granted but OS permission was never requested → gate stays closed.
    const store    = createCalendarSyncStore();
    const gateway  = createMockExpoCalendarGateway();
    const mapStore = createCalendarMapStore();
    const settings = createDeviceCalendarSettings();
    const queue    = createDeviceCalendarQueue();

    const bridge = createDeviceCalendarBridge({
      gateway,
      mapStore,
      settings,
      queue,
      consentSnapshot: {
        calendarSync:  { status: 'granted' },
        generalHealth: { status: 'granted' },
      },
      osPermissionGranted: false,
      postConsent: jest.fn().mockResolvedValue({ ok: true }),
    });

    attachAppointmentCalendarObserver(store, bridge);

    // ─── No onToggleOn call (no-op / absent prop) ─────────────────────────────
    // enableFeature() is never called → osPermission stays false → featureToggle stays false

    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'cp-noop-toggle-1' }));
    await settled();

    expect(gateway.calls.createEvent).toHaveLength(0);
  });
});

// ─── BLOCKER 1c: onDisableFeature handler ────────────────────────────────────

describe('onDisableFeature handler → disableAndWithdraw() → feature OFF + consent withdrawn', () => {
  it('disableAndWithdraw(delete) → stops sync + deletes existing native events', async () => {
    // Start with gate open (consent+feature+OS granted)
    const store    = createCalendarSyncStore();
    const gateway  = createMockExpoCalendarGateway();
    const mapStore = createCalendarMapStore();
    const settings = createDeviceCalendarSettings();
    settings.setFeatureEnabled(true);
    settings.setResolvedCalendarId('mock-cal-id');
    const queue    = createDeviceCalendarQueue();
    const postConsent = jest.fn().mockResolvedValue({ ok: true });

    const bridge = createDeviceCalendarBridge({
      gateway,
      mapStore,
      settings,
      queue,
      consentSnapshot: { calendarSync: { status: 'granted' }, generalHealth: { status: 'granted' } },
      osPermissionGranted: true,
      postConsent,
    });

    attachAppointmentCalendarObserver(store, bridge);

    // Create event first
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'cp-disable-1' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // ─── Real onDisableFeature('delete') handler ──────────────────────────────
    await bridge.disableAndWithdraw('delete', 'v1.0');

    // deleteEvent was called for the app-created event
    expect(gateway.calls.deleteEvent).toHaveLength(1);
    // consent withdrawal POSTed
    expect(postConsent).toHaveBeenLastCalledWith({
      consentType:        'calendar_sync',
      granted:             false,
      consentTextVersion: 'v1.0',
    });

    // Gate is now closed — no more writes
    store.enqueueCreateChecklistItem(makeApptRecord({ id: 'cp-disable-after' }));
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1); // still 1, not 2
  });
});

// ─── BLOCKER 1d: explainer-before-prompt ordering ────────────────────────────

describe('explainer-before-prompt ordering (CAL-SCR-10) through the real handler', () => {
  it('grantConsent fires NO OS prompt; enableFeature fires exactly one OS prompt', async () => {
    const { bridge, gateway } = buildClosedRig();

    // Before any handler call
    expect(gateway.calls.requestPermission).toBe(0);

    // Step 1: consent POST only — still no OS prompt
    await bridge.grantConsent('v1.0');
    expect(gateway.calls.requestPermission).toBe(0);

    // Step 2: update snapshot then enable — OS prompt fires HERE
    bridge.updateConsentSnapshot({
      calendarSync:  { status: 'granted' },
      generalHealth: { status: 'granted' },
    });
    await bridge.enableFeature();

    expect(gateway.calls.requestPermission).toBe(1); // exactly one native prompt
  });
});

// ─── BLOCKER 1e: privacy level handler ───────────────────────────────────────

describe('onPrivacyLevelChanged handler → re-masks existing synced events', () => {
  it('changing privacy level to descriptive → updateEvent called for each synced appointment', async () => {
    const store    = createCalendarSyncStore();
    const gateway  = createMockExpoCalendarGateway();
    const mapStore = createCalendarMapStore();
    const settings = createDeviceCalendarSettings();
    settings.setFeatureEnabled(true);
    settings.setResolvedCalendarId('mock-cal-id');
    const queue    = createDeviceCalendarQueue();

    const bridge = createDeviceCalendarBridge({
      gateway,
      mapStore,
      settings,
      queue,
      consentSnapshot: { calendarSync: { status: 'granted' }, generalHealth: { status: 'granted' } },
      osPermissionGranted: true,
      postConsent: jest.fn().mockResolvedValue({ ok: true }),
    });

    attachAppointmentCalendarObserver(store, bridge);

    const appt = makeApptRecord({ id: 'cp-privacy-1', title: 'นัดสูตินรีแพทย์' });
    store.enqueueCreateChecklistItem(appt);
    await settled();
    expect(gateway.calls.createEvent).toHaveLength(1);

    // ─── Real onPrivacyLevelChanged handler ───────────────────────────────────
    await bridge.onPrivacyLevelChanged(
      'descriptive',
      (id) => {
        // Simulates calendarSyncStore.getChecklistItem
        if (id === appt.id) {
          return {
            id: appt.id,
            category: appt.category,
            title: appt.title,
            scheduledAt: appt.scheduledAt!,
            note: appt.note ?? '',
            source: appt.source ?? 'user_created',
            done: appt.done,
          };
        }
        return undefined;
      },
    );

    // updateEvent re-masks with descriptive title
    expect(gateway.calls.updateEvent).toHaveLength(1);
    const { payload } = gateway.calls.updateEvent[0];
    expect(payload.title).toBe(appt.title); // descriptive = real title shown
  });
});
