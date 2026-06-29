/**
 * Login screen — non-UI logic tests (TDD, written BEFORE the implementation).
 *
 * What we test here (pure functions, no RN rendering):
 *  - `validateEmailField`   — input sanity (not a policy gate)
 *  - `validatePasswordField` — non-empty check (policy is appsec SEC-HOOK)
 *  - `loginStrings`         — i18n completeness + non-enumeration copy
 *  - `handleSignIn`         — submit handler: API call → token storage → outcome
 *
 * Why no render tests:
 *   The project has no React/React Native installed (package.json has no
 *   "react" or "react-native" dependency) and jest is configured for the
 *   'node' environment. Adding @testing-library/react-native would require
 *   significant deps (Metro, Babel preset-expo, react-test-renderer) that
 *   are out of scope for this slice. The screen's rendered output is
 *   validated by the UX spec + visual QA; the testable behavior lives here.
 */
import {
  validateEmailField,
  validatePasswordField,
  handleSignIn,
  loginStrings,
} from './loginScreenLogic';
import { InMemoryTokenStorage } from './tokenStorage';
import type { AuthClient } from './authApiClient';
import type { AuthTokens } from './types';

// ─── Fixture ─────────────────────────────────────────────────────────────────

const TOKENS: AuthTokens = {
  accessToken: 'at.eyJhbGciOiJSUzI1NiJ9',
  refreshToken: 'rt.opaque',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 1_209_600,
};

/** Build a minimal stub for the login method only. */
function makeClient(
  result: Awaited<ReturnType<AuthClient['login']>>,
): Pick<AuthClient, 'login'> {
  return { login: jest.fn(() => Promise.resolve(result)) };
}

// ─── validateEmailField ───────────────────────────────────────────────────────

