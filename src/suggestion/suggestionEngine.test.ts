/**
 * suggestionEngine.test.ts — TDD (RED → GREEN) for the suggestion engine.
 *
 * Tests the pure `getOfferable` function against the static catalog.
 * All inputs deterministic; no side effects, no I/O.
 */

import { getOfferable } from './suggestionEngine';
import type { SuggestionContext, UserSuggestionState } from './types';

const NOW = new Date('2026-07-03T10:00:00Z');

function mkCtx(
  overrides: Partial<SuggestionContext> = {},
): SuggestionContext {
  return {
    lifecycle: 'pregnant',
    stage: 'T3',
    gestationalWeek: 34,
    now: NOW,
    ...overrides,
  };
}

function mkState(
  key: string,
  status: UserSuggestionState['status'],
  resurfacesAt?: string,
): Record<string, UserSuggestionState> {
  return {
    [key]: {
      key: key as UserSuggestionState['key'],
      status,
      resurfacesAt,
      updatedAt: NOW.toISOString(),
    },
  };
}

// ─── lifecycle gate ───────────────────────────────────────────────────────────

describe('getOfferable — lifecycle gate', () => {
  it('returns empty list when lifecycle is ended', () => {
    const result = getOfferable(mkCtx({ lifecycle: 'ended', stage: null }), {});
    expect(result).toEqual([]);
  });

  it('returns postpartum suggestions when lifecycle is postpartum', () => {
    const result = getOfferable(
      mkCtx({ lifecycle: 'postpartum', stage: null, gestationalWeek: 0 }),
      {},
    );
    const keys = result.map((s) => s.key);
    expect(keys).toContain('postnatal_checkup');
    expect(keys).toContain('baby_feeding_log');
  });

  it('does not return pregnant suggestions when lifecycle is postpartum', () => {
    const result = getOfferable(
      mkCtx({ lifecycle: 'postpartum', stage: null, gestationalWeek: 0 }),
      {},
    );
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('kick_count_start');
    expect(keys).not.toContain('triferdine_daily');
    expect(keys).not.toContain('anc_t1_checkup');
  });
});

// ─── stage gate ───────────────────────────────────────────────────────────────

describe('getOfferable — stage gate', () => {
  it('returns T1-specific suggestion (anc_t1_checkup) when in T1', () => {
    const result = getOfferable(
      mkCtx({ stage: 'T1', gestationalWeek: 8 }),
      {},
    );
    const keys = result.map((s) => s.key);
    expect(keys).toContain('anc_t1_checkup');
    expect(keys).toContain('triferdine_daily'); // all-stages
    expect(keys).not.toContain('anc_t2_checkup');
    expect(keys).not.toContain('anc_t3_checkup');
    expect(keys).not.toContain('kick_count_start');
  });

  it('returns T2-specific suggestion (anc_t2_checkup) when in T2', () => {
    const result = getOfferable(
      mkCtx({ stage: 'T2', gestationalWeek: 20 }),
      {},
    );
    const keys = result.map((s) => s.key);
    expect(keys).toContain('anc_t2_checkup');
    expect(keys).not.toContain('anc_t1_checkup');
    expect(keys).not.toContain('anc_t3_checkup');
  });

  it('returns T3-specific suggestions (anc + supplies) when in T3 and week ≥ 28', () => {
    // kick_count_start requires wk≥32 (aligned with shouldShowModule gate)
    const result = getOfferable(mkCtx({ stage: 'T3', gestationalWeek: 30 }), {});
    const keys = result.map((s) => s.key);
    expect(keys).toContain('anc_t3_checkup');
    expect(keys).toContain('supplies_checklist');
    expect(keys).not.toContain('kick_count_start'); // not yet — wk<32
    expect(keys).not.toContain('anc_t1_checkup');
    expect(keys).not.toContain('anc_t2_checkup');
  });

  it('returns kick_count_start when in T3 and week ≥ 32 (module gate alignment)', () => {
    const result = getOfferable(mkCtx({ stage: 'T3', gestationalWeek: 32 }), {});
    const keys = result.map((s) => s.key);
    expect(keys).toContain('kick_count_start');
  });
});

// ─── week gate ────────────────────────────────────────────────────────────────

describe('getOfferable — gestational week gate', () => {
  it('does not return kick_count_start before week 32 (aligned with shouldShowModule gate)', () => {
    const result = getOfferable(
      mkCtx({ stage: 'T3', gestationalWeek: 31 }),
      {},
    );
    expect(result.map((s) => s.key)).not.toContain('kick_count_start');
  });

  it('returns kick_count_start at exactly week 32', () => {
    const result = getOfferable(
      mkCtx({ stage: 'T3', gestationalWeek: 32 }),
      {},
    );
    expect(result.map((s) => s.key)).toContain('kick_count_start');
  });

  it('does not return supplies_checklist before week 28', () => {
    const result = getOfferable(
      mkCtx({ stage: 'T3', gestationalWeek: 27 }),
      {},
    );
    expect(result.map((s) => s.key)).not.toContain('supplies_checklist');
  });

  it('returns supplies_checklist at week 28', () => {
    const result = getOfferable(
      mkCtx({ stage: 'T3', gestationalWeek: 28 }),
      {},
    );
    expect(result.map((s) => s.key)).toContain('supplies_checklist');
  });
});

