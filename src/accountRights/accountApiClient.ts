/**
 * Account API client — GET /v1/account/export, DELETE /v1/account.
 *
 * Design mirrors authApiClient.ts / consentApiClient.ts:
 * - `createAccountApiClient(baseUrl, fetchFn?, timeoutMs?)` returns a plain object.
 * - Every method returns a typed discriminated union (ok: true | false).
 * - Network / timeout errors return `{ ok: false, status: 0, code: '...' }`.
 *
 * Security (AR-AC-22..25):
 * - The `GET /v1/account/export` response body is HIGHLY sensitive (SD-1…SD-12
 *   aggregate). It MUST NEVER be passed to console.log, a crash reporter, or
 *   any network logger.
 * - IMPORTANT: Exclude the /v1/account/export endpoint from crash-reporter
 *   breadcrumbs and network-logging (e.g. Sentry denylist/scrubbing). Do NOT
 *   attach export request/response bodies to any telemetry event.
 * - Dev-only network inspectors (Flipper / Reactotron / RN network inspector)
 *   MUST be stripped from release builds; otherwise the export body is
 *   auto-captured in production (AR-AC-23).
 * - No user id is sent in path, query, or body — the server derives the user
 *   from the JWT subject (IDOR-safe, AR-AC-02).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal fetch signature — compatible with RN global fetch and test doubles. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type ExportAccountResult =
  | { ok: true; bodyText: string }
  | { ok: false; status: number; code: string; message?: string };

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message?: string };

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default request timeout for GET /v1/account/export.
 *
 * The export body is a large SD-1…SD-12 aggregate that could hang on a slow
 * link or slow server aggregation. 20 s is the spec-mandated bound (M-3);
 * rn-mobile-dev may tune within 15–30 s at Phase 1 against real p95 latency.
 */
export const EXPORT_TIMEOUT_MS = 20_000;

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Parse a non-2xx response body as a Problem; falls back gracefully. */
async function parseError(res: Response): Promise<{ code: string; message: string }> {
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

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an account API client bound to a base URL and a fetch implementation.
 *
 * @param baseUrl   - e.g. `"https://api.example.com"` (no trailing slash)
 * @param fetchFn   - defaults to the global `fetch`; inject a mock in tests
 * @param timeoutMs - request timeout for exportAccount (default 20 000 ms, tunable)
 */
export function createAccountApiClient(
  baseUrl: string,
  fetchFn: FetchFn = fetch,
  timeoutMs: number = EXPORT_TIMEOUT_MS,
) {
  return {
    /**
     * GET /v1/account/export → 200 (raw JSON body text)
     *
     * Returns the full data-export JSON as raw text.
     * The caller (accountExportFileService) writes the text directly to a file
     * and passes it to the OS share sheet — no parsing, no rendering, no logging.
     *
     * @param accessToken - current Bearer JWT — NEVER log this
     * @param signal      - optional AbortSignal for nav-away cancellation (§2.7).
     *                      When fired, returns { ok:false, code:'request_aborted' }.
     *
     * Handled statuses:
     *   200 → { ok: true, bodyText }
     *   404 → { ok: false, code: 'account_deleted' }  (soft-deleted, §2.5)
     *   401 → { ok: false, status: 401, code: ... }   (token expired — handled globally)
     *   5xx → { ok: false, status: N, code: ... }
     *   timeout (internal, ~timeoutMs) → { ok: false, code: 'timeout' }
     *   nav-away abort (external signal) → { ok: false, code: 'request_aborted' }
     *   network error → { ok: false, code: 'network_error' }
     *
     * SECURITY: NEVER log the accessToken or the response body (AR-AC-22).
     */
    async exportAccount(
      accessToken: string,
      signal?: AbortSignal,
    ): Promise<ExportAccountResult> {
      // Build a combined abort: internal timeout + optional external nav-away signal.
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

      // Wire the external nav-away signal to abort our combined controller too.
      let externalAborted = false;
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeoutId);
          return { ok: false, status: 0, code: 'request_aborted' };
        }
        const onAbort = () => {
          externalAborted = true;
          timeoutController.abort();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        const res = await fetchFn(`${baseUrl}/v1/account/export`, {
          method: 'GET',
          headers: {
            // SECURITY: NEVER log accessToken
            Authorization: `Bearer ${accessToken}`,
          },
          signal: timeoutController.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          // SECURITY: Read as raw text — do NOT parse, render, or log the body.
          // This aggregate contains SD-1…SD-12 sensitive health + financial data.
          // Exclude this endpoint from Sentry breadcrumbs / network-logging denylist.
          const bodyText = await res.text();
          return { ok: true, bodyText };
        }

        if (res.status === 404) {
          // Parse body to distinguish a genuine soft-delete (GlobalExceptionHandler
          // returns {"code":"not_found",...}) from a routing/framework 404 (Spring
          // returns a ProblemDetail or HTML error page with no "code" field).
          // Guard against non-JSON / empty body — DO NOT throw, DO NOT log.
          let parsed: Partial<{ code: string }> = {};
          try {
            parsed = (await res.json()) as Partial<{ code: string }>;
          } catch {
            // Non-JSON body (e.g. Spring HTML error page or empty body).
            // Leave parsed as {}, which falls through to the routing-404 branch below.
          }
          if (parsed.code === 'not_found') {
            // Genuine soft-delete (§2.5). Terminal for the export flow.
            return { ok: false, status: 404, code: 'account_deleted' };
          }
          // Routing or framework 404 (unknown path, stale backend lacking the endpoint).
          // Return a retryable error so the UI shows EXPORT_ERROR, not the terminal
          // "account deleted" message (which would be alarming and incorrect).
          return { ok: false, status: 404, code: 'export_unavailable' };
        }

        const err = await parseError(res);
        return { ok: false, status: res.status, code: err.code, message: err.message };
      } catch {
        clearTimeout(timeoutId);

        // Distinguish nav-away abort from internal timeout.
        if (externalAborted || signal?.aborted) {
          return { ok: false, status: 0, code: 'request_aborted' };
        }
        if (timeoutController.signal.aborted) {
          return { ok: false, status: 0, code: 'timeout' };
        }
        return { ok: false, status: 0, code: 'network_error' };
      }
    },

    /**
     * DELETE /v1/account → 202 Accepted
     *
     * Bearer-only; no body. Idempotent (second call = silent no-op 202).
     * Soft-deletes the account server-side; revokes all refresh-token families.
     * Hard-erase is deferred to `TombstoneGcScheduler`.
     *
     * On 202: the caller runs `performLogout` (tokens + all health stores) → S1.
     * On non-202: stays signed in; caller surfaces DELETE_ERROR (§3.2).
     *
     * @param accessToken - current Bearer JWT — NEVER log this
     */
    async deleteAccount(accessToken: string): Promise<DeleteAccountResult> {
      try {
        const res = await fetchFn(`${baseUrl}/v1/account`, {
          method: 'DELETE',
          headers: {
            // SECURITY: NEVER log accessToken
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (res.status === 202) {
          return { ok: true };
        }

        const err = await parseError(res);
        return { ok: false, status: res.status, code: err.code, message: err.message };
      } catch {
        return { ok: false, status: 0, code: 'network_error', message: 'Network request failed' };
      }
    },
  };
}

/** The type of the object returned by `createAccountApiClient`. */
export type AccountApiClient = ReturnType<typeof createAccountApiClient>;
