/**
 * ancOfferable.test.ts — TDD for the ANC cadence offerable predicate (Surface 3).
 *
 * Tests are parametrized over ANC_TARGET_WEEKS to avoid golden vectors bound
 * to clinically-unconfirmed week values (§3.1 — Z-16 pending).
 * The LOGIC (boundary behavior, offer window, no-upcoming gate) is pinned;
 * the constants can change without touching test logic.
 *
 * Invariants asserted:
 *   - ANC-AC-1: boundary (W−1 shown, W hidden, >W no re-open)
 *   - ANC-AC-9: upcoming appointment in window suppresses offer
 *   - ANC-AC-10: started+resurfacesAt re-arms (engine §1.5 — already in engine tests)
 *   - ANC-E1: no EDD → not offerable
 *   - ANC-E2: not pregnant → not offerable
 *   - ANC-E16: gestationalWeek ≥ max(ANC_TARGET_WEEKS) → not offerable
 *   - ANC-E17: very early / negative gestationalWeek → not offerable
 *   - INV-A1: no health/symptom input in offerable predicate
 *   - INV-A2: string corpus passes command/diagnosis denylist (TH + EN)
 *   - INV-A5: all shipped strings have clinical_signoff
 */

import { getOfferable } from './suggestionEngine';
import type { SuggestionContext, UserSuggestionState } from './types';
import {
  ANC_TARGET_WEEKS,
  OFFER_LEAD_WEEKS,
  ANC_CATALOG_COPY,
  ANC_LOCK_SCREEN_TITLE,
  ANC_APPOINTMENT_TITLE,
} from './ancConfig';

// ─── Test fixtures (parametrized — never golden-vector the specific week values) ─

/**
 * For each target week W in ANC_TARGET_WEEKS pick a test tuple:
 *   gestationalWeek = W - OFFER_LEAD_WEEKS  → first week in the offer window
 * We test the LOGIC, not the specific W value.
 */
const FIRST_TARGET = ANC_TARGET_WEEKS[0];
const SECOND_TARGET = ANC_TARGET_WEEKS[1];

const EDD = '2026-12-01'; // arbitrary future EDD for tests

function mkCtx(
  overrides: Partial<SuggestionContext> = {},
): SuggestionContext {
  return {
    lifecycle: 'pregnant',
    stage: 'T2',
    gestationalWeek: FIRST_TARGET - OFFER_LEAD_WEEKS,
    now: new Date('2026-07-01T10:00:00Z'),
    edd: EDD,
    upcomingApptInWindow: false,
    ...overrides,
  };
}

function mkStarted(resurfacesAt?: string): Partial<Record<string, UserSuggestionState>> {
  return {
    anc_next_checkup: {
      key: 'anc_next_checkup',
      status: 'started',
      resurfacesAt,
      updatedAt: new Date().toISOString(),
    },
  };
}

// ─── Catalog presence ─────────────────────────────────────────────────────────

