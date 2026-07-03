/**
 * medicationPlanSyncStore — offline-first sync store for medication plan records.
 *
 * Pattern: mutable LWW — mirrors expensesSyncStore / supplySyncStore.
 *   - Pure in-memory (no persistence in this slice; SQLite is carry-forward).
 *   - Module-level singleton (`medicationPlanSyncStore`) so the store survives
 *     component re-mounts within the same JS session.
 *   - Data repopulated by syncClient.pull() on each app launch.
 *   - drainQueue() places records under changes.medicationPlans in the
 *     SyncChangeSet so the existing sync push endpoint carries them.
 *   - All three buckets (created / updated / deleted) are live (LWW mutable).
 *
 * Security:
 *   - NEVER log name or dose fields (opaque base64 ciphertext — SD-2 / SD-5).
 *   - NEVER log scheduleRule if it infers drug class (SD-5).
 *   - reset() MUST be called on logout (PDPA 1.1: no cross-account data leak).
 *   - medicationPlanSyncStore is general_health gated (MOTHER-health data).
 */

import { v4 as uuidv4 } from 'uuid';
import type { MedicationPlan, MedicationPlanInput, SyncChangeSet } from '../sync/syncTypes';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface MedicationPlanSyncStore {
  // ── Records ────────────────────────────────────────────────────────────────

  /**
   * Live records only (deletedAt == null / absent). All plans, no sort.
   * Security: do NOT log any returned record's name or dose fields (SD-2).
   */
  getPlans(): MedicationPlan[];

  /**
   * Returns one record by id, including tombstones. undefined if absent.
   * Used for stampApplied / conflict resolution / tombstone inspection.
   */
  getPlan(id: string): MedicationPlan | undefined;

  /**
   * Upsert by id. De-dups by (id, version): if the stored version is >=
   * the incoming version (both > 0), the write is skipped (safe-window overlap).
   * A version=0 record (create sentinel, not yet pushed) always writes.
   *
   * Does NOT enqueue for push (pull path only).
   */
  upsertPlan(record: MedicationPlan): void;

  /**
   * Apply a pull-received tombstone. NOT re-queued (pull tombstones are applied
   * directly; only local deletes are queued for push).
   * If the record is absent, inserts a skeleton tombstone so it cannot
   * re-appear from a stale mutation queue.
   */
  tombstonePlan(id: string): void;

  /**
   * Stamp server-assigned version + updatedAt from an applied[] entry.
   * MUST be called for every applied record (contract §2).
   */
  stampApplied(id: string, version: number, updatedAt: string): void;

  /**
   * Adopt the authoritative serverRecord from a conflicts[] entry.
   * Called for server_won, client_won, tombstone_won — all adopt serverRecord.
   * Unconditional — always overwrites regardless of local version.
   */
  adoptServerRecord(serverRecord: MedicationPlan): void;

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Create a new medication plan (mutable LWW).
   *
   * Generates a client UUIDv4, builds a MedicationPlan with version=0, inserts
   * into the in-memory map, and enqueues for push under medicationPlans.created.
   *
   * Security: do NOT log input.name or input.dose (opaque ciphertext — SD-2/D4).
   */
  addPlan(input: MedicationPlanInput): MedicationPlan;

  /**
   * Apply a partial update to an existing plan and enqueue under
   * medicationPlans.updated. Patch is merged into the current record.
   * No-op if the id is not found.
   *
   * Security: patch fields name/dose must never be logged.
   */
  updatePlan(id: string, patch: Partial<MedicationPlanInput>): void;

  // ── Post-push reconciliation ───────────────────────────────────────────────

  /**
   * Drain all queued mutations into a SyncChangeSet (medicationPlans collection).
   * Clears the queue. Call before POST /sync/push.
   *
   * Shape: changes.medicationPlans.{ created[], updated[], deleted[] }
   * All three buckets are live (LWW mutable record — unlike immutable events).
   */
  drainQueue(): SyncChangeSet;

  /**
   * Re-enqueue a previously drained changeset (failed push or rejected items).
   * Contract §3: mutations must never be silently lost on push failure.
   */
  reEnqueueChangeset(changeSet: SyncChangeSet): void;

  /** Count of pending mutations (created + updated + deleted) waiting for push. */
  getPendingCount(): number;

  // ── Watermark ─────────────────────────────────────────────────────────────

  /** Last adopted W1 watermark. undefined = never pulled. */
  getWatermark(): string | undefined;

  /** Set the adopted watermark (called by syncClient.pull on the final page). */
  setWatermark(watermark: string): void;

  // ── Reset (PDPA logout) ───────────────────────────────────────────────────

  /**
   * Clear ALL in-memory state: records, pending queues, watermark.
   *
   * MUST be called on logout (PDPA 1.1): prevents User A's medication plan data
   * (MOTHER-health — general_health gated) from leaking to User B who logs in
   * on the same device in the same JS session.
   * Missing this call is a cross-account-leak bug — wire into performLogout.
   */
  reset(): void;
}

