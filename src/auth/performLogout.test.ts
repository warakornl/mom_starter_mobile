/**
 * performLogout — shared logout side-effect runner (TDD, failing first).
 *
 * Extracted from HomeScreen.handleLogout so the wiring (which stores get reset)
 * is unit-tested — the homeScreenLogout.test.ts suite notes this wiring was
 * previously only covered by tsc + manual device testing. Now the logout button
 * lives in SettingsScreen; both call performLogout with the real singletons.
 *
 * PDPA 1.1 (appsec): logout MUST clear tokens + EVERY health store so user A's
 * data cannot leak to user B in the same JS session. onComplete (navigate to
 * Welcome) must run LAST and must run even if a clear step rejects.
 */

import { performLogout, type LogoutDeps } from './performLogout';

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
    clearKickCountDraft: async () => { calls.push('clearKickCountDraft'); },
    onComplete: () => { calls.push('onComplete'); },
    ...overrides,
  };
  return { deps, calls };
}

describe('performLogout — clears tokens + all health stores, then navigates', () => {
  it('calls every clear/reset step and onComplete', async () => {
    const { deps, calls } = makeDeps();
    await performLogout(deps);
    expect(calls).toEqual(
      expect.arrayContaining([
        'clearTokens',
        'resetSupplyStore',
        'resetKickCountStore',
        'resetCalendarStore',
        'clearKickCountDraft',
        'onComplete',
      ]),
    );
  });

  it('runs onComplete LAST (navigation only after data is cleared)', async () => {
    const { deps, calls } = makeDeps();
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still resets stores + navigates even if clearTokens rejects (non-fatal)', async () => {
    const { deps, calls } = makeDeps({
      clearTokens: async () => { throw new Error('keychain unavailable'); },
    });
    await performLogout(deps);
    expect(calls).toEqual(
      expect.arrayContaining([
        'resetSupplyStore',
        'resetKickCountStore',
        'resetCalendarStore',
        'onComplete',
      ]),
    );
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates even if clearKickCountDraft rejects (best-effort)', async () => {
    const { deps, calls } = makeDeps({
      clearKickCountDraft: async () => { throw new Error('secure-store fail'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + attempts every store even if one reset throws synchronously', async () => {
    const { deps, calls } = makeDeps({
      resetSupplyStore: () => { throw new Error('supply reset blew up'); },
    });
    await performLogout(deps);
    // the throwing reset must not strand the user or skip the other stores
    expect(calls).toEqual(
      expect.arrayContaining(['resetKickCountStore', 'resetCalendarStore', 'onComplete']),
    );
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('calls resetConsentQueue when provided (N1 — durable queue cleared on logout)', async () => {
    const { deps, calls } = makeDeps({
      resetConsentQueue: async () => { calls.push('resetConsentQueue'); },
    });
    await performLogout(deps);
    expect(calls).toContain('resetConsentQueue');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates when resetConsentQueue is omitted (backward-compat, optional dep)', async () => {
    // No resetConsentQueue provided → must not break existing callers
    const { deps, calls } = makeDeps(); // no resetConsentQueue
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates even if resetConsentQueue rejects (best-effort)', async () => {
    const { deps, calls } = makeDeps({
      resetConsentQueue: async () => { throw new Error('secure-store full'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('calls resetSuggestionStore when provided (PDPA: no cross-account suggestion leak)', async () => {
    const { deps, calls } = makeDeps({
      resetSuggestionStore: () => { calls.push('resetSuggestionStore'); },
    });
    await performLogout(deps);
    expect(calls).toContain('resetSuggestionStore');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates when resetSuggestionStore is omitted (backward-compat, optional dep)', async () => {
    // No resetSuggestionStore provided → must not break existing callers
    const { deps, calls } = makeDeps(); // no resetSuggestionStore
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + continues even if resetSuggestionStore throws synchronously', async () => {
    const { deps, calls } = makeDeps({
      resetSuggestionStore: () => { throw new Error('store reset failure'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });
});

// ─── resetExpensesStore — PDPA: no cross-account expense leak ─────────────────

describe('performLogout — resetExpensesStore (PDPA: no cross-account expense leak)', () => {
  it('calls resetExpensesStore when provided', async () => {
    const { deps, calls } = makeDeps({
      resetExpensesStore: () => { calls.push('resetExpensesStore'); },
    });
    await performLogout(deps);
    expect(calls).toContain('resetExpensesStore');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates when resetExpensesStore is omitted (backward-compat, optional dep)', async () => {
    const { deps, calls } = makeDeps(); // no resetExpensesStore
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + continues even if resetExpensesStore throws synchronously', async () => {
    const { deps, calls } = makeDeps({
      resetExpensesStore: () => { throw new Error('expenses store reset failure'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });
});
