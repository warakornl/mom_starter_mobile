/**
 * ResetPasswordScreen — testable non-UI logic.
 *
 * Maps to: POST /v1/auth/reset-password { token, newPassword } → 204 success
 *
 * This module contains everything that can be unit-tested without React Native:
 *  - `resetStrings`          — th/en copy for all screen states
 *  - `validateNewPassword`   — client-side gate (non-empty + ≥8 + confirm-match)
 *  - `handleResetPassword`   — submit handler (pure, DI'd)
 *  - `ResetPasswordOutcome`  — discriminated union for all state transitions
 *
 * State transitions (spec §3.3):
 *   204 → success → (caller: performLogout if session exists, then → Login + toast)
 *   410 reset_token_invalid → token_invalid → (caller: navigate to ForgotPassword)
 *   422 password_too_short|password_breached → validation → (stay, same token)
 *   429 rate_limited → rate_limited → (stay, same token)
 *   throw → network_error → (stay, same token)
 *   400 @Valid / 500 → server_error → (stay, same token, one retry allowed)
 *   empty token → missing_token → (no API call, MI-6)
 *
 * Security requirements (MI-1…MI-9):
 *   MI-6: empty/missing token → return missing_token, never call API.
 *   MI-7: on success, if a local session exists → clear tokens (the full
 *         performLogout SD-5 teardown is the CALLER's responsibility — this
 *         module only clears the auth tokens; the screen/navigator must also
 *         reset all health stores and run onComplete → Login with toast).
 *   MI-8: 410 is the ONLY outcome where the token is "consumed/done";
 *         422/429/network/server_error → token still valid → stay on screen.
 *   MI-9: n/a (forgot-password concern); reset has no non-enumeration copy.
 *
 * Token security (MI-1…MI-5):
 *   The token parameter is NEVER logged, never stored, never put in route params.
 *   It is received as a param, used once, and the caller (navigator) clears the
 *   module-level ref after this function returns (on success, 410, or unmount).
 */
import type { AuthClient } from './authApiClient';
import type { TokenStorage } from './tokenStorage';
import type { Locale } from './types';
import { catalog } from '../i18n/messages';

// ─── i18n strings ─────────────────────────────────────────────────────────────

/**
 * All strings used by the ResetPasswordScreen, in th and en.
 *
 * Derived from the central catalog (src/i18n/messages.ts).
 * SEC-INV-2 invariant: `tokenInvalid` is ONE generic message — never explains
 * wrong/expired/used distinction.
 * SEC-INV-4 invariant: `revokeNotice` is shown pre-submit to warn about
 * all-device sign-out.
 */
export const resetStrings = {
  th: {
    navTitle:          catalog.th['reset.navTitle'],
    title:             catalog.th['reset.title'],
    newPasswordLabel:  catalog.th['reset.newPasswordLabel'],
    confirmLabel:      catalog.th['reset.confirmLabel'],
    passwordHint:      catalog.th['reset.passwordHint'],
    /** SEC-INV-4: warn user their devices will be signed out. */
    revokeNotice:      catalog.th['reset.revokeNotice'],
    submit:            catalog.th['reset.submit'],
    successToast:      catalog.th['reset.successToast'],
    /** SEC-INV-2: one generic message, never explains wrong/expired/used. */
    tokenInvalid:      catalog.th['reset.tokenInvalid'],
    requestNewLink:    catalog.th['reset.requestNewLink'],
    linkMissing:       catalog.th['reset.linkMissing'],
    passwordTooShort:  catalog.th['reset.passwordTooShort'],
    passwordBreached:  catalog.th['reset.passwordBreached'],
    mismatch:          catalog.th['reset.mismatch'],
    rateLimited:       catalog.th['reset.rateLimited'],
    offline:           catalog.th['reset.offline'],
    serverError:       catalog.th['reset.serverError'],
  },
  en: {
    navTitle:          catalog.en['reset.navTitle'],
    title:             catalog.en['reset.title'],
    newPasswordLabel:  catalog.en['reset.newPasswordLabel'],
    confirmLabel:      catalog.en['reset.confirmLabel'],
    passwordHint:      catalog.en['reset.passwordHint'],
    revokeNotice:      catalog.en['reset.revokeNotice'],
    submit:            catalog.en['reset.submit'],
    successToast:      catalog.en['reset.successToast'],
    tokenInvalid:      catalog.en['reset.tokenInvalid'],
    requestNewLink:    catalog.en['reset.requestNewLink'],
    linkMissing:       catalog.en['reset.linkMissing'],
    passwordTooShort:  catalog.en['reset.passwordTooShort'],
    passwordBreached:  catalog.en['reset.passwordBreached'],
    mismatch:          catalog.en['reset.mismatch'],
    rateLimited:       catalog.en['reset.rateLimited'],
    offline:           catalog.en['reset.offline'],
    serverError:       catalog.en['reset.serverError'],
  },
} satisfies Record<Locale, Record<string, string>>;

// ─── Client-side validation ───────────────────────────────────────────────────

/**
 * Validation result for the new-password form.
 *   null      — all gates pass (submit enabled)
 *   'empty'   — newPassword is empty
 *   'too_short' — newPassword < 8 characters (soft mirror of PasswordPolicy.MIN_LENGTH)
 *   'mismatch'  — newPassword !== confirm
 *
 * NOTE: breached-password check is server-only (422 password_breached). Never
 * attempt it client-side (spec §3.4).
 */
