/**
 * suggestionStore.test.ts — TDD for dismiss/snooze persistence store.
 *
 * Mirrors the consentStore test pattern: factory + injected in-memory storage.
 */

import { createSuggestionStore } from './suggestionStore';
import type { SuggestionKey } from './types';

// ─── in-memory storage stub ───────────────────────────────────────────────────

function makeMemStorage() {
  let stored: string | null = null;
  return {
    save: async (json: string) => { stored = json; },
    load: async () => stored,
    _stored: () => stored,
  };
}

// ─── dismiss ─────────────────────────────────────────────────────────────────

describe('suggestionStore.dismiss', () => {
  it('marks a suggestion as dismissed', () => {
    const store = createSuggestionStore();
    store.dismiss('kick_count_start');
    const state = store.getState();
    expect(state['kick_count_start']?.status).toBe('dismissed');
  });

  it('sets updatedAt to current time (approx)', () => {
    const before = Date.now();
    const store = createSuggestionStore();
    store.dismiss('anc_t1_checkup');
    const after = Date.now();
    const updatedAt = new Date(store.getState()['anc_t1_checkup']!.updatedAt).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
  });

  it('persists to storage on dismiss', async () => {
    const storage = makeMemStorage();
    const store = createSuggestionStore(storage);
    store.dismiss('kick_count_start');
    await Promise.resolve(); // allow micro-task queue to flush
    const stored = storage._stored();
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed['kick_count_start']?.status).toBe('dismissed');
  });
});

// ─── snooze ──────────────────────────────────────────────────────────────────

describe('suggestionStore.snooze', () => {
  it('marks a suggestion as snoozed with resurfacesAt', () => {
    const store = createSuggestionStore();
    const before = Date.now();
    store.snooze('kick_count_start', 7);
    const state = store.getState();
    const entry = state['kick_count_start'];
    expect(entry?.status).toBe('snoozed');
    expect(entry?.resurfacesAt).toBeDefined();
    const resurfacesAt = new Date(entry!.resurfacesAt!).getTime();
    // Should be approximately now + 7 days
    const expected = before + 7 * 24 * 60 * 60 * 1000;
    expect(resurfacesAt).toBeGreaterThanOrEqual(expected - 1000);
    expect(resurfacesAt).toBeLessThanOrEqual(expected + 1000);
  });

  it('uses the provided snooze duration (days)', () => {
    const store = createSuggestionStore();
    const before = Date.now();
    store.snooze('supplies_checklist', 3);
    const entry = store.getState()['supplies_checklist'];
    const resurfacesAt = new Date(entry!.resurfacesAt!).getTime();
    const expected = before + 3 * 24 * 60 * 60 * 1000;
    expect(resurfacesAt).toBeGreaterThanOrEqual(expected - 1000);
  });

  it('persists to storage on snooze', async () => {
    const storage = makeMemStorage();
    const store = createSuggestionStore(storage);
    store.snooze('kick_count_start', 7);
    await Promise.resolve();
    const stored = storage._stored();
    const parsed = JSON.parse(stored!);
    expect(parsed['kick_count_start']?.status).toBe('snoozed');
    expect(parsed['kick_count_start']?.resurfacesAt).toBeDefined();
  });
});

// ─── start ────────────────────────────────────────────────────────────────────