// ─── user state gate ──────────────────────────────────────────────────────────

describe('getOfferable — user state gate', () => {
  it('includes a suggestion with no user state (default = offered)', () => {
    const result = getOfferable(mkCtx(), {});
    expect(result.some((s) => s.key === 'kick_count_start')).toBe(true);
  });

  it('excludes dismissed suggestions', () => {
    const states = mkState('kick_count_start', 'dismissed');
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'kick_count_start')).toBe(false);
  });

  it('excludes started suggestions', () => {
    const states = mkState('anc_t3_checkup', 'started');
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'anc_t3_checkup')).toBe(false);
  });

  it('excludes snoozed suggestions whose resurfacesAt is in the future', () => {
    const future = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const states = mkState('kick_count_start', 'snoozed', future);
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'kick_count_start')).toBe(false);
  });

  it('includes snoozed suggestions whose resurfacesAt is in the past', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString(); // 1 second ago
    const states = mkState('kick_count_start', 'snoozed', past);
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'kick_count_start')).toBe(true);
  });

  it('includes snoozed suggestions whose resurfacesAt equals now', () => {
    const exact = NOW.toISOString();
    const states = mkState('kick_count_start', 'snoozed', exact);
    const result = getOfferable(mkCtx(), states);
    // resurfacesAt === now → NOT > now, so it should resurface
    expect(result.some((s) => s.key === 'kick_count_start')).toBe(true);
  });

  it('includes snoozed suggestions with no resurfacesAt (treat as offered)', () => {
    const states = mkState('kick_count_start', 'snoozed', undefined);
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'kick_count_start')).toBe(true);
  });
});

// ─── started re-arm (Surface 1 — ANC cadence) ────────────────────────────────
// Behavior: started WITHOUT resurfacesAt → permanent exclude (unchanged).
// started WITH future resurfacesAt → round-quiet (excluded, like snoozed).
// started WITH past/now resurfacesAt → re-evaluable (included).

describe('getOfferable — started re-arm gate (ANC cadence §1.5)', () => {
  it('excludes a started suggestion with no resurfacesAt (unchanged behavior)', () => {
    const states = mkState('anc_t3_checkup', 'started');
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'anc_t3_checkup')).toBe(false);
  });

  it('excludes a started suggestion with a future resurfacesAt (round-quiet)', () => {
    const future = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const states = mkState('anc_t3_checkup', 'started', future);
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'anc_t3_checkup')).toBe(false);
  });

  it('includes a started suggestion with a past resurfacesAt (re-arms for next round)', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    const states = mkState('anc_t3_checkup', 'started', past);
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'anc_t3_checkup')).toBe(true);
  });

  it('includes a started suggestion where resurfacesAt exactly equals now', () => {
    const exact = NOW.toISOString();
    const states = mkState('anc_t3_checkup', 'started', exact);
    const result = getOfferable(mkCtx(), states);
    expect(result.some((s) => s.key === 'anc_t3_checkup')).toBe(true);
  });
});

// ─── ordering ─────────────────────────────────────────────────────────────────

describe('getOfferable — evidence-strength ordering', () => {
  it('orders HIGH before STRONG before MODERATE for T3 wk32', () => {
    const result = getOfferable(mkCtx({ stage: 'T3', gestationalWeek: 32 }), {});
    const keys = result.map((s) => s.key);
    const idxKickCount = keys.indexOf('kick_count_start'); // HIGH
    const idxAnc = keys.indexOf('anc_t3_checkup'); // STRONG
    const idxSupplies = keys.indexOf('supplies_checklist'); // MODERATE
    expect(idxKickCount).toBeGreaterThanOrEqual(0);
    expect(idxAnc).toBeGreaterThanOrEqual(0);
    expect(idxSupplies).toBeGreaterThanOrEqual(0);
    expect(idxKickCount).toBeLessThan(idxAnc);
    expect(idxAnc).toBeLessThan(idxSupplies);
  });
});

// ─── output shape ─────────────────────────────────────────────────────────────

describe('getOfferable — output shape', () => {
  it('returns OfferableSuggestion objects with required fields', () => {
    const result = getOfferable(mkCtx({ stage: 'T3', gestationalWeek: 30 }), {});
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(s).toHaveProperty('key');
      expect(s).toHaveProperty('captureTarget');
      expect(s).toHaveProperty('evidenceStrength');
      expect(s).toHaveProperty('source');
    }
  });
});
