/**
 * Auth API client — unit tests (TDD, written BEFORE the implementation).
 *
 * Strategy: inject a fake FetchFn so tests are pure synchronous JS;
 * no network, no server, no global-fetch monkey-patch.
 */
import { createAuthClient, FetchFn } from './authApiClient';
import type { AuthTokens } from './types';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a minimal mock Response for a given status + optional JSON body. */
function makeResponse(status: number, body?: unknown): FetchFn {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: () => Promise.resolve(body ?? {}),
    } as unknown as Response);
}

/** Capture the URL and init that fetchFn was called with. */
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

const TOKENS: AuthTokens = {
  accessToken: 'at.eyJ',
  refreshToken: 'rt.opaque',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 1_209_600,
};

// ─── login ────────────────────────────────────────────────────────────────────

describe('authClient.login', () => {
  it('returns ok:true + tokens on 200', async () => {
    const client = createAuthClient(BASE, makeResponse(200, TOKENS));
    const r = await client.login({ email: 'a@b.com', password: 'pw123' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens).toEqual(TOKENS);
  });

  it('POSTs to /v1/auth/login with the correct URL and body', async () => {
    const { fn, calls } = spyFetch(200, TOKENS);
    await createAuthClient(BASE, fn).login({
      email: 'a@b.com',
      password: 'pw123',
      deviceId: 'device-001',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/login');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'pw123', deviceId: 'device-001' }),
    });
  });

  it('returns ok:false + code "invalid_credentials" on 401 (wrong email OR wrong password — non-enumerating)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(401, { code: 'invalid_credentials', message: 'Wrong.' }),
    );
    const r = await client.login({ email: 'a@b.com', password: 'wrong' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.code).toBe('invalid_credentials');
    }
  });

  it('returns ok:false + code "rate_limited" on 429', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(429, { code: 'rate_limited', message: 'Slow down.' }),
    );
    const r = await client.login({ email: 'a@b.com', password: 'pw123' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.code).toBe('rate_limited');
    }
  });

  it('returns ok:false with status 500 on server error', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(500, { code: 'internal_error', message: 'Oops.' }),
    );
    const r = await client.login({ email: 'a@b.com', password: 'pw123' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
  });
});

// ─── register ─────────────────────────────────────────────────────────────────

describe('authClient.register', () => {
  it('returns ok:true on 202 (verification_pending)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(202, { code: 'verification_pending' }),
    );
    const r = await client.register({ email: 'new@b.com', password: 'Str0ng!' });
    expect(r.ok).toBe(true);
  });

  it('treats 202 as success even for a colliding email — the API is non-enumerating (§E)', async () => {
    // The server returns the SAME 202 for both new and existing emails.
    // Our client must therefore treat 202 as success always (no branching on body).
    const client = createAuthClient(
      BASE,
      makeResponse(202, { code: 'verification_pending' }),
    );
    const r = await client.register({ email: 'existing@b.com', password: 'Str0ng!' });
    expect(r.ok).toBe(true);
  });

  it('POSTs to /v1/auth/register', async () => {
    const { fn, calls } = spyFetch(202, { code: 'verification_pending' });
    await createAuthClient(BASE, fn).register({ email: 'a@b.com', password: 'Str0ng!' });
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/register');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('returns ok:false + code "password_too_short" on 422', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(422, { code: 'password_too_short', message: 'Too short.' }),
    );
    const r = await client.register({ email: 'a@b.com', password: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(422);
      expect(r.code).toBe('password_too_short');
    }
  });

  it('returns ok:false + code "password_breached" on 422', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(422, { code: 'password_breached', message: 'Breached.' }),
    );
    const r = await client.register({ email: 'a@b.com', password: 'password1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('password_breached');
  });

  it('returns ok:false on 429 rate_limited', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(429, { code: 'rate_limited', message: 'Too many.' }),
    );
    const r = await client.register({ email: 'a@b.com', password: 'Str0ng!' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('rate_limited');
  });
});

// ─── refresh ──────────────────────────────────────────────────────────────────

