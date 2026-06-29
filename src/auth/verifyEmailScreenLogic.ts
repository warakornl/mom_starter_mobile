/**
 * Verify-email / Check-inbox screen — testable non-UI logic.
 *
 * Maps to:
 *   POST /v1/auth/resend-verification → always 202 (non-enumerating, §E/§G)
 *   POST /v1/auth/verify-email        → 200 AuthTokens | 410 verify_token_invalid
 *
 * This module contains everything that can be unit-tested without React Native:
 *  - `verifyStrings`        — th/en copy for all screen states
 *  - `handleResend`         — resend handler; always success on 202; rate_limited on 429
 *  - `handleVerifyToken`    — deep-link token handler; stores tokens on 200; typed errors
 *  - `ResendOutcome`        — discriminated union (includes resendAt for cooldown UI)
 *  - `VerifyTokenOutcome`   — discriminated union for deep-link verify
 *  - `RESEND_COOLDOWN_MS`   — exported constant for the screen's cooldown countdown
 *
 * Design notes:
 * - `handleResend` always returns `{ kind: 'success' }` on 202 regardless of whether
 *   the email exists or is already verified — non-enumerating posture (§E/C7).
 * - `handleVerifyToken` separates the network try-catch from the storage try-catch:
 *   fetch throws → `network_error`; storage.save() throws → `server_error`.
 *   This prevents the loading spinner from getting stuck on Keychain/Keystore failure
 *   (lesson from the login slice review).
 * - Resend cooldown: on success the function returns `{ kind: 'success', resendAt }`
 *   where `resendAt = nowFn() + RESEND_COOLDOWN_MS`. The screen drives the countdown
 *   UI; no timer is started inside this module (keeps it side-effect free).
 * - Deep-link integration: `handleVerifyToken` is called by the screen when the
 *   navigator intercepts a verification URL (Expo Linking). Extracting the `token`
 *   param from the URL scheme (e.g. "momstarter://verify?token=...") is an Expo
 *   Linking concern and is NOT handled here — that is a carry-forward for the Expo
 *   scaffold slice.
 */
import type { AuthClient } from './authApiClient';
import type { TokenStorage } from './tokenStorage';
import type { Locale } from './types';
import { catalog } from '../i18n/messages';

// ─── i18n strings ─────────────────────────────────────────────────────────────

/**
 * All strings used by the Check-inbox / Verify-email screen.
 *
 * Derived from the central catalog (src/i18n/messages.ts).
 * Shape preserved exactly for test compatibility:
 *   - verify.title (th)         → must contain 'อีเมล'
 *   - verify.resentConfirm (th) → must NOT contain 'มีบัญชี', 'ถูกลงทะเบียน' (§E/C7)
 *   - verify.tokenInvalid (th)  → must have length > 0
 */
export const verifyStrings = {
  th: {
    title: catalog.th['verify.title'],
    stepLabel: catalog.th['verify.stepLabel'],
    sentToPrefix: catalog.th['verify.sentToPrefix'],
    openLinkHint: catalog.th['verify.openLinkHint'],
    spamTip: catalog.th['verify.spamTip'],
    resend: catalog.th['verify.resend'],
    /**
     * Shown after a successful resend — non-enumerating.
     * Same copy whether the email is new, colliding, or already verified.
     * Must NOT say "resent to your email" in a way that confirms existence (§E/C7).
     */
    resentConfirm: catalog.th['verify.resentConfirm'],
    changeEmail: catalog.th['verify.changeEmail'],
    /** 429 — rate limited on resend. */
    rateLimited: catalog.th['verify.rateLimited'],
    /** 410 verify_token_invalid (deep-link verify). */
    tokenInvalid: catalog.th['verify.tokenInvalid'],
    offline: catalog.th['verify.offline'],
    serverError: catalog.th['verify.serverError'],
  },
  en: {
    title: catalog.en['verify.title'],
    stepLabel: catalog.en['verify.stepLabel'],
    sentToPrefix: catalog.en['verify.sentToPrefix'],
    openLinkHint: catalog.en['verify.openLinkHint'],
    spamTip: catalog.en['verify.spamTip'],
    resend: catalog.en['verify.resend'],
    resentConfirm: catalog.en['verify.resentConfirm'],
    changeEmail: catalog.en['verify.changeEmail'],
    rateLimited: catalog.en['verify.rateLimited'],
    tokenInvalid: catalog.en['verify.tokenInvalid'],
    offline: catalog.en['verify.offline'],
    serverError: catalog.en['verify.serverError'],
  },
} satisfies Record<Locale, Record<string, string>>;

// ─── Resend handler ───────────────────────────────────────────────────────────

