/**
 * Sync wire types — contract-pinned shapes for POST /v1/sync/push
 * and GET /v1/sync/pull.
 *
 * Source of truth: api-contract.md §"Offline-sync engine (PINNED)"
 * First entity: supplyItems (OQ-SYNC-18 — mutable LWW, cloud_storage only,
 * no field-level encryption, no floating-civil bucket key).
 *
 * Key contract rules encoded here:
 *   - push: three-bucket changes (created/updated/deleted)
 *   - push response: applied[], conflicts[], rejected[] (every pushed record
 *     lands in exactly one of the three)
 *   - applied[]: server-assigned version + updatedAt — MUST stamp local row
 *   - conflicts[]: resolution enum + serverRecord — client adopts serverRecord
 *   - rejected[]: consent/validation/unknown-collection — surfaced to caller
 *   - pull: timestamp (W1 snapshot start), nextCursor?, hasMore?, changes
 *   - watermark (timestamp) adopted ONLY on last pull page (nextCursor absent)
 *
 * Security: no sensitive fields — supplyItems is NON-health (cloud_storage only).
 * Do NOT add health-data or token fields to this module.
 */

// ─── SupplyItem data model (api-contract.md §3.9 / data-model.md §3.9) ────────

export type SupplyCategory =
  | 'diapers'
  | 'feeding'
  | 'hygiene'
  | 'health-supplies'
  | 'other';

/**
 * SupplyItem — full record including the <sync> block.
 *
 * Client-generated id (uuid v4).
 * version = 0 on first create (the create sentinel); server assigns version ≥ 1.
 * createdAt / updatedAt / deletedAt are server-assigned (authoritative).
 * onHandQty is clamped ≥ 0 server-side; never negative.
 */
export interface SupplyItemRecord {
  // ── Identity ──────────────────────────────────────────────────────────────
  id: string;

  // ── Payload ───────────────────────────────────────────────────────────────
  name: string;
  category: SupplyCategory;
  unit?: string;
  onHandQty: number;
  lowThreshold?: number;
  lowNotifiedAtVersion?: number;

  // ── <sync> block (server-assigned) ────────────────────────────────────────
  /** Monotonic server-assigned version. 0 = never pushed (create sentinel). */
  version: number;
  /** ISO-8601 UTC string. Empty string if not yet pushed. */
  createdAt: string;
  /** ISO-8601 UTC string. Empty string if not yet pushed. */
  updatedAt: string;
  /** ISO-8601 UTC string when soft-deleted, null/undefined when live. */
  deletedAt?: string | null;
}

// ─── Push request ─────────────────────────────────────────────────────────────

/**
 * Three-bucket change set per collection.
 * created vs updated is a client-side hint — server upserts by id.
 * deleted[] carries bare uuids (tombstone-wins, no base version).
 */
export interface SyncChangeSet {
  supplyItems?: {
    created: SupplyItemRecord[];
    updated: SupplyItemRecord[];
    /** Bare uuid strings — no version (tombstone-wins, no base version check). */
    deleted: string[];
  };
}

// ─── Push response ────────────────────────────────────────────────────────────

/**
 * For every cleanly-applied record: server-assigned version + updatedAt.
 * Client MUST stamp its local row — NEVER assume a mutable push left
 * version un-bumped (even a field-level no-op bumps version for mutable records).
 */
export interface AppliedRecord {
  collection: string;
  id: string;
  /** Server-assigned monotonic version after apply. */
  version: number;
  /** Server-assigned authoritative updatedAt after apply. */
  updatedAt: string;
}

/**
 * Per-record version conflict resolved by the server.
 * resolution:
 *   server_won   — base version < current; server row wins; client adopts serverRecord
 *   client_won   — base version == current (tie-broken by clientId); client write wins;
 *                  serverRecord still returned so client learns server-assigned values
 *   tombstone_won — one side is a tombstone; tombstone wins unconditionally
 */
export interface ConflictRecord {
  collection: string;
  id: string;
  resolution: 'server_won' | 'client_won' | 'tombstone_won';
  /** Authoritative server record after resolution — client MUST adopt it. */
  serverRecord: SupplyItemRecord;
}

/**
 * Per-record or per-collection rejection.
 * Kept in queue (retriable) or prompts consent (consent_required).
 * Rejections never appear in applied[] or conflicts[].
 */
export interface RejectedRecord {
  collection: string;
  /** Omitted for whole-collection rejections (consent_required, unknown_collection). */
  id?: string;
  /** consent_required | validation_error | unknown_collection */
  code: string;
  details?: string;
}

export interface SyncPushResponse {
  /** New watermark — NOT adopted by client on push (pull watermark is the clock). */
  timestamp: string;
  applied: AppliedRecord[];
  conflicts: ConflictRecord[];
  rejected: RejectedRecord[];
}

// ─── Pull response ────────────────────────────────────────────────────────────

/**
 * One page of a sync/pull response.
 * timestamp = W1 snapshot-start instant — identical on every page.
 * Client adopts timestamp ONLY on the final page (nextCursor absent).
 * updated[] is always upsert-by-id (created[] is always empty on pull per OQ-SYNC-17).
 */
export interface SyncPullPage {
  /** W1 snapshot-start watermark — same on all pages; adopt on last page only. */
  timestamp: string;
  /** Present when more pages exist; absent on the final page. */
  nextCursor?: string;
  /** True when more pages exist; false/absent on the final page. */
  hasMore?: boolean;
  changes: {
    supplyItems?: {
      /** Always empty on pull (OQ-SYNC-17). */
      created: SupplyItemRecord[];
      /** Live records — treat as upsert-by-id. */
      updated: SupplyItemRecord[];
      /** Tombstoned record ids — client soft-deletes locally. */
      deleted: string[];
    };
  };
}

// ─── Result types (discriminated unions) ──────────────────────────────────────

export interface SyncApiError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type SyncPushResult =
  | {
      ok: true;
      applied: AppliedRecord[];
      conflicts: ConflictRecord[];
      rejected: RejectedRecord[];
    }
  | SyncApiError;

export type SyncPullResult =
  | {
      ok: true;
      /** Adopted watermark (W1 from final page). */
      watermark: string;
    }
  | SyncApiError;
