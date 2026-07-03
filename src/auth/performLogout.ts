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
  for (const reset of [deps.resetSupplyStore, deps.resetKickCountStore, deps.resetCalendarStore, ...(deps.resetConsentStore ? [deps.resetConsentStore] : []), ...(deps.resetSuggestionStore ? [deps.resetSuggestionStore] : [])]) {
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