/**
 * Cooldown duration in milliseconds after a successful resend.
 * The screen disables the resend button until `Date.now() >= resendAt`.
 */
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * Outcome of a resend-verification attempt.
 *
 * On `success`, `resendAt` is the earliest timestamp (ms since epoch) at which
 * the screen should re-enable the resend button. The screen drives the countdown
 * UI — this module does NOT start a timer or hold state (side-effect free).
 */
export type ResendOutcome =
  | { kind: 'success'; resendAt: number }   // 202 → show resentConfirm, disable until resendAt
  | { kind: 'rate_limited' }                // 429 → gentle "try again in a moment"
  | { kind: 'network_error' }              // fetch threw
  | { kind: 'server_error'; code: string }; // unexpected

/**
 * Resend-verification handler for the Check-inbox screen.
 *
 * Non-enumeration: always returns `success` on 202 — does NOT reveal whether
 * the email exists or is already verified (§E/C7, same posture as forgotPassword).
 *
 * Cooldown: on success, `resendAt = nowFn() + RESEND_COOLDOWN_MS`.
 * The screen disables the button until that time has passed.
 *
 * @param nowFn — injectable clock, defaults to `Date.now`. Inject in tests to avoid
 *   relying on real time.
 */
export async function handleResend(params: {
  email: string;
  client: Pick<AuthClient, 'resendVerification'>;
  nowFn?: () => number;
}): Promise<ResendOutcome> {
  const { email, client, nowFn = Date.now } = params;

  let result: Awaited<ReturnType<AuthClient['resendVerification']>>;
  try {
    result = await client.resendVerification({ email });
  } catch {
    // fetch threw — no network or request aborted
    return { kind: 'network_error' };
  }

  if (result.ok) {
    // 202 — always success (non-enumerating, §E/C7)
    return { kind: 'success', resendAt: nowFn() + RESEND_COOLDOWN_MS };
  }

  if (result.code === 'rate_limited') {
    return { kind: 'rate_limited' };
  }

  return { kind: 'server_error', code: result.code };
}

// ─── Verify-token handler (deep-link) ────────────────────────────────────────

/**
 * Outcome of handling the deep-link verification token.
 * On `success`, tokens have been stored in secure storage.
 */
export type VerifyTokenOutcome =
  | { kind: 'success' }                     // 200 → tokens stored → navigate to home/consent
  | { kind: 'token_invalid' }              // 410 verify_token_invalid → prompt to resend
  | { kind: 'network_error' }              // fetch threw
  | { kind: 'server_error'; code: string }; // unexpected (incl. 429, 422, or storage failure)

/**
 * Handles the email-verification deep-link token.
 *
 * Called by the screen (or navigator) when Expo Linking intercepts a
 * verification URL (e.g. "momstarter://verify?token=...") and passes the
 * extracted `token` string here.
 *
 * On success:
 * 1. Calls `verifyEmail` to exchange the one-time token for the FIRST session.
 * 2. Stores the returned `AuthTokens` in secure storage (Keychain/Keystore).
 * 3. Returns `{ kind: 'success' }` so the screen navigates to home/consent.
 *
 * Security — separate try-catch for network vs. storage:
 * - fetch throws → `network_error` (no session minted, nothing stored)
 * - storage.save() throws → `server_error` with code 'storage_error'
 *   (prevents the loading spinner from getting stuck on Keychain failure)
 * - On any error: tokens are NOT stored (no partial state)
 *
 * Expo Linking carry-forward: extracting `token` from the URL scheme is an
 * Expo/navigation concern handled outside this function.
 */
export async function handleVerifyToken(params: {
  token: string;
  deviceId?: string;
  client: Pick<AuthClient, 'verifyEmail'>;
  storage: TokenStorage;
}): Promise<VerifyTokenOutcome> {
  const { token, deviceId, client, storage } = params;

  // ── 1. Network call ─────────────────────────────────────────────────────────
  let result: Awaited<ReturnType<AuthClient['verifyEmail']>>;
  try {
    result = await client.verifyEmail({ token, deviceId });
  } catch {
    // fetch threw — treat as offline / connection failure
    return { kind: 'network_error' };
  }

  // ── 2. Map API errors ────────────────────────────────────────────────────────
  if (!result.ok) {
    switch (result.code) {
      case 'verify_token_invalid':
        // 410 — bad/expired/used token; single generic code (§E, avoids oracle)
        return { kind: 'token_invalid' };
      default:
        // 429 rate_limited, 422, 500, or other unexpected code
        return { kind: 'server_error', code: result.code };
    }
  }

  // ── 3. Store tokens (separate try-catch — prevents stuck spinner on Keychain error) ──
  try {
    await storage.save(result.tokens);
  } catch {
    // Keychain/Keystore failure — return server_error (not network_error) because
    // the network call succeeded; the failure is on the local secure-storage layer.
    return { kind: 'server_error', code: 'storage_error' };
  }

  return { kind: 'success' };
}
