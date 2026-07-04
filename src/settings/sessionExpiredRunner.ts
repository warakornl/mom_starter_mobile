/**
 * sessionExpiredRunner — thin, injectable factory for the SD-5 session-expired teardown.
 *
 * SD-5 FIX: When export or delete returns a 401, the session-expired path MUST run the
 * full performLogout teardown (clearTokens + ALL health stores) BEFORE navigating to
 * Welcome. The prior code called onSessionExpired() directly (navigate-only), leaving
 * tokens and every health SyncStore populated — a cross-account PHI leak if a different
 * user signed in on the same device without an app restart.
 *
 * This factory accepts all LogoutDeps explicitly (no singleton imports) so tests can
 * inject mock deps without jest.mock on store singletons — mirroring performLogout.ts.
 *
 * Usage in SettingsScreen.handleSessionExpired (option b fix):
 *   buildSessionExpiredRunner({
 *     clearTokens: () => tokenStorage.clear(),
 *     resetSupplyStore: () => supplySyncStore.reset(),
 *     ...all health stores...,
 *     onComplete: onSessionExpired ?? onLogout,   // navigate callback, called LAST
 *   })();
 *
 * Both export-401 and delete-401 route through handleSessionExpired:
 *   export-401: runExportFlow → case 'session_expired' → handleSessionExpired()
 *   delete-401: handleConfirmTap → isSessionExpiredCode(code) → handleSessionExpired()
 *
 * No double-teardown: runDeleteGate calls performLogout ONLY on HTTP 202 (delete_success),
 * which is a separate code path that never calls handleSessionExpired.
 */

import { performLogout, type LogoutDeps } from '../auth/performLogout';

/**
 * Builds the session-expired teardown runner.
 *
 * @param deps — full LogoutDeps: clearTokens + ALL health stores + onComplete (navigate).
 *              onComplete is called LAST — after every token + store clear — and should
 *              perform navigation to Welcome (onSessionExpired ?? onLogout).
 * @returns An async runner; call it immediately: `void buildSessionExpiredRunner(deps)();`
 */
export function buildSessionExpiredRunner(deps: LogoutDeps): () => Promise<void> {
  return () => performLogout(deps);
}
