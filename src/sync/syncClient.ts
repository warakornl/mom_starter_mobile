/**
 * Sync client — HTTP client for POST /v1/sync/push and GET /v1/sync/pull.
 *
 * Contract source: api-contract.md §"Offline-sync engine (PINNED)"
 * First entity: supplyItems (OQ-SYNC-18).
 *
 * Design mirrors pregnancyApiClient.ts:
 * - `createSyncClient(baseUrl, store, fetchFn?)` factory — injectable for tests.
 * - Every function returns a discriminated union (ok: true | false).
 * - Store is injected so apply logic (stampApplied, adoptServerRecord,
 *   tombstoneItem) runs inside the client without the caller needing to
 *   inspect wire responses.
 *
 * Apply logic (contract §2/§4 — PINNED):
 *   applied[]  → stampApplied(id, version, updatedAt) on every entry.
 *                MUST NOT assume a mutable push left version un-bumped.
 *   conflicts[] → adoptServerRecord(serverRecord) for ALL resolutions
 *                (server_won, client_won, tombstone_won — client ALWAYS
 *                 adopts serverRecord to learn server-assigned values).
 *   rejected[] → surfaced in return value; kept in caller's queue.
 *
 * Pull loop (contract §9 — PINNED):
 *   - Since is fixed across all cursor pages (same W1 snapshot).
 *   - Watermark (timestamp) adopted ONLY on the final page (nextCursor absent).
 *   - updated[] → upsertSupplyItem (upsert-by-id, de-dup by (id, version)).
 *   - deleted[] → tombstoneItem (soft-delete locally, NOT re-queued).
 *
 * Wire:
 *   - Authorization: Bearer <accessToken>  (NEVER log the token)
 *   - Idempotency-Key header (optional, caller provides uuid)
 *   - Content-Type: application/json on push
 *
 * Security: NEVER log the accessToken. supplyItems is NON-health but
 * standard at-rest encryption applies — no plaintext logging of item data.
 */

import type { FetchFn } from '../auth/authApiClient';
import type { SyncStore } from './syncStore';
import type {
  SyncChangeSet,
  SyncPushResponse,
  SyncPullPage,
  SyncPushResult,
  SyncPullResult,
} from './syncTypes';

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface Problem {
  code: string;
  message: string;
  details?: string;
}

async function parseError(res: Response): Promise<Problem> {
  try {
    const body = (await res.json()) as Partial<Problem>;
    return {
      code: body.code ?? 'unknown_error',
      message: body.message ?? res.statusText,
      details: body.details,
    };
  } catch {
    return { code: 'unknown_error', message: res.statusText };
  }
}

function buildUrl(
  base: string,
  path: string,
  params: Record<string, string | undefined>,
): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join('&');
  return query ? `${base}${path}?${query}` : `${base}${path}`;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a sync client bound to a base URL, in-memory store, and fetch impl.
 *
 * @param baseUrl  e.g. `"https://api.example.com"` (no trailing slash)
 * @param store    In-memory sync store — apply logic mutates this store
 * @param fetchFn  Defaults to global `fetch`; inject a mock in tests
 */
