/**
 * expensesSyncStore — offline-first sync store for expense records.
 *
 * Mirrors supplySyncStore / calendarSyncStore pattern:
 *   - Pure in-memory (no persistence in this slice; SQLite is carry-forward).
 *   - Module-level singleton (`expensesSyncStore`) so the store survives
 *     component re-mounts within the same JS session.
 *   - Data repopulated by syncClient.pull() on each app launch.
 *   - drainQueue() places records under changes.expenses in the SyncChangeSet
 *     so the existing sync push endpoint carries them.
 *
 * Security:
 *   - NEVER log amount, note, or incurredOn values (financial data).
 *   - reset() called on logout (PDPA: no cross-account data leak).
 *   - expensesSyncStore is cloud_storage gated (non-health data, no
 *     general_health consent required — expenses-feature §0 / §5).
 */

import type { ExpenseRecord, SyncChangeSet } from '../sync/syncTypes';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ExpensesSyncStore {
  // ── Records ────────────────────────────────────────────────────────────────

  /** Live records only (deletedAt == null). All months, no sort. */
  getExpenses(): ExpenseRecord[];

  /** Returns one record by id, including tombstones. undefined if absent. */
  getExpense(id: string): ExpenseRecord | undefined;

  /**
   * Upsert by id. De-dups by (id, version): if the stored version is >= the
   * incoming version (both > 0), the write is skipped (safe-window overlap).
   * A version=0 record (create sentinel, not yet pushed) always writes.
   */
  upsertExpense(record: ExpenseRecord): void;

  /**
   * Apply a pull-received tombstone. NOT re-queued (pull tombstones are
   * applied directly; only local deletes are queued for push).
   * If the record is absent, inserts a skeleton tombstone so it cannot
   * re-appear from a stale mutation queue.
   */
  tombstoneExpense(id: string): void;

  /**
   * Stamp server-assigned version + updatedAt from an applied[] entry.
   * MUST be called for every applied record (contract §2).
   */
  stampApplied(id: string, version: number, updatedAt: string): void;

  /**
   * Adopt the authoritative serverRecord from a conflicts[] entry.
   * Called for server_won, client_won, tombstone_won — all adopt serverRecord.
   */
  adoptServerRecord(serverRecord: ExpenseRecord): void;

  // ── Mutation queue ─────────────────────────────────────────────────────────

  /** Queue a create mutation and apply optimistically. version must be 0. */
  enqueueCreate(record: ExpenseRecord): void;

  /** Queue an update mutation and apply optimistically. */
  enqueueUpdate(record: ExpenseRecord): void;

  /** Queue a delete mutation and soft-delete locally (deletedAt = now). */
  enqueueDelete(id: string): void;

  /**
   * Drain the mutation queue into a SyncChangeSet (expenses collection).
   * Clears the queue. Call before push.
   */
  drainQueue(): SyncChangeSet;

  /**
   * Re-enqueue a previously-drained changeset (failed push or rejected items).
   * Contract §3: mutations must never be silently lost.
   */
  reEnqueueChangeset(changeSet: SyncChangeSet): void;

  /** Number of queued mutations waiting to be pushed. */
  getPendingCount(): number;

  /**
   * Clear all in-memory records, the mutation queue, and the watermark.
   * Called on logout (PDPA: no cross-account data leak).
   */
  reset(): void;

  // ── Watermark ──────────────────────────────────────────────────────────────

  /** Last adopted W1 watermark. undefined = never pulled. */
  getWatermark(): string | undefined;

  /** Set the adopted watermark (called by syncClient.pull on the final page). */
  setWatermark(watermark: string): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a fresh in-memory ExpensesSyncStore.
 * Call once per app session; share the instance across syncClient and ExpensesScreen.
 */
export function createExpensesSyncStore(): ExpensesSyncStore {
  // id → ExpenseRecord (including tombstones)
  const recordMap = new Map<string, ExpenseRecord>();

  // Pending mutation queue
  const pendingCreated: ExpenseRecord[] = [];
  const pendingUpdated: ExpenseRecord[] = [];
  const pendingDeleted: string[] = [];

  // Adopted sync watermark
  let watermark: string | undefined;

  return {
    // ── Records ──────────────────────────────────────────────────────────────

    getExpenses(): ExpenseRecord[] {
      return Array.from(recordMap.values()).filter((r) => !r.deletedAt);
    },

    getExpense(id: string): ExpenseRecord | undefined {
      return recordMap.get(id);
    },

    upsertExpense(record: ExpenseRecord): void {
      const existing = recordMap.get(record.id);
      // De-dup: skip if stored version is >= incoming (both must be > 0).
      // version=0 (create sentinel) always writes (never de-duped).
      if (
        existing &&
        existing.version > 0 &&
        record.version > 0 &&
        existing.version >= record.version
      ) {
        return;
      }
      recordMap.set(record.id, { ...record });
    },

    tombstoneExpense(id: string): void {
      const existing = recordMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        recordMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone — prevents re-appearance from stale queue
        recordMap.set(id, {
          id,
          amount: 0,
          category: 'other',
          incurredOn: '1970-01-01',
          clientId: '',
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    },

    stampApplied(id: string, version: number, updatedAt: string): void {
      const existing = recordMap.get(id);
      if (existing) {
        recordMap.set(id, { ...existing, version, updatedAt });
      }
    },

    adoptServerRecord(serverRecord: ExpenseRecord): void {
      recordMap.set(serverRecord.id, { ...serverRecord });
    },

    // ── Mutation queue ────────────────────────────────────────────────────────

    enqueueCreate(record: ExpenseRecord): void {
      recordMap.set(record.id, { ...record });
      pendingCreated.push({ ...record });
    },

    enqueueUpdate(record: ExpenseRecord): void {
      recordMap.set(record.id, { ...record });
      pendingUpdated.push({ ...record });
    },

    enqueueDelete(id: string): void {
      const existing = recordMap.get(id);
      if (existing) {
        recordMap.set(id, { ...existing, deletedAt: new Date().toISOString() });
      }
      pendingDeleted.push(id);
    },

    drainQueue(): SyncChangeSet {
      const changeSet: SyncChangeSet = {
        expenses: {
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
      const exp = changeSet.expenses;
      if (!exp) return;
      pendingCreated.push(...exp.created);
      pendingUpdated.push(...exp.updated);
      pendingDeleted.push(...exp.deleted);
    },

    getPendingCount(): number {
      return pendingCreated.length + pendingUpdated.length + pendingDeleted.length;
    },

    reset(): void {
      recordMap.clear();
      pendingCreated.length = 0;
      pendingUpdated.length = 0;
      pendingDeleted.length = 0;
      watermark = undefined;
    },

    // ── Watermark ────────────────────────────────────────────────────────────

    getWatermark(): string | undefined {
      return watermark;
    },

    setWatermark(w: string): void {
      watermark = w;
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Singleton ExpensesSyncStore for the expenses feature.
 *
 * Survives component re-mounts within the same JS session.
 * reset() is called on logout (PDPA: no cross-account data leak).
 *
 * Imported by:
 *   - ExpensesScreen  — reads/writes records and mutation queue
 *   - SettingsScreen  — calls reset() on logout (PDPA §1.1)
 */
export const expensesSyncStore = createExpensesSyncStore();
