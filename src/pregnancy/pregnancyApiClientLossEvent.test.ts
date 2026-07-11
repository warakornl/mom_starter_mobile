/**
 * pregnancyApiClientLossEvent.test.ts — TDD for recordLossEvent + reopenPregnancy.
 *
 * api-contract.md "Pregnancy-loss write path" (L604-605) + functional-spec §7.1-§7.4:
 *   POST /pregnancy-profile/loss-event — { lossDate? } → 200 lifecycle:'ended'
 *   POST /pregnancy-profile/reopen     — no body       → 200 lifecycle:'pregnant'
 * Both require Authorization + If-Match; both surface 409 with currentProfile body
 * (mirrors G-4 putProfile pattern) so the client can adopt-on-conflict (§10.4).
 */

import { createPregnancyClient } from './pregnancyApiClient';
import type { FetchFn } from '../auth/authApiClient';
import type { PregnancyProfile } from './types';

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'uuid-server',
    version: 5,
    edd: '2026-12-01',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    gestationalWeek: 20,
    gestationalDay: 0,
    daysRemaining: 148,
    progress: 0.5,
    currentStage: 'T2',
    deliveryWindowActive: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeFetch(status: number, body: unknown): { fetch: FetchFn; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Error',
      json: async () => body,
    } as Response;
  };
  return { fetch, calls };
}

describe('createPregnancyClient.recordLossEvent', () => {
  it('POSTs to /v1/pregnancy-profile/loss-event with Authorization + If-Match headers', async () => {
    const { fetch, calls } = makeFetch(200, makeProfile({ lifecycle: 'ended' }));
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.recordLossEvent({ lossDate: '2026-06-30' }, 'token-abc', '5', '2026-07-11');

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/v1/pregnancy-profile/loss-event');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
    expect(headers['If-Match']).toBe('"5"');
    expect(headers['X-Client-Date']).toBe('2026-07-11');
    // NEVER log accessToken — this test only asserts the header, not any console output.
  });

  it('body omits lossDate key when not provided (LOSS-INV-11 — full success with no date)', async () => {
    const { fetch, calls } = makeFetch(200, makeProfile({ lifecycle: 'ended' }));
    const client = createPregnancyClient('https://api.test', fetch);

    await client.recordLossEvent({}, 'token-abc', '5', '2026-07-11');

    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('lossDate');
  });

  it('200 success returns { ok: true, profile } with lifecycle ended', async () => {
    const profile = makeProfile({ lifecycle: 'ended' });
    const { fetch } = makeFetch(200, profile);
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.recordLossEvent({}, 'token', '5', '2026-07-11');
    expect(result).toEqual({ ok: true, profile });
  });

  it('409 response surfaces currentProfile in the result body (adopt-on-conflict, §10.4)', async () => {
    const serverProfile = makeProfile({ lifecycle: 'ended', version: 6 });
    const { fetch } = makeFetch(409, {
      code: 'version_conflict',
      message: 'stale',
      currentProfile: serverProfile,
    });
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.recordLossEvent({}, 'token', '5', '2026-07-11');
    expect(result.ok).toBe(false);
    if (!result.ok && 'currentProfile' in result) {
      expect(result.currentProfile).toEqual(serverProfile);
    } else {
      throw new Error('expected 409 result');
    }
  });

  it('403 consent_required surfaces code for calm consent-backstop UI', async () => {
    const { fetch } = makeFetch(403, { code: 'consent_required', message: 'no consent', details: 'general_health' });
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.recordLossEvent({}, 'token', '5', '2026-07-11');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe('consent_required');
    }
  });

  it('428 precondition_required when If-Match is absent server-side is surfaced as an error', async () => {
    const { fetch } = makeFetch(428, { code: 'precondition_required', message: 'missing If-Match' });
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.recordLossEvent({}, 'token', '5', '2026-07-11');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(428);
  });
});

describe('createPregnancyClient.reopenPregnancy', () => {
  it('POSTs to /v1/pregnancy-profile/reopen with no body, Authorization + If-Match headers', async () => {
    const { fetch, calls } = makeFetch(200, makeProfile({ lifecycle: 'pregnant' }));
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.reopenPregnancy('token-abc', '7');

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/v1/pregnancy-profile/reopen');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
    expect(headers['If-Match']).toBe('"7"');
  });

  it('200 success returns { ok: true, profile } with lifecycle pregnant', async () => {
    const profile = makeProfile({ lifecycle: 'pregnant' });
    const { fetch } = makeFetch(200, profile);
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.reopenPregnancy('token', '7');
    expect(result).toEqual({ ok: true, profile });
  });

  it('409 response surfaces currentProfile (adopt-on-conflict, §10.4)', async () => {
    const serverProfile = makeProfile({ lifecycle: 'ended', version: 8 });
    const { fetch } = makeFetch(409, {
      code: 'version_conflict',
      message: 'stale',
      currentProfile: serverProfile,
    });
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.reopenPregnancy('token', '7');
    expect(result.ok).toBe(false);
    if (!result.ok && 'currentProfile' in result) {
      expect(result.currentProfile).toEqual(serverProfile);
    } else {
      throw new Error('expected 409 result');
    }
  });

  it('409 invalid_lifecycle_state (postpartum) is surfaced as a benign conflict', async () => {
    const serverProfile = makeProfile({ lifecycle: 'postpartum' });
    const { fetch } = makeFetch(409, {
      code: 'invalid_lifecycle_state',
      message: 'postpartum',
      details: 'postpartum',
      currentProfile: serverProfile,
    });
    const client = createPregnancyClient('https://api.test', fetch);

    const result = await client.reopenPregnancy('token', '7');
    expect(result.ok).toBe(false);
    if (!result.ok && 'currentProfile' in result) {
      expect(result.code).toBe('invalid_lifecycle_state');
      expect(result.currentProfile?.lifecycle).toBe('postpartum');
    } else {
      throw new Error('expected 409 result');
    }
  });
});
