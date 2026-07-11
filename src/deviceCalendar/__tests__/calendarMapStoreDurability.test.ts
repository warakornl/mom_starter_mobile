/**
 * calendarMapStoreDurability.test.ts — BLOCKER 3 durability test.
 *
 * Proves that calendarMapStore.loadFromStorage() prevents duplicate native
 * calendar events on app relaunch by restoring the appointmentId→nativeEventId
 * map from durable storage.
 *
 * Root cause before fix:
 *   The module-level singleton in deviceCalendarSingleton.ts constructed
 *   `_mapStore = createCalendarMapStore()` with NO storage argument.
 *   On relaunch, the map was always empty → every existing appointment was
 *   treated as a new (map-absent) record → gateway.createEvent was called
 *   again → DUPLICATE native calendar event.
 *
 * FAIL-ON-REVERT structure:
 *   - Positive test: loadFromStorage() restores entries → write of same
 *     appointment → updateEvent (not a second createEvent).
 *   - Negative test: without loadFromStorage() → map empty → second write
 *     → createEvent (the duplicate-event bug).
 *
 * Trace: BLOCKER 3, architecture §3 "durable, device-local, NOT synced",
 *        CAL-EDGE-06 reconciliation alternative.
 * SECURITY: health-free map entries (appointmentId, nativeEventId only).
 */

// expo-calendar is a native ESM module — mock before any import.
jest.mock('expo-calendar', () => ({}));

import { createCalendarMapStore } from '../calendarMapStore';
import type { CalendarMapStorage } from '../calendarMapStore';
import { createDeviceCalendarBridge } from '../deviceCalendarBridge';
import { createMockExpoCalendarGateway } from './expoCalendarGateway.mock';
import { createDeviceCalendarSettings } from '../deviceCalendarSettings';
import { createDeviceCalendarQueue } from '../deviceCalendarQueue';
import type { AppointmentInput } from '../eventPayloadBuilder';

// ─── In-memory storage (same pattern as calendarMapStore already expects) ─────

class InMemoryStorage implements CalendarMapStorage {
  private _data: string | null = null;

  async save(json: string): Promise<void> {
    this._data = json;
  }

  async load(): Promise<string | null> {
    return this._data;
  }

