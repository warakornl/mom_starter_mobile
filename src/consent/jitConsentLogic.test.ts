/**
 * jitConsentLogic — unit tests (TDD, written BEFORE the implementation).
 *
 * Tests the pure JIT consent gate logic:
 *   - requiresParentalAttestation — ม.20 checkbox gate for infant_feeding / child_health
 *   - isDualGatedWithGeneralHealth — dual-gate rule (§4.7)
 *   - evaluateJitGate — precedence: already_granted → general_health_needed → show_jit
 *   - isGrantEnabled — parental attestation unblocks the Grant button
 *
 * Design ref: first-run-consent.md §3.2, §4.7, §3.2c, §3.2d
 */

import {
  requiresParentalAttestation,
  isDualGatedWithGeneralHealth,
  evaluateJitGate,
  isGrantEnabled,
} from './jitConsentLogic';

// ─── requiresParentalAttestation ─────────────────────────────────────────────

describe('requiresParentalAttestation', () => {
  it('returns true for infant_feeding (ม.20 — parental consent required)', () => {
    expect(requiresParentalAttestation('infant_feeding')).toBe(true);
  });

  it('returns true for child_health (ม.20 — parental consent required)', () => {
    expect(requiresParentalAttestation('child_health')).toBe(true);
  });

  it('returns false for general_health (mother data, no parental attestation)', () => {
    expect(requiresParentalAttestation('general_health')).toBe(false);
  });

  it('returns false for cloud_storage', () => {
    expect(requiresParentalAttestation('cloud_storage')).toBe(false);
  });

  it('returns false for pdf_egress', () => {
    expect(requiresParentalAttestation('pdf_egress')).toBe(false);
  });

  it('returns false for sensitive_lab_results', () => {
    expect(requiresParentalAttestation('sensitive_lab_results')).toBe(false);
  });
});

// ─── isDualGatedWithGeneralHealth ────────────────────────────────────────────

describe('isDualGatedWithGeneralHealth', () => {
  it('returns true for infant_feeding (§4.7 explicit dual-gate)', () => {
    expect(isDualGatedWithGeneralHealth('infant_feeding')).toBe(true);
  });

  it('returns true for child_health (same server-contract rule)', () => {
    expect(isDualGatedWithGeneralHealth('child_health')).toBe(true);
  });

  it('returns false for general_health itself', () => {
    expect(isDualGatedWithGeneralHealth('general_health')).toBe(false);
  });

  it('returns false for cloud_storage', () => {
    expect(isDualGatedWithGeneralHealth('cloud_storage')).toBe(false);
  });

  it('returns false for pdf_egress', () => {
    expect(isDualGatedWithGeneralHealth('pdf_egress')).toBe(false);
  });

  it('returns false for sensitive_lab_results', () => {
    expect(isDualGatedWithGeneralHealth('sensitive_lab_results')).toBe(false);
  });
});

// ─── evaluateJitGate ─────────────────────────────────────────────────────────

describe('evaluateJitGate', () => {
  // Helper: build an isGranted function from a set of granted types
  function makeIsGranted(granted: string[]) {
    return (type: string) => granted.includes(type);
  }

  // ── already_granted cases ────────────────────────────────────────────────

  it('returns already_granted when the type is already granted', () => {
    const isGranted = makeIsGranted(['pdf_egress']);
    expect(evaluateJitGate('pdf_egress', isGranted)).toBe('already_granted');
  });

  it('returns already_granted for infant_feeding when granted (regardless of general_health)', () => {
    const isGranted = makeIsGranted(['infant_feeding']); // general_health not granted but doesn't matter
    // Once infant_feeding is granted, the JIT is not needed
    expect(evaluateJitGate('infant_feeding', isGranted)).toBe('already_granted');
  });

  // ── general_health_needed cases (dual-gate §4.7) ─────────────────────────

  it('returns general_health_needed for infant_feeding when general_health not granted', () => {
    const isGranted = makeIsGranted([]); // nothing granted
    expect(evaluateJitGate('infant_feeding', isGranted)).toBe('general_health_needed');
  });

  it('returns general_health_needed for child_health when general_health not granted', () => {
    const isGranted = makeIsGranted([]); // nothing granted
    expect(evaluateJitGate('child_health', isGranted)).toBe('general_health_needed');
  });

  it('general_health_needed takes precedence: infant_feeding not granted + general_health not granted', () => {
    const isGranted = makeIsGranted(['cloud_storage']); // only cloud granted
    expect(evaluateJitGate('infant_feeding', isGranted)).toBe('general_health_needed');
  });

  // ── show_jit cases ────────────────────────────────────────────────────────

  it('returns show_jit for pdf_egress when not granted', () => {
    const isGranted = makeIsGranted([]);
    expect(evaluateJitGate('pdf_egress', isGranted)).toBe('show_jit');
  });

  it('returns show_jit for sensitive_lab_results when not granted', () => {
    const isGranted = makeIsGranted([]);
    expect(evaluateJitGate('sensitive_lab_results', isGranted)).toBe('show_jit');
  });

  it('returns show_jit for infant_feeding when general_health IS granted but infant_feeding is not', () => {
    const isGranted = makeIsGranted(['general_health']); // dual-gate passes
    expect(evaluateJitGate('infant_feeding', isGranted)).toBe('show_jit');
  });

  it('returns show_jit for child_health when general_health IS granted but child_health is not', () => {
    const isGranted = makeIsGranted(['general_health']);
    expect(evaluateJitGate('child_health', isGranted)).toBe('show_jit');
  });

  // ── dual-gate precedence order ────────────────────────────────────────────

  it('§4.7 precedence: evaluates already_granted BEFORE dual-gate check', () => {
    // Even if general_health is not granted, if infant_feeding IS granted → already_granted
    const isGranted = makeIsGranted(['infant_feeding']); // no general_health
    expect(evaluateJitGate('infant_feeding', isGranted)).toBe('already_granted');
  });
});

// ─── isGrantEnabled ───────────────────────────────────────────────────────────

describe('isGrantEnabled', () => {
  // ── Types with parental attestation (ม.20) ────────────────────────────────

  it('infant_feeding Grant is DISABLED when parental attestation NOT ticked', () => {
    expect(isGrantEnabled('infant_feeding', false)).toBe(false);
  });

  it('infant_feeding Grant is ENABLED when parental attestation IS ticked', () => {
    expect(isGrantEnabled('infant_feeding', true)).toBe(true);
  });

  it('child_health Grant is DISABLED when parental attestation NOT ticked', () => {
    expect(isGrantEnabled('child_health', false)).toBe(false);
  });

  it('child_health Grant is ENABLED when parental attestation IS ticked', () => {
    expect(isGrantEnabled('child_health', true)).toBe(true);
  });

  // ── Types without parental attestation ────────────────────────────────────

  it('pdf_egress Grant is always enabled (no attestation required)', () => {
    expect(isGrantEnabled('pdf_egress', false)).toBe(true);
    expect(isGrantEnabled('pdf_egress', true)).toBe(true);
  });

  it('sensitive_lab_results Grant is always enabled', () => {
    expect(isGrantEnabled('sensitive_lab_results', false)).toBe(true);
  });

  it('general_health Grant is always enabled (first-run card, not JIT)', () => {
    expect(isGrantEnabled('general_health', false)).toBe(true);
  });

  it('cloud_storage Grant is always enabled', () => {
    expect(isGrantEnabled('cloud_storage', false)).toBe(true);
  });
});
