/**
 * SyncStore — in-memory local store for sync engine (entity: supplyItems).
 *
 * Design:
 *   - Pure in-memory (no persistence in this slice). expo-secure-store has a
 *     per-key 2 KB limit making it unsuitable for an unbounded item map;
 *     SQLite persistence is the next step (carry-forward). Data is fresh on
 *     each app launch, repopulated by syncClient.pull().
 *   - Tracks: supplyItems map (id → record), mutation queue (pending push),
 *     and the adopted watermark.
 *   - The mutation queue lets the SuppliesScreen batch offline edits and push
 *     them in one call via drainQueue().
 *   - De-dup by (id, version): upsertSupplyItem() skips a record whose
 *     version the store already holds (safe-window overlap idempotency).
 *   - Tombstones (deletedAt != null) are stored in the map so the store
 *     converges correctly; getSupplyItems() filters them out for the UI.
 *
 * No npm dependency is added — uuid is used in the calling screen for IDs.
 *
 * Security: no tokens or sensitive data stored here.
 */

import type { SupplyItemRecord, SyncChangeSet } from './syncTypes';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SyncStore {
  // ── supplyItems ────────────────────────────────────────────────────────────

  /** Live items only (deletedAt == null). Sorted by name for stable display. */
  getSupplyItems(): SupplyItemRecord[];

  /** Returns one item by id, including tombstones. Returns undefined if absent. */
  getSupplyItem(id: string): SupplyItemRecord | undefined;

  /**
   * Upsert a record by id. De-dups by (id, version): if the stored version
   * equals the incoming version (both > 0), the write is skipped (safe-window
   * overlap idempotency). A version=0 record (not yet pushed) always wins over
   * an absent entry.
   */
  upsertSupplyItem(item: SupplyItemRecord): void;

  /**
   * Soft-delete an item from a pull-received tombstone. Does NOT add to the
   * mutation queue — pull tombstones are applied directly, not re-pushed.
   * If the item is not present, inserts a skeleton tombstone so it doesn't
   * re-appear from a stale queue.
   */
  tombstoneItem(id: string): void;

  /**
   * Stamp version + updatedAt from an applied[] entry (after push).
   * Contract: MUST be called for EVERY applied record — mutable records
   * ALWAYS bump version; never assume a no-op left version un-bumped.
   */
  stampApplied(id: string, version: number, updatedAt: string): void;

  /**
   * Replace a local record with the authoritative serverRecord from conflicts[].
   * Called for server_won, client_won (both adopt serverRecord), and tombstone_won.
   */
  adoptServerRecord(serverRecord: SupplyItemRecord): void;

  // ── Mutation queue ─────────────────────────────────────────────────────────

  /**
   * Queue a create mutation and update the local map optimistically.
   * Item must have version=0 (create sentinel).
   */
  enqueueCreate(item: SupplyItemRecord): void;

  /**
   * Queue an update mutation and update the local map optimistically.
   */
  enqueueUpdate(item: SupplyItemRecord): void;

  /**
   * Queue a delete mutation and soft-delete locally (deletedAt = now).
   */
  enqueueDelete(id: string): void;

  /**
   * Drain the mutation queue into a SyncChangeSet and clear the queue.
   * Call before push: `client.push(store.drainQueue(), watermark, token)`.
   */
  drainQueue(): SyncChangeSet;

  /**
   * Re-enqueue a previously-drained changeset back into the pending queue.
   *
   * Call this when a push fails (network/5xx/403/409) or when the server
   * returns rejected[] records that need retry — per contract §3:
   * "client MUST keep rejected rows queued (retriable)".
   *
   * Note: only pass back the subset that needs retry (failed push → full
   * changeset; rejected items → only the rejected subset).
   */
  reEnqueueChangeset(changeSet: SyncChangeSet): void;

  /** Number of queued mutations waiting to be pushed. */
  getPendingCount(): number;

  /**
   * Clear all in-memory items, the mutation queue, and the watermark.
   *
   * Call on user logout to prevent data from one user leaking into a
   * subsequent session (PDPA compliance / data-isolation requirement).
   */
  reset(): void;

  // ── Watermark ──────────────────────────────────────────────────────────────

  /** Last adopted W1 watermark. undefined = never pulled. */
  getWatermark(): string | undefined;

  /**
   * Set the adopted watermark. Called by syncClient.pull() on the final page
   * (nextCursor absent) — NOT after each page.
   */
  setWatermark(watermark: string): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a fresh in-memory SyncStore.
 *
 * Call `createSyncStore()` once per app session; share the instance across
 * syncClient and SuppliesScreen.
 */
export function createSyncStore(): SyncStore {
  // id → SupplyItemRecord (including tombstones)
  const itemMap = new Map<string, SupplyItemRecord>();

  // Pending mutation queue
  const pendingCreated: SupplyItemRecord[] = [];
  const pendingUpdated: SupplyItemRecord[] = [];
  const pendingDeleted: string[] = [];

  // Adopted sync watermark
  let watermark: string | undefined;

  return {
    // ── supplyItems ──────────────────────────────────────────────────────────

    getSupplyItems(): SupplyItemRecord[] {
      return Array.from(itemMap.values())
        .filter((item) => !item.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    getSupplyItem(id: string): SupplyItemRecord | undefined {
      return itemMap.get(id);
    },

    upsertSupplyItem(item: SupplyItemRecord): void {
      const existing = itemMap.get(item.id);
      // De-dup by (id, version): skip if stored version is at least as new as
      // the incoming record.  Using >= rather than === means an inadvertently
      // replayed older record (e.g. from an overlap page) never overwrites a
      // newer local state.  Both sides must be > 0 (version=0 = create sentinel,
      // which must always be written so it appears in the queue).
      if (
        existing &&
        existing.version > 0 &&
        item.version > 0 &&
        existing.version >= item.version
      ) {
        return;
      }
      itemMap.set(item.id, { ...item });
    },

    tombstoneItem(id: string): void {
      const existing = itemMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        itemMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone — so this id won't re-appear from a stale queue
        itemMap.set(id, {
          id,
          name: '',
          category: 'other',
          onHandQty: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    },

    stampApplied(id: string, version: number, updatedAt: string): void {
      const existing = itemMap.get(id);
      if (existing) {
        itemMap.set(id, { ...existing, version, updatedAt });
      }
    },

    adoptServerRecord(serverRecord: SupplyItemRecord): void {
      itemMap.set(serverRecord.id, { ...serverRecord });
    },

    // ── Mutation queue ────────────────────────────────────────────────────────

    enqueueCreate(item: SupplyItemRecord): void {
      itemMap.set(item.id, { ...item });
      pendingCreated.push({ ...item });
    },

    enqueueUpdate(item: SupplyItemRecord): void {
      itemMap.set(item.id, { ...item });
      pendingUpdated.push({ ...item });
    },

    enqueueDelete(id: string): void {
      const existing = itemMap.get(id);
      if (existing) {
        itemMap.set(id, { ...existing, deletedAt: new Date().toISOString() });
      }
      pendingDeleted.push(id);
    },

    drainQueue(): SyncChangeSet {
      const changeSet: SyncChangeSet = {
        supplyItems: {
          created: [...pendingCreated],
          updated: [...pendingUpdated],
          deleted: [...pendingDeleted],
        },
      };
      // Clear the queue
      pendingCreated.length = 0;
      pendingUpdated.length = 0;
      pendingDeleted.length = 0;
      return changeSet;
    },

    reEnqueueChangeset(changeSet: SyncChangeSet): void {
      const si = changeSet.supplyItems;
      if (!si) return;
      pendingCreated.push(...si.created);
      pendingUpdated.push(...si.updated);
      pendingDeleted.push(...si.deleted);
    },

    getPendingCount(): number {
      return pendingCreated.length + pendingUpdated.length + pendingDeleted.length;
    },

    reset(): void {
      itemMap.clear();
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
