/**
 * useJitConsent — unit tests (TDD, written BEFORE implementation).
 *
 * Tests the pure logic layer underneath the hook:
 *   - useJitConsentLogic: evaluates the gate and manages parental-attestation state
 *   - initialJitState: returns correct initial state object shape
 *   - applyGrantSuccess: transitions state to 'already_granted' after grant
 *   - applyDecline: sets declined=true, shows blocked inline
 *
 * The hook itself uses consentStore + consentQueue which are singletons.
 * We test the pure state-transition functions here to keep tests node-runnable.
 *
 * Design ref: first-run-consent.md §3.2, §4.7
 */

import {
  initialJitState,
  applyGrantSuccess,
  applyDecline,
  type JitState,
} from './useJitConsentLogic';

// ─── initialJitState ──────────────────────────────────────────────────────────

describe('initialJitState', () => {
  it('starts with isLoading=false', () => {
    const state = initialJitState();
    expect(state.isLoading).toBe(false);
  });

  it('starts with error=null', () => {
    const state = initialJitState();
    expect(state.error).toBeNull();
  });

  it('starts with parentalAttested=false (ม.20 — NEVER pre-ticked)', () => {
    const state = initialJitState();
    expect(state.parentalAttested).toBe(false);
  });

  it('starts with declined=false', () => {
    const state = initialJitState();
    expect(state.declined).toBe(false);
  });

  it('has all required fields', () => {
    const state = initialJitState();
    expect(state).toHaveProperty('isLoading');
    expect(state).toHaveProperty('error');
    expect(state).toHaveProperty('parentalAttested');
    expect(state).toHaveProperty('declined');
  });
});

// ─── applyGrantSuccess ────────────────────────────────────────────────────────

describe('applyGrantSuccess', () => {
  const base: JitState = initialJitState();

  it('sets isLoading to false', () => {
    const loading: JitState = { ...base, isLoading: true };
    expect(applyGrantSuccess(loading).isLoading).toBe(false);
  });

  it('clears any error', () => {
    const withError: JitState = { ...base, error: 'some error' };
    expect(applyGrantSuccess(withError).error).toBeNull();
  });

  it('sets declined to false', () => {
    const declined: JitState = { ...base, declined: true };
    expect(applyGrantSuccess(declined).declined).toBe(false);
  });

  it('preserves parentalAttested', () => {
    const attested: JitState = { ...base, parentalAttested: true };
    expect(applyGrantSuccess(attested).parentalAttested).toBe(true);
  });
});

// ─── applyDecline ─────────────────────────────────────────────────────────────

describe('applyDecline', () => {
  const base: JitState = initialJitState();

  it('sets declined=true', () => {
    expect(applyDecline(base).declined).toBe(true);
  });

  it('sets isLoading=false (no pending POST on decline)', () => {
    const loading: JitState = { ...base, isLoading: true };
    expect(applyDecline(loading).isLoading).toBe(false);
  });

  it('clears any error', () => {
    const withError: JitState = { ...base, error: 'err' };
    expect(applyDecline(withError).error).toBeNull();
  });

  it('does NOT change parentalAttested', () => {
    const attested: JitState = { ...base, parentalAttested: true };
    expect(applyDecline(attested).parentalAttested).toBe(true);
  });
});
