/**
 * medicationLogSyncStore — offline-first sync store for medication log events.
 *
 * Pattern: immutable create-only — mirrors selfLogSyncStore / kickCountSyncStore.
 *   - Pure in-memory (no persistence in this slice; SQLite is carry-forward).
 *   - Module-level singleton (`medicationLogSyncStore`) so the store survives
 *     component re-mounts within the same JS session.
 *   - Data repopulated by syncClient.pull() on each app launch.
 *   - drainQueue() places records under changes.medicationLogs in the SyncChangeSet.
 *   - updated[] is ALWAYS EMPTY — immutable event log, no in-place rewrites (D3).
 *
 * Key invariants (from medication-behavior.md §1.2 + syncTypes §medicationLogs):
 *  - Create-only event: each log is a distinct client-gen UUIDv4.
 *    Two logs with the same plan/time are TWO records (same as SelfLog E9).
 *  - Immutable event: re-pushing the same id is a server no-op (D3).
 *    No update path — a correction is a NEW row (new UUID) + tombstone the old.
 *  - Tombstone-wins: tombstoneLog() always applies regardless of version.
 *  - drainQueue() → changes.medicationLogs.{created, updated:[], deleted} (D3).
 *  - adoptServerRecord() always writes (conflict resolution — contract §4).
 *  - upsertLog() deduplicates by (id, version) — safe-window overlap (pull path).
 *  - loggedAt is set to now() on create; it is response-only on pull (D5).
 *
 * Security:
 *  - NEVER log note, occurrenceTime, or medicationPlanId (health data — SD-5).
 *  - reset() MUST be called on logout (PDPA 1.1: no cross-account data leak).
 *  - medicationLogSyncStore is general_health gated (MOTHER-health data).
 */

