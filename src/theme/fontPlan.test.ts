/**
 * fontPlan.test.ts — TDD tests for Mother Room font loading plan.
 *
 * Spec: docs/design/mother-room-build-spec.md §2
 *
 * Tests:
 *   1. Required fonts: Sarabun-Regular, Sarabun-SemiBold, Fraunces-SemiBold
 *   2. Fraunces italic is NOT in required set (reviewer nit — skip optional)
 *   3. Sarabun-SemiBold is the TH fallback for Fraunces failures
 *   4. Fraunces is flagged as optional (graceful degradation)
 *
 * Pure-Node environment — no expo-font or native module required.
 */

import {
  REQUIRED_FONTS,
  THAI_FALLBACK_FONT,
  FRAUNCES_IS_OPTIONAL,
} from './fontPlan';

// ─── Required fonts ───────────────────────────────────────────────────────────

describe('fontPlan — required fonts (§2.1)', () => {
  it('Sarabun-Regular is in the required font map', () => {
    expect(REQUIRED_FONTS).toHaveProperty('Sarabun-Regular');
  });

  it('Sarabun-SemiBold is in the required font map', () => {
    expect(REQUIRED_FONTS).toHaveProperty('Sarabun-SemiBold');
  });

  it('Fraunces-SemiBold is in the required font map (EN bilingual surfaces)', () => {
    expect(REQUIRED_FONTS).toHaveProperty('Fraunces-SemiBold');
  });

  it('exactly 3 fonts are declared (no extras; Fraunces italic skipped per reviewer nit)', () => {
    expect(Object.keys(REQUIRED_FONTS)).toHaveLength(3);
  });

  it('Fraunces-SemiBold-Italic is NOT in the required font map (skipped per reviewer nit)', () => {
    expect(REQUIRED_FONTS).not.toHaveProperty('Fraunces-SemiBold-Italic');
  });
});

// ─── Fallback chain ───────────────────────────────────────────────────────────

describe('fontPlan — TH fallback chain (§2.2)', () => {
  it('THAI_FALLBACK_FONT is Sarabun-SemiBold (covers Fraunces failures on TH locale)', () => {
    expect(THAI_FALLBACK_FONT).toBe('Sarabun-SemiBold');
  });
});

// ─── Optional degradation ─────────────────────────────────────────────────────

describe('fontPlan — Fraunces optional (§2.2)', () => {
  it('FRAUNCES_IS_OPTIONAL is true (load failure → graceful Sarabun fallback)', () => {
    expect(FRAUNCES_IS_OPTIONAL).toBe(true);
  });
});

// ─── Expo family name constants ───────────────────────────────────────────────

describe('fontPlan — Expo font file keys (§2.1)', () => {
  it('Sarabun-Regular maps to Sarabun_400Regular', () => {
    expect(REQUIRED_FONTS['Sarabun-Regular']).toBe('Sarabun_400Regular');
  });

  it('Sarabun-SemiBold maps to Sarabun_600SemiBold', () => {
    expect(REQUIRED_FONTS['Sarabun-SemiBold']).toBe('Sarabun_600SemiBold');
  });

  it('Fraunces-SemiBold maps to Fraunces_600SemiBold', () => {
    expect(REQUIRED_FONTS['Fraunces-SemiBold']).toBe('Fraunces_600SemiBold');
  });
});
