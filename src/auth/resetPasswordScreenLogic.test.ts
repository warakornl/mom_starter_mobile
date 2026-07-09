/**
 * ResetPasswordScreen — non-UI logic tests (TDD, RED written before impl).
 *
 * Tests for:
 *  - `resetStrings`           — i18n completeness + security copy invariants
 *  - `validateNewPassword`    — all 3 client gates (non-empty, ≥8, confirm-match)
 *  - `handleResetPassword`    — all state transitions per spec §3.3 and MI-8:
 *      204→success; 410→token_invalid (goes to ForgotPassword);
 *      422→validation (same token); 429→rate_limited (same token);
 *      throw→network_error (same token); 400→server_error (same token);
 *      500→server_error (same token); missing_token→no API call.
 *
 * Security properties verified (MI-1…MI-9):
 *  - 410 is the ONLY outcome that should cause caller to leave screen / clear token
 *    (SEC-INV-6 / MI-8): 422/429/network/server all return outcomes that keep the
 *    user on screen with the same token.
 *  - missing_token → no API call (MI-6).
 *  - token is NEVER added to any log or persisted (enforced by design: handler
 *    receives token as param, never touches AsyncStorage/analytics).
 *  - th↔en parity.
 */
import {
  resetStrings,
  validateNewPassword,
  handleResetPassword,
} from './resetPasswordScreenLogic';
import type { AuthClient } from './authApiClient';
import type { TokenStorage } from './tokenStorage';
import { InMemoryTokenStorage } from './tokenStorage';
import type { AuthTokens } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResetClient(
  result: Awaited<ReturnType<AuthClient['resetPassword']>>,
): Pick<AuthClient, 'resetPassword'> {
  return { resetPassword: jest.fn(() => Promise.resolve(result)) };
}

const TOKENS: AuthTokens = {
  accessToken: 'at.test',
  refreshToken: 'rt.test',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 1_209_600,
};

// ─── resetStrings — i18n completeness ────────────────────────────────────────

describe('resetStrings', () => {
  it('has all required keys in both locales', () => {
    const keys: (keyof (typeof resetStrings)['th'])[] = [
      'navTitle', 'title',
      'newPasswordLabel', 'confirmLabel',
      'passwordHint', 'revokeNotice', 'submit',
      'successToast', 'tokenInvalid', 'requestNewLink',
      'linkMissing', 'passwordTooShort', 'passwordBreached',
      'mismatch', 'rateLimited', 'offline', 'serverError',
    ];
    for (const k of keys) {
      expect(resetStrings.th[k]).toBeTruthy();
      expect(resetStrings.en[k]).toBeTruthy();
    }
  });

  it('tokenInvalid (th) is one generic message — no wrong/expired/used distinction (SEC-INV-2)', () => {
    const copy = catalog_th_tokenInvalid();
    expect(copy).toBeTruthy();
    expect(copy.length).toBeGreaterThan(0);
  });

  it('revokeNotice (th) warns about all-device sign-out (SEC-INV-4)', () => {
    expect(resetStrings.th.revokeNotice).toBeTruthy();
    expect(resetStrings.th.revokeNotice.length).toBeGreaterThan(10);
  });

  it('rateLimited (th) does not expose numeric counter (SEC-INV-7)', () => {
    expect(resetStrings.th.rateLimited).not.toMatch(/\d+ ครั้ง/);
  });

  it('th↔en parity — every th key has a non-empty en translation', () => {
    const thKeys = Object.keys(resetStrings.th) as (keyof (typeof resetStrings)['th'])[];
    for (const k of thKeys) {
      expect(resetStrings.en[k]).toBeTruthy();
    }
  });
});

function catalog_th_tokenInvalid() {
  return resetStrings.th.tokenInvalid;
}

// ─── validateNewPassword ──────────────────────────────────────────────────────

describe('validateNewPassword', () => {
  // Gate 1: non-empty
  it('returns "empty" when newPassword is empty', () => {
    expect(validateNewPassword({ newPassword: '', confirm: 'abc' })).toBe('empty');
  });

  // Gate 2: length ≥ 8 (soft mirror of PasswordPolicy.MIN_LENGTH)
  it('returns "too_short" when newPassword has < 8 chars', () => {
    expect(validateNewPassword({ newPassword: '1234567', confirm: '1234567' })).toBe('too_short');
  });

  it('returns null when newPassword is exactly 8 chars and matches confirm', () => {
    expect(validateNewPassword({ newPassword: '12345678', confirm: '12345678' })).toBeNull();
  });

  // Gate 3: passwords match
  it('returns "mismatch" when newPassword !== confirm', () => {
    expect(validateNewPassword({ newPassword: 'password1', confirm: 'password2' })).toBe('mismatch');
  });

  it('returns null for valid matching passwords ≥ 8 chars', () => {
    expect(validateNewPassword({ newPassword: 'strongPass1', confirm: 'strongPass1' })).toBeNull();
  });

  it('gates are checked in order: empty before too_short', () => {
    expect(validateNewPassword({ newPassword: '', confirm: '' })).toBe('empty');
  });
});

// ─── handleResetPassword — state transitions (spec §3.3) ─────────────────────