import { v4 as uuidv4 } from 'uuid';
import type { MedicationLog, MedicationLogInput, SyncChangeSet } from '../sync/syncTypes';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface MedicationLogSyncStore {
  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * All live (non-tombstoned) medication log records.
   * Soft-deleted records (deletedAt != null) are excluded.
   */
  getLogs(): MedicationLog[];

  /**
   * One record by id, including tombstones. undefined if absent.
   * Used for stampApplied / conflict resolution / tombstone inspection.
   */
  getLog(id: string): MedicationLog | undefined;

  /**
   * All live (non-tombstoned) records sorted by occurrenceTime descending
   * (most-recent first) — use this in history/detail views so that display
   * order is deterministic regardless of insertion order.
   *
   * Equivalent to `getLogs().sort(...)` but avoids per-call boilerplate.
   * Does NOT mutate the internal map.
   *
   * Security: NEVER log any element of the returned array (SD-5).
   */
  getLogsSortedDesc(): MedicationLog[];

  // ── Mutations (create + tombstone — NO update path) ───────────────────────

  /**
   * Create a new medication log (create-only, immutable).
   *
   * Generates a client UUIDv4, builds a MedicationLog with version=0, sets
   * loggedAt = now() (absolute UTC), inserts into the in-memory map, and
   * enqueues for push via sync/push.
   *
   * Two calls with the same input produce two distinct records (different UUIDs).
   *
   * Security: do NOT log input.note, input.occurrenceTime, or input.medicationPlanId.
   */
  addLog(input: MedicationLogInput): MedicationLog;

  /**
   * Upsert a pull-received record by (id, version) de-dup.
   *
   * Incoming record is skipped when the local version >= incoming version
   * (both > 0) — safe-window overlap. version=0 (create sentinel) always writes.
   *
   * Does NOT enqueue for push (pull path only).
   */
  upsertLog(record: MedicationLog): void;

  /**
   * Soft-delete a medication log and enqueue for push as a tombstone (deleted[]).
   *
   * Sets deletedAt locally (immediate exclusion from getLogs).
   * Adds the id to the pending delete queue so drainQueue() emits it under
   * changes.medicationLogs.deleted.
   *
   * For unknown ids: inserts a tombstone skeleton so other-device convergence
   * does not re-surface the record (contract §5).
   *
   * Tombstone-wins: unconditional — may be called multiple times safely.
   */
  tombstoneLog(id: string): void;

  // ── Post-push reconciliation ───────────────────────────────────────────────

  /**
   * Stamp server-assigned version + updatedAt after applied[] response (contract §2).
   * MUST be called for every applied[] entry.
   */
  stampApplied(id: string, version: number, updatedAt: string): void;

  /**
   * Unconditionally adopt a server record (contract §4 — server_won / client_won /
   * tombstone_won). Unlike upsertLog, this always overwrites regardless of local
   * version. Used for conflict resolution on push response.
   */
  adoptServerRecord(record: MedicationLog): void;

  // ── Queue ─────────────────────────────────────────────────────────────────

  /**
   * Drain all queued mutations into a SyncChangeSet (medicationLogs collection).
   * Clears the queue. Call before POST /sync/push.
   *
   * Shape: changes.medicationLogs.{ created[], updated:[], deleted[] }
   * updated[] is ALWAYS empty — immutable event log, no in-place rewrites (D3).
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
   * MUST be called on logout (PDPA 1.1): prevents User A's medication log data
   * (MOTHER-health — general_health gated) from leaking to User B who logs in
   * on the same device in the same JS session.
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
function makeUpsert<T extends { id: string; version: number }>(
  map: Map<string, T>,
) {
  return (item: T): void => {
    const existing = map.get(item.id);
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
 * Creates a fresh in-memory MedicationLogSyncStore.
 * Call once per app session; share the instance across syncClient and screens.
 */
export function createMedicationLogSyncStore(): MedicationLogSyncStore {
  // id → MedicationLog (including tombstones)
  const logMap = new Map<string, MedicationLog>();

  // Push queues (no pendingUpdated — immutable event log, D3)
  const pendingCreated: MedicationLog[] = [];
  const pendingDeleted: string[] = [];

  // Adopted sync watermark
  let watermark: string | undefined;

  const upsertBase = makeUpsert(logMap);

  return {
    // ── Read ──────────────────────────────────────────────────────────────────

    getLogs(): MedicationLog[] {
      return Array.from(logMap.values()).filter((r) => !r.deletedAt);
    },

    getLog(id: string): MedicationLog | undefined {
      return logMap.get(id);
    },

    getLogsSortedDesc(): MedicationLog[] {
      // occurrenceTime is floating-civil YYYY-MM-DDTHH:mm (FLAG-1) — lexicographic
      // comparison is correct because the format is sortable as-is.
      return Array.from(logMap.values())
        .filter((r) => !r.deletedAt)
        .sort((a, b) => b.occurrenceTime.localeCompare(a.occurrenceTime));
    },

    // ── Create ─────────────────────────────────────────────────────────────────

    addLog(input: MedicationLogInput): MedicationLog {
      const now = new Date().toISOString();
      const record: MedicationLog = {
        id: uuidv4(),
        // Security: never log these fields — health data (SD-5)
        medicationPlanId: input.medicationPlanId ?? null,
        occurrenceTime: input.occurrenceTime,
        status: input.status,
        note: input.note ?? null,
        // loggedAt is the absolute-UTC record-creation instant (D5 / response-only).
        // Client sets it to now() on create; the server will confirm/overwrite via
        // stampApplied after push ack.
        loggedAt: now,
        version: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      // Fresh UUID will not exist in the map; guards against theoretical UUID reuse
      upsertBase(record);
      pendingCreated.push({ ...record });
      return { ...record };
    },

    // ── Upsert (pull path) ─────────────────────────────────────────────────────

    upsertLog(record: MedicationLog): void {
      upsertBase(record);
    },

    // ── Tombstone ─────────────────────────────────────────────────────────────

    tombstoneLog(id: string): void {
      const existing = logMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        logMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone for unknown id — prevents re-appearance from stale
        // queue or other-device replay (contract §5 convergence rule).
        logMap.set(id, {
          id,
          occurrenceTime: '',     // minimal required field; never used for reads
          status: 'taken',        // minimal required field; never used for reads
          loggedAt: now,
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

    adoptServerRecord(record: MedicationLog): void {
      // Unconditional — always write (conflict resolution; record may be a tombstone)
      logMap.set(record.id, { ...record });
    },

    // ── Queue ─────────────────────────────────────────────────────────────────

    drainQueue(): SyncChangeSet {
      const changeSet: SyncChangeSet = {
        medicationLogs: {
          created: [...pendingCreated],
          updated: [], // always empty — immutable event log, no in-place rewrites (D3)
          deleted: [...pendingDeleted],
        },
      };
      pendingCreated.length = 0;
      pendingDeleted.length = 0;
      return changeSet;
    },

    reEnqueueChangeset(changeSet: SyncChangeSet): void {
      const ml = changeSet.medicationLogs;
      if (!ml) return;
      pendingCreated.push(...ml.created);
      // ml.updated is always empty for immutable events — safe to ignore
      pendingDeleted.push(...ml.deleted);
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
 * Module-level singleton for medication log events.
 *
 * Survives component re-mounts within one JS session.
 * Data is in-memory only; repopulated by syncClient.pull() on app launch.
 *
 * CRITICAL: Call reset() on logout (PDPA 1.1).
 * A missing reset() causes User A's medication log health data to remain visible
 * to User B after logout within the same JS session — this is the cross-account-
 * leak bug pattern fixed for selfLogSyncStore. Wire reset() into performLogout.
 *
 * Security: note/occurrenceTime/medicationPlanId are health data (SD-5).
 * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
 */
export const medicationLogSyncStore = createMedicationLogSyncStore();
