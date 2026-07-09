/**
 * Reset-password deep-link handling — pure URL parser + in-memory token store.
 *
 * ## Security (MI-1…MI-5 / SD-9)
 *
 * MI-1: The reset token is held ONLY in `resetTokenStore.current` — a plain
 *   module-level ref. It is NEVER placed in React Navigation route params, never
 *   serialised into nav-state, never written to AsyncStorage/SecureStore/MMKV.
 *
 * MI-2: `parseResetToken` intentionally does NOT receive the full URL — callers
 *   pass the already-parsed query string so the raw URL (which contains the token)
 *   is never logged, never passed to analytics, and does not appear in stack traces
 *   or crash-report breadcrumbs. The caller (initResetDeepLink in App.tsx) silently
 *   discards the URL after extraction.
 *   NOTE: `parseResetTokenFromUrl` IS provided for the navigator's convenience but
 *   the contract is the same — callers MUST NOT log the URL or the returned token.
 *
 * MI-5: `clearResetToken` must be called by the navigator on:
 *   (a) 204 success (token consumed by server),
 *   (b) 410 token_invalid (token rejected; route to ForgotPassword),
 *   (c) Screen unmount (user navigated away without submitting).
 *   After clearing, the value is `undefined` and any subsequent render of
 *   ResetPasswordScreen shows the `missing_token` state.
 *
 * ## Deep-link scheme
 *
 * Custom scheme (MVP):   `momstarter://reset-password?token=<RAW_TOKEN>`
 * HTTPS universal link:  `https://<app-domain>/reset-password?token=<RAW_TOKEN>`
 *   (carry-forward: cloud-infra sets up assetlinks.json / apple-app-site-association)
 *
 * ## Expo Go caveat (spec §4.3)
 *
 * Custom-scheme and HTTPS universal-link deep-links are NOT fully exercisable in
 * Expo Go for a standalone custom scheme. Cold-start `getInitialURL` + HTTPS app
 * links require a **dev build** (`expo prebuild` / EAS dev client). Plan UAT
 * deep-link testing on a dev build, not Expo Go.
 */

// ─── In-memory token store (MI-1 / SD-9) ─────────────────────────────────────

/**
 * Module-level in-memory store for the reset token.
 *
 * Written ONLY by the deep-link handler (App.tsx / initResetDeepLink).
 * Read ONLY by StackNavigator when rendering ResetPasswordScreen.
 * Cleared by the navigator on success / 410 / unmount (MI-5).
 *
 * This is the "SD-9 ref" pattern (matching ancPrefillRef) but at module scope
 * because the writer (App.tsx Linking handler) and the reader (StackNavigator)
 * live in different component trees.
 */
export const resetTokenStore: { current: string | undefined } = { current: undefined };

export function setResetToken(token: string): void {
  resetTokenStore.current = token;
}

export function clearResetToken(): void {
  resetTokenStore.current = undefined;
}

// ─── URL parser ───────────────────────────────────────────────────────────────

/**
 * Parse the reset token from a deep-link URL.
 *
 * Supports:
 *   `momstarter://reset-password?token=<TOKEN>`
 *   `https://<domain>/reset-password?token=<TOKEN>`
 *
 * Returns `undefined` for any URL that is not a reset-password link or has no
 * token. Never throws.
 *
 * MI-2 contract: callers MUST NOT log the `url` parameter or the return value.
 * This function does not log either.
 */
export function parseResetTokenFromUrl(url: string): string | undefined {
  // SECURITY: do NOT log `url` — it contains the token in the query string.
  if (!url || !url.includes('reset-password')) return undefined;

  // Extract query string without using URL/URLSearchParams (RN Hermes compatibility)
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return undefined;

  const queryString = url.slice(queryStart + 1);

  // Parse token= from query string
  const pairs = queryString.split('&');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx);
    if (key !== 'token') continue;
    try {
      const value = decodeURIComponent(pair.slice(eqIdx + 1));
      if (value.trim()) return value.trim();
    } catch {
      return undefined;
    }
  }

  return undefined;
}
