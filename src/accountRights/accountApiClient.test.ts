/**
 * accountApiClient — unit tests (TDD, written BEFORE the implementation).
 *
 * Tests cover:
 *  - exportAccount: 200, 404, 401, 5xx, network error, timeout, nav-away abort
 *  - deleteAccount: 202, 401, 5xx, network error
 *  - Security: response body is never logged (AR-AC-22)
 *  - Security: no id in path/query/body for export (AR-AC-02)
 *  - Request includes Authorization: Bearer header
 */

import { createAccountApiClient } from './accountApiClient';
import type { FetchFn } from './accountApiClient';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal mock Response that returns a text body. */
function makeTextResponse(status: number, body = ''): FetchFn {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve({}),
    } as unknown as Response);
}

/** Build a mock Response that returns a JSON error body. */
function makeJsonResponse(status: number, body: unknown): FetchFn {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    } as unknown as Response);
}

/** Spy-capable fetch — captures the calls. */
function spyFetch(
  status: number,
  bodyText = '',
  bodyJson: unknown = {},
): { fn: FetchFn; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn: FetchFn = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      text: () => Promise.resolve(bodyText),
      json: () => Promise.resolve(bodyJson),
    } as unknown as Response);
  };
  return { fn, calls };
}

/** A fetch that never resolves, but aborts when the signal fires. */
function hangingFetch(): FetchFn {
  return (_url, init) =>
    new Promise((_, reject) => {
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }
      // Never resolves otherwise
    });
}

const BASE = 'http://localhost:8080';
const TOKEN = 'test-access-token';
const EXPORT_BODY = JSON.stringify({ account: { email: 'user@test.com' } });

// ─── exportAccount ────────────────────────────────────────────────────────────

