/**
 * Auth API client — unit tests (TDD, written BEFORE the implementation).
 *
 * Strategy: inject a fake FetchFn so tests are pure synchronous JS;
 * no network, no server, no global-fetch monkey-patch.
 */
import { createAuthClient, FetchFn } from './authApiClient';
import type { AuthTokens, DeviceSession } from './types';

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

// ─── verifyEmail ──────────────────────────────────────────────────────────────

describe('authClient.verifyEmail', () => {
  it('returns ok:true + tokens on 200 (first session for the account)', async () => {
    const client = createAuthClient(BASE, makeResponse(200, TOKENS));
    const r = await client.verifyEmail({ token: 'ver-tok-abc' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens).toEqual(TOKENS);
  });

  it('POSTs to /v1/auth/verify-email with token + optional deviceId', async () => {
    const { fn, calls } = spyFetch(200, TOKENS);
    await createAuthClient(BASE, fn).verifyEmail({
      token: 'ver-tok-abc',
      deviceId: 'device-001',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/verify-email');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ token: 'ver-tok-abc', deviceId: 'device-001' }),
    });
  });

  it('returns ok:false + code "verify_token_invalid" on 410 (bad/expired/used token — §E/C9)', async () => {
    // Single generic code — does not distinguish bad/expired/already-used (avoids oracle).
    const client = createAuthClient(
      BASE,
      makeResponse(410, { code: 'verify_token_invalid', message: 'Gone.' }),
    );
    const r = await client.verifyEmail({ token: 'bad-token' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(410);
      expect(r.code).toBe('verify_token_invalid');
    }
  });

  it('returns ok:false on 422 (validation error)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(422, { code: 'validation_error', message: 'Invalid.' }),
    );
    const r = await client.verifyEmail({ token: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it('returns ok:false + code "rate_limited" on 429', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(429, { code: 'rate_limited', message: 'Too many.' }),
    );
    const r = await client.verifyEmail({ token: 'ver-tok' });
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
    const r = await client.verifyEmail({ token: 'ver-tok' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
  });
});

// ─── resendVerification ───────────────────────────────────────────────────────

describe('authClient.resendVerification', () => {
  it('returns ok:true on 202 (always — non-enumerating, same posture as forgotPassword)', async () => {
    const client = createAuthClient(BASE, makeResponse(202));
    const r = await client.resendVerification({ email: 'user@example.com' });
    expect(r.ok).toBe(true);
  });

  it('returns ok:true on 202 even for a non-existent or already-verified email (non-enumerating, §E)', async () => {
    // Server never reveals whether the email exists or is already verified.
    const client = createAuthClient(BASE, makeResponse(202));
    const r = await client.resendVerification({ email: 'ghost@nowhere.io' });
    expect(r.ok).toBe(true);
  });

  it('POSTs to /v1/auth/resend-verification with the email', async () => {
    const { fn, calls } = spyFetch(202);
    await createAuthClient(BASE, fn).resendVerification({ email: 'user@example.com' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/resend-verification');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    });
  });

  it('returns ok:false + code "rate_limited" on 429', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(429, { code: 'rate_limited', message: 'Too many.' }),
    );
    const r = await client.resendVerification({ email: 'user@example.com' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.code).toBe('rate_limited');
    }
  });
});

// ─── google ───────────────────────────────────────────────────────────────────

describe('authClient.google', () => {
  it('returns ok:true + tokens on 200 (successful Google sign-in, returning or brand-new user — §J G4)', async () => {
    const client = createAuthClient(BASE, makeResponse(200, TOKENS));
    const r = await client.google({ idToken: 'google.id.tok', nonce: 'nonce-rand-abc' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens).toEqual(TOKENS);
  });

  it('POSTs to /v1/auth/google with correct body and NO Authorization header (unauthenticated endpoint, §J/Conventions)', async () => {
    const { fn, calls } = spyFetch(200, TOKENS);
    await createAuthClient(BASE, fn).google({
      idToken: 'google.id.tok',
      nonce: 'nonce-rand-abc',
      deviceId: 'dev-001',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/google');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ idToken: 'google.id.tok', nonce: 'nonce-rand-abc', deviceId: 'dev-001' }),
    });
    // /auth/google is on the unauthenticated list — must NOT send Authorization header
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns ok:false + code "google_token_invalid" on 401 (any G2 check failure — single generic code, avoids oracle)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(401, { code: 'google_token_invalid', message: 'ID token verification failed.' }),
    );
    const r = await client.google({ idToken: 'forged.tok', nonce: 'nonce-rand-abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.code).toBe('google_token_invalid');
    }
  });

  it('returns ok:false + code "link_required" on 409 (Google email collides with existing local account — G4, no auto-merge or silent takeover)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(409, { code: 'link_required', message: 'An account with this email already exists.' }),
    );
    const r = await client.google({ idToken: 'google.id.tok', nonce: 'nonce-rand-abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe('link_required');
    }
  });

  it('returns ok:false + code "rate_limited" on 429 (§H per-IP + per-Google-sub ceiling)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(429, { code: 'rate_limited', message: 'Too many requests.' }),
    );
    const r = await client.google({ idToken: 'google.id.tok', nonce: 'nonce-rand-abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.code).toBe('rate_limited');
    }
  });
});

// ─── logout ───────────────────────────────────────────────────────────────────

describe('authClient.logout', () => {
  it('returns ok:true on 204 (server-side revocation successful)', async () => {
    const client = createAuthClient(BASE, makeResponse(204));
    const r = await client.logout({ refreshToken: 'rt.opaque' }, 'at.eyJ');
    expect(r.ok).toBe(true);
  });

  it('POSTs to /v1/auth/logout with Authorization: Bearer header (Bearer required — §C/Conventions)', async () => {
    const { fn, calls } = spyFetch(204);
    await createAuthClient(BASE, fn).logout({ refreshToken: 'rt.opaque' }, 'at.eyJ');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/logout');
    expect(calls[0].init?.method).toBe('POST');
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer at.eyJ');
  });

  it('sends refreshToken in the request body (revokes that one device family)', async () => {
    const { fn, calls } = spyFetch(204);
    await createAuthClient(BASE, fn).logout({ refreshToken: 'rt.opaque' }, 'at.eyJ');
    expect(calls[0].init).toMatchObject({
      body: JSON.stringify({ refreshToken: 'rt.opaque' }),
    });
  });

  it('supports allDevices:true to revoke every family ("sign out everywhere" / lost-phone, §C)', async () => {
    const { fn, calls } = spyFetch(204);
    const r = await createAuthClient(BASE, fn).logout({ allDevices: true }, 'at.eyJ');
    expect(r.ok).toBe(true);
    expect(calls[0].init).toMatchObject({
      body: JSON.stringify({ allDevices: true }),
    });
  });

  it('returns ok:false on 401 (access token invalid or session already revoked)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(401, { code: 'invalid_token', message: 'Unauthorized.' }),
    );
    const r = await client.logout({ refreshToken: 'rt.opaque' }, 'at.expired');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
});

// ─── listSessions ─────────────────────────────────────────────────────────────

describe('authClient.listSessions', () => {
  const SESSION: DeviceSession = {
    deviceId: 'dev-001',
    deviceName: 'iPhone 15',
    createdAt: '2026-06-01T10:00:00Z',
    lastSeenAt: '2026-06-29T08:00:00Z',
    current: true,
  };

  it('returns ok:true + page with items array on 200 (contract shape: Page<DeviceSession>)', async () => {
    const client = createAuthClient(BASE, makeResponse(200, { items: [SESSION] }));
    const r = await client.listSessions('at.eyJ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.page.items).toHaveLength(1);
      expect(r.page.items[0]).toEqual(SESSION);
    }
  });

  it('GETs /v1/auth/sessions with Authorization: Bearer header (Bearer required — §D/C5/Conventions)', async () => {
    const { fn, calls } = spyFetch(200, { items: [SESSION] });
    await createAuthClient(BASE, fn).listSessions('at.eyJ');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/sessions');
    expect(calls[0].init?.method).toBe('GET');
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer at.eyJ');
  });

  it('reads response as SessionsPage {items, nextCursor?} — NOT a bare array (contract N5: Page<DeviceSession>)', async () => {
    // Contract says GET /auth/sessions → Page<DeviceSession> = { items[], nextCursor? }
    // Client MUST read .items, not treat the response body as a bare array.
    // (Backend will be updated to return this Page shape separately.)
    const client = createAuthClient(
      BASE,
      makeResponse(200, { items: [SESSION], nextCursor: 'cursor-xyz' }),
    );
    const r = await client.listSessions('at.eyJ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Array.isArray(r.page.items)).toBe(true);
      expect(r.page.nextCursor).toBe('cursor-xyz');
    }
  });

  it('returns ok:false on 401 (access token invalid or expired)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(401, { code: 'invalid_token', message: 'Unauthorized.' }),
    );
    const r = await client.listSessions('at.expired');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
});

// ─── revokeSession ────────────────────────────────────────────────────────────

describe('authClient.revokeSession', () => {
  it('returns ok:true on 204 (device family revoked)', async () => {
    const client = createAuthClient(BASE, makeResponse(204));
    const r = await client.revokeSession('dev-002', 'at.eyJ');
    expect(r.ok).toBe(true);
  });

  it('DELETEs /v1/auth/sessions/{deviceId} with Authorization: Bearer header (§D/C5)', async () => {
    const { fn, calls } = spyFetch(204);
    await createAuthClient(BASE, fn).revokeSession('dev-002', 'at.eyJ');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/sessions/dev-002');
    expect(calls[0].init?.method).toBe('DELETE');
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer at.eyJ');
  });

  it('interpolates deviceId into the URL path correctly', async () => {
    const { fn, calls } = spyFetch(204);
    await createAuthClient(BASE, fn).revokeSession('my-tablet-id-123', 'at.eyJ');
    expect(calls[0].url).toBe('http://localhost:8080/v1/auth/sessions/my-tablet-id-123');
  });

  it('returns ok:false on 401 (access token invalid or session already revoked)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(401, { code: 'invalid_token', message: 'Unauthorized.' }),
    );
    const r = await client.revokeSession('dev-002', 'at.expired');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('returns ok:false on 404 (device not found or already removed)', async () => {
    const client = createAuthClient(
      BASE,
      makeResponse(404, { code: 'not_found', message: 'Device session not found.' }),
    );
    const r = await client.revokeSession('dev-nonexistent', 'at.eyJ');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.code).toBe('not_found');
    }
  });
});
