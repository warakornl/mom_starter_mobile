/**
 * Register screen (S2) — non-UI logic tests (TDD, written BEFORE the implementation).
 *
 * What we test here (pure functions, no RN rendering):
 *  - `validateEmailField`    — input sanity (same rule as login screen)
 *  - `validatePasswordField` — non-empty check (policy is appsec SEC-HOOK)
 *  - `registerStrings`       — i18n completeness + non-enumeration guarantee
 *  - `handleRegister`        — submit handler: API call → typed outcome
 *
 * Key contract: NON-ENUMERATION (§E/C7)
 *   POST /auth/register always returns 202 for both new AND existing emails.
 *   `handleRegister` MUST return `{ kind: 'success' }` on 202 regardless of
 *   the response body. There MUST NEVER be an outcome or copy that reveals
 *   email existence — no "email already taken", "already registered", etc.
 *
 * What is NOT tested (render / interaction):
 *   Navigation callbacks (onSuccess, onSignIn), loading-spinner, error rendering.
 *   These are validated by UX spec + visual QA when RN testing framework is installed.
 */
import {
  validateEmailField,
  validatePasswordField,
  handleRegister,
  registerStrings,
} from './registerScreenLogic';
import type { AuthClient } from './authApiClient';

// ─── Fixture ─────────────────────────────────────────────────────────────────

function makeClient(
  result: Awaited<ReturnType<AuthClient['register']>>,
): Pick<AuthClient, 'register'> {
  return { register: jest.fn(() => Promise.resolve(result)) };
}

// ─── validateEmailField (register) ───────────────────────────────────────────

