/**
 * pushOrchestrator — unit tests (TDD, written BEFORE implementation).
 *
 * Covers the three orchestration gaps identified by mobile-reviewer:
 *
 *  🔴-1  push fail → queue must be preserved (no silent mutation loss)
 *  🔴-2  rejected[] records must stay retriable in the queue (contract §3)
 *  🟡-1  banner state must always reflect the *current* push result (not
 *         accumulated from a prior push) — caller can unconditionally assign
 *         result.conflicts.length / result.rejected to React state.
 *
 * Each test drives against `executePush` from `./pushOrchestrator` which does
 * not exist yet; the suite fails until the implementation lands.
 */

import { executePush } from './pushOrchestrator';
import { createSyncStore } from './syncStore';
import { createSyncClient } from './syncClient';
import type { FetchFn } from '../auth/authApiClient';
import type { SupplyItemRecord } from './syncTypes';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:8080';
const TOKEN = 'test.token';
const IDEM = 'idem-key-1';

function makeItem(overrides: Partial<SupplyItemRecord> = {}): SupplyItemRecord {
  return {
    id: 'item-1',
    name: 'ผ้าอ้อม',
    category: 'diapers',
    onHandQty: 10,
    version: 1,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

function mockFetch(status: number, body?: unknown): FetchFn {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: () => Promise.resolve(body ?? {}),
    } as unknown as Response);
}

function pushOkResp(overrides: {
  applied?: unknown[];
  conflicts?: unknown[];
  rejected?: unknown[];
}) {
  return {
    timestamp: '2026-06-29T10:00:00Z',
    applied: overrides.applied ?? [],
    conflicts: overrides.conflicts ?? [],
    rejected: overrides.rejected ?? [],
  };
}

// ─── 🔴-1  push fail → mutation preserved in queue ───────────────────────────