  peek(): string | null {
    return this._data;
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeAppt(id: string): AppointmentInput {
  return {
    id,
    category:    'appointment',
    title:       'นัดตรวจครรภ์',
    scheduledAt: '2027-09-10T10:00',
    note:        '',
    source:      'user_created',
    done:        false,
  };
}

function buildBridge(mapStore: ReturnType<typeof createCalendarMapStore>, gateway: ReturnType<typeof createMockExpoCalendarGateway>) {
  const settings = createDeviceCalendarSettings();
  settings.setFeatureEnabled(true);
  settings.setResolvedCalendarId('mock-cal-id');

  return createDeviceCalendarBridge({
    gateway,
    mapStore,
    settings,
    queue: createDeviceCalendarQueue(),
    consentSnapshot: {
      calendarSync:  { status: 'granted' },
      generalHealth: { status: 'granted' },
    },
    osPermissionGranted: true,
    postConsent: jest.fn().mockResolvedValue({ ok: true }),
  });
}

// ─── Durability — prevents duplicates on relaunch ────────────────────────────

describe('calendarMapStore loadFromStorage() — prevents duplicate native events on relaunch (BLOCKER 3 fix)', () => {
  it('restored map → second write of same appointment → updateEvent (not duplicate createEvent)', async () => {
    // ── "First launch" session ────────────────────────────────────────────────
    const storage = new InMemoryStorage();
    const mapStore1 = createCalendarMapStore(storage);

    const gateway1 = createMockExpoCalendarGateway();
    const bridge1 = buildBridge(mapStore1, gateway1);

    // Appointment written to native calendar
    const appt = makeAppt('durable-appt-1');
    await bridge1.onAppointmentUpserted(appt);

    expect(gateway1.calls.createEvent).toHaveLength(1);
    const nativeId = gateway1.calls.createEvent[0]; // event was created

    // Verify map was persisted
    expect(storage.peek()).not.toBeNull();
    const stored = mapStore1.get('durable-appt-1');
    expect(stored?.nativeEventId).toMatch(/^mock-event-/);

    // ── "Second launch" session — simulate relaunch ───────────────────────────
    const mapStore2 = createCalendarMapStore(storage); // same storage
    await mapStore2.loadFromStorage(); // ← THIS is the fix

    // Map should be restored
    const restored = mapStore2.get('durable-appt-1');
    expect(restored).toBeDefined();
    expect(restored?.nativeEventId).toBe(stored?.nativeEventId);

    // Write same appointment again (as backfill would do on relaunch)
    const gateway2 = createMockExpoCalendarGateway();
    const bridge2 = buildBridge(mapStore2, gateway2);

    await bridge2.onAppointmentUpserted(appt);

    // MUST NOT create a duplicate — existing map entry means updateEvent OR skip (hash match)
    expect(gateway2.calls.createEvent).toHaveLength(0);
    // updateEvent may or may not fire depending on hash match — key thing is NO duplicate create
    void nativeId; // unused var acknowledgment
  });

  it('FAIL-ON-REVERT: without loadFromStorage map is empty → duplicate createEvent fires', async () => {
    // Proves why loadFromStorage is needed.
    // A new mapStore without loadFromStorage() starts empty.
    const storage = new InMemoryStorage();
    const mapStore1 = createCalendarMapStore(storage);

    // "First launch" — create and persist
    const gateway1 = createMockExpoCalendarGateway();
    const bridge1 = buildBridge(mapStore1, gateway1);
    await bridge1.onAppointmentUpserted(makeAppt('dup-appt-1'));
    expect(gateway1.calls.createEvent).toHaveLength(1);

    // "Second launch" — map NOT loaded from storage (the bug)
    const mapStore2 = createCalendarMapStore(storage);
    // NOT calling mapStore2.loadFromStorage() — simulates the pre-fix bug

    const gateway2 = createMockExpoCalendarGateway();
    const bridge2 = buildBridge(mapStore2, gateway2);

    // Write same appointment again — empty map → bridge thinks it's new → DUPLICATE
    await bridge2.onAppointmentUpserted(makeAppt('dup-appt-1'));
    expect(gateway2.calls.createEvent).toHaveLength(1); // proves the duplicate bug
    expect(gateway2.calls.updateEvent).toHaveLength(0);
  });
});

// ─── deviceCalendarSettings durability ───────────────────────────────────────

describe('deviceCalendarSettings loadFromStorage() — feature state survives relaunch', () => {
  it('settings loaded from storage: featureEnabled=true → bridge reads correct initial state', async () => {
    // After the fix, deviceCalendarSingleton injects storage into _settings
    // and calls loadFromStorage() at startup — bridge then reads the persisted state.
    const { createDeviceCalendarSettings: makeSettings } = await import('../deviceCalendarSettings');
    const storage = new InMemoryStorage();

    // "First launch" — save featureEnabled=true
    const settings1 = makeSettings(storage);
    settings1.setFeatureEnabled(true);
    settings1.setResolvedCalendarId('cal-42');
    settings1.setPrivacyLevel('descriptive');
    await settings1.persist();

    // "Second launch" — load from storage
    const settings2 = makeSettings(storage);
    await settings2.loadFromStorage();

    expect(settings2.get().featureEnabled).toBe(true);
    expect(settings2.get().resolvedCalendarId).toBe('cal-42');
    expect(settings2.get().privacyLevel).toBe('descriptive');
  });

  it('FAIL-ON-REVERT: without loadFromStorage, settings default to featureEnabled=false', async () => {
    const { createDeviceCalendarSettings: makeSettings } = await import('../deviceCalendarSettings');
    const storage = new InMemoryStorage();

    const settings1 = makeSettings(storage);
    settings1.setFeatureEnabled(true);
    await settings1.persist();

    // Second launch WITHOUT loadFromStorage — starts with defaults
    const settings2 = makeSettings(storage);
    // NOT calling loadFromStorage()

    expect(settings2.get().featureEnabled).toBe(false); // default — proves durability is needed
  });
});

// ─── calendarMapStore.loadFromStorage handles edge cases ─────────────────────

describe('calendarMapStore.loadFromStorage — edge cases', () => {
  it('empty storage → loadFromStorage is a no-op → map starts empty', async () => {
    const storage = new InMemoryStorage();
    const mapStore = createCalendarMapStore(storage);
    await mapStore.loadFromStorage();

    expect(mapStore.entries()).toHaveLength(0);
  });

  it('corrupt JSON in storage → loadFromStorage silently recovers with empty map', async () => {
    const storage = new InMemoryStorage();
    await storage.save('{{{NOT_VALID_JSON');
    const mapStore = createCalendarMapStore(storage);
    await mapStore.loadFromStorage(); // must not throw

    expect(mapStore.entries()).toHaveLength(0);
  });

  it('multiple entries round-trip: save 3 → load → all 3 restored', async () => {
    const storage = new InMemoryStorage();
    const mapStore1 = createCalendarMapStore(storage);

    const now = Date.now();
    mapStore1.put({ appointmentId: 'a1', nativeEventId: 'ne1', calendarId: 'c1', privacyLevelAtWrite: 'generic', syncedContentHash: 'h:1', updatedAt: now });
    mapStore1.put({ appointmentId: 'a2', nativeEventId: 'ne2', calendarId: 'c1', privacyLevelAtWrite: 'descriptive', syncedContentHash: 'h:2', updatedAt: now });
    mapStore1.put({ appointmentId: 'a3', nativeEventId: 'ne3', calendarId: 'c1', privacyLevelAtWrite: 'generic', syncedContentHash: 'h:3', updatedAt: now });
    await mapStore1.persist();

    const mapStore2 = createCalendarMapStore(storage);
    await mapStore2.loadFromStorage();

    expect(mapStore2.entries()).toHaveLength(3);
    expect(mapStore2.get('a1')?.nativeEventId).toBe('ne1');
    expect(mapStore2.get('a2')?.privacyLevelAtWrite).toBe('descriptive');
    expect(mapStore2.get('a3')?.syncedContentHash).toBe('h:3');
  });
});
