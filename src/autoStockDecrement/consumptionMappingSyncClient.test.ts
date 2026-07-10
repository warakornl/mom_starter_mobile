/**
 * consumptionMappingSyncClient.test.ts — TDD RED → GREEN for the
 * ConsumptionMapping sync client (push + pull against the shared
 * /v1/sync/push + /v1/sync/pull endpoints).
 *
 * Pattern follows existing syncClient.test.ts (same wire contract).
 *
 * Contract invariants under test:
 *   §2   applied[]  → stampApplied(id, version, updatedAt) per record.
 *   §4   conflicts[] → adoptServerRecord(serverRecord) for all resolutions.
 *   §9   Pull: watermark adopted ONLY on last page; since fixed across pages.
 *   INV-ASD-8: pull NEVER touches usesRemainingInOpenContainer (mobile-local).
 *   INV-ASD-9: consumptionMappings pushed in health-side changeset (never under
 *              supplyItems).
 *   D-4 backstop: disabled mappings are NOT filtered client-side during sync —
 *              the server receives them; client just calls upsert on pull.
 *
 * Security: all tokens/UUIDs are synthetic test fixtures. No real health data.
 */

import {
  createConsumptionMappingSyncClient,
} from '../sync/syncClient';
import {
  createConsumptionMappingStore,
  type ConsumptionMappingStore,
} from './consumptionMappingStore';
import type { FetchFn } from '../auth/authApiClient';
import type { ConsumptionMappingRecord } from '../sync/syncTypes';

// ─── Test helpers ──────────────────────────────────────────────────────────────

function spyFetch(responses: Array<{ status: number; body?: unknown }>): {
  fn: FetchFn;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let idx = 0;
  const fn: FetchFn = (url, init) => {
    calls.push({ url, init });
    const resp = responses[idx++] ?? { status: 200, body: {} };
    return Promise.resolve({
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: `HTTP ${resp.status}`,
      json: () => Promise.resolve(resp.body ?? {}),
    } as unknown as Response);
  };
  return { fn, calls };
}

const BASE      = 'http://localhost:8080';
const TOKEN     = 'bearer.test.token';
const WATERMARK = '2026-07-10T10:00:00Z';
const MAP_ID    = 'mmap-0000-0000-4000-8000-000000000001';
const MAP_ID_2  = 'mmap-0000-0000-4000-8000-000000000002';

function makeMapping(overrides: Partial<ConsumptionMappingRecord> = {}): ConsumptionMappingRecord {
  return {
    id: MAP_ID,
    activityType: 'feeding_formula',
    supplyItemId: 'item-001',
    defaultQty: 2,
    enabled: true,
    version: 1,
    createdAt: '2026-07-10T00:00:00Z',
    updatedAt: '2026-07-10T00:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

function makePushOk(overrides: {
  applied?: unknown[];
  conflicts?: unknown[];
  rejected?: unknown[];
} = {}): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      applied: overrides.applied ?? [],
      conflicts: overrides.conflicts ?? [],
      rejected: overrides.rejected ?? [],
    },
  };
}