// ─── Internal upsert helper ───────────────────────────────────────────────────

/**
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
 * Creates a fresh in-memory MedicationPlanSyncStore.
 * Call once per app session; share the instance across syncClient and screens.
 */
export function createMedicationPlanSyncStore(): MedicationPlanSyncStore {
  // id → MedicationPlan (including tombstones)
  const planMap = new Map<string, MedicationPlan>();

  // Push queues — all three buckets are live (LWW mutable record)
  const pendingCreated: MedicationPlan[] = [];
  const pendingUpdated: MedicationPlan[] = [];
  const pendingDeleted: string[] = [];

  // Adopted sync watermark
  let watermark: string | undefined;

  const upsertBase = makeUpsert(planMap);

  return {
    // ── Records ──────────────────────────────────────────────────────────────

    getPlans(): MedicationPlan[] {
      return Array.from(planMap.values()).filter((r) => !r.deletedAt);
    },

    getPlan(id: string): MedicationPlan | undefined {
      return planMap.get(id);
    },

    upsertPlan(record: MedicationPlan): void {
      upsertBase(record);
    },

    tombstonePlan(id: string): void {
      const existing = planMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        planMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone — prevents re-appearance from stale queue or
        // other-device replay (contract §5 convergence rule).
        planMap.set(id, {
          id,
          name: '', // minimal required field; never used for reads
          active: false,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
      pendingDeleted.push(id);
    },

    stampApplied(id: string, version: number, updatedAt: string): void {
      const existing = planMap.get(id);
      if (existing) {
        planMap.set(id, { ...existing, version, updatedAt });
      }
    },

    adoptServerRecord(serverRecord: MedicationPlan): void {
      // Unconditional — always write (conflict resolution)
      planMap.set(serverRecord.id, { ...serverRecord });
    },

    // ── Mutations ────────────────────────────────────────────────────────────

    addPlan(input: MedicationPlanInput): MedicationPlan {
      const now = new Date().toISOString();
      const record: MedicationPlan = {
        id: uuidv4(),
        // Security: name and dose are opaque base64 — do NOT log (SD-2/D4)
        name: input.name,
        dose: input.dose ?? null,
        scheduleRule: input.scheduleRule ?? null,
        active: input.active,
        sourceSuggestionStateId: input.sourceSuggestionStateId ?? null,
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

    updatePlan(id: string, patch: Partial<MedicationPlanInput>): void {
      const existing = planMap.get(id);
      if (!existing) return;
      const now = new Date().toISOString();
      const updated: MedicationPlan = {
        ...existing,
        ...patch,
        updatedAt: now,
      };
      planMap.set(id, updated);
      pendingUpdated.push({ ...updated });
    },

    // ── Queue ─────────────────────────────────────────────────────────────────

    drainQueue(): SyncChangeSet {
      const changeSet: SyncChangeSet = {
        medicationPlans: {
          created: [...pendingCreated],
          updated: [...pendingUpdated],
          deleted: [...pendingDeleted],
        },
      };
      pendingCreated.length = 0;
      pendingUpdated.length = 0;
      pendingDeleted.length = 0;
      return changeSet;
    },

    reEnqueueChangeset(changeSet: SyncChangeSet): void {
      const mp = changeSet.medicationPlans;
      if (!mp) return;
      pendingCreated.push(...mp.created);
      pendingUpdated.push(...mp.updated);
      pendingDeleted.push(...mp.deleted);
    },

    getPendingCount(): number {
      return pendingCreated.length + pendingUpdated.length + pendingDeleted.length;
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
      planMap.clear();
      pendingCreated.length = 0;
      pendingUpdated.length = 0;
      pendingDeleted.length = 0;
      watermark = undefined;
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Singleton MedicationPlanSyncStore for the medication feature.
 *
 * Survives component re-mounts within the same JS session.
 * reset() MUST be called on logout (PDPA 1.1: no cross-account data leak).
 *
 * Imported by:
 *   - MedicationScreen  — reads/writes records and mutation queue
 *   - performLogout     — calls reset() on every logout path (PDPA §1.1)
 *
 * Security: name/dose are opaque base64 ciphertext (SD-2 / ruling 4).
 * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
 */
export const medicationPlanSyncStore = createMedicationPlanSyncStore();