describe('accountApiClient.exportAccount', () => {
  it('returns ok:true with raw bodyText on 200', async () => {
    const client = createAccountApiClient(BASE, makeTextResponse(200, EXPORT_BODY));
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodyText).toBe(EXPORT_BODY);
    }
  });

  it('sends GET /v1/account/export with Authorization: Bearer header', async () => {
    const { fn, calls } = spyFetch(200, EXPORT_BODY);
    await createAccountApiClient(BASE, fn).exportAccount(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/account/export');
    expect(calls[0].init?.method).toBe('GET');
    expect((calls[0].init?.headers as Record<string, string>)?.['Authorization']).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('sends NO user id in path or query string (IDOR-safe, AR-AC-02)', async () => {
    const { fn, calls } = spyFetch(200, EXPORT_BODY);
    await createAccountApiClient(BASE, fn).exportAccount(TOKEN);
    const url = calls[0].url;
    // Path must be exactly /v1/account/export with no extra segments or query params
    expect(url).toBe('http://localhost:8080/v1/account/export');
    expect(url).not.toContain('?');
    // No body
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('returns ok:false, status:404, code:account_deleted on 404 with body code:not_found (genuine soft-delete)', async () => {
    const client = createAccountApiClient(
      BASE,
      makeJsonResponse(404, { code: 'not_found', message: 'Not found' }),
    );
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.code).toBe('account_deleted');
    }
  });

  it('returns ok:false, status:404, code:export_unavailable on 404 with Spring-default body (no code field)', async () => {
    // Spring Boot framework/routing 404 — ProblemDetail without a "code" field.
    const springBody = { timestamp: '2026-07-06T00:00:00.000+00:00', status: 404, error: 'Not Found', path: '/v1/account/export' };
    const client = createAccountApiClient(
      BASE,
      makeJsonResponse(404, springBody),
    );
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.code).toBe('export_unavailable');
    }
  });

  it('returns ok:false, status:404, code:export_unavailable on 404 with empty body (JSON parse throws)', async () => {
    // Empty body — res.json() throws; must not propagate the throw.
    const emptyBodyFetch: FetchFn = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(''),
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      } as unknown as Response);
    const client = createAccountApiClient(BASE, emptyBodyFetch);
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.code).toBe('export_unavailable');
    }
  });

  it('returns ok:false, status:404, code:export_unavailable on 404 with non-JSON HTML body', async () => {
    // Spring HTML error page — res.json() throws a SyntaxError.
    const htmlBodyFetch: FetchFn = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('<html><body>Not Found</body></html>'),
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      } as unknown as Response);
    const client = createAccountApiClient(BASE, htmlBodyFetch);
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.code).toBe('export_unavailable');
    }
  });

  it('returns ok:false, status:401, code from body on 401', async () => {
    const client = createAccountApiClient(
      BASE,
      makeJsonResponse(401, { code: 'token_expired', message: 'Token expired' }),
    );
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('token_expired');
    }
  });

  it('returns ok:false on 500 (server error)', async () => {
    const client = createAccountApiClient(
      BASE,
      makeJsonResponse(500, { code: 'internal_error', message: 'Server error' }),
    );
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
  });

  it('returns ok:false, status:0, code:network_error when fetch throws', async () => {
    const errorFetch: FetchFn = () => Promise.reject(new Error('Network request failed'));
    const client = createAccountApiClient(BASE, errorFetch);
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.code).toBe('network_error');
    }
  });

  it('returns ok:false, status:0, code:timeout when request times out', async () => {
    // Use a very short timeout to trigger within test time
    const client = createAccountApiClient(BASE, hangingFetch(), 10 /* 10 ms */);
    const result = await client.exportAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.code).toBe('timeout');
    }
  }, 2000 /* jest timeout 2s */);

  it('returns ok:false, code:request_aborted when external nav-away signal fires', async () => {
    const ctrl = new AbortController();
    const client = createAccountApiClient(BASE, hangingFetch(), 30_000);
    const promise = client.exportAccount(TOKEN, ctrl.signal);
    // Abort immediately to simulate nav-away
    ctrl.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.code).toBe('request_aborted');
    }
  });

  it('does NOT console.log the response body (AR-AC-22 security)', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const sensitive = EXPORT_BODY;
    const client = createAccountApiClient(BASE, makeTextResponse(200, sensitive));
    await client.exportAccount(TOKEN);
    const logged = logSpy.mock.calls.flat().join('');
    expect(logged).not.toContain(sensitive);
    logSpy.mockRestore();
  });
});

// ─── deleteAccount ────────────────────────────────────────────────────────────

describe('accountApiClient.deleteAccount', () => {
  it('returns ok:true on 202', async () => {
    const client = createAccountApiClient(BASE, makeTextResponse(202));
    const result = await client.deleteAccount(TOKEN);
    expect(result.ok).toBe(true);
  });

  it('sends DELETE /v1/account with Authorization: Bearer header and no body', async () => {
    const { fn, calls } = spyFetch(202);
    await createAccountApiClient(BASE, fn).deleteAccount(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/account');
    expect(calls[0].init?.method).toBe('DELETE');
    expect((calls[0].init?.headers as Record<string, string>)?.['Authorization']).toBe(
      `Bearer ${TOKEN}`,
    );
    // No body per contract
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('returns ok:false, status:401 on 401', async () => {
    const client = createAccountApiClient(
      BASE,
      makeJsonResponse(401, { code: 'token_expired', message: 'Token expired' }),
    );
    const result = await client.deleteAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('returns ok:false, status:500 on server error', async () => {
    const client = createAccountApiClient(
      BASE,
      makeJsonResponse(500, { code: 'internal_error', message: 'Error' }),
    );
    const result = await client.deleteAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
  });

  it('returns ok:false, code:network_error when fetch throws', async () => {
    const errorFetch: FetchFn = () => Promise.reject(new Error('Network request failed'));
    const client = createAccountApiClient(BASE, errorFetch);
    const result = await client.deleteAccount(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.code).toBe('network_error');
    }
  });
});
