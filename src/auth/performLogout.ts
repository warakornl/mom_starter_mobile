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
  // Health-store isolation (order irrelevant — independent singletons).
  deps.resetSupplyStore();
  deps.resetKickCountStore();
  deps.resetCalendarStore();
  await deps.clearKickCountDraft().catch(() => {
    // Draft clear is best-effort; never blocks logout.
  });
  deps.onComplete();
}