describe('suggestionStore.start', () => {
  it('marks a suggestion as started', () => {
    const store = createSuggestionStore();
    store.start('triferdine_daily');
    expect(store.getState()['triferdine_daily']?.status).toBe('started');
  });

  it('persists to storage on start', async () => {
    const storage = makeMemStorage();
    const store = createSuggestionStore(storage);
    store.start('triferdine_daily');
    await Promise.resolve();
    const parsed = JSON.parse(storage._stored()!);
    expect(parsed['triferdine_daily']?.status).toBe('started');
  });

  // Surface 1: ANC cadence re-arm — start(key, resurfacesAt)
  it('stores resurfacesAt when provided (ANC round-quiet)', () => {
    const store = createSuggestionStore();
    const resurfacesAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    store.start('anc_t3_checkup', resurfacesAt);
    const state = store.getState()['anc_t3_checkup'];
    expect(state?.status).toBe('started');
    expect(state?.resurfacesAt).toBe(resurfacesAt);
  });

  it('stores no resurfacesAt when not provided (non-cadence keys — unchanged)', () => {
    const store = createSuggestionStore();
    store.start('triferdine_daily');
    const state = store.getState()['triferdine_daily'];
    expect(state?.status).toBe('started');
    expect(state?.resurfacesAt).toBeUndefined();
  });

  it('persists resurfacesAt to storage', async () => {
    const storage = makeMemStorage();
    const store = createSuggestionStore(storage);
    const resurfacesAt = '2026-08-01T00:00:00.000Z';
    store.start('anc_t3_checkup', resurfacesAt);
    await Promise.resolve();
    const parsed = JSON.parse(storage._stored()!);
    expect(parsed['anc_t3_checkup']?.resurfacesAt).toBe(resurfacesAt);
  });
});

// ─── reenable ─────────────────────────────────────────────────────────────────

