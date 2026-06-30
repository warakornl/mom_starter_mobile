/**
 * kickCountSyncStore — in-memory local store for kick-count completed sessions.
 *
 * Pattern mirrors calendarSyncStore (same factory / upsert / watermark design).
 *
 * Key invariants (from spec §D2/D3):
 *  - Only `completed` sessions are stored / pushed.
 *  - `in_progress` draft lives in the encrypted draft store (kickCountDraftStore).
 *  - `cancelled` → no row, no queue entry, no egress.
 *  - drainQueue() enforces terminal-status guard: only status=completed is drained.
 *  - Immutable event union: upsert is (id, version) de-dup; no field overwrite
 *    for re-sent identical ids (version echo — contract §4/§10).
 *  - Tombstone-wins: tombstoneSession() always applies regardless of version.
 *  - adoptServerRecord() always writes (conflict resolution — contract §4).
 *
 * Security: never log movementCount or any session field (MOTHER-health K-8).
 * Call reset() on logout (PDPA: prevent data leakage between sessions).
 */

import type { KickCountSessionRecord, KickCountSyncChanges } from './kickCountTypes';

// ─── SyncChangeSet slice for kickCountSessions ────────────────────────────────

/** The portion of SyncChangeSet that belongs to this store. */
export interface KickCountChangeSet {
  kickCountSessions: KickCountSyncChanges;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface KickCountSyncStore {
  /** All active (non-tombstoned) completed sessions, sorted by startedAt descending. */
  getActiveSessions(): KickCountSessionRecord[];

  /** One session by id (including tombstones — for stampApplied / conflict resolution). */
  getSession(id: string): KickCountSessionRecord | undefined;

  /**
   * Upsert by (id, version) de-dup.
   * Incoming record is ignored when local version >= incoming version (both > 0).
   * Use for pull-received records and initial local inserts.
   */
  upsertSession(record: KickCountSessionRecord): void;

  /**
   * Set deletedAt on an existing session (tombstone-wins, unconditional).
   * Inserts a tombstone skeleton for unknown ids (convergence to other devices).
   */
  tombstoneSession(id: string): void;

  /**
   * Stamp server-assigned version + updatedAt after applied[] response (contract §2).
   * MUST be called for every applied[] entry — never assume version is un-bumped.
   */
  stampApplied(id: string, version: number, updatedAt: string): void;

  /**
   * Unconditionally adopt a server record (contract §4 — server_won/client_won/tombstone_won).
   * Unlike upsert, this always overwrites regardless of local version.
   */
  adoptServerRecord(record: KickCountSessionRecord): void;

  /**
   * Enqueue a new completed session for push (immutable create).
   * Adds to the local session map AND the created[] push queue.
   * Only status=completed accepted — guards at call site.
   */
  enqueueCreate(record: KickCountSessionRecord): void;

  /**
   * Enqueue a tombstone delete for push.
   * Also applies the local tombstone immediately.
   */
  enqueueDelete(id: string): void;

  /** Drain all queued mutations into a KickCountChangeSet and clear the queues. */
  drainQueue(): KickCountChangeSet;

  /** Re-enqueue a previously drained changeset (for retry on push failure). */
  reEnqueueChangeset(changeSet: KickCountChangeSet): void;

  /** Count of pending mutations (created + deleted). */
  getPendingCount(): number;

  /** Last adopted W1 watermark. */
  getWatermark(): string | undefined;
  setWatermark(watermark: string): void;

  /** PDPA logout: clear all sessions, queues, watermark. */
  reset(): void;
}

// ─── Internal upsert helper ───────────────────────────────────────────────────

function makeUpsert<T extends { id: string; version: number; deletedAt?: string | null }>(
  map: Map<string, T>,
) {
  return (item: T): void => {
    const existing = map.get(item.id);
    // De-dup by (id, version): ignore incoming if local version >= incoming (both > 0).
    // version=0 is the create sentinel — always insert.
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

export function createKickCountSyncStore(): KickCountSyncStore {
  const sessionMap = new Map<string, KickCountSessionRecord>();

  // Push queues
  const pendingCreated: KickCountSessionRecord[] = [];
  // No pendingUpdated — kickCountSessions is create-only union (immutable events)
  const pendingDeleted: string[] = [];

  let watermark: string | undefined;

  const upsertBase = makeUpsert(sessionMap);

  return {
    // ── Read ────────────────────────────────────────────────────────────────

    getActiveSessions(): KickCountSessionRecord[] {
      return Array.from(sessionMap.values())
        .filter((s) => !s.deletedAt)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)); // descending by startedAt
    },

    getSession(id) {
      return sessionMap.get(id);
    },

    // ── Upsert / tombstone (for pull apply) ─────────────────────────────────

    upsertSession(record) {
      upsertBase(record);
    },

    tombstoneSession(id) {
      const existing = sessionMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        sessionMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone for unknown id (convergence to other devices — contract §5)
        sessionMap.set(id, {
          id,
          startedAt: '',
          movementCount: 0,
          targetCount: 10,
          status: 'completed',
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    },

    // ── stampApplied / adoptServerRecord (for push response) ─────────────────

    stampApplied(id, version, updatedAt) {
      const existing = sessionMap.get(id);
      if (existing) {
        sessionMap.set(id, { ...existing, version, updatedAt });
      }
    },

    adoptServerRecord(record) {
      // Unconditional — always write (conflict resolution; may be a tombstone)
      sessionMap.set(record.id, { ...record });
    },

    // ── Queue mutations (for push) ────────────────────────────────────────────

    enqueueCreate(record) {
      // Terminal-status guard: only completed is ever queued
      if (record.status !== 'completed') return;
      sessionMap.set(record.id, { ...record });
      pendingCreated.push({ ...record });
    },

    enqueueDelete(id) {
      this.tombstoneSession(id);
      pendingDeleted.push(id);
    },

    // ── Drain / re-enqueue ────────────────────────────────────────────────────

    drainQueue(): KickCountChangeSet {
      // Terminal-status guard (defensive): filter any accidentally queued non-completed
      const completedCreated = pendingCreated.filter((s) => s.status === 'completed');

      const changeSet: KickCountChangeSet = {
        kickCountSessions: {
          created: [...completedCreated],
          updated: [], // immutable event log — no updates
          deleted: [...pendingDeleted],
        },
      };

      // Clear queues
      pendingCreated.length = 0;
      pendingDeleted.length = 0;

      return changeSet;
    },

    reEnqueueChangeset(changeSet) {
      if (changeSet.kickCountSessions) {
        const kcs = changeSet.kickCountSessions;
        // Only re-enqueue completed rows (terminal guard on re-enqueue too)
        const completedCreated = kcs.created.filter((s) => s.status === 'completed');
        pendingCreated.push(...completedCreated);
        pendingDeleted.push(...kcs.deleted);
      }
    },

    getPendingCount(): number {
      return pendingCreated.length + pendingDeleted.length;
    },

    // ── Watermark ────────────────────────────────────────────────────────────

    getWatermark() {
      return watermark;
    },

    setWatermark(w) {
      watermark = w;
    },

    // ── Reset (PDPA logout) ───────────────────────────────────────────────────

    reset() {
      sessionMap.clear();
      pendingCreated.length = 0;
      pendingDeleted.length = 0;
      watermark = undefined;
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Module-level singleton for kick-count sessions.
 * Survives component re-mounts within one JS session.
 * Data is in-memory only; repopulated by syncClient.pull() on app launch.
 * Call reset() on logout (PDPA).
 */
export const kickCountSyncStore = createKickCountSyncStore();
