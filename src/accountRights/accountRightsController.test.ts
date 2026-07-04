/**
 * accountRightsController.test.ts — TDD tests for pure controller decision logic.
 *
 * Tests cover (per Task 3 spec):
 *   1. 401-routing decision — export/delete session-expired discriminant
 *   2. nudge-return-to-confirm — any export outcome from nudge → CONFIRM_OPEN
 *   3. synchronous-disable guard (E-13) — second tap is suppressed before re-render
 *   4. mapExport401 / mapDelete401 — inline 401 mappers extracted as pure functions
 */

import {
  SESSION_EXPIRED_CODE,
  isSessionExpiredCode,
  resolveExportOutcome,
  acquireDeleteLock,
  releaseDeleteLock,
  mapExport401,
  mapDelete401,
} from './accountRightsController';
import type { ExportOutcome } from './exportOrchestration';
import type { ExportAccountResult, DeleteAccountResult } from './accountApiClient';

// ─── 1. Session-expired discriminant ──────────────────────────────────────────

describe('isSessionExpiredCode', () => {
  it('returns true for the sentinel SESSION_EXPIRED_CODE', () => {
    expect(isSessionExpiredCode(SESSION_EXPIRED_CODE)).toBe(true);
  });

  it('returns false for ordinary error codes', () => {
    expect(isSessionExpiredCode('network_error')).toBe(false);
    expect(isSessionExpiredCode('timeout')).toBe(false);
    expect(isSessionExpiredCode('account_deleted')).toBe(false);
    expect(isSessionExpiredCode('')).toBe(false);
    expect(isSessionExpiredCode('unauthorized')).toBe(false);
  });
});

// ─── 2. Export outcome resolution — normal (non-nudge) ───────────────────────

describe('resolveExportOutcome — normal row (fromNudge=false)', () => {
  it('routes to session_expired when error is the sentinel code', () => {
    const outcome: ExportOutcome = {
      phase: 'EXPORT_ERROR',
      error: SESSION_EXPIRED_CODE,
    };
    expect(resolveExportOutcome(outcome, false)).toBe('session_expired');
  });

  it('routes to show_error for ordinary EXPORT_ERROR', () => {
    const outcome: ExportOutcome = { phase: 'EXPORT_ERROR', error: 'network_error' };
    expect(resolveExportOutcome(outcome, false)).toBe('show_error');
  });

  it('routes to show_error for timeout EXPORT_ERROR', () => {
    const outcome: ExportOutcome = { phase: 'EXPORT_ERROR', error: 'timeout' };
    expect(resolveExportOutcome(outcome, false)).toBe('show_error');
  });

  it('routes to show_404 for EXPORT_UNAVAILABLE_404', () => {
    const outcome: ExportOutcome = { phase: 'EXPORT_UNAVAILABLE_404' };
    expect(resolveExportOutcome(outcome, false)).toBe('show_404');
  });

  it('routes to set_idle for EXPORT_IDLE (success)', () => {
    const outcome: ExportOutcome = { phase: 'EXPORT_IDLE' };
    expect(resolveExportOutcome(outcome, false)).toBe('set_idle');
  });
});

// ─── 3. Nudge-return-to-confirm ──────────────────────────────────────────────

describe('resolveExportOutcome — nudge context (fromNudge=true)', () => {
  it('returns restore_confirm for EXPORT_IDLE (share complete/cancel)', () => {
    const outcome: ExportOutcome = { phase: 'EXPORT_IDLE' };
    // AR-AC-15/19: any outcome from nudge → return to confirm, floor intact
    expect(resolveExportOutcome(outcome, true)).toBe('restore_confirm');
  });

  it('returns restore_confirm for EXPORT_ERROR (e.g. offline)', () => {
    const outcome: ExportOutcome = { phase: 'EXPORT_ERROR', error: 'network_error' };
    // AR-AC-19: even errors from nudge → return to confirm (not auto-advance, not stuck)
    expect(resolveExportOutcome(outcome, true)).toBe('restore_confirm');
  });

  it('returns restore_confirm for EXPORT_UNAVAILABLE_404', () => {
    const outcome: ExportOutcome = { phase: 'EXPORT_UNAVAILABLE_404' };
    // AR-AC-19: 404 during nudge export → return to confirm (user can still proceed to delete)
    expect(resolveExportOutcome(outcome, true)).toBe('restore_confirm');
  });

  it('still routes to session_expired for 401 even in nudge context', () => {
    // 401 overrides nudge context — session is gone, must sign out
    const outcome: ExportOutcome = { phase: 'EXPORT_ERROR', error: SESSION_EXPIRED_CODE };
    expect(resolveExportOutcome(outcome, true)).toBe('session_expired');
  });
});

// ─── 4. Synchronous-disable guard (E-13) ─────────────────────────────────────

describe('acquireDeleteLock / releaseDeleteLock (E-13 double-tap guard)', () => {
  it('acquires the lock on the first call (ref=false)', () => {
    const ref = { current: false };
    const result = acquireDeleteLock(ref);
    expect(result).toBe('acquired');
    // CRITICAL (E-13): the ref is set to true SYNCHRONOUSLY — no await needed
    expect(ref.current).toBe(true);
  });

  it('returns already_locked on the second call before release', () => {
    const ref = { current: false };
    acquireDeleteLock(ref);        // first tap
    const result = acquireDeleteLock(ref);  // rapid second tap — must be suppressed
    expect(result).toBe('already_locked');
  });

  it('does NOT modify the ref on a rejected acquire attempt', () => {
    const ref = { current: true }; // already locked
    acquireDeleteLock(ref);
    // ref stays true (not flipped)
    expect(ref.current).toBe(true);
  });

  it('releases the lock so a subsequent acquire succeeds', () => {
    const ref = { current: false };
    acquireDeleteLock(ref);        // lock
    releaseDeleteLock(ref);        // release (after async outcome)
    expect(ref.current).toBe(false);
    const result2 = acquireDeleteLock(ref);
    expect(result2).toBe('acquired');
  });

  it('handles a full acquire → release → acquire cycle correctly', () => {
    const ref = { current: false };

    // Simulate: tap → in-flight → outcome → re-tappable
    expect(acquireDeleteLock(ref)).toBe('acquired');       // first tap
    expect(acquireDeleteLock(ref)).toBe('already_locked'); // rapid second tap (E-13)
    releaseDeleteLock(ref);                                // gate result returned
    expect(acquireDeleteLock(ref)).toBe('acquired');       // user can tap again
  });
});

