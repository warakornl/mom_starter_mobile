/**
 * Pregnancy-profile API client — pure TypeScript, fully injectable fetch.
 *
 * Implements GET/PUT /v1/pregnancy-profile from api-contract.md §"Endpoints":
 *   GET /pregnancy-profile  → PregnancyProfile or 404 (no profile yet)
 *   PUT /pregnancy-profile  → 201 (created) or 200 (updated) PregnancyProfile
 *
 * Design mirrors authApiClient.ts:
 * - `createPregnancyClient(baseUrl, fetchFn?)` returns a plain object of async
 *   functions — no classes, no global state, injectable for testing.
 * - Every function returns a typed discriminated union (`ok: true | false`).
 * - Error codes surfaced at the top level (no `.problem.code` nesting).
 *
 * Contract obligations (api-contract.md §"Gestational-age"):
 * - `X-Client-Date: YYYY-MM-DD` MUST be sent on every PUT (bakes the civil
 *   date into the stored edd when eddBasis=current_week; UTC fallback risks
 *   ±1-day drift).
 * - `X-Client-Date` is optional on GET (advisory only — the server snapshot
 *   is overridden by the client's own local computation anyway).
 * - `Authorization: Bearer <accessToken>` MUST be sent on both GET and PUT.
 * - PUT on an existing profile MUST send `If-Match: "<version>"` (missing → 428).
 *
 * Security:
 * - NEVER log the accessToken.
 * - The edd field is a civil date (not sensitive in isolation), but follows
 *   the general principle of not logging request bodies.
 */

import type { FetchFn } from '../auth/authApiClient';
import type {
  PregnancyProfileInput,
  PregnancyProfile,
  GetProfileResult,
  PutProfileResult,
  PregnancyApiError,
} from './types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface Problem {
  code: string;
  message: string;
  details?: string;
}

function makeError(status: number, problem: Problem): PregnancyApiError {
  return {
    ok: false,
    status,
    code: problem.code,
    message: problem.message,
  };
}

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

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a pregnancy-profile API client bound to a base URL and fetch impl.
 *
 * @param baseUrl - e.g. `"https://api.example.com"` (no trailing slash)
 * @param fetchFn - defaults to global `fetch`; inject a mock in tests
 */
export function createPregnancyClient(baseUrl: string, fetchFn: FetchFn = fetch) {
  return {
    /**
     * GET /v1/pregnancy-profile → PregnancyProfile or 404.
     *
     * 200 — profile exists; returns the full PregnancyProfile including the
     *       derived snapshot (advisory; client recomputes locally from edd).
     * 404 `not_found` — no profile yet → navigate user to ProfileSetup.
     * 401 — access token invalid/expired → re-auth flow.
     * 403 `consent_required` — consent gate (should not happen for GET per
     *     api-contract, included for defensive error handling).
     *
     * `clientDate` (optional, YYYY-MM-DD): the device's local civil date.
     * Sent as `X-Client-Date` header.  Advisory on GET; the client will
     * recompute the derived values locally anyway.
     *
     * NEVER log accessToken.
     */
    async getProfile(
      accessToken: string,
      clientDate?: string,
    ): Promise<GetProfileResult> {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      if (clientDate) {
        headers['X-Client-Date'] = clientDate;
      }

      const res = await fetchFn(`${baseUrl}/v1/pregnancy-profile`, {
        method: 'GET',
        headers,
      });

      if (res.ok) {
        const profile = (await res.json()) as PregnancyProfile;
        return { ok: true, profile };
      }

      const problem = await parseError(res);

      if (res.status === 404) {
        return { ok: false, status: 404, code: 'not_found', message: problem.message };
      }

      return makeError(res.status, problem);
    },

    /**
     * PUT /v1/pregnancy-profile → 201 (created) or 200 (updated).
     *
     * Exactly one of `req.edd` or `req.currentWeek` must be present (XOR).
     *
     * Headers REQUIRED by contract:
     *   Authorization: Bearer <accessToken>
     *   X-Client-Date: <clientDate>  — MANDATORY on every PUT (bakes civil today
     *     into the stored edd when eddBasis=current_week; UTC fallback risks
     *     ±1-day drift — api-contract §"Gestational-age").
     *
     * `ifMatch` (optional):
     *   Pass the `version` from the last-pulled profile as the `If-Match` value.
     *   Required when a profile already exists (missing → 428 Precondition Required).
     *   Omit only on first-time creation (when GET returned 404).
     *
     * Status codes:
     *   201 — first creation
     *   200 — update
     *   403 `consent_required (general_health)` — PDPA gate
     *   409 — optimistic-concurrency mismatch (another device changed it first)
     *   422 — validation error (EDD outside plausibility window, XOR violated)
     *   428 — If-Match header missing on an update
     *
     * NEVER log accessToken.
     */
    async putProfile(
      req: PregnancyProfileInput,
      accessToken: string,
      ifMatch?: string,
      clientDate?: string,
    ): Promise<PutProfileResult> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      };

      // Client MUST send X-Client-Date on every PUT (api-contract §"Gestational-age").
      if (clientDate) {
        headers['X-Client-Date'] = clientDate;
      }

      // Send If-Match when updating an existing profile (api-contract B2).
      if (ifMatch !== undefined) {
        headers['If-Match'] = `"${ifMatch}"`;
      }

      const res = await fetchFn(`${baseUrl}/v1/pregnancy-profile`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(req),
      });

      if (res.ok) {
        const profile = (await res.json()) as PregnancyProfile;
        const created = res.status === 201;
        return { ok: true, profile, created };
      }

      return makeError(res.status, await parseError(res));
    },
  };
}

/** The type of the object returned by `createPregnancyClient`. */
export type PregnancyClient = ReturnType<typeof createPregnancyClient>;
