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
    resetSelfLogStore: () => { calls.push('resetSelfLogStore'); },
    resetMedicationPlanStore: () => { calls.push('resetMedicationPlanStore'); },
    resetMedicationLogStore: () => { calls.push('resetMedicationLogStore'); },
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
        'resetSelfLogStore',
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

  it('calls resetProfileVerbQueue when provided (N1-parity — durable profile-verb queue cleared on logout, direct-rest-offline-resilience OR-INV cross-user guard)', async () => {
    const { deps, calls } = makeDeps({
      resetProfileVerbQueue: async () => { calls.push('resetProfileVerbQueue'); },
    });
    await performLogout(deps);
    expect(calls).toContain('resetProfileVerbQueue');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates when resetProfileVerbQueue is omitted (backward-compat, optional dep)', async () => {
    const { deps, calls } = makeDeps(); // no resetProfileVerbQueue
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates even if resetProfileVerbQueue rejects (best-effort)', async () => {
    const { deps, calls } = makeDeps({
      resetProfileVerbQueue: async () => { throw new Error('secure-store full'); },
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

// ─── resetSelfLogStore — PDPA SD-5: no cross-account self-log leak ────────────
//
// BLOCKER 2: resetSelfLogStore must be REQUIRED (not optional) in LogoutDeps —
// a health-data isolation guard, not a backward-compat nicety.
// These tests are parity with the resetExpensesStore suite above.

describe('performLogout — resetSelfLogStore (PDPA SD-5: no cross-account self-log leak)', () => {
  it('calls resetSelfLogStore when logout runs', async () => {
    // RED: makeDeps() does not yet include resetSelfLogStore (currently optional and
    // omitted from the baseline helper). After BLOCKER 2 fix: makeDeps() includes it
    // as a required field and the implementation unconditionally calls it.
    const { deps, calls } = makeDeps();
    await performLogout(deps);
    expect(calls).toContain('resetSelfLogStore');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + continues even if resetSelfLogStore throws synchronously', async () => {
    // A throw in resetSelfLogStore must never strand the user before onComplete.
    const { deps, calls } = makeDeps({
      resetSelfLogStore: () => { throw new Error('self-log store reset failure'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });
});

// ─── resetMedicationPlanStore + resetMedicationLogStore — PDPA: no cross-account medication leak ──
//
// Both are REQUIRED deps (not optional) — medication plans and logs are MOTHER-health data
// (general_health gated). A missing reset() is a cross-account-leak bug (SD-5).
// Pattern mirrors resetSelfLogStore (required) and resetExpensesStore (optional→required).

describe('performLogout — resetMedicationPlanStore (PDPA: no cross-account medication plan leak)', () => {
  it('calls resetMedicationPlanStore when logout runs', async () => {
    const { deps, calls } = makeDeps();
    await performLogout(deps);
    expect(calls).toContain('resetMedicationPlanStore');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + continues even if resetMedicationPlanStore throws synchronously', async () => {
    const { deps, calls } = makeDeps({
      resetMedicationPlanStore: () => { throw new Error('medication plan store reset failure'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });
});

describe('performLogout — resetMedicationLogStore (PDPA: no cross-account medication log leak)', () => {
  it('calls resetMedicationLogStore when logout runs', async () => {
    const { deps, calls } = makeDeps();
    await performLogout(deps);
    expect(calls).toContain('resetMedicationLogStore');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + continues even if resetMedicationLogStore throws synchronously', async () => {
    const { deps, calls } = makeDeps({
      resetMedicationLogStore: () => { throw new Error('medication log store reset failure'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });
});

// ─── resetConsumptionMappingStore — PDPA SD-5: no cross-account mapping leak ──
//
// consumptionMappingStore holds which activities link to which supply items
// (health→supply, INV-ASD-9). It is health-adjacent data and MUST be cleared on
// logout so User A's mapping config cannot leak to User B in the same JS session.
// Optional dep (backward-compat) — same posture as resetSuggestionStore.

describe('performLogout — resetConsumptionMappingStore (PDPA SD-5: no cross-account mapping leak)', () => {
  it('calls resetConsumptionMappingStore when provided', async () => {
    const { deps, calls } = makeDeps({
      resetConsumptionMappingStore: () => { calls.push('resetConsumptionMappingStore'); },
    });
    await performLogout(deps);
    expect(calls).toContain('resetConsumptionMappingStore');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates when resetConsumptionMappingStore is omitted (backward-compat, optional dep)', async () => {
    const { deps, calls } = makeDeps(); // no resetConsumptionMappingStore
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + continues even if resetConsumptionMappingStore throws synchronously', async () => {
    const { deps, calls } = makeDeps({
      resetConsumptionMappingStore: () => { throw new Error('consumption mapping store reset failure'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });
});

// ─── resetStockDecrementMarkerStore — INV-ASD-8: on-device-only idempotency ──
//
// stockDecrementMarkerStore is health-adjacent (completionEventId = FeedingSession/
// ReminderOccurrence id). It NEVER leaves the device (INV-ASD-8) and MUST be
// cleared on logout so User A's skip-if-seen markers cannot suppress User B's
// first auto-decrement for the same supply event id (E-10 cross-account fence).
// Optional dep (backward-compat) — same posture as resetSuggestionStore.

describe('performLogout — resetStockDecrementMarkerStore (INV-ASD-8: E-10 cross-account fence)', () => {
  it('calls resetStockDecrementMarkerStore when provided', async () => {
    const { deps, calls } = makeDeps({
      resetStockDecrementMarkerStore: () => { calls.push('resetStockDecrementMarkerStore'); },
    });
    await performLogout(deps);
    expect(calls).toContain('resetStockDecrementMarkerStore');
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates when resetStockDecrementMarkerStore is omitted (backward-compat, optional dep)', async () => {
    const { deps, calls } = makeDeps(); // no resetStockDecrementMarkerStore
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });

  it('still navigates + continues even if resetStockDecrementMarkerStore throws synchronously', async () => {
    const { deps, calls } = makeDeps({
      resetStockDecrementMarkerStore: () => { throw new Error('marker store reset failure'); },
    });
    await performLogout(deps);
    expect(calls[calls.length - 1]).toBe('onComplete');
  });
});
