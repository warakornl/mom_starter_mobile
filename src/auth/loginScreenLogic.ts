/**
 * Login screen (S4) — testable non-UI logic.
 *
 * This module contains everything that can be unit-tested without React Native:
 *  - `loginStrings`        — th/en copy for all screen states
 *  - `validateEmailField`  — input-sanity check (blur-time, non-blaming)
 *  - `validatePasswordField` — non-empty check (appsec policy is a SEC-HOOK)
 *  - `handleSignIn`        — submit handler (injected API client + storage)
 *  - `SignInOutcome`       — discriminated union for the screen to render
 *
 * Design notes:
 * - Copy follows auth-login-ui.md §7.2 exactly: three visually distinct states
 *   (offline strip · server card · wrong-credentials inline), each non-blaming.
 * - `validateEmailField` returns a key into `loginStrings.<locale>` so the
 *   screen can look up the right language without a separate lookup map.
 * - `handleSignIn` uses dependency injection so tests never touch fetch or
 *   secure storage directly.
 * - Non-enumerating contract: `invalid_credentials` covers both "no such email"
 *   and "wrong password" — the copy MUST be the same in both cases (§E/C7).
 */
import type { TokenStorage } from './tokenStorage';
import type { AuthClient } from './authApiClient';
import type { Locale } from './types';
import { catalog } from '../i18n/messages';

// ─── i18n strings ─────────────────────────────────────────────────────────────

/**
 * All strings used by the Sign-in screen (S4), in th and en.
 *
 * Derived from the central catalog (src/i18n/messages.ts).
 * The shape is preserved exactly so existing tests continue to pass:
 *   loginStrings.th.wrongCredentials  → must contain 'รีเซ็ต' (§E/C7)
 *   loginStrings.en.wrongCredentials  → must contain 'reset', not enumerate
 */
export const loginStrings = {
  th: {
    title: catalog.th['login.title'],
    emailLabel: catalog.th['login.emailLabel'],
    passwordLabel: catalog.th['login.passwordLabel'],
    /** Primary action button label. */
    submit: catalog.th['login.submit'],
    /** Quiet link below the form → Forgot password (S5). Always visible. */
    forgotPassword: catalog.th['login.forgotPassword'],
    /** Quiet link → Sign-up (S2). */
    createAccount: catalog.th['login.createAccount'],
    /**
     * Inline message under the password field on 401 invalid_credentials.
     * §E/C7: NON-ENUMERATING — same copy whether the email doesn't exist
     * or the password is wrong. Never says "we don't know that email."
     * Includes a reset link per auth-login-ui.md §7.2.
     */
    wrongCredentials: catalog.th['login.wrongCredentials'],
    /** Inline calm message on 429 — no exposed attempt counter (§H/SEC-HOOK). */
    rateLimited: catalog.th['login.rateLimited'],
    /** Warm-neutral inline strip (not red, not a modal) on network failure. */
    offline: catalog.th['login.offline'],
    /** Calm centered card for unexpected server errors. */
    serverError: catalog.th['login.serverError'],
    /** Shown under the email field on blur when the value looks malformed. */
    emailHint: catalog.th['login.emailHint'],
    /** Placeholder text for the email input. */
    emailPlaceholder: catalog.th['login.emailPlaceholder'],
    /** Password show / hide toggle accessible label. */
    showPassword: catalog.th['login.showPassword'],
    hidePassword: catalog.th['login.hidePassword'],
  },
  en: {
    title: catalog.en['login.title'],
    emailLabel: catalog.en['login.emailLabel'],
    passwordLabel: catalog.en['login.passwordLabel'],
    submit: catalog.en['login.submit'],
    forgotPassword: catalog.en['login.forgotPassword'],
    createAccount: catalog.en['login.createAccount'],
    /**
     * §E/C7 non-enumerating: identical copy for wrong email AND wrong password.
     * Includes reset-link affordance per auth-login-ui.md §7.2.
     */
    wrongCredentials: catalog.en['login.wrongCredentials'],
    rateLimited: catalog.en['login.rateLimited'],
    offline: catalog.en['login.offline'],
    serverError: catalog.en['login.serverError'],
    emailHint: catalog.en['login.emailHint'],
    emailPlaceholder: catalog.en['login.emailPlaceholder'],
    showPassword: catalog.en['login.showPassword'],
    hidePassword: catalog.en['login.hidePassword'],
  },
} satisfies Record<Locale, Record<string, string>>;

// ─── Field validation ─────────────────────────────────────────────────────────

/**
 * Validate the email field on blur (input sanity only — not a server call).
 * Returns a key into `loginStrings.<locale>` if invalid, or null if valid.
 *
 * Voice: "ตรวจสอบอีเมลอีกครั้ง / Double-check this email" — non-blaming,
 * never "invalid" (auth-login-ui.md §3/§5.1).
 */
export function validateEmailField(email: string): 'emailHint' | null {
  const trimmed = email.trim();
  // Require non-empty, contains @, and something before the @
  if (!trimmed || !trimmed.includes('@') || trimmed.startsWith('@')) {
    return 'emailHint';
  }
  return null;
}

/**
 * Validate the password field for submit-readiness.
 * Returns `true` if the field is non-empty (the only client-side gate).
 *
 * The actual password policy (length floor, breached-password check,
 * strength scoring) is applied server-side and returned as error codes
 * — those are appsec SEC-HOOKs, not client validation (§2/§F).
 */
export function validatePasswordField(password: string): boolean {
  return password.length > 0;
}

// ─── Submit handler ───────────────────────────────────────────────────────────

/**
 * The four outcomes a completed sign-in attempt can produce.
 * The screen switches on `kind` to render the right state (§7.2).
 */
export type SignInOutcome =
  | { kind: 'success' }
  | { kind: 'wrong_credentials' }          // 401 invalid_credentials → inline, non-enumerating
  | { kind: 'rate_limited' }               // 429 → calm "try again in a moment"
  | { kind: 'network_error' }              // fetch threw → offline strip
  | { kind: 'server_error'; code: string }; // unexpected → calm centered card

/**
 * Submit handler for the sign-in form (S4).
 *
 * Calls the API client, stores tokens on success, and returns a typed
 * outcome so the screen can render the correct state (auth-login-ui.md §7.2).
 *
 * Dependencies are injected so this function can be tested without a real
 * network or secure store.
 */
export async function handleSignIn(params: {
  email: string;
  password: string;
  deviceId?: string;
  client: Pick<AuthClient, 'login'>;
  storage: TokenStorage;
}): Promise<SignInOutcome> {
  const { email, password, deviceId, client, storage } = params;

  let result: Awaited<ReturnType<AuthClient['login']>>;
  try {
    result = await client.login({ email, password, deviceId });
  } catch {
    // fetch threw — no network or request aborted
    return { kind: 'network_error' };
  }

  if (result.ok) {
    // Success — persist tokens (in Keychain/Keystore via expo-secure-store in production)
    await storage.save(result.tokens);
    return { kind: 'success' };
  }

  // Map the error code to the appropriate screen state
  switch (result.code) {
    case 'invalid_credentials':
      return { kind: 'wrong_credentials' };

    case 'rate_limited':
      return { kind: 'rate_limited' };

    default:
      // 500, email_unverified (unexpected at login), or any other code
      return { kind: 'server_error', code: result.code };
  }
}
