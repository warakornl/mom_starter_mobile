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
  AuthApiError,
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
  };
}

/** The type of the object returned by `createAuthClient`. */
export type AuthClient = ReturnType<typeof createAuthClient>;
