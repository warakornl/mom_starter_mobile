/**
 * Sync client — HTTP client for POST /v1/sync/push and GET /v1/sync/pull.
 *
 * Contract source: api-contract.md §"Offline-sync engine (PINNED)"
 *
 * Generic adapter design:
 *   `createSyncClient` and `createCalendarSyncClient` both delegate to an
 *   internal factory that accepts a `Map<collectionName, SyncCollectionAdapter>`.
 *   Each adapter exposes:
 *     stampApplied   — called for every applied[] entry (contract §2)
 *     adoptServerRecord — called for every conflict[] entry (contract §4)
 *     upsertRecord   — called for pull updated[]/created[]
 *     tombstoneRecord — called for pull deleted[]
 *   Adding a new collection in a future slice = add one adapter entry.
 *
 * Public factories:
 *   createSyncClient(baseUrl, supplyStore, fetchFn?)
 *     → binds to SyncStore; handles collection='supplyItems' only.
 *   createCalendarSyncClient(baseUrl, calendarStore, fetchFn?)
 *     → binds to CalendarSyncStore; handles reminders, reminderOccurrences,
 *        checklistItems (all MOTHER-health collections).
 *
 * Apply logic (contract §2/§4 — PINNED):
 *   applied[]  → stampApplied(id, version, updatedAt) for every entry.
 *                MUST NOT assume a mutable push left version un-bumped.
 *   conflicts[] → adoptServerRecord(serverRecord) for ALL resolutions
 *                (server_won, client_won, tombstone_won — client ALWAYS
 *                 adopts serverRecord to learn server-assigned values).
 *   rejected[] → surfaced in return value; kept in caller's queue.
 *
 * Pull loop (contract §9 — PINNED):
 *   - Since is fixed across all cursor pages (same W1 snapshot).
 *   - Watermark (timestamp) adopted ONLY on the final page (nextCursor absent).
 *   - updated[]/created[] → upsertRecord (upsert-by-id, de-dup by (id, version)).
 *   - deleted[] → tombstoneRecord (soft-delete locally, NOT re-queued).
 *
 * Wire:
 *   - Authorization: Bearer <accessToken>  (NEVER log the token)
 *   - Idempotency-Key header (optional, caller provides uuid)
 *   - Content-Type: application/json on push
 *
 * Security: NEVER log the accessToken. reminders/reminderOccurrences/
 * checklistItems are MOTHER-health (general_health gate) — no plaintext logging.
 */

import type { FetchFn } from '../auth/authApiClient';
import type { SyncStore } from './syncStore';
import type { CalendarSyncStore } from './calendarSyncStore';
import type {
  SyncChangeSet,
  SyncPushResponse,
  SyncPullPage,
  SyncPushResult,
  SyncPullResult,
  SyncRecord,
  SupplyItemRecord,
  ReminderRecord,
  ReminderOccurrenceRecord,
  ChecklistItemRecord,
} from './syncTypes';

// ─── Collection adapter interface ─────────────────────────────────────────────

/**
 * Per-collection adapter: maps sync apply operations to the right store method.
 * Register one adapter per collection in the adapterMap passed to the internal
 * factory. Adding a new collection in future slices = add one adapter entry.
 */
interface SyncCollectionAdapter {
  /** Push apply logic: stamp server-assigned version+updatedAt (contract §2). */
  stampApplied(id: string, version: number, updatedAt: string): void;
  /**
   * Push apply logic: adopt serverRecord for all conflict resolutions (§4).
   * server_won | client_won | tombstone_won → always call adoptServerRecord.
   */
  adoptServerRecord(record: SyncRecord): void;
  /** Pull apply logic: upsert a record received in updated[]/created[]. */
  upsertRecord(record: SyncRecord): void;
  /** Pull apply logic: soft-delete a record from deleted[] (not re-queued). */
  tombstoneRecord(id: string): void;
}

/** Minimal watermark interface shared by SyncStore and CalendarSyncStore. */
interface WatermarkStore {
  getWatermark(): string | undefined;
  setWatermark(watermark: string): void;
}

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

/**
 * Apply pull changes for a single collection.
 * Unknown collections are silently ignored (no crash — forward-compat).
 */
function applyPullChanges(
  collectionName: string,
  changes: { created?: unknown[]; updated?: unknown[]; deleted?: string[] } | undefined,
  adapterMap: Map<string, SyncCollectionAdapter>,
): void {
  if (!changes) return;
  const adapter = adapterMap.get(collectionName);
  if (!adapter) return;
  // updated[] / created[] → upsert (OQ-SYNC-17: treat both as upsert-by-id)
  for (const item of changes.updated ?? []) adapter.upsertRecord(item as SyncRecord);
  for (const item of changes.created ?? []) adapter.upsertRecord(item as SyncRecord);
  // deleted[] → tombstone locally (soft-delete, not re-queued)
  for (const id of changes.deleted ?? []) adapter.tombstoneRecord(id);
}

// ─── Internal generic sync client factory ────────────────────────────────────

