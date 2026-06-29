/**
 * syncClient — unit tests (TDD, written BEFORE the implementation).
 *
 * Tests cover the three apply-logic outcomes mandated by api-contract.md
 * §"Offline-sync engine (PINNED)":
 *   1. applied[]  — server-assigned version/updatedAt stamped on local row
 *   2. conflicts[] — serverRecord adopted for server_won / tombstone_won
 *   3. rejected[]  — surfaced to caller without dropping
 *
 * Also covers:
 *   - pull cursor loop: merges all pages, adopts watermark ONLY on last page
 *   - wire shape: URL, Authorization header, Idempotency-Key header, body
 *   - error responses: 403, 409 watermark_expired
 */

import { createSyncClient } from './syncClient';
import { createSyncStore } from './syncStore';
import type { FetchFn } from '../auth/authApiClient';
import type {
  SupplyItemRecord,
  AppliedRecord,
  ConflictRecord,
  RejectedRecord,
} from './syncTypes';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeResponse(status: number, body?: unknown): FetchFn {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: () => Promise.resolve(body ?? {}),
    } as unknown as Response);
}

/**
 * Multi-response spy — steps through the responses array on each call.
 */
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

const BASE = 'http://localhost:8080';
const TOKEN = 'bearer.test.token';
const WATERMARK = '2026-06-29T10:00:00Z';
const ZERO_WATERMARK = '';