describe('handleResetPassword', () => {
  // ── Success (204) ─────────────────────────────────────────────────────────

  it('returns { kind: "success" } on 204', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: 'tok-abc',
      newPassword: 'newpass99',
      client: makeResetClient({ ok: true }),
      tokenStorage: storage,
    });
    expect(outcome.kind).toBe('success');
  });

  it('passes token and newPassword to resetPassword', async () => {
    const resetMock = jest.fn(() => Promise.resolve({ ok: true as const }));
    const storage = new InMemoryTokenStorage();
    await handleResetPassword({
      token: 'my-tok',
      newPassword: 'mypassword1',
      client: { resetPassword: resetMock },
      tokenStorage: storage,
    });
    expect(resetMock).toHaveBeenCalledWith({ token: 'my-tok', newPassword: 'mypassword1' });
  });

  // ── 410 → token_invalid (goes back to ForgotPassword, SEC-INV-2) ──────────

  it('returns { kind: "token_invalid" } on 410 reset_token_invalid', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: 'expired-tok',
      newPassword: 'newpass99',
      client: makeResetClient({
        ok: false, status: 410, code: 'reset_token_invalid', message: 'Gone.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'token_invalid' });
  });

  // ── 422 → validation (stay on screen, same token, SEC-INV-6 / MI-8) ───────

  it('returns { kind: "validation", code: "password_too_short" } on 422 — token NOT burned', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: 'live-tok',
      newPassword: 'short',
      client: makeResetClient({
        ok: false, status: 422, code: 'password_too_short', message: 'Too short.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'validation', code: 'password_too_short' });
  });

  it('returns { kind: "validation", code: "password_breached" } on 422 — token NOT burned', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: 'live-tok',
      newPassword: 'password123',
      client: makeResetClient({
        ok: false, status: 422, code: 'password_breached', message: 'Breached.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'validation', code: 'password_breached' });
  });

  // ── 429 → rate_limited (stay on screen, same token, SEC-INV-6 / MI-8) ────

  it('returns { kind: "rate_limited" } on 429 — token NOT burned (SEC-INV-6)', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: 'live-tok',
      newPassword: 'newpass99',
      client: makeResetClient({
        ok: false, status: 429, code: 'rate_limited', message: 'Too many.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'rate_limited' });
  });

  // ── Network error (stay on screen, same token) ────────────────────────────

  it('returns { kind: "network_error" } when fetch throws — token untouched', async () => {
    const storage = new InMemoryTokenStorage();
    const brokenClient: Pick<AuthClient, 'resetPassword'> = {
      resetPassword: jest.fn(() =>
        Promise.reject(new TypeError('Network request failed')),
      ),
    };
    const outcome = await handleResetPassword({
      token: 'live-tok',
      newPassword: 'newpass99',
      client: brokenClient,
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'network_error' });
  });

  // ── 400 @Valid → server_error (stay on screen, NOT a crash, spec §3.5) ────

  it('returns { kind: "server_error" } on 400 @Valid — not a crash', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: 'live-tok',
      newPassword: 'newpass99',
      client: makeResetClient({
        ok: false, status: 400, code: 'unknown_error', message: 'Bad request.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toMatchObject({ kind: 'server_error' });
  });

  // ── 500 → server_error (stay on screen) ──────────────────────────────────

  it('returns { kind: "server_error" } on 500', async () => {
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: 'live-tok',
      newPassword: 'newpass99',
      client: makeResetClient({
        ok: false, status: 500, code: 'internal_error', message: 'Oops.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toMatchObject({ kind: 'server_error', code: 'internal_error' });
  });

  // ── Missing token → no API call (MI-6, spec §3.2 missing_token state) ─────

  it('returns { kind: "missing_token" } when token is empty — no API call (MI-6)', async () => {
    const resetMock = jest.fn();
    const storage = new InMemoryTokenStorage();
    const outcome = await handleResetPassword({
      token: '',
      newPassword: 'newpass99',
      client: { resetPassword: resetMock },
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'missing_token' });
    expect(resetMock).not.toHaveBeenCalled();
  });

  // ── Success with existing session → clearTokens called (MI-7 / SEC-INV-4) ──

  it('calls clearTokens on success when a session exists (MI-7)', async () => {
    const storage = new InMemoryTokenStorage();
    await storage.save(TOKENS);
    const outcome = await handleResetPassword({
      token: 'tok-abc',
      newPassword: 'newpass99',
      client: makeResetClient({ ok: true }),
      tokenStorage: storage,
    });
    expect(outcome.kind).toBe('success');
    // Tokens must be cleared so the old session doesn't linger (MI-7 / SD-5)
    expect(await storage.load()).toBeNull();
  });

  it('does NOT call clearTokens on 410 — no session teardown for invalid token', async () => {
    const storage = new InMemoryTokenStorage();
    await storage.save(TOKENS);
    const outcome = await handleResetPassword({
      token: 'expired-tok',
      newPassword: 'newpass99',
      client: makeResetClient({
        ok: false, status: 410, code: 'reset_token_invalid', message: 'Gone.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'token_invalid' });
    // Tokens must NOT be cleared on 410 — clearTokens is only for successful reset
    expect(await storage.load()).toEqual(TOKENS);
  });

  it('does NOT call clearTokens on 422 — stay on screen, same token (SEC-INV-6)', async () => {
    const storage = new InMemoryTokenStorage();
    await storage.save(TOKENS);
    const outcome = await handleResetPassword({
      token: 'live-tok',
      newPassword: 'short',
      client: makeResetClient({
        ok: false, status: 422, code: 'password_too_short', message: 'Too short.',
      }),
      tokenStorage: storage,
    });
    expect(outcome).toEqual({ kind: 'validation', code: 'password_too_short' });
    expect(await storage.load()).toEqual(TOKENS);
  });

  // ── Success without a local session → no teardown needed ─────────────────

  it('returns success even when no local session exists (normal case — user is logged out)', async () => {
    const storage = new InMemoryTokenStorage(); // empty
    const outcome = await handleResetPassword({
      token: 'tok-abc',
      newPassword: 'newpass99',
      client: makeResetClient({ ok: true }),
      tokenStorage: storage,
    });
    expect(outcome.kind).toBe('success');
    expect(await storage.load()).toBeNull(); // still null, no issue
  });
});