describe('authClient.refresh', () => {
  it('returns ok:true + new tokens on 200 (token rotation)', async () => {
    const newTokens: AuthTokens = { ...TOKENS, accessToken: 'at.rotated' };
    const client = createAuthClient(BASE, makeResponse(200, newTokens));
    const r = await client.refresh({ refreshToken: 'rt.opaque' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens.accessToken).toBe('at.rotated');
  });

  it('POSTs to /v1/auth/refresh', async () => {
    const { fn, calls } = spyFetch(200, TOKENS);
    await createAuthClient(BASE, fn).refresh({ refreshToken: 'rt.opaque', deviceId: 'd1' });
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/refresh');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('returns ok:false + code "token_reuse_detected" on 401 (whole family revoked)', async () => {
    // A previously-rotated token was presented — the server revokes the entire family.
    const client = createAuthClient(
      BASE,
      makeResponse(401, { code: 'token_reuse_detected', message: 'Possible theft.' }),
    );
    const r = await client.refresh({ refreshToken: 'rt.stale' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.code).toBe('token_reuse_detected');
    }
  });
});

// ─── forgotPassword ───────────────────────────────────────────────────────────

describe('authClient.forgotPassword', () => {
  it('returns ok:true on 202 (always — non-enumerating, email-exists branch is server-only)', async () => {
    const client = createAuthClient(BASE, makeResponse(202));
    const r = await client.forgotPassword({ email: 'anyone@example.com' });
    expect(r.ok).toBe(true);
  });

  it('returns ok:true on 202 even for a non-existent email (non-enumerating contract, §E)', async () => {
    // Server always returns 202 — client must not attempt to distinguish existence.
    const client = createAuthClient(BASE, makeResponse(202));
    const r = await client.forgotPassword({ email: 'ghost@nowhere.io' });
    expect(r.ok).toBe(true);
  });

  it('POSTs to /v1/auth/forgot-password', async () => {
    const { fn, calls } = spyFetch(202);
    await createAuthClient(BASE, fn).forgotPassword({ email: 'a@b.com' });
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/forgot-password');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('returns ok:false + code "rate_limited" on 429', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(429, { code: 'rate_limited', message: 'Too many.' }),
    );
    const r = await client.forgotPassword({ email: 'a@b.com' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.code).toBe('rate_limited');
    }
  });
});

// ─── resetPassword ────────────────────────────────────────────────────────────

describe('authClient.resetPassword', () => {
  it('returns ok:true on 204 (success)', async () => {
    const client = createAuthClient(BASE, makeResponse(204));
    const r = await client.resetPassword({ token: 'tok-abc', newPassword: 'NewPass123!' });
    expect(r.ok).toBe(true);
  });

  it('POSTs to /v1/auth/reset-password with token + newPassword', async () => {
    const { fn, calls } = spyFetch(204);
    await createAuthClient(BASE, fn).resetPassword({
      token: 'tok-abc',
      newPassword: 'NewPass123!',
    });
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/reset-password');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ token: 'tok-abc', newPassword: 'NewPass123!' }),
    });
  });

  it('returns ok:false + code "reset_token_invalid" on 410 (bad/expired/used token — §E)', async () => {
    // Single generic code — does not distinguish "wrong token" / "expired" / "already used".
    const client = createAuthClient(
      BASE,
      makeResponse(410, { code: 'reset_token_invalid', message: 'Gone.' }),
    );
    const r = await client.resetPassword({ token: 'expired', newPassword: 'NewPass123!' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(410);
      expect(r.code).toBe('reset_token_invalid');
    }
  });

  it('returns ok:false + code "password_too_short" on 422', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(422, { code: 'password_too_short', message: 'Too short.' }),
    );
    const r = await client.resetPassword({ token: 'tok', newPassword: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(422);
      expect(r.code).toBe('password_too_short');
    }
  });

  it('returns ok:false + code "password_breached" on 422', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(422, { code: 'password_breached', message: 'Breached.' }),
    );
    const r = await client.resetPassword({ token: 'tok', newPassword: 'password1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('password_breached');
  });
});
