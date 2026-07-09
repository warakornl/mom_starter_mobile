/**
 * ForgotPasswordScreen (S5) — testable non-UI logic.
 *
 * Maps to: POST /v1/auth/forgot-password { email } → always 202 (non-enumerating)
 *
 * This module contains everything that can be unit-tested without React Native:
 *  - `forgotStrings`         — th/en copy for all screen states
 *  - `handleForgotPassword`  — submit handler; always success on 202; rate_limited on 429
 *  - `ForgotPasswordOutcome` — discriminated union (includes resendAt for cooldown UI)
 *  - `RESEND_COOLDOWN_MS`    — 60 s cooldown (same constant as verifyEmailScreenLogic)
 *
 * NON-ENUMERATION CONTRACT (SEC-INV-1 / §E/C7 / MI-9 — MUST NOT be broken):
 *   POST /auth/forgot-password returns 202 for BOTH existing AND non-existing emails
 *   (byte-identical response + timing, per api-contract.md §E). `handleForgotPassword`
 *   MUST return `{ kind: 'success' }` on 202 regardless of the response body. It MUST
 *   NOT inspect the body for existence hints. There is NEVER a `{ kind: 'email_not_found' }`
 *   outcome. The mandated unit test asserts `forgotStrings.th.confirmBody` does NOT
 *   contain 'บัญชี' (spec §2.4, MI-9).
 *
 * Security:
 *   - No token material is handled here (forgot is pre-token flow).
 *   - Email is passed to the API client; never logged here.
 */
import type { AuthClient } from './authApiClient';
import type { Locale } from './types';
import { catalog } from '../i18n/messages';

// ─── i18n strings ─────────────────────────────────────────────────────────────

/**
 * All strings used by the ForgotPasswordScreen (S5), in th and en.
 *
 * Derived from the central catalog (src/i18n/messages.ts).
 * SEC-INV-1 / MI-9 invariant:
 *   `confirmBody (th)` MUST NOT contain 'บัญชี' — enforced by
 *   `forgotPasswordScreenLogic.test.ts` and `messages.test.ts`.
 */
export const forgotStrings = {
  th: {
    navTitle:      catalog.th['forgot.navTitle'],
    title:         catalog.th['forgot.title'],
    subtitle:      catalog.th['forgot.subtitle'],
    emailLabel:    catalog.th['forgot.emailLabel'],
    emailPlaceholder: catalog.th['forgot.emailPlaceholder'],
    emailHint:     catalog.th['forgot.emailHint'],
    submit:        catalog.th['forgot.submit'],
    confirmTitle:  catalog.th['forgot.confirmTitle'],
    /**
     * SEC-INV-1 NON-ENUMERATING — must NOT hint at email existence.
     * Shown identically whether or not the email has an account.
     * Assertion: not.toContain('บัญชี').
     */
    confirmBody:   catalog.th['forgot.confirmBody'],
    resend:        catalog.th['forgot.resend'],
    backToLogin:   catalog.th['forgot.backToLogin'],
    rateLimited:   catalog.th['forgot.rateLimited'],
    offline:       catalog.th['forgot.offline'],
    serverError:   catalog.th['forgot.serverError'],
  },
  en: {
    navTitle:      catalog.en['forgot.navTitle'],
    title:         catalog.en['forgot.title'],
    subtitle:      catalog.en['forgot.subtitle'],
    emailLabel:    catalog.en['forgot.emailLabel'],
    emailPlaceholder: catalog.en['forgot.emailPlaceholder'],
    emailHint:     catalog.en['forgot.emailHint'],
    submit:        catalog.en['forgot.submit'],
    confirmTitle:  catalog.en['forgot.confirmTitle'],
    confirmBody:   catalog.en['forgot.confirmBody'],
    resend:        catalog.en['forgot.resend'],
    backToLogin:   catalog.en['forgot.backToLogin'],
    rateLimited:   catalog.en['forgot.rateLimited'],
    offline:       catalog.en['forgot.offline'],
    serverError:   catalog.en['forgot.serverError'],
  },
} satisfies Record<Locale, Record<string, string>>;

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Cooldown duration in milliseconds after a successful submit/resend.
 * The screen disables the resend button until `Date.now() >= resendAt`.
 * Matches `verifyEmailScreenLogic.RESEND_COOLDOWN_MS` (60 s).
 */
export const RESEND_COOLDOWN_MS = 60_000;

// ─── Outcome type ─────────────────────────────────────────────────────────────

/**
 * Outcome of a forgot-password submit or resend attempt.
 *
 * On `success`, `resendAt` is the earliest timestamp (ms since epoch) at which
 * the screen should re-enable the resend button. The screen drives the cooldown
 * UI — this module does NOT start any timer (side-effect free).
 *
 * NON-ENUMERATION: there is NEVER a `{ kind: 'email_not_found' }` variant.
 * Both the "email exists" and "email doesn't exist" paths receive `{ kind: 'success' }`.
 */
export type ForgotPasswordOutcome =
  | { kind: 'success'; resendAt: number }      // 202 → show confirmation + cooldown
  | { kind: 'rate_limited' }                   // 429 → calm "ลองใหม่ภายหลัง"
  | { kind: 'network_error' }                  // fetch threw → offline strip
  | { kind: 'server_error'; code: string };    // 400 @Valid / 500 / unexpected

// ─── Submit handler ───────────────────────────────────────────────────────────

/**
 * ForgotPassword submit handler (pure, DI'd, unit-testable).
 *
 * Mirrors the `handleResend` pattern from `verifyEmailScreenLogic`:
 *   - Always returns `success` on 202 without body inspection (SEC-INV-1).
 *   - fetch throws → `network_error` (offline/aborted).
 *   - 429 → `rate_limited` (SEC-INV-7 — no counter exposed).
 *   - 400 @Valid → `server_error` (form gate normally prevents this; spec §2.4).
 *   - 500/unexpected → `server_error`.
 *
 * @param nowFn  Injectable clock (default `Date.now`). Inject in tests.
 */
export async function handleForgotPassword(params: {
  email: string;
  client: Pick<AuthClient, 'forgotPassword'>;
  nowFn?: () => number;
}): Promise<ForgotPasswordOutcome> {
  const { email, client, nowFn = Date.now } = params;

  let result: Awaited<ReturnType<AuthClient['forgotPassword']>>;
  try {
    result = await client.forgotPassword({ email });
  } catch {
    // fetch threw — no network or request aborted
    return { kind: 'network_error' };
  }

  if (result.ok) {
    // 202 — ALWAYS success (non-enumerating, SEC-INV-1).
    // Do NOT inspect the body for existence hints.
    return { kind: 'success', resendAt: nowFn() + RESEND_COOLDOWN_MS };
  }

  // Map error codes to screen outcomes
  switch (result.code) {
    case 'rate_limited':
      // 429 — calm "ส่งบ่อยเกินไป · ลองใหม่ภายหลัง" (SEC-INV-7, no counter)
      return { kind: 'rate_limited' };

    default:
      // 400 @Valid (blank body — submit gate normally prevents this)
      // 500 or any other unexpected code
      return { kind: 'server_error', code: result.code };
  }
}
