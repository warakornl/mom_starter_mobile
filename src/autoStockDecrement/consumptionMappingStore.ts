/**
 * consumptionMappingStore.ts — In-memory store for ConsumptionMapping records.
 *
 * HEALTH-SIDE (INV-ASD-9):
 *   The supply row carries ZERO activity linkage. This store holds the
 *   health→supply reference. The reverse (supply→health) never exists.
 *
 * Design:
 *   - LWW (last-write-wins) by version, matching SupplyItem/MedicationPlan pattern.
 *   - Mutation queue for offline-first sync (same drain/re-enqueue pattern as SyncStore).
 *   - Per-row consent by activityType enforced at push time by the server;
 *     the client gate (D-4) is enforced by checkEnableGate().
 *   - No FK cascade on supplyItemId (soft ref — INV-ASD-9).
 *   - reset() clears all state (call on sign-out — PDPA data isolation).
 *
 * Source: auto-stock-decrement-functional.md §9.1 (mapping writes),
 *   auto-stock-decrement-architecture.md §4 (mapping entity),
 *   functional §6.2 (D-4 steer-to-pack).
 *
 * Security:
 *   NEVER log supplyItemId or defaultQty (INV-ASD-5 / SD-5).
 *   Milk-Code (FW-1): this record has no brand/price/vendor/promo field by design.
 */

import type { ConsumptionMappingRecord, MappingActivityType, SyncChangeSet } from '../sync/syncTypes';

// ─── D-4 steer-to-pack gate ───────────────────────────────────────────────────

/**
 * D-4 enable-gate check: a mapping may be set enabled=true ONLY when:
 *   1. supplyItemId is non-null (an item is linked), AND
 *   2. the linked item's usesPerContainer ≥ 2 (container = pack/tin/bottle).
 *
 * usesPerContainer ∈ {null, 1} → gate fails → steer-to-pack advisory.
 *
 * This is enforced at BOTH:
 *   (a) UI toggle time (client-side, prevents enabling in the UI), AND
 *   (b) trigger time (functional §5.3 E-9 backstop for cross-device config races).
 *
 * @returns true if the mapping is eligible to be enabled.
 */
export function checkEnableGate(params: {
  supplyItemId: string | null | undefined;
  usesPerContainer: number | null | undefined;
}): boolean {
  if (!params.supplyItemId) return false; // must be linked
  if (params.usesPerContainer == null) return false; // must be set
  return params.usesPerContainer >= 2; // must be a pack (≥2 uses)
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface ConsumptionMappingStore {
  // ── Read ──────────────────────────────────────────────────────────────────

  /** Returns all live (non-tombstoned) mappings regardless of enabled state. */
  getAll(): ConsumptionMappingRecord[];

  /** Returns all enabled, live mappings for the given activity type. */
  getByActivityType(activityType: MappingActivityType): ConsumptionMappingRecord[];

  /** Returns one record by id, including tombstones. undefined if absent. */
  getById(id: string): ConsumptionMappingRecord | undefined;

  // ── Write (direct — for pull/upsert from sync) ────────────────────────────

  /**
   * Upsert a record by id. LWW by version: if the stored version is at least
   * as new as the incoming record (both > 0), the write is skipped.
   */
  upsert(record: ConsumptionMappingRecord): void;

  /** Soft-delete a record (tombstone). */
  tombstone(id: string): void;

  // ── Queue (for local edits → sync/push) ──────────────────────────────────

  enqueueCreate(record: ConsumptionMappingRecord): void;
  enqueueUpdate(record: ConsumptionMappingRecord): void;
  enqueueDelete(id: string): void;

  /** Drain queue into a SyncChangeSet and clear it. */
  drainQueue(): SyncChangeSet;

  /** Re-enqueue a drained changeset (on push failure — same pattern as SyncStore). */
  reEnqueueChangeset(changeSet: SyncChangeSet): void;

  getPendingCount(): number;

  /** Clear all data + queue (call on sign-out — PDPA data isolation). */
  reset(): void;

  // ── Sync apply (called by sync client — contract §2/§4) ──────────────────

  /**
   * Stamp a local record with server-assigned version+updatedAt after push
   * is acknowledged (contract §2 applied[]). Safe no-op if id is absent.
   */
  stampApplied(id: string, version: number, updatedAt: string): void;

  /**
   * Replace local record with the server record for all conflict resolutions
   * (contract §4: server_won | client_won | tombstone_won → always adopt).
   */
  adoptServerRecord(record: ConsumptionMappingRecord): void;

  // ── Watermark (shared pull cursor — WatermarkStore interface) ────────────

  getWatermark(): string | undefined;
  setWatermark(watermark: string): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createConsumptionMappingStore(): ConsumptionMappingStore {
  const recordMap = new Map<string, ConsumptionMappingRecord>();
  const pendingCreated: ConsumptionMappingRecord[] = [];
  const pendingUpdated: ConsumptionMappingRecord[] = [];
  const pendingDeleted: string[] = [];
  let watermark: string | undefined;

  function upsertInternal(record: ConsumptionMappingRecord): void {
    const existing = recordMap.get(record.id);
    // LWW de-dup: skip if stored version is at least as new (both > 0).
    if (
      existing &&
      existing.version > 0 &&
      record.version > 0 &&
      existing.version >= record.version
    ) {
      return;
    }
    recordMap.set(record.id, { ...record });
  }

  return {
    getAll(): ConsumptionMappingRecord[] {
      return Array.from(recordMap.values()).filter((r) => !r.deletedAt);
    },

    getByActivityType(activityType: MappingActivityType): ConsumptionMappingRecord[] {
      return Array.from(recordMap.values()).filter(
        (r) => !r.deletedAt && r.activityType === activityType && r.enabled,
      );
    },

    getById(id: string): ConsumptionMappingRecord | undefined {
      return recordMap.get(id);
    },

    upsert(record: ConsumptionMappingRecord): void {
      upsertInternal(record);
    },

    tombstone(id: string): void {
      const existing = recordMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        recordMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone (prevents stale queue from resurrecting).
        recordMap.set(id, {
          id,
          activityType: 'feeding_formula',
          defaultQty: 0,
          enabled: false,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    },

    enqueueCreate(record: ConsumptionMappingRecord): void {
      upsertInternal(record);
      pendingCreated.push({ ...record });
    },

    enqueueUpdate(record: ConsumptionMappingRecord): void {
      upsertInternal(record);
      pendingUpdated.push({ ...record });
    },

    enqueueDelete(id: string): void {
      const existing = recordMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        recordMap.set(id, { ...existing, deletedAt: now });
      }
      pendingDeleted.push(id);
    },

    drainQueue(): SyncChangeSet {
      const changeSet: SyncChangeSet = {
        consumptionMappings: {
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
      const cm = changeSet.consumptionMappings;
      if (!cm) return;
      pendingCreated.push(...cm.created);
      pendingUpdated.push(...cm.updated);
      pendingDeleted.push(...cm.deleted);
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

    stampApplied(id: string, version: number, updatedAt: string): void {
      const existing = recordMap.get(id);
      if (!existing) return;
      recordMap.set(id, { ...existing, version, updatedAt });
    },

    adoptServerRecord(record: ConsumptionMappingRecord): void {
      // Unconditional replace — server record always wins for conflict resolution.
      recordMap.set(record.id, { ...record });
    },

    getWatermark(): string | undefined {
      return watermark;
    },

    setWatermark(w: string): void {
      watermark = w;
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/** Module-level ConsumptionMapping store singleton. */
export const consumptionMappingStore = createConsumptionMappingStore();
