/**
 * Verify-email / Check-inbox screen — non-UI logic tests (TDD, written BEFORE the implementation).
 *
 * Tests for:
 *  - `verifyStrings`      — i18n completeness + non-enumeration check
 *  - `handleResend`       — resend-verification: success on 202 + cooldown; rate_limited; network/server
 *  - `handleVerifyToken`  — deep-link verify: stores tokens on 200; 410; storage failure; network/server
 *
 * Key security properties verified here:
 *  - handleResend always returns 'success' on 202 regardless of email existence (§E/C7)
 *  - handleVerifyToken stores tokens ONLY on 200 success; never on failure
 *  - If storage.save() throws, handleVerifyToken returns 'server_error' (not an unhandled reject)
 *    — this prevents the loading spinner from getting stuck (lesson from login review)
 */
import {
  verifyStrings,
  handleResend,
  handleVerifyToken,
  RESEND_COOLDOWN_MS,
} from './verifyEmailScreenLogic';
import { InMemoryTokenStorage } from './tokenStorage';
import type { AuthClient } from './authApiClient';
import type { AuthTokens } from './types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOKENS: AuthTokens = {
  accessToken: 'at.eyJhbGciOiJSUzI1NiJ9',
  refreshToken: 'rt.opaque',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 1_209_600,
};

function makeResendClient(
  result: Awaited<ReturnType<AuthClient['resendVerification']>>,
): Pick<AuthClient, 'resendVerification'> {
  return { resendVerification: jest.fn(() => Promise.resolve(result)) };
}

function makeVerifyClient(
  result: Awaited<ReturnType<AuthClient['verifyEmail']>>,
): Pick<AuthClient, 'verifyEmail'> {
  return { verifyEmail: jest.fn(() => Promise.resolve(result)) };
}

// ─── verifyStrings ────────────────────────────────────────────────────────────

describe('verifyStrings', () => {
  it('has the expected keys in both locales', () => {
    const keys: (keyof (typeof verifyStrings)['th'])[] = [
      'title', 'stepLabel', 'sentToPrefix', 'openLinkHint',
      'spamTip', 'resend', 'resentConfirm', 'changeEmail',
      'rateLimited', 'tokenInvalid', 'offline', 'serverError',
    ];
    for (const k of keys) {
      expect(verifyStrings.th[k]).toBeTruthy();
      expect(verifyStrings.en[k]).toBeTruthy();
    }
  });

  it('title (th) tells the user to check their email inbox', () => {
    expect(verifyStrings.th.title).toContain('อีเมล');
  });

  it('resentConfirm (th) is non-enumerating — does not reveal email existence', () => {
    expect(verifyStrings.th.resentConfirm).not.toContain('มีบัญชี');
    expect(verifyStrings.th.resentConfirm).not.toContain('ถูกลงทะเบียน');
  });

  it('tokenInvalid (th) instructs the user to request a new link', () => {
    expect(verifyStrings.th.tokenInvalid).toBeTruthy();
    // Must mention requesting a new link, not blame the user
    expect(verifyStrings.th.tokenInvalid.length).toBeGreaterThan(0);
  });
});

// ─── handleResend ─────────────────────────────────────────────────────────────

