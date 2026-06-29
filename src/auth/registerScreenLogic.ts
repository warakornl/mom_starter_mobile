/**
 * Register screen (S2) — testable non-UI logic.
 *
 * Maps to: POST /v1/auth/register → 202 (verification_pending)
 * On success: screen navigates to VerifyEmailScreen (check-inbox).
 *
 * This module contains everything that can be unit-tested without React Native:
 *  - `registerStrings`       — th/en copy for all screen states (warm, encouraging)
 *  - `validateEmailField`    — blur-time input sanity check (non-blaming)
 *  - `validatePasswordField` — non-empty check (policy is appsec SEC-HOOK server-side)
 *  - `handleRegister`        — submit handler (injected API client)
 *  - `RegisterOutcome`       — discriminated union for the screen to render
 *
 * NON-ENUMERATION CONTRACT (§E/C7 — MUST NOT be broken):
 *   POST /auth/register returns 202 for BOTH new AND existing emails (byte-identical
 *   response + timing). `handleRegister` MUST return `{ kind: 'success' }` on 202
 *   regardless of the response body — it MUST NOT inspect the body for hints.
 *   There is NEVER a `{ kind: 'email_exists' }` outcome and no copy that hints at
 *   email existence. Breaking this exposes user enumeration (security defect §E/C7).
 */
import type { AuthClient } from './authApiClient';
import type { Locale } from './types';

// ─── i18n strings ─────────────────────────────────────────────────────────────

/** All strings used by the Register screen (S2), in th and en. */
export const registerStrings = {
  th: {
    title: 'สร้างบัญชีของคุณ',
    subtitle: 'สมุดสีชมพูของคุณ พร้อมเริ่มแล้ว',
    emailLabel: 'อีเมล',
    passwordLabel: 'รหัสผ่าน',
    submit: 'สร้างบัญชี',
    signIn: 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ',
    emailPlaceholder: 'you@example.com',
    /** Shown on blur when email looks malformed. Non-blaming voice. */
    emailHint: 'ตรวจสอบอีเมลอีกครั้ง',
    /** Helper text below the password field — shown before any server error. */
    passwordHint: 'อย่างน้อย 8 ตัวอักษร — ยิ่งยาวยิ่งดี',
    /** 422 password_too_short returned by server (appsec policy, not a client gate). */
    passwordTooShort: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
    /** 422 password_breached returned by server. */
    passwordBreached: 'รหัสผ่านนี้ไม่ปลอดภัย กรุณาลองรหัสผ่านอื่น',
    /** 429 — calm inline, no counter exposed (§H/SEC-HOOK). */
    rateLimited: 'ลองอีกครั้งในอีกสักครู่',
    /** Offline — warm-neutral strip (not red, not a modal). */
    offline: 'คุณออฟไลน์อยู่ · ต้องต่ออินเทอร์เน็ตเพื่อสมัครสมาชิก',
    /** Unexpected server error — calm centered card. */
    serverError: 'มีบางอย่างผิดพลาดทางฝั่งเรา · ข้อมูลของคุณปลอดภัย ลองอีกครั้ง',
    showPassword: 'แสดงรหัสผ่าน',
    hidePassword: 'ซ่อนรหัสผ่าน',
    disclaimer: 'เริ่มต้นนี้ไม่ใช่คำวินิจฉัยทางการแพทย์',
  },
  en: {
    title: 'Create your account',
    subtitle: 'Your pink handbook, ready to start.',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    submit: 'Create account',
    signIn: 'Already have an account? Sign in',
    emailPlaceholder: 'you@example.com',
    emailHint: 'Double-check this email',
    passwordHint: 'At least 8 characters — longer is better.',
    passwordTooShort: 'Password must be at least 8 characters.',
    passwordBreached:
      'This password has appeared in a data breach — please choose another.',
    rateLimited: "Let's try again in a moment.",
    offline: "You're offline — you'll need a connection to sign up.",
    serverError: 'Something went wrong on our end. Your details are safe — try again.',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    disclaimer: 'This is not a substitute for medical advice.',
  },
} satisfies Record<Locale, Record<string, string>>;

// ─── Field validation ─────────────────────────────────────────────────────────

/**
 * Validate the email field on blur (input sanity only — not a server call).
 * Returns a key into `registerStrings.<locale>` if invalid, or null if valid.
 * Voice: non-blaming; never says "invalid email" (matches login screen pattern).
 */
export function validateEmailField(email: string): 'emailHint' | null {
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes('@') || trimmed.startsWith('@')) {
    return 'emailHint';
  }
  return null;
}

/**
 * Validate the password field for submit-readiness.
 * Returns `true` if the field is non-empty.
 *
 * The actual password policy (length floor, breached-password check) is
 * applied server-side and returned as 422 codes (`password_too_short` /
 * `password_breached`) — those are appsec SEC-HOOKs (§2/§F), not client gates.
 */
export function validatePasswordField(password: string): boolean {
  return password.length > 0;
}

// ─── Submit handler ───────────────────────────────────────────────────────────

/**
 * The outcomes a completed register attempt can produce.
 *
 * NON-ENUMERATING CONTRACT (§E/C7):
 * - `success` is returned on 202 regardless of whether the email was new or
 *   colliding. The screen navigates to VerifyEmailScreen and shows
 *   "check your inbox" — identical for BOTH cases, no branching on body.
 * - There is NEVER a `email_exists` or `email_taken` outcome — this would
 *   break the §E enumeration-safe guarantee and is a security defect.
 */
export type RegisterOutcome =
  | { kind: 'success' }                                                        // 202 → navigate to Verify-email
  | { kind: 'rate_limited' }                                                    // 429 → calm inline
  | { kind: 'network_error' }                                                   // fetch threw → offline strip
  | { kind: 'server_error'; code: string }                                      // 500/unexpected → calm card
  | { kind: 'validation'; code: 'password_too_short' | 'password_breached' };  // 422 appsec policy

/**
 * Submit handler for the register form (S2).
 *
 * Calls the API client and returns a typed outcome so the screen can render
 * the correct state. Dependencies are injected so tests never touch fetch.
 *
 * Non-enumeration: `client.register` returns ok:true on 202 regardless of body.
 * This handler preserves that contract — it does NOT inspect the body for hints.
 */
export async function handleRegister(params: {
  email: string;
  password: string;
  locale?: Locale;
  deviceId?: string;
  client: Pick<AuthClient, 'register'>;
}): Promise<RegisterOutcome> {
  const { email, password, locale, deviceId, client } = params;

  let result: Awaited<ReturnType<AuthClient['register']>>;
  try {
    result = await client.register({ email, password, locale, deviceId });
  } catch {
    // fetch threw — no network or request aborted
    return { kind: 'network_error' };
  }

  if (result.ok) {
    // 202 verification_pending — ALWAYS success (non-enumerating, §E/C7).
    // NO tokens are issued here; the first session is minted only by
    // POST /auth/verify-email (§G). Do NOT store any tokens here.
    return { kind: 'success' };
  }

  // Map error codes to screen outcomes
  switch (result.code) {
    case 'password_too_short':
    case 'password_breached':
      // 422 appsec policy errors (§2/§F) — surfaced inline below the password field
      return { kind: 'validation', code: result.code };

    case 'rate_limited':
      // 429 — calm "try again in a moment" inline
      return { kind: 'rate_limited' };

    default:
      // 500, unexpected codes — calm centered card
      return { kind: 'server_error', code: result.code };
  }
}