describe('suggestionStore.reenable', () => {
  it('transitions dismissed → offered', () => {
    const store = createSuggestionStore();
    store.dismiss('kick_count_start');
    store.reenable('kick_count_start');
    expect(store.getState()['kick_count_start']?.status).toBe('offered');
  });

  it('clears resurfacesAt when re-enabling a snoozed entry', () => {
    const store = createSuggestionStore();
    store.snooze('kick_count_start', 7);
    store.reenable('kick_count_start');
    const entry = store.getState()['kick_count_start'];
    expect(entry?.status).toBe('offered');
    expect(entry?.resurfacesAt).toBeUndefined();
  });

  it('persists to storage on reenable', async () => {
    const storage = makeMemStorage();
    const store = createSuggestionStore(storage);
    store.dismiss('anc_t2_checkup');
    store.reenable('anc_t2_checkup');
    await Promise.resolve();
    const parsed = JSON.parse(storage._stored()!);
    expect(parsed['anc_t2_checkup']?.status).toBe('offered');
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('suggestionStore.reset', () => {
  it('clears all state', () => {
    const store = createSuggestionStore();
    store.dismiss('kick_count_start');
    store.dismiss('triferdine_daily');
    store.reset();
    expect(Object.keys(store.getState())).toHaveLength(0);
  });

  it('persists cleared state to storage', async () => {
    const storage = makeMemStorage();
    const store = createSuggestionStore(storage);
    store.dismiss('kick_count_start');
    store.reset();
    await Promise.resolve();
    const parsed = JSON.parse(storage._stored()!);
    expect(Object.keys(parsed)).toHaveLength(0);
  });
});

// ─── loadFromStorage ──────────────────────────────────────────────────────────

describe('suggestionStore.loadFromStorage', () => {
  it('restores state from durable storage', async () => {
    const storage = makeMemStorage();
    // Seed the storage
    const seeded: Record<SuggestionKey, { key: SuggestionKey; status: 'dismissed'; updatedAt: string }> = {
      kick_count_start: { key: 'kick_count_start', status: 'dismissed', updatedAt: new Date().toISOString() },
      triferdine_daily: { key: 'triferdine_daily', status: 'dismissed', updatedAt: new Date().toISOString() },
      anc_t1_checkup: { key: 'anc_t1_checkup', status: 'dismissed', updatedAt: new Date().toISOString() },
      anc_t2_checkup: { key: 'anc_t2_checkup', status: 'dismissed', updatedAt: new Date().toISOString() },
      anc_t3_checkup: { key: 'anc_t3_checkup', status: 'dismissed', updatedAt: new Date().toISOString() },
      supplies_checklist: { key: 'supplies_checklist', status: 'dismissed', updatedAt: new Date().toISOString() },
      postnatal_checkup: { key: 'postnatal_checkup', status: 'dismissed', updatedAt: new Date().toISOString() },
      baby_feeding_log: { key: 'baby_feeding_log', status: 'dismissed', updatedAt: new Date().toISOString() },
    };
    await storage.save(JSON.stringify({ kick_count_start: seeded['kick_count_start'] }));

    const store = createSuggestionStore(storage);
    await store.loadFromStorage();

    expect(store.getState()['kick_count_start']?.status).toBe('dismissed');
  });

  it('is a no-op when storage is empty', async () => {
    const storage = makeMemStorage();
    const store = createSuggestionStore(storage);
    await store.loadFromStorage(); // should not throw
    expect(Object.keys(store.getState())).toHaveLength(0);
  });

  it('silently ignores corrupt storage', async () => {
    const storage = makeMemStorage();
    await storage.save('not-valid-json{{{');
    const store = createSuggestionStore(storage);
    await expect(store.loadFromStorage()).resolves.not.toThrow();
    expect(Object.keys(store.getState())).toHaveLength(0);
  });

  it('does not overwrite newer in-memory state with older storage state', async () => {
    const storage = makeMemStorage();
    const oldDate = new Date(Date.now() - 10000).toISOString();
    await storage.save(JSON.stringify({
      kick_count_start: { key: 'kick_count_start', status: 'dismissed', updatedAt: oldDate },
    }));

    const store = createSuggestionStore(storage);
    // Set a newer in-memory state first
    store.dismiss('kick_count_start'); // updatedAt = now (newer than storage)
    // Load should not clobber the in-memory state
    await store.loadFromStorage();
    // Still dismissed (the in-memory state was newer)
    expect(store.getState()['kick_count_start']?.status).toBe('dismissed');
  });
});

// ─── cold-start scenario ──────────────────────────────────────────────────────

describe('suggestionStore — cold-start: dismissed state survives loadFromStorage', () => {
  it('dismissed keys loaded from storage are still returned by getDismissedKeys', async () => {
    const storage = makeMemStorage();
    // Simulate a previous session that dismissed two suggestions
    const prevStore = createSuggestionStore(storage);
    prevStore.dismiss('kick_count_start');
    prevStore.dismiss('triferdine_daily');
    await Promise.resolve(); // flush save micro-task

    // Cold start: a brand-new store instance loads from the same durable storage
    const freshStore = createSuggestionStore(storage);
    await freshStore.loadFromStorage();

    const dismissed = freshStore.getDismissedKeys();
    expect(dismissed).toContain('kick_count_start');
    expect(dismissed).toContain('triferdine_daily');
  });

  it('dismissed state after cold-start prevents suggestions from being offerable', async () => {
    // This test ties the store cold-start restore to the engine contract:
    // a dismissed suggestion must NOT appear in getOfferable after a restart.
    const { getOfferable } = await import('./suggestionEngine');
    const storage = makeMemStorage();

    // Session 1: dismiss kick_count_start
    const sessionOneStore = createSuggestionStore(storage);
    sessionOneStore.dismiss('kick_count_start');
    await Promise.resolve();

    // Session 2: cold start — load from storage and verify engine hides the dismissed key
    const sessionTwoStore = createSuggestionStore(storage);
    await sessionTwoStore.loadFromStorage();

    const offerable = getOfferable(
      { lifecycle: 'pregnant', stage: 'T3', gestationalWeek: 34, now: new Date() },
      sessionTwoStore.getState(),
    );
    expect(offerable.map((s) => s.key)).not.toContain('kick_count_start');
  });
});

// ─── getDismissedKeys ─────────────────────────────────────────────────────────

describe('suggestionStore.getDismissedKeys', () => {
  it('returns keys whose status is dismissed', () => {
    const store = createSuggestionStore();
    store.dismiss('kick_count_start');
    store.dismiss('triferdine_daily');
    store.snooze('anc_t1_checkup', 7); // not dismissed
    const dismissed = store.getDismissedKeys();
    expect(dismissed).toContain('kick_count_start');
    expect(dismissed).toContain('triferdine_daily');
    expect(dismissed).not.toContain('anc_t1_checkup');
  });

  it('returns empty array when nothing is dismissed', () => {
    const store = createSuggestionStore();
    expect(store.getDismissedKeys()).toEqual([]);
  });
});
