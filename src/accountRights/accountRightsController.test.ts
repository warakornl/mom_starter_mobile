/**
 * accountRightsController.test.ts — TDD tests for pure controller decision logic.
 *
 * Tests cover (per Task 3 spec):
 *   1. 401-routing decision — export/delete session-expired discriminant
 *   2. nudge-return-to-confirm — any export outcome from nudge → CONFIRM_OPEN
 *   3. synchronous-disable guard (E-13) — second tap is suppressed before re-render
 */

import {
  SESSION_EXPIRED_CODE,
  isSessionExpiredCode,
  resolveExportOutcome,
  acquireDeleteLock,
  releaseDeleteLock,
} from './accountRightsController';
import type { ExportOutcome } from './exportOrchestration';

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