function createSyncClientWithAdapters(
  baseUrl: string,
  adapterMap: Map<string, SyncCollectionAdapter>,
  watermarkStore: WatermarkStore,
  fetchFn: FetchFn,
) {
  return {
    /**
     * POST /v1/sync/push
     *
     * Sends `changes` to the server and applies the response using adapters:
     *   applied[]  → adapter.stampApplied() for every record (contract §2)
     *   conflicts[] → adapter.adoptServerRecord() for every conflict (contract §4)
     *   rejected[] → returned to caller; caller decides retry / consent prompt
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

      // ── Apply logic — generic adapter routing ────────────────────────────
      //
      // Contract §2 (OQ-SYNC-1): stamp EVERY applied record.
      // Route by collection — unknown collections are silently skipped.
      for (const applied of resp.applied ?? []) {
        adapterMap.get(applied.collection)?.stampApplied(
          applied.id,
          applied.version,
          applied.updatedAt,
        );
      }

      // Contract §4 (OQ-SYNC-5): adopt serverRecord for ALL resolutions.
      // server_won   — server row won; client adopts.
      // client_won   — client write won; client still learns server values.
      // tombstone_won — tombstone wins unconditionally; client adopts tombstone.
      for (const conflict of resp.conflicts ?? []) {
        adapterMap.get(conflict.collection)?.adoptServerRecord(conflict.serverRecord);
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
     * not present). On each page applies changes via the adapter map:
     *   updated[]/created[] → adapter.upsertRecord (upsert-by-id)
     *   deleted[] → adapter.tombstoneRecord (soft-delete locally, not re-queued)
     *
     * Watermark adoption (contract §9 OQ-SYNC-12 — BINDING):
     *   The watermark (timestamp = W1 snapshot-start) is identical on every
     *   page and adopted ONLY on the final page (nextCursor absent).
     *
     * Since is kept FIXED across all cursor pages (same W1 snapshot).
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

        // Apply changes from this page using the adapter map
        applyPullChanges('supplyItems', page.changes?.supplyItems, adapterMap);
        applyPullChanges('reminders', page.changes?.reminders, adapterMap);
        applyPullChanges('reminderOccurrences', page.changes?.reminderOccurrences, adapterMap);
        applyPullChanges('checklistItems', page.changes?.checklistItems, adapterMap);

        const isLastPage = !page.nextCursor;

        if (isLastPage) {
          // Adopt watermark ONLY on the final page (OQ-SYNC-12 — BINDING).
          adoptedWatermark = page.timestamp;
          watermarkStore.setWatermark(adoptedWatermark);
          break;
        }

        cursor = page.nextCursor;
      }

      return { ok: true, watermark: adoptedWatermark! };
    },
  };
}

// ─── Public factories ─────────────────────────────────────────────────────────

/**
 * Creates a sync client bound to a SyncStore (supplyItems collection).
 *
 * Backward-compatible signature — existing callers (SuppliesScreen, tests)
 * do not need to change.
 *
 * @param baseUrl  e.g. `"https://api.example.com"` (no trailing slash)
 * @param store    In-memory supply sync store
 * @param fetchFn  Defaults to global `fetch`; inject a mock in tests
 */
export function createSyncClient(
  baseUrl: string,
  store: SyncStore,
  fetchFn: FetchFn = fetch,
) {
  const adapterMap = new Map<string, SyncCollectionAdapter>([
    [
      'supplyItems',
      {
        stampApplied: (id, version, updatedAt) =>
          store.stampApplied(id, version, updatedAt),
        adoptServerRecord: (record) =>
          store.adoptServerRecord(record as SupplyItemRecord),
        upsertRecord: (record) =>
          store.upsertSupplyItem(record as SupplyItemRecord),
        tombstoneRecord: (id) => store.tombstoneItem(id),
      },
    ],
  ]);
  return createSyncClientWithAdapters(baseUrl, adapterMap, store, fetchFn);
}

/**
 * Creates a sync client bound to a CalendarSyncStore.
 * Handles collections: reminders, reminderOccurrences, checklistItems.
 *
 * Use this in calendar screens (CalendarScreen, AppointmentFormScreen,
 * ReminderFormScreen) for push/pull of MOTHER-health data.
 *
 * @param baseUrl  API base URL (no trailing slash)
 * @param store    CalendarSyncStore singleton
 * @param fetchFn  Defaults to global `fetch`; inject a mock in tests
 */
export function createCalendarSyncClient(
  baseUrl: string,
  store: CalendarSyncStore,
  fetchFn: FetchFn = fetch,
) {
  const adapterMap = new Map<string, SyncCollectionAdapter>([
    [
      'reminders',
      {
        stampApplied: (id, version, updatedAt) =>
          store.stampReminderApplied(id, version, updatedAt),
        adoptServerRecord: (record) =>
          store.adoptReminderServerRecord(record as ReminderRecord),
        upsertRecord: (record) =>
          store.upsertReminder(record as ReminderRecord),
        tombstoneRecord: (id) => store.tombstoneReminder(id),
      },
    ],
    [
      'reminderOccurrences',
      {
        stampApplied: (id, version, updatedAt) =>
          store.stampOccurrenceApplied(id, version, updatedAt),
        adoptServerRecord: (record) =>
          store.adoptOccurrenceServerRecord(record as ReminderOccurrenceRecord),
        upsertRecord: (record) =>
          store.upsertOccurrence(record as ReminderOccurrenceRecord),
        tombstoneRecord: (id) => store.tombstoneOccurrence(id),
      },
    ],
    [
      'checklistItems',
      {
        stampApplied: (id, version, updatedAt) =>
          store.stampChecklistItemApplied(id, version, updatedAt),
        adoptServerRecord: (record) =>
          store.adoptChecklistItemServerRecord(record as ChecklistItemRecord),
        upsertRecord: (record) =>
          store.upsertChecklistItem(record as ChecklistItemRecord),
        tombstoneRecord: (id) => store.tombstoneChecklistItem(id),
      },
    ],
  ]);
  return createSyncClientWithAdapters(baseUrl, adapterMap, store, fetchFn);
}

/** The type of the object returned by either sync client factory. */
export type SyncClient = ReturnType<typeof createSyncClient>;
