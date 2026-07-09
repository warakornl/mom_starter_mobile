/**
 * ForgotPasswordScreen (S5) — non-UI logic tests (TDD, RED written before impl).
 *
 * Tests for:
 *  - `forgotStrings`       — i18n completeness + non-enumeration copy guard (MI-9)
 *  - `handleForgotPassword` — submit handler: 202→success; 429→rate_limited;
 *                            throw→network_error; 400→server_error; 500→server_error
 *
 * Security properties verified:
 *  - handleForgotPassword always returns { kind: 'success' } on 202 — non-enumerating
 *    (SEC-INV-1). Never body-inspects; no email_not_found branch.
 *  - confirmBody (th) not.toContain('บัญชี') — copy assertion (MI-9, spec §2.4).
 *  - th↔en parity: all string keys present in both locales.
 *  - 400 (Spring @Valid) falls through to server_error, not a crash (spec §2.4).
 */
import {
  forgotStrings,
  handleForgotPassword,
  RESEND_COOLDOWN_MS,
} from './forgotPasswordScreenLogic';
import type { AuthClient } from './authApiClient';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeForgotClient(
  result: Awaited<ReturnType<AuthClient['forgotPassword']>>,
): Pick<AuthClient, 'forgotPassword'> {
  return { forgotPassword: jest.fn(() => Promise.resolve(result)) };
}

// ─── forgotStrings — i18n completeness ────────────────────────────────────────

describe('forgotStrings', () => {
  it('has all required keys in both locales', () => {
    const keys: (keyof (typeof forgotStrings)['th'])[] = [
      'navTitle', 'title', 'subtitle',
      'emailLabel', 'emailPlaceholder', 'emailHint',
      'submit', 'confirmTitle', 'confirmBody',
      'resend', 'backToLogin',
      'rateLimited', 'offline', 'serverError',
    ];
    for (const k of keys) {
      expect(forgotStrings.th[k]).toBeTruthy();
      expect(forgotStrings.en[k]).toBeTruthy();
    }
  });

  // SEC-INV-1 / MI-9: the mandated non-enumeration copy assertion
  it('confirmBody (th) is NON-ENUMERATING — must not contain บัญชี', () => {
    expect(forgotStrings.th.confirmBody).not.toContain('บัญชี');
  });

  it('confirmBody (en) has unconditional neutral voice', () => {
    const copy = forgotStrings.en.confirmBody.toLowerCase();
    expect(copy).not.toContain('if an account');
    expect(copy).not.toContain('no account');
    expect(copy).not.toContain('not registered');
  });

  it('th↔en parity — every th key has a non-empty en translation', () => {
    const thKeys = Object.keys(forgotStrings.th) as (keyof (typeof forgotStrings)['th'])[];
    for (const k of thKeys) {
      expect(forgotStrings.en[k]).toBeTruthy();
    }
  });

  it('rateLimited (th) does not expose numeric counter (SEC-INV-7)', () => {
    expect(forgotStrings.th.rateLimited).not.toMatch(/\d+ ครั้ง/);
  });
});

// ─── RESEND_COOLDOWN_MS ───────────────────────────────────────────────────────

describe('RESEND_COOLDOWN_MS', () => {
  it('is 60 000 ms (60 s) matching verifyEmailScreenLogic', () => {
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });
});

// ─── handleForgotPassword ─────────────────────────────────────────────────────

describe('handleForgotPassword', () => {
  // ── SEC-INV-1: non-enumerating 202 ────────────────────────────────────────

  it('returns { kind: "success", resendAt } on 202 — non-enumerating (SEC-INV-1)', async () => {
    const outcome = await handleForgotPassword({
      email: 'user@example.com',
      client: makeForgotClient({ ok: true }),
    });
    expect(outcome.kind).toBe('success');
  });

  it('returns success on 202 even for a non-existent email — body is never inspected', async () => {
    // Server returns identical 202 whether or not the email exists.
    const outcome = await handleForgotPassword({
      email: 'ghost@nowhere.io',
      client: makeForgotClient({ ok: true }),
    });
    expect(outcome.kind).toBe('success');
  });

  it('passes the email to forgotPassword', async () => {
    const forgotMock = jest.fn(() => Promise.resolve({ ok: true as const }));
    await handleForgotPassword({
      email: 'user@example.com',
      client: { forgotPassword: forgotMock },
    });
    expect(forgotMock).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  // ── Rate limited ──────────────────────────────────────────────────────────

  it('returns { kind: "rate_limited" } on 429', async () => {
    const outcome = await handleForgotPassword({
      email: 'user@example.com',
      client: makeForgotClient({
        ok: false, status: 429, code: 'rate_limited', message: 'Too many.',
      }),
    });
    expect(outcome).toEqual({ kind: 'rate_limited' });
  });

  // ── Network error ─────────────────────────────────────────────────────────

  it('returns { kind: "network_error" } when fetch throws (offline)', async () => {
    const brokenClient: Pick<AuthClient, 'forgotPassword'> = {
      forgotPassword: jest.fn(() =>
        Promise.reject(new TypeError('Network request failed')),
      ),
    };
    const outcome = await handleForgotPassword({
      email: 'user@example.com',
      client: brokenClient,
    });
    expect(outcome).toEqual({ kind: 'network_error' });
  });

  // ── Server error 500 ──────────────────────────────────────────────────────

  it('returns { kind: "server_error" } on unexpected 500', async () => {
    const outcome = await handleForgotPassword({
      email: 'user@example.com',
      client: makeForgotClient({
        ok: false, status: 500, code: 'internal_error', message: 'Oops.',
      }),
    });
    expect(outcome).toMatchObject({ kind: 'server_error', code: 'internal_error' });
  });

  // ── 400 @Valid (blank/malformed body) → calm server_error, NOT a crash (spec §2.4) ──

  it('returns { kind: "server_error" } on 400 @Valid — not a crash', async () => {
    const outcome = await handleForgotPassword({
      email: 'user@example.com',
      client: makeForgotClient({
        ok: false, status: 400, code: 'unknown_error', message: 'Bad request.',
      }),
    });
    expect(outcome).toMatchObject({ kind: 'server_error' });
  });

  // ── Cooldown resendAt (handleForgotPassword returns resendAt on success) ──

  it('returns { resendAt } on success — resendAt is nowFn() + RESEND_COOLDOWN_MS', async () => {
    const fixedNow = 1_700_000_000_000;
    const outcome = await handleForgotPassword({
      email: 'user@example.com',
      client: makeForgotClient({ ok: true }),
      nowFn: () => fixedNow,
    });
    if (outcome.kind === 'success') {
      expect(outcome.resendAt).toBe(fixedNow + RESEND_COOLDOWN_MS);
    } else {
      fail('expected success');
    }
  });
});