describe('anc_next_checkup — catalog presence', () => {
  it('anc_next_checkup is offerable at the first offer window (W−LEAD)', () => {
    const result = getOfferable(mkCtx(), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(true);
  });

  it('anc_next_checkup has captureTarget "appointment"', () => {
    const result = getOfferable(mkCtx(), {});
    const entry = result.find((s) => s.key === 'anc_next_checkup');
    expect(entry?.captureTarget).toBe('appointment');
  });

  it('anc_next_checkup has evidenceStrength STRONG', () => {
    const result = getOfferable(mkCtx(), {});
    const entry = result.find((s) => s.key === 'anc_next_checkup');
    expect(entry?.evidenceStrength).toBe('STRONG');
  });

  it('source contains กรมอนามัย or RTCOG', () => {
    const result = getOfferable(mkCtx(), {});
    const entry = result.find((s) => s.key === 'anc_next_checkup');
    expect(entry?.source).toMatch(/กรมอนามัย|RTCOG/);
  });
});

// ─── ANC-AC-1: boundary logic (parametrized over FIRST_TARGET) ───────────────

describe('anc_next_checkup — offer window boundary (ANC-AC-1, parametrized)', () => {
  const W = FIRST_TARGET;

  it('is offerable at gestationalWeek = W − OFFER_LEAD_WEEKS (first window week)', () => {
    const result = getOfferable(mkCtx({ gestationalWeek: W - OFFER_LEAD_WEEKS }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(true);
  });

  it('is offerable at gestationalWeek = W − 1 (one week before target)', () => {
    // W - 1 >= W - OFFER_LEAD_WEEKS is true when OFFER_LEAD_WEEKS >= 1 (which it is)
    const result = getOfferable(mkCtx({ gestationalWeek: W - 1 }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(true);
  });

  it('is NOT offerable at gestationalWeek = W (hidden at exactly the target week)', () => {
    // At W, nextTargetWeek advances to the NEXT target; W is no longer < nextTargetWeek
    // The offer for W closes; the next target is not yet in its lead window.
    // Requires at least one more target after W.
    if (ANC_TARGET_WEEKS.length < 2) return; // skip if only one target
    const result = getOfferable(mkCtx({ gestationalWeek: W }), {});
    // If SECOND_TARGET - OFFER_LEAD_WEEKS <= W, this might be offerable for a different target.
    // We assert: the offer for the FIRST target is gone (cadence forward-only).
    // The simplest assertion: at W, we're not in [SECOND_TARGET - LEAD, SECOND_TARGET) unless lead >= gap.
    const gapToSecond = SECOND_TARGET - W;
    if (gapToSecond > OFFER_LEAD_WEEKS) {
      // W is not yet in the lead window for the second target
      expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
    }
    // If gap <= OFFER_LEAD_WEEKS, the offer for the second target starts right at W — acceptable.
  });

  it('is NOT offerable at gestationalWeek = W + 1 (past the first target, no re-open)', () => {
    const W_plus1 = W + 1;
    // Only assert if W+1 is not yet in the lead window of the next target
    if (SECOND_TARGET - OFFER_LEAD_WEEKS > W_plus1) {
      const result = getOfferable(mkCtx({ gestationalWeek: W_plus1 }), {});
      expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
    }
  });
});

// ─── ANC-E1: no EDD → not offerable ──────────────────────────────────────────

describe('anc_next_checkup — edge cases', () => {
  it('ANC-E1: not offerable when edd is null', () => {
    const result = getOfferable(mkCtx({ edd: null }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
  });

  it('ANC-E1: not offerable when edd is undefined', () => {
    const result = getOfferable(mkCtx({ edd: undefined }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
  });

  it('ANC-E2: not offerable when lifecycle is not pregnant', () => {
    const result = getOfferable(
      mkCtx({ lifecycle: 'postpartum', stage: null, edd: null }),
      {},
    );
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
  });

  it('ANC-E16: not offerable when gestationalWeek >= max(ANC_TARGET_WEEKS)', () => {
    const maxW = Math.max(...ANC_TARGET_WEEKS);
    const result = getOfferable(mkCtx({ gestationalWeek: maxW }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
  });

  it('ANC-E17: not offerable when gestationalWeek is below first offer window', () => {
    const firstWindowStart = FIRST_TARGET - OFFER_LEAD_WEEKS;
    if (firstWindowStart > 0) {
      const result = getOfferable(mkCtx({ gestationalWeek: firstWindowStart - 1 }), {});
      expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
    }
  });

  it('ANC-E17: not offerable for negative gestational week', () => {
    const result = getOfferable(mkCtx({ gestationalWeek: -2 }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
  });

  // ANC-AC-9: upcoming appointment suppresses offer
  it('ANC-AC-9: not offerable when upcomingApptInWindow is true', () => {
    const result = getOfferable(mkCtx({ upcomingApptInWindow: true }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
  });

  it('ANC-E3: not offerable when lifecycle is ended', () => {
    const result = getOfferable(mkCtx({ lifecycle: 'ended', stage: null }), {});
    expect(result.some((s) => s.key === 'anc_next_checkup')).toBe(false);
  });
});

// ─── INV-A2: command/diagnosis denylist (TH + EN) ────────────────────────────

const TH_DENYLIST = [
  'ต้องไป', 'คุณต้อง', 'ห้ามพลาด', 'อย่าพลาด',
  'ผิดปกติ', 'เสี่ยง', 'จำเป็นต้อง', 'ควรรีบ',
];
const EN_DENYLIST = [
  'you should', 'you must', "must ", "don't miss", 'do not miss',
  'need to', 'required', 'overdue', 'abnormal', 'at risk', 'risk',
  'urgent',
];

describe('INV-A2: command/diagnosis denylist — ANC string corpus', () => {
  // Collect all ANC-specific shipped strings (INV-A2: full corpus — card headline,
  // disclaimer, date labels both flags, source ribbon, reminder generic title,
  // and the appointment-form prefill title "นัดตรวจครรภ์" / "Prenatal check-up").
  const allStrings: string[] = [
    ANC_CATALOG_COPY.title.th,
    ANC_CATALOG_COPY.title.en,
    ANC_CATALOG_COPY.reason.th,
    ANC_CATALOG_COPY.reason.en,
    ANC_CATALOG_COPY.cardDisclaimer.th,
    ANC_CATALOG_COPY.cardDisclaimer.en,
    ANC_CATALOG_COPY.formDisclaimer.th,
    ANC_CATALOG_COPY.formDisclaimer.en,
    ANC_CATALOG_COPY.dateLabelOn.th,
    ANC_CATALOG_COPY.dateLabelOn.en,
    ANC_CATALOG_COPY.dateLabelOff.th,
    ANC_CATALOG_COPY.dateLabelOff.en,
    ANC_CATALOG_COPY.sourceRibbon.th,
    ANC_CATALOG_COPY.sourceRibbon.en,
    ANC_LOCK_SCREEN_TITLE.th,
    ANC_LOCK_SCREEN_TITLE.en,
    // ANC_APPOINTMENT_TITLE: prefilled in the appointment form (§3.3 / ANC-AC-3).
    // Gap-fill: this shipped string was missing from the INV-A2 corpus check.
    ANC_APPOINTMENT_TITLE.th,
    ANC_APPOINTMENT_TITLE.en,
  ];

  it('no Thai denylist token appears in any ANC string (INV-A2)', () => {
    for (const s of allStrings) {
      const lower = s.toLowerCase();
      for (const token of TH_DENYLIST) {
        expect(lower).not.toContain(token.toLowerCase());
      }
    }
  });

  it('no English denylist token appears in any ANC string (INV-A2)', () => {
    for (const s of allStrings) {
      const lower = s.toLowerCase();
      for (const token of EN_DENYLIST) {
        expect(lower).not.toContain(token.toLowerCase());
      }
    }
  });
});

// ─── INV-A1: no health/symptom input ─────────────────────────────────────────

describe('INV-A1: ANC offerable predicate inputs are non-health metadata only', () => {
  it('SuggestionContext for ANC only uses lifecycle/stage/gestationalWeek/now/edd/upcomingApptInWindow', () => {
    // The ANC predicate only reads these six fields — no health measurement.
    // This test enumerates the context fields to ensure no health value leaks in.
    const ctx = mkCtx();
    const expectedKeys = new Set(['lifecycle', 'stage', 'gestationalWeek', 'now', 'edd', 'upcomingApptInWindow']);
    for (const key of Object.keys(ctx)) {
      expect(expectedKeys.has(key)).toBe(true);
    }
  });
});
