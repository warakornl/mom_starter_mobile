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

// ─── Google Sign-In (§J) ──────────────────────────────────────────────────────

/**
 * POST /auth/google request body.
 * `nonce` is REQUIRED for G3 replay protection — the client generates a fresh
 * cryptographically-random nonce per attempt, passes it to the Google Sign-In SDK
 * (which embeds it into the ID token's `nonce` claim), then sends the same value
 * here so the server can verify G2.5 and mark the nonce consumed (single-use).
 */
export interface GoogleSignInRequest {
  idToken: string;
  nonce: string;
  deviceId?: string;
}

// ─── Logout (§C) ─────────────────────────────────────────────────────────────

/**
 * POST /auth/logout request body.
 * Providing `refreshToken` revokes that device's refresh-token family.
 * `allDevices: true` revokes every family for the authenticated subject
 * ("sign out everywhere" / lost-phone flow).
 * Endpoint requires `Authorization: Bearer <accessToken>` (§C/Conventions).
 */
export interface LogoutRequest {
  refreshToken?: string;
  allDevices?: boolean;
}

// ─── Sessions (§D/C5) ────────────────────────────────────────────────────────

/**
 * One "device signed in" row returned by GET /auth/sessions.
 * Never carries token material (§D/C5).
 */
export interface DeviceSession {
  deviceId: string;
  deviceName?: string;
  /** UTC instant as ISO-8601 string (Java Instant → JSON string). */
  createdAt: string;
  lastSeenAt?: string;
  /** True if this session is the calling device's current active session. */
  current: boolean;
}

/**
 * Contract pagination wrapper for GET /auth/sessions.
 * Contract N5: Page<DeviceSession> = `{ items[], nextCursor? }` — NOT a bare array.
 * NOTE: the backend currently returns List<DeviceSession>; it will be updated
 * to return this Page shape separately. The client reads `.items` per contract.
 */
export interface SessionsPage {
  items: DeviceSession[];
  nextCursor?: string;
}

// ─── New result types (discriminated unions) ──────────────────────────────────

/**
 * POST /auth/google → 200 AuthTokens on success.
 * 401 `google_token_invalid` — any failed G2 check (single generic code, never reveals which).
 * 409 `link_required` — Google email collides with existing local account (G4, no auto-merge).
 * 429 `rate_limited` (§H).
 */
export type GoogleResult = { ok: true; tokens: AuthTokens } | AuthApiError;

/**
 * POST /auth/logout → 204 on success.
 * Requires `Authorization: Bearer <accessToken>` (§C).
 */
export type LogoutResult = { ok: true } | AuthApiError;

/**
 * GET /auth/sessions → 200 SessionsPage on success.
 * Requires `Authorization: Bearer <accessToken>` (§D/C5).
 * 401 when the access token is invalid or expired.
 */
export type ListSessionsResult = { ok: true; page: SessionsPage } | AuthApiError;

/**
 * DELETE /auth/sessions/{deviceId} → 204 on success.
 * Requires `Authorization: Bearer <accessToken>` (§D/C5).
 */
export type RevokeSessionResult = { ok: true } | AuthApiError;