describe('executePush — push fail → mutation stays in queue', () => {
  it('re-enqueues entire changeset on 500 server error', async () => {
    const store = createSyncStore();
    store.enqueueCreate(makeItem({ id: 'c1', version: 0 }));

    expect(store.getPendingCount()).toBe(1);

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(500, { code: 'server_error', message: 'Internal Server Error' }),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(false);
    // Mutation must survive — not silently lost
    expect(store.getPendingCount()).toBe(1);
  });

  it('re-enqueues entire changeset on 403 forbidden', async () => {
    const store = createSyncStore();
    store.enqueueUpdate(makeItem({ id: 'u1', version: 2 }));

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(403, { code: 'consent_required', message: 'Forbidden' }),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(false);
    expect(store.getPendingCount()).toBe(1);
  });

  it('re-enqueues entire changeset on 409 watermark_expired', async () => {
    const store = createSyncStore();
    store.enqueueDelete('del-1');

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(409, { code: 'watermark_expired', message: 'Expired' }),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(false);
    expect(store.getPendingCount()).toBe(1);
  });

  it('preserves a mixed create+update+delete changeset on network fail', async () => {
    const store = createSyncStore();
    store.enqueueCreate(makeItem({ id: 'new-1', version: 0 }));
    store.enqueueUpdate(makeItem({ id: 'upd-1', version: 3 }));
    store.enqueueDelete('del-1');

    expect(store.getPendingCount()).toBe(3);

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(503, { code: 'unavailable', message: 'Service Unavailable' }),
    );
    await executePush(store, client, TOKEN, IDEM);

    // All three mutations must be recoverable
    expect(store.getPendingCount()).toBe(3);
  });

  // 🔴-A (contract §3 PINNED): fetchFn reject (true offline) must re-enqueue
  it('re-enqueues entire changeset when fetchFn rejects (fetch reject — true offline)', async () => {
    const store = createSyncStore();
    store.enqueueCreate(makeItem({ id: 'offline-1', version: 0 }));

    expect(store.getPendingCount()).toBe(1);

    const client = createSyncClient(
      BASE,
      store,
      () => Promise.reject(new TypeError('Network request failed')),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    // Data must NOT be lost — contract §3 PINNED
    expect(result.ok).toBe(false);
    expect(store.getPendingCount()).toBe(1);
  });

  it('does NOT re-enqueue on success (applied items should be stamped, not re-pushed)', async () => {
    const store = createSyncStore();
    store.enqueueUpdate(makeItem({ id: 'ok-item', version: 1 }));

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(200, pushOkResp({
        applied: [{ collection: 'supplyItems', id: 'ok-item', version: 2, updatedAt: 'now' }],
      })),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(true);
    // Applied items must NOT be re-queued
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── 🔴-2  rejected[] must be retriable (stay in queue) ──────────────────────

describe('executePush — rejected[] records stay in queue', () => {
  it('re-enqueues per-record rejected create (validation_error)', async () => {
    const store = createSyncStore();
    const itemA = makeItem({ id: 'item-A', version: 0 });
    const itemB = makeItem({ id: 'item-B', version: 0 });
    store.enqueueCreate(itemA);
    store.enqueueCreate(itemB);

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(200, pushOkResp({
        applied: [{ collection: 'supplyItems', id: 'item-B', version: 1, updatedAt: 'now' }],
        rejected: [{ collection: 'supplyItems', id: 'item-A', code: 'validation_error', details: 'name too long' }],
      })),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(true);
    // item-A rejected → must remain queued for retry; item-B applied → must not re-queue
    expect(store.getPendingCount()).toBe(1);
  });

  it('re-enqueues rejected update by id', async () => {
    const store = createSyncStore();
    store.enqueueUpdate(makeItem({ id: 'upd-rej', version: 2 }));

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(200, pushOkResp({
        rejected: [{ collection: 'supplyItems', id: 'upd-rej', code: 'validation_error' }],
      })),
    );
    await executePush(store, client, TOKEN, IDEM);

    expect(store.getPendingCount()).toBe(1);
  });

  it('re-enqueues entire changeset on whole-collection rejection (no id = consent_required)', async () => {
    const store = createSyncStore();
    store.enqueueCreate(makeItem({ id: 'c-consent', version: 0 }));
    store.enqueueUpdate(makeItem({ id: 'u-consent', version: 1 }));

    const client = createSyncClient(
      BASE,
      store,
      // No `id` on rejected record → whole-collection rejection
      mockFetch(200, pushOkResp({
        rejected: [{ collection: 'supplyItems', code: 'consent_required' }],
      })),
    );
    await executePush(store, client, TOKEN, IDEM);

    // Both mutations must be re-queued
    expect(store.getPendingCount()).toBe(2);
  });

  it('does NOT re-enqueue items that were applied even when other items are rejected', async () => {
    const store = createSyncStore();
    store.enqueueCreate(makeItem({ id: 'applied-item', version: 0 }));
    store.enqueueCreate(makeItem({ id: 'rejected-item', version: 0 }));

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(200, pushOkResp({
        applied: [{ collection: 'supplyItems', id: 'applied-item', version: 1, updatedAt: 'now' }],
        rejected: [{ collection: 'supplyItems', id: 'rejected-item', code: 'validation_error' }],
      })),
    );
    await executePush(store, client, TOKEN, IDEM);

    expect(store.getPendingCount()).toBe(1); // only the rejected item
  });
});

// ─── 🟡-1  banner state: always reflects current push result ─────────────────

describe('executePush — result always reflects current push (unconditional banner reset)', () => {
  it('returns ok:false result on push fail — screen can always reset banner', async () => {
    const store = createSyncStore();
    store.enqueueUpdate(makeItem({ id: 'fail-item', version: 1 }));

    const client = createSyncClient(BASE, store, mockFetch(500, { code: 'err', message: 'err' }));
    const result = await executePush(store, client, TOKEN, IDEM);

    // ok:false → screen sets conflictCount = 0, rejectedItems = []
    expect(result.ok).toBe(false);
  });

  it('returns empty conflicts[] on success with no conflicts (resets prior conflict banner)', async () => {
    const store = createSyncStore();
    store.enqueueUpdate(makeItem({ id: 'c2', version: 3 }));

    const client = createSyncClient(
      BASE,
      store,
      mockFetch(200, pushOkResp({
        applied: [{ collection: 'supplyItems', id: 'c2', version: 4, updatedAt: 'now' }],
        conflicts: [],
        rejected: [],
      })),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Screen must set conflictCount = result.conflicts.length = 0 → banner clears
      expect(result.conflicts).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
    }
  });

  it('returns current conflicts[] (not accumulated from previous push)', async () => {
    const store = createSyncStore();
    const item = makeItem({ id: 'conflict-item', version: 1 });
    store.upsertSupplyItem(item);

    // First push: has a conflict
    store.enqueueUpdate(item);
    const firstClient = createSyncClient(
      BASE,
      store,
      mockFetch(200, pushOkResp({
        conflicts: [{ collection: 'supplyItems', id: 'conflict-item', resolution: 'server_won', serverRecord: { ...item, version: 3 } }],
      })),
    );
    const firstResult = await executePush(store, firstClient, TOKEN, IDEM);
    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) expect(firstResult.conflicts).toHaveLength(1);

    // Second push: no conflicts
    store.enqueueUpdate({ ...item, version: 3, name: 'updated name' });
    const secondClient = createSyncClient(
      BASE,
      store,
      mockFetch(200, pushOkResp({
        applied: [{ collection: 'supplyItems', id: 'conflict-item', version: 4, updatedAt: 'now' }],
        conflicts: [],
        rejected: [],
      })),
    );
    const secondResult = await executePush(store, secondClient, TOKEN, IDEM);

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      // Must NOT carry the conflict from the first push
      expect(secondResult.conflicts).toHaveLength(0);
    }
  });
});