function makeItem(overrides: Partial<SupplyItemRecord> = {}): SupplyItemRecord {
  return {
    id: 'item-uuid-1',
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

function makePushResponse(overrides: {
  applied?: AppliedRecord[];
  conflicts?: ConflictRecord[];
  rejected?: RejectedRecord[];
  timestamp?: string;
}) {
  return {
    timestamp: overrides.timestamp ?? WATERMARK,
    applied: overrides.applied ?? [],
    conflicts: overrides.conflicts ?? [],
    rejected: overrides.rejected ?? [],
  };
}

// ─── applied[] stamping ───────────────────────────────────────────────────────

describe('syncClient.push — applied[] stamping', () => {
  it('stamps version and updatedAt on the local store row from applied[]', async () => {
    const store = createSyncStore();
    const item = makeItem({ version: 1 });
    store.upsertSupplyItem(item);

    const serverVersion = 2;
    const serverUpdatedAt = '2026-06-29T10:00:00Z';

    const pushResp = makePushResponse({
      applied: [
        {
          collection: 'supplyItems',
          id: item.id,
          version: serverVersion,
          updatedAt: serverUpdatedAt,
        },
      ],
    });

    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    const changes = { supplyItems: { created: [], updated: [item], deleted: [] } };
    const result = await client.push(changes, ZERO_WATERMARK, TOKEN);

    expect(result.ok).toBe(true);

    const stored = store.getSupplyItem(item.id);
    expect(stored).toBeDefined();
    // Contract: client MUST stamp version from applied[] — never assume un-bumped
    expect(stored!.version).toBe(serverVersion);
    expect(stored!.updatedAt).toBe(serverUpdatedAt);
  });

  it('stamps applied[] even when push appears redundant (mutable records always bump)', async () => {
    // Contract §2: "MUST stamp its local row from applied[] for EVERY record —
    // it must NEVER assume a redundant/duplicate mutable push left version un-bumped."
    const store = createSyncStore();
    const item = makeItem({ version: 5 });
    store.upsertSupplyItem(item);

    const pushResp = makePushResponse({
      applied: [
        {
          collection: 'supplyItems',
          id: item.id,
          version: 6,
          updatedAt: '2026-06-29T11:00:00Z',
        },
      ],
    });

    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    await client.push({ supplyItems: { created: [], updated: [item], deleted: [] } }, WATERMARK, TOKEN);

    // Must update to the server-returned version
    expect(store.getSupplyItem(item.id)!.version).toBe(6);
  });

  it('stamps applied[] for a delete (tombstone applied)', async () => {
    const store = createSyncStore();
    const item = makeItem({ version: 1 });
    store.upsertSupplyItem(item);

    const pushResp = makePushResponse({
      applied: [
        {
          collection: 'supplyItems',
          id: item.id,
          version: 2,
          updatedAt: '2026-06-29T12:00:00Z',
        },
      ],
    });

    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    await client.push({ supplyItems: { created: [], updated: [], deleted: [item.id] } }, WATERMARK, TOKEN);

    expect(store.getSupplyItem(item.id)!.version).toBe(2);
    expect(store.getSupplyItem(item.id)!.updatedAt).toBe('2026-06-29T12:00:00Z');
  });
});

// ─── conflicts[] adoption ─────────────────────────────────────────────────────

describe('syncClient.push — conflict adoption', () => {
  it('adopts serverRecord when resolution is server_won', async () => {
    const store = createSyncStore();
    const localItem = makeItem({ id: 'item-2', name: 'ชื่อเก่า', version: 1 });
    store.upsertSupplyItem(localItem);

    const serverRecord = makeItem({
      id: 'item-2',
      name: 'ชื่อใหม่จากเซิร์ฟเวอร์',
      version: 3,
      updatedAt: '2026-06-29T10:30:00Z',
    });

    const pushResp = makePushResponse({
      conflicts: [
        { collection: 'supplyItems', id: 'item-2', resolution: 'server_won', serverRecord },
      ],
    });

    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    const result = await client.push(
      { supplyItems: { created: [], updated: [localItem], deleted: [] } },
      ZERO_WATERMARK,
      TOKEN,
    );

    expect(result.ok).toBe(true);

    const stored = store.getSupplyItem('item-2');
    expect(stored).toBeDefined();
    // Server record should fully replace the local one
    expect(stored!.name).toBe('ชื่อใหม่จากเซิร์ฟเวอร์');
    expect(stored!.version).toBe(3);
    expect(stored!.updatedAt).toBe('2026-06-29T10:30:00Z');
  });

  it('adopts serverRecord when resolution is client_won (learns server-assigned version)', async () => {
    // Contract: "client_won records DO appear in conflicts[] so the client always
    // learns the server-assigned values even when its write won."
    const store = createSyncStore();
    const localItem = makeItem({ id: 'item-3', name: 'ชื่อ client', version: 1 });
    store.upsertSupplyItem(localItem);

    const serverRecord = makeItem({
      id: 'item-3',
      name: 'ชื่อ client', // same content, but server-assigned version
      version: 2,
      updatedAt: '2026-06-29T10:45:00Z',
    });

    const pushResp = makePushResponse({
      conflicts: [
        { collection: 'supplyItems', id: 'item-3', resolution: 'client_won', serverRecord },
      ],
    });

    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    await client.push({ supplyItems: { created: [], updated: [localItem], deleted: [] } }, ZERO_WATERMARK, TOKEN);

    const stored = store.getSupplyItem('item-3');
    // Adopts serverRecord — gets server-assigned version
    expect(stored!.version).toBe(2);
  });

  it('adopts serverRecord when resolution is tombstone_won (item becomes tombstoned)', async () => {
    const store = createSyncStore();
    const localItem = makeItem({ id: 'item-4', version: 1 });
    store.upsertSupplyItem(localItem);

    const tombstoneRecord = makeItem({
      id: 'item-4',
      version: 4,
      deletedAt: '2026-06-29T09:00:00Z',
    });

    const pushResp = makePushResponse({
      conflicts: [
        {
          collection: 'supplyItems',
          id: 'item-4',
          resolution: 'tombstone_won',
          serverRecord: tombstoneRecord,
        },
      ],
    });

    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    await client.push({ supplyItems: { created: [], updated: [localItem], deleted: [] } }, ZERO_WATERMARK, TOKEN);

    const stored = store.getSupplyItem('item-4');
    // Tombstone adopted — item has deletedAt
    expect(stored!.deletedAt).toBeTruthy();
    expect(stored!.version).toBe(4);
    // Item should not appear in live items list
    expect(store.getSupplyItems()).toHaveLength(0);
  });

  it('returns conflicts in the push result', async () => {
    const store = createSyncStore();
    const localItem = makeItem({ id: 'item-5', version: 1 });
    store.upsertSupplyItem(localItem);

    const serverRecord = makeItem({ id: 'item-5', version: 2 });
    const pushResp = makePushResponse({
      conflicts: [{ collection: 'supplyItems', id: 'item-5', resolution: 'server_won', serverRecord }],
    });

    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    const result = await client.push(
      { supplyItems: { created: [], updated: [localItem], deleted: [] } },
      ZERO_WATERMARK,
      TOKEN,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].resolution).toBe('server_won');
    }
  });
});

// ─── rejected[] surface ───────────────────────────────────────────────────────

