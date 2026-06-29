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

import type { SyncStore } from './syncStore';
import type { SyncClient } from './syncClient';
import type { SyncChangeSet, SyncPushResult } from './syncTypes';

/**
 * Drain the store's mutation queue, push to the server, then re-enqueue any
 * mutations that need retry.
 *
 * @param store          Shared in-memory sync store (mutation queue + item map)
 * @param client         Sync HTTP client (already bound to baseUrl + store)
 * @param accessToken    Bearer JWT — NEVER log
 * @param idempotencyKey UUID v4 for 24h Idempotency-Key header (§10)
 */
export async function executePush(
  store: SyncStore,
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

  // Successful push — handle partial rejections (🔴-2 bug fix).
  // Contract §3: rejected rows MUST remain queued (retriable).
  if (result.rejected.length > 0) {
    const hasCollectionRejection = result.rejected.some((r) => !r.id);

    if (hasCollectionRejection) {
      // Whole-collection rejection (e.g. consent_required with no id):
      // re-enqueue everything — we can't distinguish individual rows.
      store.reEnqueueChangeset(changes);
    } else {
      // Per-record rejections: re-enqueue only the affected rows.
      const rejectedIds = new Set(result.rejected.map((r) => r.id!));
      const si = changes.supplyItems;
      if (si) {
        const requeue: SyncChangeSet = {
          supplyItems: {
            created: si.created.filter((item) => rejectedIds.has(item.id)),
            updated: si.updated.filter((item) => rejectedIds.has(item.id)),
            deleted: si.deleted.filter((id) => rejectedIds.has(id)),
          },
        };
        store.reEnqueueChangeset(requeue);
      }
    }
  }

  return result;
}
