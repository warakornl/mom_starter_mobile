/**
 * Auth domain — shared TypeScript types.
 *
 * Derived from api-contract.md §A/§E/§G and "Key schemas".
 * These types are the contract between the auth API client, the token
 * storage, and the screen logic; they NEVER contain health data or PII
 * beyond the email address that is part of identity (api-contract §A/§F).
 */

export type Locale = 'th' | 'en';

// ─── Tokens ──────────────────────────────────────────────────────────────────

/**
 * Returned on successful login / email-verify / token-refresh.
 * `accessToken` is a short-lived JWT (RS256/ES256); `refreshToken` is an
 * opaque random string — MUST be stored only in Keychain/Keystore via
 * expo-secure-store (§A, appsec SEC-HOOK; see tokenStorage.ts).
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Remaining lifetime of the access token, in seconds (~900). */
  accessTokenExpiresIn: number;
  /** Remaining lifetime of the refresh token, in seconds. */
  refreshTokenExpiresIn: number;
}

// ─── Error body ──────────────────────────────────────────────────────────────

/**
 * Standard error body returned on every non-2xx response.
 * Auth-surface codes are enumeration-safe (§E/C7):
 * `invalid_credentials` covers both "no such email" and "wrong password".
 */
export interface Problem {
  code: string;
  message: string;
  details?: string;
}

// ─── Request shapes ───────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
  /** Client-generated stable per-install id (NOT a hardware identifier, C5). */
  deviceId?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  locale?: Locale;
  deviceId?: string;
}

export interface RefreshRequest {
  refreshToken: string;
  deviceId?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface VerifyEmailRequest {
  /** The single-use verification token from the email link. */
  token: string;
  /** Client-generated stable per-install id (NOT a hardware identifier, C5). */
  deviceId?: string;
}

export interface ResendVerificationRequest {
  email: string;
}

// ─── Result shapes (discriminated unions) ─────────────────────────────────────

/**
 * An API-level error with the Problem.code surfaced at the top level
 * so callers can switch on it without nesting.
 */
export interface AuthApiError {
  ok: false;
  /** HTTP status code (401, 410, 422, 429, 500, …). */
  status: number;
  /** The Problem.code string from the response body. */
  code: string;
  message: string;
}

export type LoginResult = { ok: true; tokens: AuthTokens } | AuthApiError;
export type RegisterResult = { ok: true } | AuthApiError;
export type RefreshResult = { ok: true; tokens: AuthTokens } | AuthApiError;
export type ForgotPasswordResult = { ok: true } | AuthApiError;
export type ResetPasswordResult = { ok: true } | AuthApiError;

/**
 * POST /auth/verify-email → 200 AuthTokens (the FIRST session for the account)
 * 410 `verify_token_invalid` — single generic code for bad/expired/used token (§E/C9).
 * 429 `rate_limited` — rate-limited per IP/token to prevent token guessing (§H).
 */
export type VerifyEmailResult = { ok: true; tokens: AuthTokens } | AuthApiError;

/**
 * POST /auth/resend-verification → always 202 (non-enumerating, §E/§G).
 * 429 `rate_limited` — rate-limited per account to prevent email flooding (§H).
 */
export type ResendVerificationResult = { ok: true } | AuthApiError;