describe('syncClient.push — rejected[] surface', () => {
  it('returns rejected[] (whole-collection consent_required)', async () => {
    const store = createSyncStore();
    const rejected: RejectedRecord[] = [
      { collection: 'supplyItems', code: 'consent_required', details: 'cloud_storage' },
    ];

    const pushResp = makePushResponse({ rejected });
    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    const result = await client.push(
      { supplyItems: { created: [], updated: [], deleted: [] } },
      ZERO_WATERMARK,
      TOKEN,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].code).toBe('consent_required');
      expect(result.rejected[0].details).toBe('cloud_storage');
    }
  });

  it('returns rejected[] (per-record validation_error)', async () => {
    const store = createSyncStore();
    const rejected: RejectedRecord[] = [
      { collection: 'supplyItems', id: 'bad-item', code: 'validation_error', details: 'name is required' },
    ];

    const pushResp = makePushResponse({ rejected });
    const client = createSyncClient(BASE, store, makeResponse(200, pushResp));
    const result = await client.push(
      { supplyItems: { created: [], updated: [], deleted: [] } },
      ZERO_WATERMARK,
      TOKEN,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rejected[0].id).toBe('bad-item');
      expect(result.rejected[0].code).toBe('validation_error');
    }
  });

  it('returns ok:false on 403 (whole-batch consent_required)', async () => {
    const store = createSyncStore();
    const client = createSyncClient(
      BASE,
      store,
      makeResponse(403, { code: 'consent_required', message: 'cloud_storage consent required' }),
    );
    const result = await client.push(
      { supplyItems: { created: [], updated: [], deleted: [] } },
      ZERO_WATERMARK,
      TOKEN,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe('consent_required');
    }
  });

  it('returns ok:false on 409 watermark_expired', async () => {
    const store = createSyncStore();
    const client = createSyncClient(
      BASE,
      store,
      makeResponse(409, { code: 'watermark_expired', message: 'watermark too old' }),
    );
    const result = await client.push(
      { supplyItems: { created: [], updated: [], deleted: [] } },
      'ancient-watermark',
      TOKEN,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('watermark_expired');
    }
  });
});

// ─── pull: cursor loop + watermark ───────────────────────────────────────────

describe('syncClient.pull — cursor loop', () => {
  it('merges all pages into store, adopts watermark on final page', async () => {
    const store = createSyncStore();

    const item1 = makeItem({ id: 'pull-1', name: 'A', version: 1 });
    const item2 = makeItem({ id: 'pull-2', name: 'B', version: 1 });
    const item3 = makeItem({ id: 'pull-3', name: 'C', version: 1 });

    const page1 = {
      timestamp: 'W1',
      nextCursor: 'cursor-page2',
      hasMore: true,
      changes: {
        supplyItems: { created: [], updated: [item1, item2], deleted: [] },
      },
    };
    const page2 = {
      timestamp: 'W1', // same W1 per contract — identical on every batch
      hasMore: false,
      changes: {
        supplyItems: { created: [], updated: [item3], deleted: [] },
      },
    };

    const { fn, calls } = spyFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);

    const client = createSyncClient(BASE, store, fn);
    const result = await client.pull(TOKEN, 'prior-watermark');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.watermark).toBe('W1');

    // All items merged into store
    const items = store.getSupplyItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id).sort()).toEqual(['pull-1', 'pull-2', 'pull-3']);

    // Second call must have used nextCursor from first page
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('cursor=cursor-page2');
  });

  it('adopts watermark ONLY on the last page (nextCursor absent)', async () => {
    const store = createSyncStore();

    const page1 = {
      timestamp: 'W1',
      nextCursor: 'cursor2',
      hasMore: true,
      changes: { supplyItems: { created: [], updated: [], deleted: [] } },
    };
    const page2 = {
      timestamp: 'W1',
      hasMore: false,
      changes: { supplyItems: { created: [], updated: [], deleted: [] } },
    };

    const { fn } = spyFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);

    // Before pull: no watermark
    expect(store.getWatermark()).toBeUndefined();

    const client = createSyncClient(BASE, store, fn);
    await client.pull(TOKEN);

    // After pull: watermark adopted from last page
    expect(store.getWatermark()).toBe('W1');
  });

  it('keeps since fixed across cursor pages', async () => {
    const store = createSyncStore();

    const page1 = {
      timestamp: 'W1',
      nextCursor: 'cursor2',
      hasMore: true,
      changes: { supplyItems: { created: [], updated: [], deleted: [] } },
    };
    const page2 = {
      timestamp: 'W1',
      hasMore: false,
      changes: { supplyItems: { created: [], updated: [], deleted: [] } },
    };

    const { fn, calls } = spyFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);

    const client = createSyncClient(BASE, store, fn);
    await client.pull(TOKEN, 'my-watermark');

    // Both calls must carry the same `since`
    expect(calls[0].url).toContain('since=my-watermark');
    expect(calls[1].url).toContain('since=my-watermark');
    // Second call also has cursor
    expect(calls[1].url).toContain('cursor=cursor2');
  });

  it('soft-deletes (tombstones) items from pull deleted[]', async () => {
    const store = createSyncStore();
    // Pre-populate store with an item
    store.upsertSupplyItem(makeItem({ id: 'del-item-1', version: 1 }));

    const pullResp = {
      timestamp: 'W2',
      hasMore: false,
      changes: {
        supplyItems: { created: [], updated: [], deleted: ['del-item-1'] },
      },
    };

    const client = createSyncClient(BASE, store, makeResponse(200, pullResp));
    await client.pull(TOKEN, 'W1');

    // Item tombstoned — not in live items
    expect(store.getSupplyItems()).toHaveLength(0);
    // But still in store as tombstone
    const raw = store.getSupplyItem('del-item-1');
    expect(raw).toBeDefined();
    expect(raw!.deletedAt).toBeTruthy();
  });

  it('handles single-page pull (no nextCursor) correctly', async () => {
    const store = createSyncStore();
    const item = makeItem({ id: 'only-item', version: 1 });

    const pullResp = {
      timestamp: 'W-single',
      hasMore: false,
      changes: { supplyItems: { created: [], updated: [item], deleted: [] } },
    };

    const { fn, calls } = spyFetch([{ status: 200, body: pullResp }]);
    const client = createSyncClient(BASE, store, fn);
    const result = await client.pull(TOKEN, 'prior');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.watermark).toBe('W-single');
    expect(calls).toHaveLength(1);
    expect(store.getSupplyItems()).toHaveLength(1);
  });

  it('returns ok:false on 403 (consent_required)', async () => {
    const store = createSyncStore();
    const client = createSyncClient(
      BASE,
      store,
      makeResponse(403, { code: 'consent_required', message: 'cloud_storage' }),
    );
    const result = await client.pull(TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe('consent_required');
    }
  });

  it('returns ok:false on 400 invalid_cursor (expired cursor)', async () => {
    const store = createSyncStore();
    // Simulate first page returning cursor, second page 400 invalid_cursor
    const page1 = {
      timestamp: 'W1',
      nextCursor: 'expired-cursor',
      hasMore: true,
      changes: { supplyItems: { created: [], updated: [], deleted: [] } },
    };

    const { fn } = spyFetch([
      { status: 200, body: page1 },
      { status: 400, body: { code: 'invalid_cursor', message: 'cursor expired' } },
    ]);

    const client = createSyncClient(BASE, store, fn);
    const result = await client.pull(TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_cursor');
  });
});