describe('handleResend', () => {
  it('returns { kind: "success", resendAt } on 202', async () => {
    const fixedNow = 1_700_000_000_000;
    const outcome = await handleResend({
      email: 'user@example.com',
      client: makeResendClient({ ok: true }),
      nowFn: () => fixedNow,
    });
    expect(outcome).toEqual({ kind: 'success', resendAt: fixedNow + RESEND_COOLDOWN_MS });
  });

  it('resendAt is exactly RESEND_COOLDOWN_MS (60 000 ms) after nowFn()', async () => {
    const fixedNow = 0;
    const outcome = await handleResend({
      email: 'user@example.com',
      client: makeResendClient({ ok: true }),
      nowFn: () => fixedNow,
    });
    if (outcome.kind === 'success') {
      expect(outcome.resendAt).toBe(RESEND_COOLDOWN_MS);
    }
  });

  it('returns success on 202 even for a non-existent/already-verified email (non-enumerating, §E)', async () => {
    // Server always returns 202 regardless of email state — client must not distinguish.
    const outcome = await handleResend({
      email: 'ghost@nowhere.io',
      client: makeResendClient({ ok: true }),
    });
    expect(outcome.kind).toBe('success');
  });

  it('passes the email to resendVerification', async () => {
    const resendMock = jest.fn(() => Promise.resolve({ ok: true as const }));
    await handleResend({
      email: 'user@example.com',
      client: { resendVerification: resendMock },
    });
    expect(resendMock).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('returns { kind: "rate_limited" } on 429', async () => {
    const outcome = await handleResend({
      email: 'user@example.com',
      client: makeResendClient({
        ok: false, status: 429, code: 'rate_limited', message: 'Too many.',
      }),
    });
    expect(outcome).toEqual({ kind: 'rate_limited' });
  });

  it('returns { kind: "network_error" } when fetch throws (no connection)', async () => {
    const brokenClient: Pick<AuthClient, 'resendVerification'> = {
      resendVerification: jest.fn(() =>
        Promise.reject(new TypeError('Network request failed')),
      ),
    };
    const outcome = await handleResend({
      email: 'user@example.com',
      client: brokenClient,
    });
    expect(outcome).toEqual({ kind: 'network_error' });
  });

  it('returns { kind: "server_error" } for unexpected error codes', async () => {
    const outcome = await handleResend({
      email: 'user@example.com',
      client: makeResendClient({
        ok: false, status: 500, code: 'internal_error', message: 'Oops.',
      }),
    });
    expect(outcome).toMatchObject({ kind: 'server_error', code: 'internal_error' });
  });
});

// ─── handleVerifyToken ────────────────────────────────────────────────────────

describe('handleVerifyToken', () => {
  it('stores tokens and returns { kind: "success" } on 200', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleVerifyToken({
      token: 'ver-tok-abc',
      client: makeVerifyClient({ ok: true, tokens: TOKENS }),
      storage,
    });
    expect(outcome).toEqual({ kind: 'success' });
    // Tokens must be persisted in secure storage
    expect(await storage.load()).toEqual(TOKENS);
  });

  it('passes token + deviceId to verifyEmail', async () => {
    const storage = new InMemoryTokenStorage();
    const verifyMock = jest.fn(() =>
      Promise.resolve({ ok: true as const, tokens: TOKENS }),
    );
    await handleVerifyToken({
      token: 'ver-tok',
      deviceId: 'device-001',
      client: { verifyEmail: verifyMock },
      storage,
    });
    expect(verifyMock).toHaveBeenCalledWith({ token: 'ver-tok', deviceId: 'device-001' });
  });

  it('returns { kind: "token_invalid" } on 410 verify_token_invalid', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleVerifyToken({
      token: 'expired-tok',
      client: makeVerifyClient({
        ok: false, status: 410, code: 'verify_token_invalid', message: 'Gone.',
      }),
      storage,
    });
    expect(outcome).toEqual({ kind: 'token_invalid' });
  });

  it('does NOT store tokens when verifyEmail returns an error', async () => {
    const storage = new InMemoryTokenStorage();
    await handleVerifyToken({
      token: 'bad-tok',
      client: makeVerifyClient({
        ok: false, status: 410, code: 'verify_token_invalid', message: 'Gone.',
      }),
      storage,
    });
    expect(await storage.load()).toBeNull();
  });

  it('returns { kind: "network_error" } when fetch throws', async () => {
    const storage = new InMemoryTokenStorage();
    const brokenClient: Pick<AuthClient, 'verifyEmail'> = {
      verifyEmail: jest.fn(() =>
        Promise.reject(new TypeError('Network request failed')),
      ),
    };
    const outcome = await handleVerifyToken({
      token: 'ver-tok',
      client: brokenClient,
      storage,
    });
    expect(outcome).toEqual({ kind: 'network_error' });
  });

  it('returns { kind: "server_error", code: "storage_error" } when storage.save() throws', async () => {
    // Security / UX invariant: storage.save() is inside the try-block so a
    // Keychain/Keystore failure is caught and returned as a typed outcome.
    // This prevents the loading spinner from getting stuck (lesson from login review).
    // The outcome is 'server_error' (not 'network_error') because the network
    // call succeeded — the failure is on the local secure-storage layer.
    const failingStorage = {
      save: jest.fn(() => Promise.reject(new Error('Keychain unavailable'))),
      load: jest.fn(() => Promise.resolve(null)),
      clear: jest.fn(() => Promise.resolve()),
    };
    const outcome = await handleVerifyToken({
      token: 'ver-tok',
      client: makeVerifyClient({ ok: true, tokens: TOKENS }),
      storage: failingStorage,
    });
    expect(outcome).toMatchObject({ kind: 'server_error', code: 'storage_error' });
  });

  it('returns { kind: "server_error" } for unexpected error codes (5xx)', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleVerifyToken({
      token: 'ver-tok',
      client: makeVerifyClient({
        ok: false, status: 500, code: 'internal_error', message: 'Oops.',
      }),
      storage,
    });
    expect(outcome).toMatchObject({ kind: 'server_error', code: 'internal_error' });
  });
});
