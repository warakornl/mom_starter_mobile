/**
 * lossOptimisticApply — the loss verb's NEW client-side optimistic-apply
 * producer (functional-spec §7.1/§7.2, architecture §6 BLOCKER-1 correction).
 *
 * Today, the flip to `lifecycle: 'ended'` only ever arrives via a server
 * round-trip (HomeTabScreen's post-focus GET adopting the server's `ended`).
 * That producer does not exist offline. This module is the missing piece:
 * given the current raw ProfileSnapshot + cached consent state + the loss
 * form input, it decides (pure, no I/O) whether to:
 *   - 'apply'            — flip the raw snapshot to 'ended' + build the
 *                           profileVerbQueue enqueue params (caller then
 *                           calls setSnapshot() + profileVerbQueue.enqueue()
 *                           atomically, OR-INV-8).
 *   - 'consent_required'  — FAIL-CLOSED: consent is locally known-withdrawn.
 *                           No flip, no enqueue (G-OR-1..3 / §17.4).
 *   - 'suppress'          — the previous snapshot is null. Per §17.8/GAP-2,
 *                           a null snapshot never renders a loss as pregnant
 *                           and this producer never fabricates one out of
 *                           nothing — the caller must already have a loaded
 *                           snapshot before offering the loss confirm at all.
 *
 * RED-LINE (non-negotiable): the predicate/mutation is the LITERAL string
 * 'ended' — never any other enum, never a computed/derived value that could
 * silently diverge. This module NEVER falls back to the pregnant state via
 * a nullish-coalescing default anywhere — a missing/null snapshot is handled
 * by the explicit 'suppress' branch above, NOT by defaulting the lifecycle
 * field. This is enforced by both the runtime assertions and a static
 * source-scan in lossOptimisticApply.test.ts.
 *
 * NO CELEBRATORY UI (SENS-2): this module produces data only — no UI.
 * idempotencyKey is NOT minted here (profileVerbQueue.enqueue mints it,
 * OR-INV-4) — this producer only supplies the verb/body/targetProfileId/
 * baseVersion/clientDate/intendedLifecycle the queue needs.
 */

import type { ProfileSnapshot } from './PregnancyProfileContext';
import type { EnqueueParams } from './profileVerbQueue';
import type { LossEventInput } from './types';

export interface BuildLossOptimisticApplyParams {
  /** The RAW previous snapshot (may be null — §17.8). NEVER defaulted. */
  prevSnapshot: ProfileSnapshot | null;
  /** Cached general_health consent state (same consentStore the rest of the app uses). */
  generalHealthConsented: boolean;
  targetProfileId: string;
  baseVersion: number;
  /** Raw form input — '' / omitted means "no date" (LOSS-INV-11, never mandatory). */
  lossDate: string;
  /** Device-local civil today, captured AT CONFIRM TIME (frozen, floating-civil). */
  clientDate: string;
}

export type LossOptimisticApplyResult =
  | {
      kind: 'apply';
      /** The new raw snapshot to pass to useProfileSnapshotSetter(). lifecycle
       * is the LITERAL string 'ended' — see module doc RED-LINE note. */
      optimisticSnapshot: ProfileSnapshot;
      /** The ORIGINAL raw snapshot, retained verbatim for rollback (OR-ROLL-1). */
      prevServerSnapshot: ProfileSnapshot;
      /** Params for profileVerbQueue.enqueue() — the queue mints id/seq/idempotencyKey. */
      enqueueParams: EnqueueParams;
    }
  | { kind: 'consent_required' }
  | { kind: 'suppress' };

export function buildLossOptimisticApply(
  params: BuildLossOptimisticApplyParams,
): LossOptimisticApplyResult {
  // §17.8 / GAP-2: a null previous snapshot fails toward suppress. This
  // function does NOT fabricate a snapshot — the caller must already have a
  // loaded profile before the loss confirm surface is reachable at all.
  if (params.prevSnapshot === null) {
    return { kind: 'suppress' };
  }

  // G-OR-1/2/3 / OR-INV-12: fail-closed on locally-known-withdrawn consent.
  // NO optimistic apply, NO enqueue — surface consent-required at confirm time.
  if (!params.generalHealthConsented) {
    return { kind: 'consent_required' };
  }

  const prevServerSnapshot: ProfileSnapshot = { ...params.prevSnapshot };

  const trimmedLossDate = params.lossDate.trim();
  const body: LossEventInput = trimmedLossDate.length > 0 ? { lossDate: trimmedLossDate } : {};

  // RED-LINE: the literal string 'ended' — raw, no nullish-coalescing fallback.
  const optimisticSnapshot: ProfileSnapshot = {
    ...params.prevSnapshot,
    lifecycle: 'ended',
  };

  const enqueueParams: EnqueueParams = {
    verb: 'loss_event',
    targetProfileId: params.targetProfileId,
    baseVersion: params.baseVersion,
    body: body as unknown as Record<string, unknown>,
    clientDate: params.clientDate,
    intendedLifecycle: 'ended',
  };

  return { kind: 'apply', optimisticSnapshot, prevServerSnapshot, enqueueParams };
}