describe('validateEmailField', () => {
  it('accepts a well-formed email', () => {
    expect(validateEmailField('user@example.com')).toBeNull();
  });

  it('accepts a minimal x@x.x form', () => {
    expect(validateEmailField('a@b.c')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(validateEmailField('')).toBe('emailHint');
  });

  it('rejects whitespace-only', () => {
    expect(validateEmailField('   ')).toBe('emailHint');
  });

  it('rejects a string without @', () => {
    expect(validateEmailField('notanemail')).toBe('emailHint');
  });

  it('rejects a string with @ but nothing before it', () => {
    expect(validateEmailField('@example.com')).toBe('emailHint');
  });
});

// ─── validatePasswordField ────────────────────────────────────────────────────

describe('validatePasswordField', () => {
  it('accepts any non-empty password (policy is appsec SEC-HOOK, not a client gate)', () => {
    expect(validatePasswordField('pw')).toBe(true);
    expect(validatePasswordField('a very long and complex passphrase')).toBe(true);
  });

  it('rejects an empty password', () => {
    expect(validatePasswordField('')).toBe(false);
  });
});

// ─── loginStrings ─────────────────────────────────────────────────────────────

describe('loginStrings', () => {
  it('has the expected keys in both locales', () => {
    const keys: (keyof (typeof loginStrings)['th'])[] = [
      'title', 'emailLabel', 'passwordLabel', 'submit',
      'forgotPassword', 'createAccount',
      'wrongCredentials', 'rateLimited', 'offline', 'serverError', 'emailHint',
    ];
    for (const k of keys) {
      expect(loginStrings.th[k]).toBeTruthy();
      expect(loginStrings.en[k]).toBeTruthy();
    }
  });

  it('non-enumerating wrong-credentials copy (th) — must mention "reset" concept', () => {
    // Auth spec §7.2 + §E: the message is the SAME whether the email doesn't
    // exist or the password is wrong. It must not say "we don't know that email."
    expect(loginStrings.th.wrongCredentials).toContain('รีเซ็ต');
  });

  it('non-enumerating wrong-credentials copy (en) — must mention reset and not enumerate', () => {
    const copy = loginStrings.en.wrongCredentials;
    expect(copy.toLowerCase()).toContain('reset');
    // Must NOT say something that reveals whether the email exists
    expect(copy.toLowerCase()).not.toContain('not found');
    expect(copy.toLowerCase()).not.toContain('no account');
    expect(copy.toLowerCase()).not.toContain('doesn\'t exist');
  });

  it('offline copy (th) explains network is needed, not an alarm', () => {
    expect(loginStrings.th.offline).toContain('ออฟไลน์');
  });

  it('offline copy (en) is calm and non-blaming', () => {
    expect(loginStrings.en.offline.toLowerCase()).not.toContain('error');
    expect(loginStrings.en.offline.toLowerCase()).toContain('offline');
  });
});

// ─── handleSignIn ─────────────────────────────────────────────────────────────

describe('handleSignIn', () => {
  it('stores tokens and returns { kind: "success" } on 200', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleSignIn({
      email: 'a@b.com',
      password: 'Str0ng!',
      client: makeClient({ ok: true, tokens: TOKENS }),
      storage,
    });
    expect(outcome).toEqual({ kind: 'success' });
    expect(await storage.load()).toEqual(TOKENS);
  });

  it('passes deviceId to the API client when provided', async () => {
    const storage = new InMemoryTokenStorage();
    const loginMock = jest.fn(() => Promise.resolve({ ok: true, tokens: TOKENS } as const));
    await handleSignIn({
      email: 'a@b.com',
      password: 'pw',
      deviceId: 'device-001',
      client: { login: loginMock },
      storage,
    });
    expect(loginMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-001' }),
    );
  });

  it('returns { kind: "wrong_credentials" } on 401 invalid_credentials', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleSignIn({
      email: 'a@b.com',
      password: 'wrong',
      client: makeClient({
        ok: false, status: 401, code: 'invalid_credentials', message: 'Wrong.',
      }),
      storage,
    });
    expect(outcome).toEqual({ kind: 'wrong_credentials' });
    // Tokens must NOT be stored on failure
    expect(await storage.load()).toBeNull();
  });

  it('does NOT store any tokens on 401', async () => {
    const storage = new InMemoryTokenStorage();
    await handleSignIn({
      email: 'a@b.com',
      password: 'wrong',
      client: makeClient({ ok: false, status: 401, code: 'invalid_credentials', message: 'Wrong.' }),
      storage,
    });
    expect(await storage.load()).toBeNull();
  });

  it('returns { kind: "rate_limited" } on 429', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleSignIn({
      email: 'a@b.com',
      password: 'pw',
      client: makeClient({ ok: false, status: 429, code: 'rate_limited', message: 'Too many.' }),
      storage,
    });
    expect(outcome).toEqual({ kind: 'rate_limited' });
  });

  it('returns { kind: "network_error" } when the fetch call throws (no connection)', async () => {
    const storage = new InMemoryTokenStorage();
    const brokenClient: Pick<AuthClient, 'login'> = {
      login: jest.fn(() => Promise.reject(new TypeError('Network request failed'))),
    };
    const outcome = await handleSignIn({
      email: 'a@b.com',
      password: 'pw',
      client: brokenClient,
      storage,
    });
    expect(outcome).toEqual({ kind: 'network_error' });
  });

  it('returns { kind: "server_error", code } for unexpected error codes (5xx)', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleSignIn({
      email: 'a@b.com',
      password: 'pw',
      client: makeClient({ ok: false, status: 500, code: 'internal_error', message: 'Oops.' }),
      storage,
    });
    expect(outcome).toMatchObject({ kind: 'server_error', code: 'internal_error' });
  });

  it('returns { kind: "server_error" } for email_unverified (403) — network is up, server responded', async () => {
    // A registered-but-unverified user logs in: the server returns 200 with
    // an unverified JWT. Cloud egress is withheld server-side (403 email_unverified)
    // but login itself succeeds (§G/C9). If the server ever returns 403 at login,
    // that is an unexpected condition → server_error.
    const storage = new InMemoryTokenStorage();
    const outcome = await handleSignIn({
      email: 'a@b.com',
      password: 'pw',
      client: makeClient({ ok: false, status: 403, code: 'email_unverified', message: 'Unverified.' }),
      storage,
    });
    expect(outcome).toMatchObject({ kind: 'server_error' });
  });
});
