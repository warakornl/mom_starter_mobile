/**
 * Auth API client — pure TypeScript, fully injectable fetch.
 *
 * Implements the auth surface from api-contract.md §E/§G:
 *   POST /auth/login · /auth/register · /auth/refresh
 *   POST /auth/forgot-password · /auth/reset-password
 *
 * Design:
 * - `createAuthClient(baseUrl, fetchFn?)` returns a plain object of async
 *   functions — no classes, no global state, injectable for testing.
 * - Every function returns a typed discriminated union (`ok: true | false`)
 *   so callers handle every case at compile time.
 * - Error codes are surfaced at the top level (no `.problem.code` nesting)
 *   to simplify `switch` on the screen side.
 * - The HTTP verb, path, and Content-Type header are set here — the caller
 *   never constructs raw requests.
 *
 * Security notes:
 * - Tokens returned here MUST be stored only in Keychain/Keystore via
 *   expo-secure-store (appsec SEC-HOOK; see tokenStorage.ts).
 * - This module NEVER logs tokens, passwords, or Authorization headers.
 */
import type {
  AuthTokens,
  Problem,
  LoginRequest,
  LoginResult,
  RegisterRequest,
  RegisterResult,
  RefreshRequest,
  RefreshResult,
  ForgotPasswordRequest,
  ForgotPasswordResult,
  ResetPasswordRequest,
  ResetPasswordResult,
  VerifyEmailRequest,
  VerifyEmailResult,
  ResendVerificationRequest,
  ResendVerificationResult,
  AuthApiError,
  GoogleSignInRequest,
  GoogleResult,
  LogoutRequest,
  LogoutResult,
  SessionsPage,
  ListSessionsResult,
  RevokeSessionResult,
} from './types';

/**
 * Minimal fetch signature (subset of the standard Web Fetch API).
 * Compatible with Node 18+, React Native's built-in fetch, and test doubles.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeError(status: number, problem: Problem): AuthApiError {
  return {
    ok: false,
    status,
    code: problem.code,
    message: problem.message,
  };
}

/** Parse a non-2xx response body as a Problem; falls back gracefully on empty/malformed bodies. */
async function parseError(res: Response): Promise<Problem> {
  try {
    const body = (await res.json()) as Partial<Problem>;
    return {
      code: body.code ?? 'unknown_error',
      message: body.message ?? res.statusText,
      details: body.details,
    };
  } catch {
    return { code: 'unknown_error', message: res.statusText };
  }
}

