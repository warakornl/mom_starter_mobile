/**
 * selfLogSyncStore — in-memory local store for self-log immutable events.
 *
 * Mirrors kickCountSyncStore exactly (same factory / upsert / watermark design),
 * adapted for the SelfLog immutable-event union (5 metricTypes: weight,
 * blood_pressure, swelling, lochia, symptom).
 *
 * Key invariants (from spec §D2/D3, self-log-behavior.md):
 *  - Create-only union: each self-log is a distinct client-gen UUIDv4.
 *    Two logs with the same metricType/value/loggedAt are TWO records (E9).
 *  - Immutable event: re-pushing the same id is a server no-op (D2).
 *    No update path — a correction is a NEW row (new UUID) + tombstone the old one.
 *  - Tombstone-wins: tombstoneSelfLog() always applies regardless of version.
 *  - drainQueue() → changes.selfLogs.{created, updated:[], deleted} (D2).
 *  - adoptServerRecord() always writes (conflict resolution — contract §4).
 *  - upsertSelfLog() deduplicates by (id, version) — safe-window overlap (pull path).
 *
 * Security:
 *  - NEVER log valueNumeric, valueNumericSecondary, valueText, or note fields
 *    (MOTHER-health data — SD-5). These are opaque base64 ciphertext strings.
 *  - Call reset() on logout (PDPA: no cross-account data leak between sessions).
 *    A missing reset() is a real cross-account-leak bug — do NOT skip it.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SelfLog, SelfLogInput, SyncChangeSet } from '../sync/syncTypes';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SelfLogSyncStore {
  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * All live (non-tombstoned) self-log records, sorted by loggedAt descending.
   * Soft-deleted records (deletedAt != null) are excluded.
   */
  getSelfLogs(): SelfLog[];

  /**
   * One record by id, including tombstones. undefined if absent.
   * Used for stampApplied / conflict resolution / tombstone inspection.
   */
  getSelfLog(id: string): SelfLog | undefined;

  // ── Mutations (create + tombstone — NO update path) ───────────────────────

  /**
   * Create a new self-log (create-only, immutable).
   *
   * Generates a client UUIDv4, builds a SelfLog with version=0, inserts into
   * the in-memory map, and enqueues for push via sync/push.
   *
   * Two calls with the same input produce two distinct records (different UUIDs) —
   * no same-input dedup for self-logs (E9: two readings a minute apart are two rows).
   *
   * Security: do NOT log input.valueNumeric / input.valueText / input.note.
   */
  addSelfLog(input: SelfLogInput): SelfLog;

  /**
   * Upsert a pull-received record by (id, version) de-dup.
   *
   * Incoming record is skipped when the local version >= incoming version
   * (both > 0) — safe-window overlap. version=0 (create sentinel) always writes.
   *
   * Does NOT enqueue for push (pull path only).
   */
  upsertSelfLog(record: SelfLog): void;

  /**
   * Soft-delete a self-log and enqueue for push as a tombstone (deleted[]).
   *
   * Sets deletedAt locally (immediate exclusion from getSelfLogs).
   * Adds the id to the pending delete queue so drainQueue() emits it under
   * changes.selfLogs.deleted.
   *
   * For unknown ids: inserts a tombstone skeleton so other-device convergence
   * does not re-surface the record (contract §5).
   *
   * Tombstone-wins: unconditional — may be called multiple times safely.
   */
  tombstoneSelfLog(id: string): void;

  // ── Post-push reconciliation ───────────────────────────────────────────────

  /**
   * Stamp server-assigned version + updatedAt after applied[] response (contract §2).
   * MUST be called for every applied[] entry — do not assume the version is stable.
   */
  stampApplied(id: string, version: number, updatedAt: string): void;

  /**
   * Unconditionally adopt a server record (contract §4 — server_won / client_won /
   * tombstone_won). Unlike upsertSelfLog, this always overwrites regardless of
   * local version. Used for conflict resolution on push response.
   */
  adoptServerRecord(record: SelfLog): void;

  // ── Queue ─────────────────────────────────────────────────────────────────

  /**
   * Drain all queued mutations into a SyncChangeSet (selfLogs collection).
   * Clears the queue. Call before POST /sync/push.
   *
   * Shape: changes.selfLogs.{ created[], updated:[], deleted[] }
   * updated[] is ALWAYS empty — immutable event, no in-place rewrites (D2).
   */
  drainQueue(): SyncChangeSet;

  /**
   * Re-enqueue a previously drained changeset (failed push or rejected items).
   * Contract §3: mutations must never be silently lost on push failure.
   */
  reEnqueueChangeset(changeSet: SyncChangeSet): void;

  /** Count of pending mutations (created + deleted) waiting for push. */
  getPendingCount(): number;

  // ── Watermark ─────────────────────────────────────────────────────────────

  /** Last adopted W1 watermark (undefined = never pulled). */
  getWatermark(): string | undefined;

  /** Set the adopted watermark (called by syncClient.pull on the final page). */
  setWatermark(watermark: string): void;

  // ── Reset (PDPA logout) ───────────────────────────────────────────────────

  /**
   * Clear ALL in-memory state: records, pending queues, watermark.
   *
   * MUST be called on logout (PDPA 1.1): prevents User A's self-log health data
   * from leaking to User B who logs in on the same device in the same JS session.
   * Missing this call is a cross-account-leak bug — wire into performLogout.
   */
  reset(): void;
}

