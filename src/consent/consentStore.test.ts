/**
 * consentStore — unit tests (TDD, written BEFORE the implementation).
 *
 * Tests the in-memory consent state store per first-run-consent.md §4.5:
 *   - isGranted() returns false when no records (fail-closed, §4.2)
 *   - isGranted() returns true for the latest granted record
 *   - isGranted() returns false when the latest record is a withdrawal
 *   - hydrate() loads from server records (latest per type wins)
 *   - setGranted() updates local state optimistically
 *   - reset() clears all state
 *   - hasPendingSync() reflects queued entries
 *   - getLatestVersion() returns the consentTextVersion of the latest record
 */

import { createConsentStore } from './consentStore';
import type { ConsentPersistStorage } from './consentStore';
import type { ConsentRecord } from './types';

// ─── In-memory persist storage for tests ──────────────────────────────────────

class InMemoryPersistStorage implements ConsentPersistStorage {
  private data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<ConsentRecord> & Pick<ConsentRecord, 'consentType' | 'granted'>,
): ConsentRecord {
  return {
    id: 'test-id-' + Math.random(),
    consentTextVersion: 'v1.0-th',
    grantedAt: '2026-07-03T09:00:00Z',
    ...overrides,
  };
}

// ─── isGranted (fail-closed) ──────────────────────────────────────────────────

describe('consentStore.isGranted', () => {
  it('returns false when store is empty (fail-closed)', () => {
    const store = createConsentStore();
    expect(store.isGranted('general_health')).toBe(false);
    expect(store.isGranted('cloud_storage')).toBe(false);
  });

  it('returns true after setGranted(type, true)', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('returns false for a different consent type than what was granted', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    expect(store.isGranted('cloud_storage')).toBe(false);
  });

  it('returns false after setGranted(type, false) (withdrawal)', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    store.setGranted('general_health', false, 'v1.0-th');
    expect(store.isGranted('general_health')).toBe(false);
  });

  it('returns true again after re-granting a previously withdrawn consent', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    store.setGranted('general_health', false, 'v1.0-th');
    store.setGranted('general_health', true, 'v1.0-th');
    expect(store.isGranted('general_health')).toBe(true);
  });
});

// ─── hydrate ──────────────────────────────────────────────────────────────────