function jsonPost(baseUrl: string, fetchFn: FetchFn, path: string, body: unknown): Promise<Response> {
  return fetchFn(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Authenticated POST — includes `Authorization: Bearer <accessToken>`.
 * Used for endpoints that require Bearer (§C/Conventions).
 * NEVER logs the accessToken.
 */
function jsonPostAuth(
  baseUrl: string,
  fetchFn: FetchFn,
  path: string,
  body: unknown,
  accessToken: string,
): Promise<Response> {
  return fetchFn(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Authenticated GET — includes `Authorization: Bearer <accessToken>`.
 * NEVER logs the accessToken.
 */
function jsonGetAuth(
  baseUrl: string,
  fetchFn: FetchFn,
  path: string,
  accessToken: string,
): Promise<Response> {
  return fetchFn(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
}

/**
 * Authenticated DELETE — includes `Authorization: Bearer <accessToken>`.
 * NEVER logs the accessToken.
 */
function jsonDeleteAuth(
  baseUrl: string,
  fetchFn: FetchFn,
  path: string,
  accessToken: string,
): Promise<Response> {
  return fetchFn(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
}

/**
 * Creates an auth API client bound to a base URL and a fetch implementation.
 *
 * @param baseUrl - e.g. `"https://api.example.com"` (no trailing slash)
 * @param fetchFn - defaults to the global `fetch`; inject a mock in tests
 */
export function createAuthClient(baseUrl: string, fetchFn: FetchFn = fetch) {
  return {
    /**
     * POST /auth/login → 200 AuthTokens
     *
     * 401 `invalid_credentials` — generic code for both "no such email" AND
     * "wrong password" (non-enumerating per §E/C7; constant-time server-side).
     * 429 `rate_limited` — soft-lock with Retry-After (§H).
     *
     * A registered-but-unverified account returns 200 (email_verified=false
     * in the JWT); cloud egress is withheld server-side via 403 email_unverified
     * until the user completes email verification (§G/C9).
     */
    async login(req: LoginRequest): Promise<LoginResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/login', req);
      if (res.ok) {
        const tokens = (await res.json()) as AuthTokens;
        return { ok: true, tokens };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/register → 202 (verification_pending)
     *
     * ALWAYS returns 202 regardless of whether the email exists — this is
     * the §E/C7 non-enumerating contract. The server sends the existing owner
     * an out-of-band notice on collision but the HTTP response is byte-identical.
     * No `AuthTokens` are issued here; the first session is minted only by
     * POST /auth/verify-email (§G/C9).
     *
     * 422 `password_too_short` | `password_breached` — appsec policy (§2).
     */
    async register(req: RegisterRequest): Promise<RegisterResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/register', req);
      if (res.status === 202) {
        return { ok: true };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/refresh → 200 AuthTokens (rotated)
     *
     * Each call issues a BRAND-NEW refresh token and immediately invalidates
     * the presented one (rotating refresh, §B/C2).
     *
     * 401 `token_reuse_detected` — a previously-rotated (non-leaf) token was
     * presented; the entire token family is revoked (all devices in that lineage);
     * the client MUST force re-login (§B §3).
     */
    async refresh(req: RefreshRequest): Promise<RefreshResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/refresh', req);
      if (res.ok) {
        const tokens = (await res.json()) as AuthTokens;
        return { ok: true, tokens };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/forgot-password → always 202 (non-enumerating)
     *
     * The server sends a reset email asynchronously (to avoid timing oracles).
     * The HTTP response is IDENTICAL whether the email exists or not.
     * The client MUST display a non-enumerating confirmation (§E/§5.2 spec).
     *
     * 429 `rate_limited` — protects against reset-email flooding.
     */
    async forgotPassword(req: ForgotPasswordRequest): Promise<ForgotPasswordResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/forgot-password', req);
      if (res.status === 202) {
        return { ok: true };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/reset-password → 204 on success
     *
     * 410 `reset_token_invalid` — single generic code for bad/expired/already-used
     * token (never distinguishes the cases — avoids token-probing oracle, §E).
     * On success the server revokes ALL refresh families (every device) and
     * emails the owner a "your password was changed" notice (§B/C1).
     *
     * 422 `password_too_short` | `password_breached` — appsec policy.
     */
    async resetPassword(req: ResetPasswordRequest): Promise<ResetPasswordResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/reset-password', req);
      if (res.status === 204) {
        return { ok: true };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/verify-email → 200 AuthTokens (the FIRST session for the account)
     *
     * Mints the initial refresh-token family bound to deviceId (§G/C9).
     * This is the only session-minting event for a just-registered account;
     * `register` itself issues no tokens (§G — "register issues NO AuthTokens").
     *
     * 410 `verify_token_invalid` — single generic code for bad/expired/used token
     * (does not distinguish the cases — avoids token-probing oracle, §E/C9).
     * Token is single-use, short-expiry, SHA-256-hashed server-side.
     *
     * 429 `rate_limited` — protects against verify-token guessing (§H).
     */
    async verifyEmail(req: VerifyEmailRequest): Promise<VerifyEmailResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/verify-email', req);
      if (res.ok) {
        const tokens = (await res.json()) as AuthTokens;
        return { ok: true, tokens };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/resend-verification → always 202 (non-enumerating)
     *
     * ALWAYS returns 202 regardless of whether the email exists or is already
     * verified — identical non-enumerating posture as `forgotPassword` (§E/C7).
     * The server sends the verification email asynchronously, out-of-band.
     *
     * 429 `rate_limited` — rate-limited per-account to prevent email flooding (§H).
     */
    async resendVerification(req: ResendVerificationRequest): Promise<ResendVerificationResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/resend-verification', req);
      if (res.status === 202) {
        return { ok: true };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/google → 200 AuthTokens
     *
     * The device obtains a Google ID token via the native SDK, then POSTs it here.
     * The server fully verifies the token (G2: signature, iss, aud, exp, nonce,
     * email_verified) and mints the app's own opaque-rotating-refresh session (§J).
     *
     * Endpoint is on the UNAUTHENTICATED list (§J/Conventions) — no Bearer header.
     *
     * 401 `google_token_invalid` — any G2 check failure (single generic code,
     *   never reveals which specific check failed — avoids oracle, §E/C7).
     * 409 `link_required` — Google email collides with an existing email/password
     *   account; NO session minted, NO auto-merge; link only after proof (G4).
     * 429 `rate_limited` — per-IP + per-Google-sub ceiling (§H).
     *
     * Security: `req.nonce` is required for G3 replay protection; NEVER log `idToken`.
     */
    async google(req: GoogleSignInRequest): Promise<GoogleResult> {
      const res = await jsonPost(baseUrl, fetchFn, '/v1/auth/google', req);
      if (res.ok) {
        const tokens = (await res.json()) as AuthTokens;
        return { ok: true, tokens };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * POST /auth/logout → 204 (server-side revocation, §C)
     *
     * Revokes the presented refresh-token family on the server — not merely
     * a client-side token clear. The access token is required as Bearer to
     * authenticate the request (§C/Conventions); logout is not unauthenticated.
     *
     * - `req.refreshToken` — revokes that one device's family.
     * - `req.allDevices: true` — revokes EVERY family for the subject
     *   ("sign out everywhere", lost-phone / post-compromise flow, §C).
     *
     * Access tokens are stateless and live out their ≤15-min window after revocation;
     * for especially sensitive actions the server additionally checks the family.
     *
     * NEVER log `accessToken` or `req.refreshToken`.
     */
    async logout(req: LogoutRequest, accessToken: string): Promise<LogoutResult> {
      const res = await jsonPostAuth(baseUrl, fetchFn, '/v1/auth/logout', req, accessToken);
      if (res.status === 204) {
        return { ok: true };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * GET /auth/sessions → 200 SessionsPage (§D/C5)
     *
     * Returns the authenticated user's "devices signed in" list — the active leaf
     * of each refresh-token family. Response is `Page<DeviceSession>` per contract
     * N5: `{ items[], nextCursor? }` — NOT a bare array.
     *
     * Requires `Authorization: Bearer <accessToken>` (scoped to `sub`).
     * 401 — access token invalid or expired.
     *
     * NEVER log `accessToken`.
     */
    async listSessions(accessToken: string): Promise<ListSessionsResult> {
      const res = await jsonGetAuth(baseUrl, fetchFn, '/v1/auth/sessions', accessToken);
      if (res.ok) {
        const page = (await res.json()) as SessionsPage;
        return { ok: true, page };
      }
      return makeError(res.status, await parseError(res));
    },

    /**
     * DELETE /auth/sessions/{deviceId} → 204 (§D/C5)
     *
     * Revokes the named device's refresh-token family ("sign out that tablet",
     * S7/S8 device management). Equivalent to a targeted logout for a chosen device.
     *
     * Requires `Authorization: Bearer <accessToken>` (scoped to `sub`).
     * 401 — access token invalid or expired.
     * 404 — device not found or already removed.
     *
     * NEVER log `accessToken`.
     */
    async revokeSession(deviceId: string, accessToken: string): Promise<RevokeSessionResult> {
      const res = await jsonDeleteAuth(
        baseUrl,
        fetchFn,
        `/v1/auth/sessions/${deviceId}`,
        accessToken,
      );
      if (res.status === 204) {
        return { ok: true };
      }
      return makeError(res.status, await parseError(res));
    },
  };
}

/** The type of the object returned by `createAuthClient`. */
export type AuthClient = ReturnType<typeof createAuthClient>;
