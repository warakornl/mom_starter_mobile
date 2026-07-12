/**
 * Consent API client — POST /v1/account/consents, GET /v1/account/consents.
 *
 * Design mirrors authApiClient.ts:
 * - `createConsentApiClient(baseUrl, fetchFn?)` returns a plain object.
 * - Every function returns a typed discriminated union (ok: true | false).
 * - Network errors (fetch throws) return `{ ok: false, status: 0, code: 'network_error' }`.
 *
 * PDPA compliance:
 * - The POST endpoint is never itself gated by consent (§4.3 contract); it is
 *   always reachable so the user can grant or withdraw at any time.
 * - The client sends `consentTextVersion`; the server derives `locale` from
 *   the `Accept-Language` header (not sent here).
 *
 * SECURITY: NEVER log the accessToken.
 */

import type {
  ConsentType,
  PostConsentResult,
  GetConsentsResult,
  PostConsentResponse,
  ConsentsPage,
} from './types';

/** Minimal fetch signature — compatible with RN global fetch and test doubles. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Parse a non-2xx response body as a Problem; falls back gracefully. */
async function parseError(
  res: Response,
): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as Partial<{ code: string; message: string }>;
    return {
      code: body.code ?? 'unknown_error',
      message: body.message ?? res.statusText,
    };
  } catch {
    return { code: 'unknown_error', message: res.statusText };
  }
}

/**
 * Creates a consent API client bound to a base URL and a fetch implementation.
 *
 * @param baseUrl - e.g. `"https://api.example.com"` (no trailing slash)
 * @param fetchFn - defaults to the global `fetch`; inject a mock in tests
 */
export function createConsentApiClient(baseUrl: string, fetchFn: FetchFn = fetch) {
  return {
    /**
     * POST /v1/account/consents → 201 ConsentRecord
     *
     * Records a consent grant or withdrawal for a single purpose.
     * Append-only on the server (each call inserts a new row; the latest row
     * per consent_type determines effective state).
     *
     * @param consentType  - one of the 6 PDPA purpose identifiers
     * @param granted      - true = grant; false = withdraw
     * @param consentTextVersion - version tag of the text shown to the user
     * @param accessToken  - current Bearer JWT — NEVER log this
     */
    async postConsent(
      consentType: ConsentType,
      granted: boolean,
      consentTextVersion: string,
      accessToken: string,
    ): Promise<PostConsentResult> {
      try {
        const res = await fetchFn(`${baseUrl}/v1/account/consents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ consentType, granted, consentTextVersion }),
        });

        // Bug #3 fix (owner report 2026-07): gate success on res.ok (the full
        // 2xx range), matching every other mutating client in this codebase
        // (pregnancyApiClient PUT, accountApiClient POST) — NOT a literal
        // `res.status === 201`. A backend that legitimately answers 200 (or
        // any other 2xx) must not be treated as a failure; the previous
        // 201-only check made EVERY consent toggle error uniformly whenever
        // the real endpoint's success code differed from exactly 201.
        if (res.ok) {
          const record = (await res.json()) as PostConsentResponse;
          return { ok: true, record };
        }

        const err = await parseError(res);
        return { ok: false, status: res.status, ...err };
      } catch {
        return {
          ok: false,
          status: 0,
          code: 'network_error',
          message: 'Network request failed',
        };
      }
    },

    /**
     * GET /v1/account/consents → 200 ConsentsPage
     *
     * Returns the authenticated user's full consent history (append-only log),
     * ordered by grantedAt DESC. The client derives effective state by reading
     * the latest record per consentType.
     *
     * @param accessToken  - current Bearer JWT — NEVER log this
     * @param cursor       - optional pagination cursor
     * @param limit        - optional page size (default 20, max 100)
     */
    async getConsents(
      accessToken: string,
      cursor?: string,
      limit?: number,
    ): Promise<GetConsentsResult> {
      try {
        const params = new URLSearchParams();
        if (cursor !== undefined) params.set('cursor', cursor);
        if (limit !== undefined) params.set('limit', String(limit));
        const qs = params.toString();
        const url = `${baseUrl}/v1/account/consents${qs ? `?${qs}` : ''}`;

        const res = await fetchFn(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (res.ok) {
          const page = (await res.json()) as ConsentsPage;
          return { ok: true, page };
        }

        const err = await parseError(res);
        return { ok: false, status: res.status, ...err };
      } catch {
        return {
          ok: false,
          status: 0,
          code: 'network_error',
          message: 'Network request failed',
        };
      }
    },
  };
}

/** The type of the object returned by `createConsentApiClient`. */
export type ConsentApiClient = ReturnType<typeof createConsentApiClient>;