// ─── wire shape ───────────────────────────────────────────────────────────────

describe('syncClient.push — wire shape', () => {
  it('POSTs to /v1/sync/push with correct URL, Authorization, Idempotency-Key, and body', async () => {
    const store = createSyncStore();
    const pushResp = makePushResponse({});
    const { fn, calls } = spyFetch([{ status: 200, body: pushResp }]);

    const client = createSyncClient(BASE, store, fn);
    const changes = { supplyItems: { created: [], updated: [], deleted: [] } };
    await client.push(changes, WATERMARK, TOKEN, 'idem-key-abc');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/sync/push');

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(headers['Idempotency-Key']).toBe('idem-key-abc');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.lastPulledAt).toBe(WATERMARK);
    expect(body.changes).toEqual(changes);
  });

  it('omits Idempotency-Key header when not provided', async () => {
    const store = createSyncStore();
    const { fn, calls } = spyFetch([{ status: 200, body: makePushResponse({}) }]);
    await createSyncClient(BASE, store, fn).push(
      { supplyItems: { created: [], updated: [], deleted: [] } },
      WATERMARK,
      TOKEN,
      // no idempotencyKey
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('does NOT include the access token in the request body', async () => {
    // Security: token must only appear in Authorization header, never in body
    const store = createSyncStore();
    const { fn, calls } = spyFetch([{ status: 200, body: makePushResponse({}) }]);
    await createSyncClient(BASE, store, fn).push(
      { supplyItems: { created: [], updated: [], deleted: [] } },
      WATERMARK,
      TOKEN,
    );
    const body = calls[0].init?.body as string;
    expect(body).not.toContain(TOKEN);
  });
});

describe('syncClient.pull — wire shape', () => {
  it('GETs /v1/sync/pull with since and Authorization', async () => {
    const store = createSyncStore();
    const pullResp = {
      timestamp: 'W1',
      hasMore: false,
      changes: { supplyItems: { created: [], updated: [], deleted: [] } },
    };
    const { fn, calls } = spyFetch([{ status: 200, body: pullResp }]);

    await createSyncClient(BASE, store, fn).pull(TOKEN, 'wm-123');

    expect(calls[0].url).toContain('/v1/sync/pull');
    expect(calls[0].url).toContain('since=wm-123');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('GETs /v1/sync/pull without since when no watermark provided (cold start)', async () => {
    const store = createSyncStore();
    const pullResp = {
      timestamp: 'W-cold',
      hasMore: false,
      changes: { supplyItems: { created: [], updated: [], deleted: [] } },
    };
    const { fn, calls } = spyFetch([{ status: 200, body: pullResp }]);

    await createSyncClient(BASE, store, fn).pull(TOKEN);

    // No `since` query param for cold start
    expect(calls[0].url).not.toContain('since=');
  });
});
