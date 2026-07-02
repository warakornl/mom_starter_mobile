/**
 * consentApiClient — unit tests (TDD, written BEFORE the implementation).
 *
 * Strategy: inject a fake FetchFn so tests are pure synchronous JS;
 * no network, no server, no global-fetch monkey-patch.
 *
 * Contract under test:
 *   postConsent(consentType, granted, version, token) → POST /v1/account/consents
 *   getConsents(token, cursor?, limit?) → GET /v1/account/consents
 */

import { createConsentApiClient } from './consentApiClient';
import type { FetchFn } from './consentApiClient';
import type { ConsentRecord } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(status: number, body?: unknown): FetchFn {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: () => Promise.resolve(body ?? {}),
    } as unknown as Response);
}

function spyFetch(
  status: number,
  body?: unknown,
): { fn: FetchFn; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn: FetchFn = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: () => Promise.resolve(body ?? {}),
    } as unknown as Response);
  };
  return { fn, calls };
}

const BASE = 'http://localhost:8080';
const TOKEN = 'Bearer-access-token-abc';

const SAMPLE_RECORD: ConsentRecord = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  consentType: 'general_health',
  granted: true,
  consentTextVersion: 'v1.0-th',
  grantedAt: '2026-07-03T09:00:00Z',
};

// ─── postConsent ─────────────────────────────────────────────────────────────

describe('consentClient.postConsent', () => {
  it('returns ok:true + record on 201', async () => {
    const client = createConsentApiClient(BASE, makeResponse(201, SAMPLE_RECORD));
    const r = await client.postConsent('general_health', true, 'v1.0-th', TOKEN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.consentType).toBe('general_health');
      expect(r.record.granted).toBe(true);
      expect(r.record.consentTextVersion).toBe('v1.0-th');
      expect(r.record.id).toBe(SAMPLE_RECORD.id);
    }
  });

  it('POSTs to /v1/account/consents with Authorization header and correct body', async () => {
    const { fn, calls } = spyFetch(201, SAMPLE_RECORD);
    await createConsentApiClient(BASE, fn).postConsent(
      'general_health',
      true,
      'v1.0-th',
      TOKEN,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/account/consents');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      }),
      body: JSON.stringify({
        consentType: 'general_health',
        granted: true,
        consentTextVersion: 'v1.0-th',
      }),
    });
  });

  it('returns ok:false + code on 401 (unauthorized)', async () => {
    const client = createConsentApiClient(
      BASE,
      makeResponse(401, { code: 'unauthorized', message: 'No token' }),
    );
    const r = await client.postConsent('general_health', true, 'v1.0-th', TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.code).toBe('unauthorized');
    }
  });

  it('returns ok:false + code on 422 (unknown consent type)', async () => {
    const client = createConsentApiClient(
      BASE,
      makeResponse(422, { code: 'validation_error', message: 'Unknown type' }),
    );
    const r = await client.postConsent(
      'general_health',
      true,
      'v1.0-th',
      TOKEN,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(422);
      expect(r.code).toBe('validation_error');
    }
  });

  it('returns ok:false on network error (fetch throws)', async () => {
    const throwingFetch: FetchFn = () => Promise.reject(new Error('Network error'));
    const client = createConsentApiClient(BASE, throwingFetch);
    const r = await client.postConsent('general_health', true, 'v1.0-th', TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(0);
      expect(r.code).toBe('network_error');
    }
  });

  it('sends granted:false for a withdrawal', async () => {
    const { fn, calls } = spyFetch(201, { ...SAMPLE_RECORD, granted: false });
    await createConsentApiClient(BASE, fn).postConsent(
      'cloud_storage',
      false,
      'v1.0-th',
      TOKEN,
    );
    const body = JSON.parse(calls[0].init?.body as string) as Record<string, unknown>;
    expect(body.granted).toBe(false);
    expect(body.consentType).toBe('cloud_storage');
  });
});

// ─── getConsents ──────────────────────────────────────────────────────────────

describe('consentClient.getConsents', () => {
  const PAGE = {
    items: [SAMPLE_RECORD],
    nextCursor: null,
  };

  it('returns ok:true + page on 200', async () => {
    const client = createConsentApiClient(BASE, makeResponse(200, PAGE));
    const r = await client.getConsents(TOKEN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.page.items).toHaveLength(1);
      expect(r.page.items[0].consentType).toBe('general_health');
      expect(r.page.nextCursor).toBeNull();
    }
  });

  it('GETs /v1/account/consents with Authorization header', async () => {
    const { fn, calls } = spyFetch(200, PAGE);
    await createConsentApiClient(BASE, fn).getConsents(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/account/consents');
    expect(calls[0].init).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({
        'Authorization': `Bearer ${TOKEN}`,
      }),
    });
  });

  it('appends cursor and limit query params when provided', async () => {
    const { fn, calls } = spyFetch(200, PAGE);
    await createConsentApiClient(BASE, fn).getConsents(TOKEN, 'cursor-abc', 10);
    expect(calls[0].url).toBe(
      'http://localhost:8080/v1/account/consents?cursor=cursor-abc&limit=10',
    );
  });

  it('appends only limit when cursor is omitted', async () => {
    const { fn, calls } = spyFetch(200, PAGE);
    await createConsentApiClient(BASE, fn).getConsents(TOKEN, undefined, 5);
    expect(calls[0].url).toBe(
      'http://localhost:8080/v1/account/consents?limit=5',
    );
  });

  it('returns ok:false + code on 401', async () => {
    const client = createConsentApiClient(
      BASE,
      makeResponse(401, { code: 'unauthorized', message: 'No token' }),
    );
    const r = await client.getConsents(TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.code).toBe('unauthorized');
    }
  });

  it('returns ok:false on network error', async () => {
    const throwingFetch: FetchFn = () => Promise.reject(new Error('Network error'));
    const client = createConsentApiClient(BASE, throwingFetch);
    const r = await client.getConsents(TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(0);
      expect(r.code).toBe('network_error');
    }
  });
});