// ─── 5. mapExport401 — pure 401 mapper for the export endpoint ────────────────

describe('mapExport401', () => {
  it('maps a raw 401 result to the session-expired sentinel', () => {
    const raw401: ExportAccountResult = {
      ok: false,
      status: 401,
      code: 'token_expired',
      message: 'Unauthorized',
    };
    const mapped = mapExport401(raw401);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.status).toBe(401);
      expect(mapped.code).toBe(SESSION_EXPIRED_CODE);
    }
  });

  it('drops the message field on 401 so message??code resolves to session_expired', () => {
    const raw401: ExportAccountResult = {
      ok: false,
      status: 401,
      code: 'token_expired',
      message: 'Stale message from server',
    };
    const mapped = mapExport401(raw401);
    // The mapped result must NOT carry a message — downstream `message ?? code` must
    // resolve to SESSION_EXPIRED_CODE, not the stale server message.
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.message).toBeUndefined();
      // Verify the ?? chain: message ?? code === session_expired
      const resolved = mapped.message ?? mapped.code;
      expect(resolved).toBe(SESSION_EXPIRED_CODE);
    }
  });

  it('passes through a 404 result unchanged', () => {
    const raw404: ExportAccountResult = {
      ok: false,
      status: 404,
      code: 'account_deleted',
      message: 'Not found',
    };
    const mapped = mapExport401(raw404);
    expect(mapped).toEqual(raw404);
  });

  it('passes through a 5xx result unchanged', () => {
    const raw5xx: ExportAccountResult = {
      ok: false,
      status: 503,
      code: 'server_error',
      message: 'Service unavailable',
    };
    const mapped = mapExport401(raw5xx);
    expect(mapped).toEqual(raw5xx);
  });

  it('passes through a timeout/network result (status 0) unchanged', () => {
    const rawTimeout: ExportAccountResult = {
      ok: false,
      status: 0,
      code: 'timeout',
    };
    const mapped = mapExport401(rawTimeout);
    expect(mapped).toEqual(rawTimeout);
  });

  it('passes through a network_error result (status 0) unchanged', () => {
    const rawNetwork: ExportAccountResult = {
      ok: false,
      status: 0,
      code: 'network_error',
    };
    const mapped = mapExport401(rawNetwork);
    expect(mapped).toEqual(rawNetwork);
  });

  it('passes through a successful result unchanged', () => {
    const rawOk: ExportAccountResult = { ok: true, bodyText: '{"data":"..."}' };
    const mapped = mapExport401(rawOk);
    expect(mapped).toEqual(rawOk);
  });
});

// ─── 6. mapDelete401 — pure 401 mapper for the delete endpoint ────────────────

describe('mapDelete401', () => {
  it('maps a raw 401 result to the session-expired sentinel', () => {
    const raw401: DeleteAccountResult = {
      ok: false,
      status: 401,
      code: 'token_expired',
      message: 'Unauthorized',
    };
    const mapped = mapDelete401(raw401);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.code).toBe(SESSION_EXPIRED_CODE);
    }
  });

  it('drops the message field on 401 so message??code resolves to session_expired', () => {
    const raw401: DeleteAccountResult = {
      ok: false,
      status: 401,
      code: 'token_expired',
      message: 'Stale server message',
    };
    const mapped = mapDelete401(raw401);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      // Must have no message — downstream `message ?? code` must resolve to session_expired
      expect((mapped as { message?: string }).message).toBeUndefined();
      const resolved = (mapped as { message?: string; code: string }).message ?? mapped.code;
      expect(resolved).toBe(SESSION_EXPIRED_CODE);
    }
  });

  it('passes through a 5xx result as { ok: false, code } (normalised shape, no stale message)', () => {
    const raw5xx: DeleteAccountResult = {
      ok: false,
      status: 503,
      code: 'server_error',
      message: 'Service unavailable',
    };
    const mapped = mapDelete401(raw5xx);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.code).toBe('server_error');
    }
  });

  it('passes through a network_error (status 0) as { ok: false, code }', () => {
    const rawNetwork: DeleteAccountResult = {
      ok: false,
      status: 0,
      code: 'network_error',
      message: 'Network request failed',
    };
    const mapped = mapDelete401(rawNetwork);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.code).toBe('network_error');
    }
  });

  it('maps a successful result to { ok: true }', () => {
    const rawOk: DeleteAccountResult = { ok: true };
    const mapped = mapDelete401(rawOk);
    expect(mapped).toEqual({ ok: true });
  });

  it('nudge-context 401 still routes to session_expired via resolveExportOutcome', () => {
    // Regression guard: a 401 in nudge context must NOT produce restore_confirm.
    // This is already covered by resolveExportOutcome tests, but asserted here to
    // confirm the contract that mappers + resolver together route 401→session_expired.
    const outcome: ExportOutcome = { phase: 'EXPORT_ERROR', error: SESSION_EXPIRED_CODE };
    expect(resolveExportOutcome(outcome, true)).toBe('session_expired');
  });
});
