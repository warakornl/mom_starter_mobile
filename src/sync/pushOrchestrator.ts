/**
 * pushOrchestrator — executes one push cycle with correct re-queue behaviour.
 *
 * Contract §3 (PINNED — offline-first core):
 *   After drainQueue() + push():
 *     • push fails (network/5xx/403/409) → re-enqueue entire changeset.
 *       Data must NEVER be silently lost on a failed push.
 *     • push succeeds, rejected[] non-empty:
 *         - whole-collection rejection (no id) → re-enqueue entire changeset
 *         - per-record rejection (has id)      → re-enqueue only those rows
 *     • push succeeds, no rejected[] → nothing to re-enqueue
 *       (applied[] are stamped by syncClient; conflicts[] adopt serverRecord)
 *
 * Generic design:
 *   `executePush` accepts any `Drainable` store — both SyncStore (supplyItems)
 *   and CalendarSyncStore (reminders/occurrences/checklistItems) implement it.
 *   Per-record rejected re-enqueue uses `filterChangeSetByIds` which handles
 *   ALL collections in SyncChangeSet generically.
 *
 * The function returns the raw SyncPushResult so the caller can:
 *   • detect errors and show a banner
 *   • derive conflictCount = result.ok ? result.conflicts.length : 0
 *   • derive rejectedItems  = result.ok ? result.rejected       : []
 * Both derivations are UNCONDITIONAL — this guarantees banners reset after
 * a clean push following a push that had conflicts or rejected items.
 *
 * Security: accessToken is forwarded only to syncClient.push() (which puts
 * it in the Authorization header).  Never logged.
 */

import type { SyncClient } from './syncClient';
import type { SyncChangeSet, SyncPushResult } from './syncTypes';

// ─── Drainable interface ──────────────────────────────────────────────────────

/**
 * Minimal interface required by executePush.
 * Both SyncStore and CalendarSyncStore satisfy this via duck typing.
 */
export interface Drainable {
  getWatermark(): string | undefined;
  drainQueue(): SyncChangeSet;
  reEnqueueChangeset(changeSet: SyncChangeSet): void;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a SyncChangeSet containing only the records whose id is in rejectedIds.
 * Handles all four collections generically — no per-collection hardcoding.
 */
function filterChangeSetByIds(
  changes: SyncChangeSet,
  rejectedIds: Set<string>,
): SyncChangeSet {
  const result: SyncChangeSet = {};

  if (changes.supplyItems) {
    const s = changes.supplyItems;
    result.supplyItems = {
      created: s.created.filter((r) => rejectedIds.has(r.id)),
      updated: s.updated.filter((r) => rejectedIds.has(r.id)),
      deleted: s.deleted.filter((id) => rejectedIds.has(id)),
    };
  }
  if (changes.reminders) {
    const r = changes.reminders;
    result.reminders = {
      created: r.created.filter((rec) => rejectedIds.has(rec.id)),
      updated: r.updated.filter((rec) => rejectedIds.has(rec.id)),
      deleted: r.deleted.filter((id) => rejectedIds.has(id)),
    };
  }
  if (changes.reminderOccurrences) {
    const o = changes.reminderOccurrences;
    result.reminderOccurrences = {
      created: o.created.filter((rec) => rejectedIds.has(rec.id)),
      updated: o.updated.filter((rec) => rejectedIds.has(rec.id)),
      deleted: o.deleted.filter((id) => rejectedIds.has(id)),
    };
  }
  if (changes.checklistItems) {
    const c = changes.checklistItems;
    result.checklistItems = {
      created: c.created.filter((rec) => rejectedIds.has(rec.id)),
      updated: c.updated.filter((rec) => rejectedIds.has(rec.id)),
      deleted: c.deleted.filter((id) => rejectedIds.has(id)),
    };
  }

  // Y-2: kickCountSessions — immutable event union, per-record rejected re-enqueue
  if (changes.kickCountSessions) {
    const k = changes.kickCountSessions;
    result.kickCountSessions = {
      created: k.created.filter((rec) => rejectedIds.has(rec.id)),
      updated: k.updated.filter((rec) => rejectedIds.has(rec.id)),
      deleted: k.deleted.filter((id) => rejectedIds.has(id)),
    };
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Drain the store's mutation queue, push to the server, then re-enqueue any
 * mutations that need retry.
 *
 * Works with any Drainable store: SyncStore (supplyItems) or CalendarSyncStore
 * (reminders, reminderOccurrences, checklistItems).
 *
 * @param store          Shared in-memory sync store (mutation queue + item map)
 * @param client         Sync HTTP client (already bound to baseUrl + store)
 * @param accessToken    Bearer JWT — NEVER log
 * @param idempotencyKey UUID v4 for 24h Idempotency-Key header (§10)
 */
export async function executePush(
  store: Drainable,
  client: SyncClient,
  accessToken: string,
  idempotencyKey: string,
): Promise<SyncPushResult> {
  const watermark = store.getWatermark() ?? '';
  const changes = store.drainQueue();

  const result = await client.push(changes, watermark, accessToken, idempotencyKey);

  if (!result.ok) {
    // Network fail / 5xx / 403 / 409 — restore the entire changeset so the
    // next syncPush attempt can retry it.  Without this re-enqueue the
    // mutation is permanently lost (the 🔴-1 bug).
    store.reEnqueueChangeset(changes);
    return result;
  }

  // Successful push — handle partial rejections.
  // Contract §3: rejected rows MUST remain queued (retriable).
  if (result.rejected.length > 0) {
    const hasCollectionRejection = result.rejected.some((r) => !r.id);

    if (hasCollectionRejection) {
      // Whole-collection rejection (e.g. consent_required with no id):
      // re-enqueue everything — we can't distinguish individual rows.
      store.reEnqueueChangeset(changes);
    } else {
      // Per-record rejections: re-enqueue only the affected rows.
      // filterChangeSetByIds is generic — handles all collections.
      const rejectedIds = new Set(result.rejected.map((r) => r.id!));
      const requeue = filterChangeSetByIds(changes, rejectedIds);
      store.reEnqueueChangeset(requeue);
    }
  }

  return result;
}
