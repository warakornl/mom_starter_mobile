/**
 * lossOfflineApplyWiring — the real wiring RootNavigator's LossConfirm screen
 * calls from its `onOfflineApply` render-prop (direct-rest-offline-resilience
 * §7). Extracted so this wiring is independently testable against the REAL
 * module-level profileVerbQueue singleton — not a rig.
 *
 * Runs buildLossOptimisticApply (pure decision) then, iff it decides to
 * apply, performs the ATOMIC apply+enqueue (OR-INV-8):
 *   1. setSnapshot(optimisticSnapshot) — the raw flip to lifecycle:'ended'.
 *   2. profileVerbQueue.enqueue(...) + persist() — durable, survives kill.
 *   3. onNavigateSettled() — same navigation convention as a server-confirmed
 *      success (reset to MainTabs; HomeTabScreen's drainer is now live).
 *
 * On 'consent_required' or 'suppress', NONE of the three side-effects run —
 * the mother stays on the confirm screen (LossConfirmScreen's own consent/
 * error surface already covers this).
 */

import { buildLossOptimisticApply } from './lossOptimisticApply';
import { profileVerbQueue } from './profileVerbSyncSingleton';
import type { ProfileSnapshot } from './PregnancyProfileContext';

export interface RunLossOfflineApplyParams {
  prevSnapshot: ProfileSnapshot | null;
  baseVersion: number;
  lossDate: string;
  /** Device-local civil today AT CONFIRM TIME (frozen, floating-civil — §3.1).
   * Defaults to prevSnapshot.todayCivil only when omitted (test convenience);
   * production callers should pass localCivilToday() explicitly. */
  clientDate?: string;
  setSnapshot: (snapshot: ProfileSnapshot) => void;
  onNavigateSettled: () => void;
}

/**
 * Single-profile MVP sentinel (functional-spec §17.1) — ProfileSnapshot
 * carries no profile id; the queue's per-profile guards exist for a future
 * multi-profile mix, not exercised today.
 */
const SINGLE_PROFILE_ID = 'current';

export function runLossOfflineApply(params: RunLossOfflineApplyParams): void {
  const result = buildLossOptimisticApply({
    prevSnapshot: params.prevSnapshot,
    generalHealthConsented: params.prevSnapshot?.generalHealthConsented ?? false,
    targetProfileId: SINGLE_PROFILE_ID,
    baseVersion: params.baseVersion,
    lossDate: params.lossDate,
    clientDate: params.clientDate ?? params.prevSnapshot?.todayCivil ?? '',
  });

  if (result.kind !== 'apply') {
    return;
  }

  // Atomic apply+enqueue (OR-INV-8): never an 'ended' snapshot with no
  // queued entry.
  params.setSnapshot(result.optimisticSnapshot);
  profileVerbQueue.enqueue(result.enqueueParams);
  void profileVerbQueue.persist();

  params.onNavigateSettled();
}