function makePullPage(
  mappings: { created?: ConsumptionMappingRecord[]; updated?: ConsumptionMappingRecord[]; deleted?: string[] },
  opts: { nextCursor?: string; timestamp?: string } = {},
): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      timestamp: opts.timestamp ?? WATERMARK,
      nextCursor: opts.nextCursor,
      changes: {
        consumptionMappings: {
          created: mappings.created ?? [],
          updated: mappings.updated ?? [],
          deleted: mappings.deleted ?? [],
        },
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConsumptionMapping sync client — push', () => {
  let store: ConsumptionMappingStore;

  beforeEach(() => {
    store = createConsumptionMappingStore();
  });

  // ── Wire shape ──

  it('push sends POST to /v1/sync/push with Authorization header', async () => {
    const { fn, calls } = spyFetch([makePushOk()]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const m = makeMapping({ id: MAP_ID, version: 0 });
    store.enqueueCreate(m);
    const cs = store.drainQueue();
    await client.push(cs, WATERMARK, TOKEN);
    expect(calls[0]!.url).toBe(`${BASE}/v1/sync/push`);
    expect((calls[0]!.init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('push sends consumptionMappings in changes body (NOT supplyItems)', async () => {
    const { fn, calls } = spyFetch([makePushOk()]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const m = makeMapping({ id: MAP_ID, version: 0 });
    store.enqueueCreate(m);
    const cs = store.drainQueue();
    await client.push(cs, WATERMARK, TOKEN);
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body.changes.consumptionMappings).toBeDefined();
    expect(body.changes.supplyItems).toBeUndefined(); // INV-ASD-9: separate from supply
  });

  it('push sends Idempotency-Key header when provided', async () => {
    const { fn, calls } = spyFetch([makePushOk()]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    await client.push({}, WATERMARK, TOKEN, 'ikey-001');
    expect((calls[0]!.init?.headers as Record<string, string>)['Idempotency-Key']).toBe('ikey-001');
  });

  // ── Contract §2: applied[] → stampApplied ──

  it('§2 applied[]: stamps version+updatedAt on local record', async () => {
    const m = makeMapping({ id: MAP_ID, version: 0 });
    store.enqueueCreate(m);
    const cs = store.drainQueue();

    const serverVersion = 5;
    const serverUpdatedAt = '2026-07-10T10:00:00Z';
    const { fn } = spyFetch([makePushOk({
      applied: [{ id: MAP_ID, collection: 'consumptionMappings', version: serverVersion, updatedAt: serverUpdatedAt }],
    })]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    await client.push(cs, WATERMARK, TOKEN);

    const record = store.getById(MAP_ID)!;
    expect(record.version).toBe(serverVersion);
    expect(record.updatedAt).toBe(serverUpdatedAt);
  });

  // ── Contract §4: conflicts[] → adoptServerRecord ──

  it('§4 conflicts[]: adoptServerRecord called for server_won resolution', async () => {
    const m = makeMapping({ id: MAP_ID, version: 1 });
    store.upsert(m);
    const cs = store.drainQueue();

    const serverRecord: ConsumptionMappingRecord = {
      ...m,
      defaultQty: 99, // server wins with different value
      version: 10,
      updatedAt: '2026-07-10T11:00:00Z',
    };
    const { fn } = spyFetch([makePushOk({
      conflicts: [{
        collection: 'consumptionMappings',
        resolution: 'server_won',
        serverRecord,
      }],
    })]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    await client.push(cs, WATERMARK, TOKEN);

    // After adoptServerRecord the local record should match server
    const local = store.getById(MAP_ID)!;
    expect(local.defaultQty).toBe(99);
    expect(local.version).toBe(10);
  });

  // ── rejected[] → surfaced to caller ──

  it('rejected[] returned to caller without dropping', async () => {
    const rejected = [{ id: MAP_ID, collection: 'consumptionMappings', reason: 'invalid_data' }];
    const { fn } = spyFetch([makePushOk({ rejected })]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const result = await client.push({}, WATERMARK, TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rejected).toHaveLength(1);
    }
  });

  // ── Network error ──

  it('returns network_error result when fetch throws', async () => {
    const fn: FetchFn = () => Promise.reject(new Error('Network failure'));
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const result = await client.push({}, WATERMARK, TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network_error');
    }
  });

  // ── INV-ASD-8: usesRemainingInOpenContainer never in push payload ──

  it('INV-ASD-8: push payload NEVER contains usesRemainingInOpenContainer', async () => {
    const { fn, calls } = spyFetch([makePushOk()]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const m = makeMapping({ id: MAP_ID, version: 0 });
    store.enqueueCreate(m);
    const cs = store.drainQueue();
    await client.push(cs, WATERMARK, TOKEN);

    const bodyText = calls[0]!.init?.body as string;
    expect(bodyText).not.toContain('usesRemainingInOpenContainer');
    expect(bodyText).not.toContain('usesRemaining');
  });
});

describe('ConsumptionMapping sync client — pull', () => {
  let store: ConsumptionMappingStore;

  beforeEach(() => {
    store = createConsumptionMappingStore();
  });

  // ── Single page pull: created / updated / deleted ──

  it('pull upserts created[] and updated[] records', async () => {
    const m1 = makeMapping({ id: MAP_ID });
    const m2 = makeMapping({ id: MAP_ID_2, activityType: 'diaper_change' });
    const { fn } = spyFetch([makePullPage({ created: [m1], updated: [m2] })]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    await client.pull(TOKEN);

    expect(store.getById(MAP_ID)).toBeDefined();
    expect(store.getById(MAP_ID_2)).toBeDefined();
  });

  it('pull tombstones deleted[] records', async () => {
    store.upsert(makeMapping({ id: MAP_ID }));
    const { fn } = spyFetch([makePullPage({ deleted: [MAP_ID] })]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    await client.pull(TOKEN);

    expect(store.getAll()).toHaveLength(0); // tombstoned → not in getAll()
    expect(store.getById(MAP_ID)?.deletedAt).toBeTruthy();
  });

  // ── §9: watermark adopted ONLY on last page ──

  it('§9: watermark adopted ONLY on the last cursor page', async () => {
    const m1 = makeMapping({ id: MAP_ID });
    const m2 = makeMapping({ id: MAP_ID_2 });
    const { fn } = spyFetch([
      makePullPage({ created: [m1] }, { nextCursor: 'cursor-abc', timestamp: 'IGNORED_WATERMARK' }),
      makePullPage({ created: [m2] }, { timestamp: WATERMARK }),
    ]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const result = await client.pull(TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.watermark).toBe(WATERMARK); // last page only
    }
    // All records from both pages were applied
    expect(store.getById(MAP_ID)).toBeDefined();
    expect(store.getById(MAP_ID_2)).toBeDefined();
  });

  it('§9: since parameter is fixed across all cursor pages', async () => {
    const { fn, calls } = spyFetch([
      makePullPage({ created: [] }, { nextCursor: 'cursor-abc', timestamp: 'T1' }),
      makePullPage({ created: [] }, { timestamp: WATERMARK }),
    ]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const sinceVal = '2026-07-01T00:00:00Z';
    await client.pull(TOKEN, sinceVal);

    // Both pages should use the same `since`
    expect(calls[0]!.url).toContain(`since=${encodeURIComponent(sinceVal)}`);
    expect(calls[1]!.url).toContain(`since=${encodeURIComponent(sinceVal)}`);
  });

  // ── INV-ASD-8: pull NEVER sets usesRemainingInOpenContainer ──

  it('INV-ASD-8: pull does NOT set usesRemainingInOpenContainer on pulled records', async () => {
    // Server sends a record that somehow includes the field (forward-compat / rogue server).
    // The ingress sanitizer in consumptionMappingStore.upsert() must strip it.
    const badRecord = {
      ...makeMapping({ id: MAP_ID }),
      usesRemainingInOpenContainer: 999, // must be silently stripped (INV-ASD-8)
    };
    const { fn } = spyFetch([makePullPage({ created: [badRecord as ConsumptionMappingRecord] })]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    await client.pull(TOKEN);

    // The field MUST NOT be present on the stored record — asserted as absent, not just defined.
    const stored = store.getById(MAP_ID) as unknown as Record<string, unknown>;
    expect(stored).toBeDefined(); // record was stored
    // Primary assertion: usesRemainingInOpenContainer must be absent (INV-ASD-8).
    expect(Object.prototype.hasOwnProperty.call(stored, 'usesRemainingInOpenContainer')).toBe(false);
    expect(stored['usesRemainingInOpenContainer']).toBeUndefined();
  });

  // ── HTTP error handling ──

  it('returns error result on 401 pull', async () => {
    const { fn } = spyFetch([{ status: 401, body: { code: 'unauthorized', message: 'Unauthorized' } }]);
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const result = await client.pull(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('returns network_error on fetch rejection during pull', async () => {
    const fn: FetchFn = () => Promise.reject(new Error('offline'));
    const client = createConsumptionMappingSyncClient(BASE, store, fn);
    const result = await client.pull(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network_error');
    }
  });
});
