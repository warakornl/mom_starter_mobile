/**
 * performLogout — shared logout side-effect runner.
 *
 * Clears the auth tokens and EVERY health store (PDPA 1.1 appsec: no cross-account
 * data leak within one JS session), then runs onComplete (navigate away) LAST.
 * Every clear step is best-effort — a storage failure must never strand the user
 * in a half-logged-out state, so onComplete always runs.
 *
 * Callers (SettingsScreen) inject the real singleton stores; tests inject spies.
 */
export interface LogoutDeps {
  /** Clear the secure token storage (access + refresh). */
  clearTokens: () => Promise<void>;
  /** Reset the supply-items sync store. */
  resetSupplyStore: () => void;
  /** Reset the kick-count sessions sync store (MOTHER-health K-8). */
  resetKickCountStore: () => void;
  /** Reset the calendar (appointments/reminders) sync store. */
  resetCalendarStore: () => void;
  /** Reset the consent store (clears isGranted state so the next user starts fresh). */
  resetConsentStore?: () => void;
  /**
   * Clear the durable consent queue (in-memory + persisted).
   * Prevents a prior-session queued consent entry from being POSTed under the
   * next user's token on the next foreground drain (N1 — PDPA cross-user leak).
   */
  resetConsentQueue?: () => Promise<void>;
  /**
   * Reset the suggestion dismiss/snooze store (clears durable SecureStore too).
   * Prevents User A's dismissed/snoozed suggestions from appearing for User B
   * after a cold start (PDPA cross-account data leak — MUST clear on logout).
   */
  resetSuggestionStore?: () => void;
  /**
   * Reset the expenses sync store (financial data — cloud_storage gated).
   * Prevents User A's expense records from being visible to User B after
   * logout within the same JS session (PDPA cross-account isolation).
   */
  resetExpensesStore?: () => void;
  /**
   * Reset the self-log sync store (MOTHER-health SD-5 — general_health gated).
   * Prevents User A's self-log health data (weight, BP, swelling, lochia, symptom)
   * from leaking to User B after logout within the same JS session.
   * CRITICAL: a missing reset() here is a cross-account-leak bug (SD-5).
   * Required (not optional) — mirrors resetKickCountStore as a health-data isolation guard.
   */
  resetSelfLogStore: () => void;
  /**
   * Reset the medication plan sync store (MOTHER-health — general_health gated).
   * Prevents User A's medication plan data (name/dose ciphertext, schedule rules)
   * from leaking to User B after logout within the same JS session (SD-5).
   * CRITICAL: required (not optional) — same posture as resetSelfLogStore.
   */
  resetMedicationPlanStore: () => void;
  /**
   * Reset the medication log sync store (MOTHER-health — general_health gated).
   * Prevents User A's medication log data (taken/missed events, occurrence times)
   * from leaking to User B after logout within the same JS session (SD-5).
   * CRITICAL: required (not optional) — immutable events are still health data.
   */
  resetMedicationLogStore: () => void;
  /**
   * Reset the consumption mapping store (health→supply config, INV-ASD-9).
   * Prevents User A's activity→supply mapping config from leaking to User B
   * in the same JS session (PDPA SD-5 cross-account isolation).
   * Optional (backward-compat) — added alongside auto-stock-decrement feature.
   */
  resetConsumptionMappingStore?: () => void;
  /**
   * Reset the stock decrement marker store (on-device-only idempotency set,
   * INV-ASD-8). completionEventId is health-adjacent — NEVER logged (K-8/SD-5).
   * Clearing on logout prevents User A's skip-if-seen markers from suppressing
   * User B's first auto-decrement for the same event id (E-10 cross-account fence).
   * Optional (backward-compat) — added alongside auto-stock-decrement feature.
   */
  resetStockDecrementMarkerStore?: () => void;
  /** Clear the in-progress kick-count draft from secure store (best-effort). */
  clearKickCountDraft: () => Promise<void>;
  /** Runs LAST — navigate to the unauthenticated entry (e.g. Welcome). */
  onComplete: () => void;
}

export async function performLogout(deps: LogoutDeps): Promise<void> {
  try {
    await deps.clearTokens();
  } catch {
    // Token clear failure is non-fatal — continue clearing local state.
  }
  // Health-store isolation (order irrelevant — independent singletons). Each is
  // guarded so a synchronous throw in one still attempts the others and never
  // strands the user before onComplete.
  for (const reset of [deps.resetSupplyStore, deps.resetKickCountStore, deps.resetCalendarStore, deps.resetSelfLogStore, deps.resetMedicationPlanStore, deps.resetMedicationLogStore, ...(deps.resetConsentStore ? [deps.resetConsentStore] : []), ...(deps.resetSuggestionStore ? [deps.resetSuggestionStore] : []), ...(deps.resetExpensesStore ? [deps.resetExpensesStore] : []), ...(deps.resetConsumptionMappingStore ? [deps.resetConsumptionMappingStore] : []), ...(deps.resetStockDecrementMarkerStore ? [deps.resetStockDecrementMarkerStore] : [])]) {
    try {
      reset();
    } catch {
      // store reset failure is non-fatal
    }
  }
  await deps.clearKickCountDraft().catch(() => {
    // Draft clear is best-effort; never blocks logout.
  });
  if (deps.resetConsentQueue) {
    await deps.resetConsentQueue().catch(() => {
      // Queue clear is best-effort; never blocks logout.
    });
  }
  deps.onComplete();
}