describe('validateEmailField (register)', () => {
  it('accepts a well-formed email', () => {
    expect(validateEmailField('user@example.com')).toBeNull();
  });

  it('accepts a minimal x@x form', () => {
    expect(validateEmailField('a@b')).toBeNull();
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

  it('rejects a string starting with @', () => {
    expect(validateEmailField('@example.com')).toBe('emailHint');
  });
});

// ─── validatePasswordField (register) ────────────────────────────────────────

describe('validatePasswordField (register)', () => {
  it('accepts any non-empty password (actual policy is appsec SEC-HOOK, server-side)', () => {
    expect(validatePasswordField('pw')).toBe(true);
    expect(validatePasswordField('a very long and complex passphrase')).toBe(true);
  });

  it('rejects an empty password', () => {
    expect(validatePasswordField('')).toBe(false);
  });
});

// ─── registerStrings ──────────────────────────────────────────────────────────

describe('registerStrings', () => {
  it('has the expected keys in both locales', () => {
    const keys: (keyof (typeof registerStrings)['th'])[] = [
      'title', 'subtitle', 'emailLabel', 'passwordLabel', 'submit', 'signIn',
      'emailHint', 'passwordHint', 'passwordTooShort', 'passwordBreached',
      'rateLimited', 'offline', 'serverError',
    ];
    for (const k of keys) {
      expect(registerStrings.th[k]).toBeTruthy();
      expect(registerStrings.en[k]).toBeTruthy();
    }
  });

  it('non-enumeration: th copy must NOT mention email existence (§E/C7)', () => {
    const allTh = Object.values(registerStrings.th).join(' ');
    expect(allTh).not.toContain('ใช้แล้ว');
    expect(allTh).not.toContain('มีอยู่แล้ว');
    expect(allTh).not.toContain('ถูกลงทะเบียน');
  });

  it('non-enumeration: en copy must NOT mention email existence (§E/C7)', () => {
    const allEn = Object.values(registerStrings.en).join(' ').toLowerCase();
    expect(allEn).not.toContain('already registered');
    expect(allEn).not.toContain('already taken');
    expect(allEn).not.toContain('already in use');
    expect(allEn).not.toContain('email exists');
  });

  it('passwordBreached copy (th) gives direction without blaming the user', () => {
    expect(registerStrings.th.passwordBreached).toBeTruthy();
    expect(registerStrings.th.passwordBreached).not.toContain('ถูกแฮก');
  });

  it('offline copy (th) explains that a network connection is needed', () => {
    expect(registerStrings.th.offline).toContain('ออฟไลน์');
  });

  it('offline copy (en) is calm and non-blaming', () => {
    expect(registerStrings.en.offline.toLowerCase()).not.toContain('error');
    expect(registerStrings.en.offline.toLowerCase()).toContain('offline');
  });
});

// ─── handleRegister ───────────────────────────────────────────────────────────

describe('handleRegister', () => {
  it('returns { kind: "success" } on 202 (new email — verification_pending)', async () => {
    const outcome = await handleRegister({
      email: 'new@b.com',
      password: 'Str0ng!',
      client: makeClient({ ok: true }),
    });
    expect(outcome).toEqual({ kind: 'success' });
  });

  it('returns { kind: "success" } on 202 for a colliding email — non-enumeration (§E/C7)', async () => {
    // The server returns the SAME 202 for both new and existing emails.
    // The client MUST treat 202 as success always — no body inspection for hints.
    const outcome = await handleRegister({
      email: 'existing@b.com',
      password: 'Str0ng!',
      client: makeClient({ ok: true }),
    });
    expect(outcome).toEqual({ kind: 'success' });
  });

  it('passes email, password, locale, deviceId to the API client', async () => {
    const registerMock = jest.fn(() => Promise.resolve({ ok: true as const }));
    await handleRegister({
      email: 'a@b.com',
      password: 'Str0ng!',
      locale: 'th',
      deviceId: 'device-001',
      client: { register: registerMock },
    });
    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        password: 'Str0ng!',
        locale: 'th',
        deviceId: 'device-001',
      }),
    );
  });

  it('returns { kind: "validation", code: "password_too_short" } on 422 password_too_short', async () => {
    const outcome = await handleRegister({
      email: 'a@b.com',
      password: 'short',
      client: makeClient({
        ok: false, status: 422, code: 'password_too_short', message: 'Too short.',
      }),
    });
    expect(outcome).toEqual({ kind: 'validation', code: 'password_too_short' });
  });

  it('returns { kind: "validation", code: "password_breached" } on 422 password_breached', async () => {
    const outcome = await handleRegister({
      email: 'a@b.com',
      password: 'password1',
      client: makeClient({
        ok: false, status: 422, code: 'password_breached', message: 'Breached.',
      }),
    });
    expect(outcome).toEqual({ kind: 'validation', code: 'password_breached' });
  });

  it('returns { kind: "rate_limited" } on 429', async () => {
    const outcome = await handleRegister({
      email: 'a@b.com',
      password: 'Str0ng!',
      client: makeClient({
        ok: false, status: 429, code: 'rate_limited', message: 'Too many.',
      }),
    });
    expect(outcome).toEqual({ kind: 'rate_limited' });
  });

  it('returns { kind: "network_error" } when fetch throws (no connection)', async () => {
    const brokenClient: Pick<AuthClient, 'register'> = {
      register: jest.fn(() => Promise.reject(new TypeError('Network request failed'))),
    };
    const outcome = await handleRegister({
      email: 'a@b.com',
      password: 'Str0ng!',
      client: brokenClient,
    });
    expect(outcome).toEqual({ kind: 'network_error' });
  });

  it('returns { kind: "server_error", code } for unexpected 500', async () => {
    const outcome = await handleRegister({
      email: 'a@b.com',
      password: 'Str0ng!',
      client: makeClient({
        ok: false, status: 500, code: 'internal_error', message: 'Oops.',
      }),
    });
    expect(outcome).toMatchObject({ kind: 'server_error', code: 'internal_error' });
  });

  it('does NOT issue or store any tokens — register never mints a session (§G)', async () => {
    // Security invariant: POST /auth/register returns 202 with no AuthTokens.
    // The only session-minting event for a new account is POST /auth/verify-email.
    // The outcome type { kind: 'success' } has no .tokens field — enforced by TypeScript.
    const result = await handleRegister({
      email: 'a@b.com',
      password: 'Str0ng!',
      client: makeClient({ ok: true }),
    });
    expect(result.kind).toBe('success');
    // TypeScript ensures result does not carry tokens — no runtime assertion needed.
  });
});