export type NewPasswordValidation = null | 'empty' | 'too_short' | 'mismatch';

/**
 * Client-side gate for the Reset-password form (spec §3.4).
 *
 * Gates (in order):
 *   1. Non-empty — matches `validatePasswordField` from registerScreenLogic.
 *   2. Length ≥ 8 — soft mirror of `PasswordPolicy.MIN_LENGTH`. Advisory only:
 *      if the constant ever changes, the server is the source of truth.
 *   3. Passwords match — client-only gate (API takes a single `newPassword`).
 */
export function validateNewPassword(params: {
  newPassword: string;
  confirm: string;
}): NewPasswordValidation {
  const { newPassword, confirm } = params;
  if (newPassword.length === 0) return 'empty';
  if (newPassword.length < 8) return 'too_short';
  if (newPassword !== confirm) return 'mismatch';
  return null;
}

// ─── Outcome type ─────────────────────────────────────────────────────────────

/**
 * All possible outcomes of a reset-password submit (spec §3.3).
 *
 * Routing rules (enforced by caller/screen):
 *   success      → (if session exists: performLogout SD-5 teardown) → Login + toast
 *   token_invalid → navigate to ForgotPassword (410, SEC-INV-2)
 *   validation   → stay on ResetPasswordScreen, token still valid (422, SEC-INV-6)
 *   rate_limited → stay on ResetPasswordScreen, token still valid (429, SEC-INV-6)
 *   network_error → stay on ResetPasswordScreen, token still valid (SEC-INV-6)
 *   server_error → stay on ResetPasswordScreen, allow one retry (SEC-INV-6)
 *   missing_token → show linkMissing state, button → ForgotPassword (MI-6)
 */
export type ResetPasswordOutcome =
  | { kind: 'success' }                                                         // 204
  | { kind: 'token_invalid' }                                                   // 410 reset_token_invalid
  | { kind: 'validation'; code: 'password_too_short' | 'password_breached' }   // 422
  | { kind: 'rate_limited' }                                                    // 429
  | { kind: 'network_error' }                                                   // fetch threw
  | { kind: 'server_error'; code: string }                                      // 400/500/unexpected
  | { kind: 'missing_token' };                                                  // empty token, no API call

// ─── Submit handler ───────────────────────────────────────────────────────────

/**
 * Reset-password submit handler (pure, DI'd, unit-testable).
 *
 * Security invariants:
 *   MI-6: if token is empty/blank → return missing_token immediately, no API call.
 *   MI-7: on success, if tokenStorage has a session → clear tokens so the old
 *         (now-revoked-by-server) session doesn't linger. The caller is then
 *         responsible for the full SD-5 teardown (reset all health stores) and
 *         navigation to Login + toast.
 *   MI-8: 410 only → { kind: 'token_invalid' }; all other errors stay on screen.
 *         Token is NEVER "burned" by 422/429/network/server_error (SEC-INV-6).
 *
 * NEVER log the token or the newPassword.
 */
export async function handleResetPassword(params: {
  token: string;
  newPassword: string;
  client: Pick<AuthClient, 'resetPassword'>;
  tokenStorage: TokenStorage;
}): Promise<ResetPasswordOutcome> {
  const { token, newPassword, client, tokenStorage } = params;

  // MI-6: empty/blank token → never call API
  if (!token || !token.trim()) {
    return { kind: 'missing_token' };
  }

  // ── 1. Network call ─────────────────────────────────────────────────────────
  let result: Awaited<ReturnType<AuthClient['resetPassword']>>;
  try {
    result = await client.resetPassword({ token, newPassword });
  } catch {
    // fetch threw — no network or request aborted.
    // Token is untouched (no server call reached) — caller MUST stay on screen.
    return { kind: 'network_error' };
  }

  // ── 2. Map API result ────────────────────────────────────────────────────────

  if (result.ok) {
    // 204 success — reset revokes ALL refresh families on every device (SEC-INV-4).
    // If the local session exists, clear the auth tokens now. The caller (screen/
    // navigator) must also run the full SD-5 health-store teardown (MI-7).
    try {
      const existing = await tokenStorage.load();
      if (existing !== null) {
        await tokenStorage.clear();
      }
    } catch {
      // Token clear failure is non-fatal — success still routes to Login.
      // The server has already revoked the session; a stale local token is harmless.
    }
    return { kind: 'success' };
  }

  // ── 3. Error mapping (SEC-INV-6: 410 only → leave; others → stay) ───────────

  switch (result.code) {
    case 'reset_token_invalid':
      // 410 — bad/expired/used token; single generic code (SEC-INV-2).
      // Token is consumed/invalidated server-side. Caller routes to ForgotPassword.
      return { kind: 'token_invalid' };

    case 'password_too_short':
    case 'password_breached':
      // 422 appsec policy — validate before consume, so token is NOT burned (SEC-INV-6).
      // Caller stays on ResetPasswordScreen with the same token.
      return { kind: 'validation', code: result.code };

    case 'rate_limited':
      // 429 — rate-limit runs before consume; token still valid (SEC-INV-6 / MI-8).
      return { kind: 'rate_limited' };

    default:
      // 400 @Valid (blank/malformed body — client gate normally prevents this;
      //   token NOT consumed, one retry allowed, spec §3.5).
      // 500 or any other unexpected code.
      // Caller stays on ResetPasswordScreen with the same token.
      return { kind: 'server_error', code: result.code };
  }
}