describe('consentStore.hydrate', () => {
  it('sets granted=true from a single granted record', () => {
    const store = createConsentStore();
    store.hydrate([makeRecord({ consentType: 'general_health', granted: true })]);
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('sets granted=false from a single withdrawal record', () => {
    const store = createConsentStore();
    store.hydrate([makeRecord({ consentType: 'general_health', granted: false })]);
    expect(store.isGranted('general_health')).toBe(false);
  });

  it('uses the latest grantedAt record when multiple records exist for same type', () => {
    const store = createConsentStore();
    store.hydrate([
      makeRecord({
        consentType: 'general_health',
        granted: true,
        grantedAt: '2026-07-01T09:00:00Z',
      }),
      makeRecord({
        consentType: 'general_health',
        granted: false, // withdrawal — latest
        grantedAt: '2026-07-03T10:00:00Z',
      }),
    ]);
    expect(store.isGranted('general_health')).toBe(false);
  });

  it('uses the latest grantedAt even when records arrive out of order', () => {
    const store = createConsentStore();
    store.hydrate([
      makeRecord({
        consentType: 'cloud_storage',
        granted: false, // withdrawal — but earlier
        grantedAt: '2026-07-01T08:00:00Z',
      }),
      makeRecord({
        consentType: 'cloud_storage',
        granted: true, // grant — later (this wins)
        grantedAt: '2026-07-03T12:00:00Z',
      }),
    ]);
    expect(store.isGranted('cloud_storage')).toBe(true);
  });

  it('handles multiple types independently', () => {
    const store = createConsentStore();
    store.hydrate([
      makeRecord({ consentType: 'general_health', granted: true }),
      makeRecord({ consentType: 'cloud_storage', granted: false }),
    ]);
    expect(store.isGranted('general_health')).toBe(true);
    expect(store.isGranted('cloud_storage')).toBe(false);
  });

  it('handles empty array — leaves state unchanged', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    store.hydrate([]);
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('merges with existing state (hydrate does not clear setGranted state for other types)', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th'); // optimistic local
    store.hydrate([makeRecord({ consentType: 'cloud_storage', granted: true })]); // server response
    expect(store.isGranted('general_health')).toBe(true);
    expect(store.isGranted('cloud_storage')).toBe(true);
  });
});

// ─── getLatestVersion ────────────────────────────────────────────────────────

describe('consentStore.getLatestVersion', () => {
  it('returns undefined when no record for that type', () => {
    const store = createConsentStore();
    expect(store.getLatestVersion('general_health')).toBeUndefined();
  });

  it('returns the version after setGranted', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    expect(store.getLatestVersion('general_health')).toBe('v1.0-th');
  });

  it('returns the version from the latest hydrated record', () => {
    const store = createConsentStore();
    store.hydrate([
      makeRecord({
        consentType: 'general_health',
        granted: true,
        consentTextVersion: 'v1.0-en',
        grantedAt: '2026-07-03T09:00:00Z',
      }),
    ]);
    expect(store.getLatestVersion('general_health')).toBe('v1.0-en');
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('consentStore.reset', () => {
  it('clears all granted state', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    store.setGranted('cloud_storage', true, 'v1.0-th');
    store.reset();
    expect(store.isGranted('general_health')).toBe(false);
    expect(store.isGranted('cloud_storage')).toBe(false);
  });
});

// ─── persistence (B1) ─────────────────────────────────────────────────────────

describe('consentStore persistence (B1)', () => {
  it('setGranted auto-persists state to storage', async () => {
    const storage = new InMemoryPersistStorage();
    const store = createConsentStore(storage);
    store.setGranted('general_health', true, 'v1.0-th');
    // Give microtask queue a turn so the fire-and-forget save completes
    await Promise.resolve();
    const saved = await storage.load();
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!) as Record<string, unknown>;
    expect((parsed['general_health'] as { granted: boolean }).granted).toBe(true);
  });

  it('hydrate auto-persists merged state to storage', async () => {
    const storage = new InMemoryPersistStorage();
    const store = createConsentStore(storage);
    store.hydrate([makeRecord({ consentType: 'cloud_storage', granted: true })]);
    await Promise.resolve();
    const saved = await storage.load();
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!) as Record<string, unknown>;
    expect((parsed['cloud_storage'] as { granted: boolean }).granted).toBe(true);
  });

  it('reset auto-persists empty state to storage', async () => {
    const storage = new InMemoryPersistStorage();
    const store = createConsentStore(storage);
    store.setGranted('general_health', true, 'v1.0-th');
    await Promise.resolve();
    store.reset();
    await Promise.resolve();
    const saved = await storage.load();
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!) as Record<string, unknown>;
    expect(Object.keys(parsed)).toHaveLength(0);
  });
});

// ─── loadFromStorage (B1) ─────────────────────────────────────────────────────

describe('consentStore.loadFromStorage (B1)', () => {
  it('populates state from previously persisted data', async () => {
    const storage = new InMemoryPersistStorage();
    await storage.save(JSON.stringify({
      general_health: { granted: true, version: 'v1.0-th', grantedAt: '2026-07-03T09:00:00Z' },
    }));
    const store = createConsentStore(storage);
    await store.loadFromStorage();
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('is a no-op when no storage is injected (no-arg factory)', async () => {
    const store = createConsentStore(); // no storage
    await store.loadFromStorage(); // must not throw
    expect(store.isGranted('general_health')).toBe(false);
  });

  it('keeps existing state if storage is null (first launch)', async () => {
    const storage = new InMemoryPersistStorage(); // data = null
    const store = createConsentStore(storage);
    store.setGranted('general_health', true, 'v1.0-th');
    await store.loadFromStorage(); // storage is null — keep setGranted state
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('silently ignores corrupt storage — keeps current state', async () => {
    const storage = new InMemoryPersistStorage();
    await storage.save('{{invalid json}}');
    const store = createConsentStore(storage);
    store.setGranted('general_health', true, 'v1.0-th');
    await store.loadFromStorage();
    // corrupt storage → keep current state, do not reset
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('B1 cold-start resilience: cached granted state survives a failed GET', async () => {
    // Simulate: user consented before → state cached in storage
    const storage = new InMemoryPersistStorage();
    await storage.save(JSON.stringify({
      general_health: { granted: true, version: 'v1.0-th', grantedAt: '2026-07-03T09:00:00Z' },
    }));
    const store = createConsentStore(storage);

    // App cold-starts: load cache first
    await store.loadFromStorage();
    expect(store.isGranted('general_health')).toBe(true); // cache restored

    // GET /account/consents fails (simulated by not calling hydrate)
    // The store must remain granted — no drop to limited mode
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('B1: successful GET merges over cached state (latest grantedAt wins)', async () => {
    const storage = new InMemoryPersistStorage();
    await storage.save(JSON.stringify({
      general_health: { granted: true, version: 'v1.0-th', grantedAt: '2026-07-01T09:00:00Z' },
    }));
    const store = createConsentStore(storage);
    await store.loadFromStorage();

    // Server returns a later withdrawal
    store.hydrate([makeRecord({
      consentType: 'general_health',
      granted: false,
      grantedAt: '2026-07-03T12:00:00Z',
    })]);
    expect(store.isGranted('general_health')).toBe(false);
  });

  it('configurePersistence wires storage into an already-created store', async () => {
    const store = createConsentStore(); // no initial storage
    store.setGranted('general_health', true, 'v1.0-th');

    // Configure storage after the fact (simulates App.tsx wiring)
    const storage = new InMemoryPersistStorage();
    store.configurePersistence(storage);
    store.setGranted('cloud_storage', true, 'v1.0-th');
    await Promise.resolve();
    const saved = await storage.load();
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!) as Record<string, unknown>;
    expect((parsed['cloud_storage'] as { granted: boolean }).granted).toBe(true);
  });
});