// ─── Internal upsert helper ───────────────────────────────────────────────────

/**
 * Returns an upsert function for the given Map.
 * De-dup by (id, version): incoming record is ignored when local version >=
 * incoming version (both > 0). version=0 is the create sentinel — always inserts.
 */
function makeUpsert<T extends { id: string; version: number; deletedAt?: string | null }>(
  map: Map<string, T>,
) {
  return (item: T): void => {
    const existing = map.get(item.id);
    // Skip if local version >= incoming (both > 0) — safe-window overlap.
    // version=0 (create sentinel) always writes.
    if (
      existing &&
      existing.version > 0 &&
      item.version > 0 &&
      existing.version >= item.version
    ) {
      return;
    }
    map.set(item.id, { ...item });
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a fresh in-memory SelfLogSyncStore.
 * Call once per app session; share the instance across syncClient and UI screens.
 */
export function createSelfLogSyncStore(): SelfLogSyncStore {
  // id → SelfLog (including tombstones)
  const logMap = new Map<string, SelfLog>();

  // Push queues (no pendingUpdated — selfLogs is create-only union, D2)
  const pendingCreated: SelfLog[] = [];
  const pendingDeleted: string[] = [];

  // Adopted sync watermark
  let watermark: string | undefined;

  const upsertBase = makeUpsert(logMap);

  return {
    // ── Read ──────────────────────────────────────────────────────────────────

    getSelfLogs(): SelfLog[] {
      return Array.from(logMap.values())
        .filter((r) => !r.deletedAt)
        .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt)); // descending by loggedAt
    },

    getSelfLog(id: string): SelfLog | undefined {
      return logMap.get(id);
    },

    // ── Create ─────────────────────────────────────────────────────────────────

    addSelfLog(input: SelfLogInput): SelfLog {
      const now = new Date().toISOString();
      const record: SelfLog = {
        id: uuidv4(),
        metricType: input.metricType,
        // Security: never log these fields — opaque ciphertext (SD-5)
        valueNumeric: input.valueNumeric ?? null,
        valueNumericSecondary: input.valueNumericSecondary ?? null,
        valueText: input.valueText ?? null,
        unit: input.unit ?? null,
        loggedAt: input.loggedAt,
        note: input.note ?? null,
        version: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      // Dedup by (id, version): a fresh UUID will not exist in the map, so this
      // always inserts. Guards against any theoretical UUID reuse via the upsert rule.
      upsertBase(record);
      pendingCreated.push({ ...record });
      return { ...record };
    },

    // ── Upsert (pull path) ─────────────────────────────────────────────────────

    upsertSelfLog(record: SelfLog): void {
      upsertBase(record);
    },

    // ── Tombstone ─────────────────────────────────────────────────────────────

    tombstoneSelfLog(id: string): void {
      const existing = logMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        logMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone for unknown id — prevents re-appearance from stale queue
        // or other-device replay (contract §5 convergence rule).
        logMap.set(id, {
          id,
          metricType: 'symptom', // minimal required field; never used for reads
          loggedAt: '',
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
      pendingDeleted.push(id);
    },

    // ── Post-push reconciliation ───────────────────────────────────────────────

    stampApplied(id: string, version: number, updatedAt: string): void {
      const existing = logMap.get(id);
      if (existing) {
        logMap.set(id, { ...existing, version, updatedAt });
      }
    },

    adoptServerRecord(record: SelfLog): void {
      // Unconditional — always write (conflict resolution; record may be a tombstone)
      logMap.set(record.id, { ...record });
    },

    // ── Queue ─────────────────────────────────────────────────────────────────

    drainQueue(): SyncChangeSet {
      const changeSet: SyncChangeSet = {
        selfLogs: {
          created: [...pendingCreated],
          updated: [], // always empty — immutable event log, no in-place rewrites (D2)
          deleted: [...pendingDeleted],
        },
      };
      // Clear queues after draining
      pendingCreated.length = 0;
      pendingDeleted.length = 0;
      return changeSet;
    },

    reEnqueueChangeset(changeSet: SyncChangeSet): void {
      const sl = changeSet.selfLogs;
      if (!sl) return;
      pendingCreated.push(...sl.created);
      // sl.updated is always empty for immutable events — safe to ignore
      pendingDeleted.push(...sl.deleted);
    },

    getPendingCount(): number {
      return pendingCreated.length + pendingDeleted.length;
    },

    // ── Watermark ─────────────────────────────────────────────────────────────

    getWatermark(): string | undefined {
      return watermark;
    },

    setWatermark(w: string): void {
      watermark = w;
    },

    // ── Reset (PDPA logout) ───────────────────────────────────────────────────

    reset(): void {
      logMap.clear();
      pendingCreated.length = 0;
      pendingDeleted.length = 0;
      watermark = undefined;
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Module-level singleton for self-log events.
 *
 * Survives component re-mounts within one JS session.
 * Data is in-memory only; repopulated by syncClient.pull() on app launch.
 *
 * CRITICAL: Call reset() on logout (PDPA 1.1).
 * A missing reset() causes User A's health data to remain visible to User B
 * after logout within the same JS session — this is the cross-account-leak bug
 * that was found in a prior session. Wire reset() into performLogout.
 */
export const selfLogSyncStore = createSelfLogSyncStore();