export function createSyncClient(
  baseUrl: string,
  store: SyncStore,
  fetchFn: FetchFn = fetch,
) {
  return {
    /**
     * POST /v1/sync/push
     *
     * Sends `changes` to the server and applies the response to the store:
     *   applied[]  → stampApplied() for every record (contract §2)
     *   conflicts[] → adoptServerRecord() for every conflict (contract §4)
     *   rejected[] → returned to caller; caller decides retry / consent prompt
     *
     * @param changes         SyncChangeSet to push (caller builds from queue/drain)
     * @param lastPulledAt    Watermark of last adopted pull (zero string = never pulled)
     * @param accessToken     Bearer JWT — NEVER log
     * @param idempotencyKey  Optional uuid for 24h Idempotency-Key header (§10)
     */
    async push(
      changes: SyncChangeSet,
      lastPulledAt: string,
      accessToken: string,
      idempotencyKey?: string,
    ): Promise<SyncPushResult> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // NEVER log accessToken
        Authorization: `Bearer ${accessToken}`,
      };
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }

      const res = await fetchFn(`${baseUrl}/v1/sync/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ changes, lastPulledAt }),
      });

      if (!res.ok) {
        const problem = await parseError(res);
        return { ok: false, status: res.status, code: problem.code, message: problem.message };
      }

      const resp = (await res.json()) as SyncPushResponse;

      // ── Apply logic ──────────────────────────────────────────────────────
      //
      // Contract §2 (OQ-SYNC-1): stamp EVERY applied record — mutable records
      // ALWAYS bump version; never assume un-bumped.
      for (const applied of resp.applied ?? []) {
        if (applied.collection === 'supplyItems') {
          store.stampApplied(applied.id, applied.version, applied.updatedAt);
        }
      }

      // Contract §4 (OQ-SYNC-5): adopt serverRecord for ALL resolutions.
      // server_won   — server row won (base < current); client adopts.
      // client_won   — client write won; client still learns server values.
      // tombstone_won — tombstone wins unconditionally; client adopts tombstone.
      for (const conflict of resp.conflicts ?? []) {
        if (conflict.collection === 'supplyItems') {
          // serverRecord is a SyncRecord union; narrow via collection discriminant
          store.adoptServerRecord(conflict.serverRecord as import('./syncTypes').SupplyItemRecord);
        }
      }

      return {
        ok: true,
        applied: resp.applied ?? [],
        conflicts: resp.conflicts ?? [],
        rejected: resp.rejected ?? [],
      };
    },

    /**
     * GET /v1/sync/pull — with cursor loop.
     *
     * Loops pages until nextCursor is absent (hasMore false / nextCursor
     * not present). On each page applies changes to the store:
     *   updated[] → upsertSupplyItem (upsert-by-id, (id,version) de-dup)
     *   deleted[] → tombstoneItem (soft-delete locally — NOT re-queued)
     *
     * Watermark adoption (contract §9 OQ-SYNC-12 — BINDING):
     *   The watermark (timestamp = W1 snapshot-start) is identical on every
     *   page and adopted ONLY on the final page (nextCursor absent).
     *   Mid-drain watermark would lose writes landing during drain.
     *
     * Since is kept FIXED across all cursor pages (same W1 snapshot).
     *
     * @param accessToken  Bearer JWT — NEVER log
     * @param since        Watermark from last pull; absent = cold start / full resync
     */
    async pull(
      accessToken: string,
      since?: string,
    ): Promise<SyncPullResult> {
      let cursor: string | undefined;
      let adoptedWatermark: string | undefined;

      // Keep `since` fixed across all pages per contract (§9 OQ-SYNC-12)
      const fixedSince = since;

      for (;;) {
        const url = buildUrl(`${baseUrl}`, '/v1/sync/pull', {
          since: fixedSince,
          cursor,
          limit: '1000',
        });

        const res = await fetchFn(url, {
          method: 'GET',
          headers: {
            // NEVER log accessToken
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!res.ok) {
          const problem = await parseError(res);
          return {
            ok: false,
            status: res.status,
            code: problem.code,
            message: problem.message,
          };
        }

        const page = (await res.json()) as SyncPullPage;

        // Apply changes from this page to the store
        const supplyChanges = page.changes?.supplyItems;
        if (supplyChanges) {
          // updated[] → upsert (OQ-SYNC-17: treat as upsert-by-id)
          for (const item of supplyChanges.updated ?? []) {
            store.upsertSupplyItem(item);
          }
          // Pull created[] is always empty per OQ-SYNC-17; upsert anyway (defensive)
          for (const item of supplyChanges.created ?? []) {
            store.upsertSupplyItem(item);
          }
          // deleted[] → tombstone locally (soft-delete, not re-queued)
          for (const id of supplyChanges.deleted ?? []) {
            store.tombstoneItem(id);
          }
        }

        const isLastPage = !page.nextCursor;

        if (isLastPage) {
          // Adopt watermark ONLY on the final page (OQ-SYNC-12 — BINDING).
          // page.timestamp = W1 snapshot-start, fixed since the first request.
          adoptedWatermark = page.timestamp;
          store.setWatermark(adoptedWatermark);
          break;
        }

        // Advance cursor for the next page; since stays fixed
        cursor = page.nextCursor;
      }

      return { ok: true, watermark: adoptedWatermark! };
    },
  };
}

/** The type of the object returned by `createSyncClient`. */
export type SyncClient = ReturnType<typeof createSyncClient>;
