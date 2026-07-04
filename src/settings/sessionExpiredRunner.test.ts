/**
 * sessionExpiredRunner.test.ts — TDD tests for the SD-5 session-expired teardown runner.
 *
 * SD-5 BUG (pre-fix): When export/delete returns a 401, handleSessionExpired in
 * SettingsScreen called onSessionExpired() directly — navigate only. Tokens and all
 * health stores were left populated, so a different user signing in on the same
 * device (no app restart) inherited the prior user's PHI.
 *
 * FIX (option b): handleSessionExpired ALWAYS calls buildSessionExpiredRunner with
 * (onSessionExpired ?? onLogout) as the onComplete callback. buildSessionExpiredRunner
 * delegates to performLogout, which clears tokens + ALL health stores THEN calls
 * onComplete (navigate). The onSessionExpired prop's role narrows to "navigate callback"
 * — teardown is always the caller's responsibility.
 *
 * Both SettingsScreen code paths that hit 401 route through handleSessionExpired:
 *   export-401: runExportFlow → case 'session_expired' → handleSessionExpired()
 *   delete-401: handleConfirmTap → isSessionExpiredCode(code) → handleSessionExpired()
 *
 * These tests mirror performLogout.test.ts — inject deps, verify call order.
 */

import { buildSessionExpiredRunner } from './sessionExpiredRunner';
import type { LogoutDeps } from '../auth/performLogout';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<LogoutDeps> = {}): {
  deps: LogoutDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const deps: LogoutDeps = {
    clearTokens: async () => { calls.push('clearTokens'); },
    resetSupplyStore: () => { calls.push('resetSupplyStore'); },
    resetKickCountStore: () => { calls.push('resetKickCountStore'); },
    resetCalendarStore: () => { calls.push('resetCalendarStore'); },
    resetSelfLogStore: () => { calls.push('resetSelfLogStore'); },
    resetMedicationPlanStore: () => { calls.push('resetMedicationPlanStore'); },
    resetMedicationLogStore: () => { calls.push('resetMedicationLogStore'); },
    clearKickCountDraft: async () => { calls.push('clearKickCountDraft'); },
    onComplete: () => { calls.push('navigate'); },
    ...overrides,
  };
  return { deps, calls };
}

// ─── Core SD-5 regression tests ───────────────────────────────────────────────

describe('buildSessionExpiredRunner — SD-5: full teardown before navigate (not navigate-only)', () => {
  it('export-401: clears tokens + all health stores THEN navigates', async () => {
    // Both runExportFlow(case session_expired) and handleConfirmTap(isSessionExpiredCode)
    // call handleSessionExpired(), which now calls buildSessionExpiredRunner.
    const { deps, calls } = makeDeps();
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    expect(calls).toEqual(
      expect.arrayContaining([
        'clearTokens',
        'resetSupplyStore',
        'resetKickCountStore',
        'resetCalendarStore',
        'resetSelfLogStore',
        'resetMedicationPlanStore',
        'resetMedicationLogStore',
        'clearKickCountDraft',
        'navigate',
      ]),
    );
  });

  it('delete-401: same teardown path as export-401 (shared handleSessionExpired entry point)', async () => {
    // runDeleteGate returns { outcome: delete_error, code: SESSION_EXPIRED_CODE } on 401.
    // handleConfirmTap sees isSessionExpiredCode → calls handleSessionExpired → this runner.
    // runDeleteGate does NOT call performLogout on 401 (only on HTTP 202) — no double teardown.
    const { deps, calls } = makeDeps();
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    expect(calls).toContain('clearTokens');
    expect(calls).toContain('resetSupplyStore');
    expect(calls[calls.length - 1]).toBe('navigate');
  });

  it('navigate runs LAST — after all store resets (regression: navigate-only was the SD-5 bug)', async () => {
    const { deps, calls } = makeDeps();
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    // navigate must be the final call
    expect(calls[calls.length - 1]).toBe('navigate');
    // clearTokens must precede navigate
    const clearIdx = calls.indexOf('clearTokens');
    const navIdx = calls.indexOf('navigate');
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(navIdx).toBeGreaterThan(clearIdx);
  });

  it('navigate still runs even if token clear fails (non-fatal, user must reach Welcome)', async () => {
    const { deps, calls } = makeDeps({
      clearTokens: async () => { throw new Error('keychain unavailable'); },
    });
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    // Token clear failure is non-fatal — stores still reset and navigate still runs
    expect(calls).toContain('resetSupplyStore');
    expect(calls).toContain('navigate');
    expect(calls[calls.length - 1]).toBe('navigate');
  });

  it('navigate still runs even if a store reset throws (best-effort, never strands user)', async () => {
    const { deps, calls } = makeDeps({
      resetSupplyStore: () => { throw new Error('supply store reset failed'); },
    });
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    // Other stores should still be attempted and navigate must run
    expect(calls).toContain('resetKickCountStore');
    expect(calls).toContain('navigate');
    expect(calls[calls.length - 1]).toBe('navigate');
  });
});

// ─── onSessionExpired as onComplete (navigate callback) ───────────────────────

describe('buildSessionExpiredRunner — onComplete wiring (onSessionExpired ?? onLogout)', () => {
  it('calls the provided onComplete exactly once (no double-navigate)', async () => {
    const navigateCalls: number[] = [];
    const { deps } = makeDeps({
      onComplete: () => { navigateCalls.push(1); },
    });
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    // onComplete must be called exactly once — no double-navigate
    expect(navigateCalls).toHaveLength(1);
  });

  it('calls onComplete AFTER clearTokens — tokens gone before navigation', async () => {
    const eventLog: string[] = [];
    const { deps } = makeDeps({
      clearTokens: async () => { eventLog.push('clearTokens'); },
      onComplete: () => { eventLog.push('onComplete'); },
    });
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    expect(eventLog.indexOf('clearTokens')).toBeLessThan(eventLog.indexOf('onComplete'));
  });

  it('with optional stores (resetConsentStore, resetSuggestionStore, etc.) — navigate still runs last', async () => {
    const { deps, calls } = makeDeps({
      resetConsentStore: () => { calls.push('resetConsentStore'); },
      resetConsentQueue: async () => { calls.push('resetConsentQueue'); },
      resetSuggestionStore: () => { calls.push('resetSuggestionStore'); },
      resetExpensesStore: () => { calls.push('resetExpensesStore'); },
    });
    const runner = buildSessionExpiredRunner(deps);
    await runner();
    expect(calls).toContain('resetConsentStore');
    expect(calls).toContain('resetSuggestionStore');
    expect(calls).toContain('resetExpensesStore');
    expect(calls[calls.length - 1]).toBe('navigate');
  });
});
