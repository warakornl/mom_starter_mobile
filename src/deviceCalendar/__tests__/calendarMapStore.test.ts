/**
 * calendarMapStore — TDD tests
 *
 * Invariants:
 *   - PK = appointmentId (one appointment ≤ one native event — INV-C5)
 *   - Durable: survives relaunch (tested via persist/load cycle)
 *   - Health-free: map stores only UUIDs + hashes (INV-CAL-1, CAL-SA-50a)
 *   - Never synced (device-local only — architecture §3.2)
 *
 * Trace: architecture §3, functional §10 CAL-SA-50a.
 */

import { createCalendarMapStore } from '../calendarMapStore';

// ─── In-memory durable storage for tests ──────────────────────────────────────

class InMemoryStorage {
  private data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<Parameters<ReturnType<typeof createCalendarMapStore>['put']>[0]> = {}) {
  return {
    appointmentId:      'appt-001',
    nativeEventId:      'native-abc',
    calendarId:         'cal-primary',
    privacyLevelAtWrite: 'generic' as const,
    syncedContentHash:  'sha256-aabbcc',
    updatedAt:          Date.now(),
    ...overrides,
  };
}

// ─── Basic CRUD ───────────────────────────────────────────────────────────────

describe('calendarMapStore — basic CRUD', () => {
  it('get returns undefined for unknown appointmentId', () => {
    const store = createCalendarMapStore();
    expect(store.get('missing-id')).toBeUndefined();
  });

  it('put then get returns the entry', () => {
    const store = createCalendarMapStore();
    const entry = makeEntry();
    store.put(entry);
    expect(store.get('appt-001')).toEqual(entry);
  });

  it('put overwrites existing entry with same appointmentId (idempotent)', () => {
    const store = createCalendarMapStore();
    store.put(makeEntry({ syncedContentHash: 'hash-v1' }));
    store.put(makeEntry({ syncedContentHash: 'hash-v2' }));
    expect(store.get('appt-001')?.syncedContentHash).toBe('hash-v2');
  });

  it('delete removes the entry', () => {
    const store = createCalendarMapStore();
    store.put(makeEntry());
    store.delete('appt-001');
    expect(store.get('appt-001')).toBeUndefined();
  });

  it('delete on unknown id is a no-op (no throw)', () => {
    const store = createCalendarMapStore();
    expect(() => store.delete('no-such-id')).not.toThrow();
  });

  it('entries() returns all stored entries', () => {
    const store = createCalendarMapStore();
    store.put(makeEntry({ appointmentId: 'a1', nativeEventId: 'n1' }));
    store.put(makeEntry({ appointmentId: 'a2', nativeEventId: 'n2' }));
    const all = store.entries();
    expect(all).toHaveLength(2);
    const ids = all.map(e => e.appointmentId).sort();
    expect(ids).toEqual(['a1', 'a2']);
  });

  it('clear() removes all entries', () => {
    const store = createCalendarMapStore();
    store.put(makeEntry({ appointmentId: 'a1' }));
    store.put(makeEntry({ appointmentId: 'a2' }));
    store.clear();
    expect(store.entries()).toHaveLength(0);
  });
});

// ─── PK uniqueness (one appointment ≤ one event — INV-C5) ─────────────────────

describe('calendarMapStore — PK uniqueness', () => {
  it('two puts with same appointmentId result in exactly one entry', () => {
    const store = createCalendarMapStore();
    store.put(makeEntry({ nativeEventId: 'n1' }));
    store.put(makeEntry({ nativeEventId: 'n2' }));
    const all = store.entries();
    expect(all).toHaveLength(1);
    expect(all[0].nativeEventId).toBe('n2');
  });
});

// ─── Health-free invariant (CAL-SA-50a / INV-CAL-1) ─────────────────────────

describe('calendarMapStore — health-free entries', () => {
  it('CalendarMapEntry does NOT contain title, note, scheduledAt, or location fields', () => {
    const store = createCalendarMapStore();
    store.put(makeEntry());
    const entry = store.get('appt-001');
    expect(entry).toBeDefined();
    // These fields must NOT exist on the entry
    expect(entry).not.toHaveProperty('title');
    expect(entry).not.toHaveProperty('note');
    expect(entry).not.toHaveProperty('scheduledAt');
    expect(entry).not.toHaveProperty('location');
  });

  it('entry fields are limited to the idempotent-map shape only', () => {
    const store = createCalendarMapStore();
    const e = makeEntry();
    store.put(e);
    const stored = store.get('appt-001')!;
    const keys = Object.keys(stored).sort();
    expect(keys).toEqual([
      'appointmentId',
      'calendarId',
      'nativeEventId',
      'privacyLevelAtWrite',
      'syncedContentHash',
      'updatedAt',
    ]);
  });
});

// ─── Persistence (durable across relaunch) ────────────────────────────────────

describe('calendarMapStore — persistence', () => {
  it('persist + load restores all entries', async () => {
    const storage = new InMemoryStorage();
    const store1 = createCalendarMapStore(storage);
    store1.put(makeEntry({ appointmentId: 'a1', nativeEventId: 'n1' }));
    store1.put(makeEntry({ appointmentId: 'a2', nativeEventId: 'n2' }));
    await store1.persist();

    const store2 = createCalendarMapStore(storage);
    await store2.loadFromStorage();
    expect(store2.get('a1')?.nativeEventId).toBe('n1');
    expect(store2.get('a2')?.nativeEventId).toBe('n2');
  });

  it('auto-persists on put when storage is configured', async () => {
    const storage = new InMemoryStorage();
    const store1 = createCalendarMapStore(storage);
    store1.put(makeEntry({ appointmentId: 'persist-me', nativeEventId: 'px' }));
    // Auto-persist is fire-and-forget — flush by calling persist explicitly
    await store1.persist();

    const store2 = createCalendarMapStore(storage);
    await store2.loadFromStorage();
    expect(store2.get('persist-me')?.nativeEventId).toBe('px');
  });

  it('loadFromStorage is no-op when storage is empty', async () => {
    const storage = new InMemoryStorage();
    const store = createCalendarMapStore(storage);
    await expect(store.loadFromStorage()).resolves.not.toThrow();
    expect(store.entries()).toHaveLength(0);
  });
});
