/**
 * ancHandleStart.test.ts — TDD for the ANC cadence handleStart payload builder.
 *
 * Tests the pure computation logic for Surface 4:
 *   - resurfacesAt = new Date(`${nextTargetDate}T00:00`).toISOString()
 *     (T00:00 LOCAL parse is LOAD-BEARING — bare YYYY-MM-DD parses UTC, off-by-1 @ UTC+7)
 *   - nextANCDate clamped to today+PAST_CLAMP_DAYS when nextTargetDate is past
 *   - AncFormPrefill fields (category, attachReminder, fromSuggestion, etc.)
 *   - ANC_PREFILL_DATE flag: date present when ON, absent when OFF
 *   - Called from SuggestionFlowScreen when key === 'anc_next_checkup'
 *
 * Tests are parametrized over ANC_TARGET_WEEKS (no golden vectors on specific weeks).
 */

import { buildAncStartPayload } from './ancHandleStart';
import {
  ANC_TARGET_WEEKS,
  OFFER_LEAD_WEEKS,
  PAST_CLAMP_DAYS,
  ANC_CATALOG_COPY,
  ANC_APPOINTMENT_TITLE,
} from './ancConfig';
import { weekToTargetDate } from '../pregnancy/gestationalAge';

const FIRST_TARGET = ANC_TARGET_WEEKS[0];
// An EDD far in the future so nextTargetDate is always ahead of any test "now"
const FUTURE_EDD = '2030-01-01';

// ─── Happy-path: prefill-date ON ──────────────────────────────────────────────

describe('buildAncStartPayload — ANC_PREFILL_DATE ON', () => {
  const gestationalWeek = FIRST_TARGET - OFFER_LEAD_WEEKS;
  const now = new Date('2026-07-01T10:00:00Z');

  it('returns a payload (not null) when edd and nextTargetWeek exist', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    });
    expect(result).not.toBeNull();
  });

  it('resurfacesAt uses T00:00 LOCAL parse (not bare YYYY-MM-DD UTC)', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    const nextTargetDate = weekToTargetDate(FUTURE_EDD, FIRST_TARGET);
    // T00:00 local parse
    const expected = new Date(`${nextTargetDate}T00:00`).toISOString();
    expect(result.resurfacesAt).toBe(expected);
    // Confirm NOT the UTC-midnight parse (which differs at UTC+7 by a day)
    const utcParse = new Date(nextTargetDate).toISOString();
    // If the test machine is UTC+0 these coincide — skip that assertion
    // The key check: the implementation uses T00:00, not bare string
    expect(result.resurfacesAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('prefill.date equals the computed nextTargetDate when future', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    const nextTargetDate = weekToTargetDate(FUTURE_EDD, FIRST_TARGET);
    // nextTargetDate is in the future → no clamp needed
    expect(result.prefill.date).toBe(nextTargetDate);
  });

  it('prefill.dateLabel is dateLabelOn when ancPrefillDateEnabled=true', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.dateLabel).toEqual(ANC_CATALOG_COPY.dateLabelOn);
  });

  it('prefill.category is anc_visit', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.category).toBe('anc_visit');
  });

  it('prefill.attachReminder defaults OFF (false)', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.attachReminder).toBe(false);
  });

  it('prefill.fromSuggestion is true', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.fromSuggestion).toBe(true);
  });

  it('prefill.sourceSuggestionStateId is anc_next_checkup', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.sourceSuggestionStateId).toBe('anc_next_checkup');
  });

  it('prefill.title is ANC_APPOINTMENT_TITLE', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.title).toEqual(ANC_APPOINTMENT_TITLE);
  });

  it('prefill.headerDisclaimer is ANC_CATALOG_COPY.formDisclaimer', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.headerDisclaimer).toEqual(ANC_CATALOG_COPY.formDisclaimer);
  });

  it('prefill.time is 09:00', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    expect(result.prefill.time).toBe('09:00');
  });
});

// ─── Prefill-date OFF ─────────────────────────────────────────────────────────

describe('buildAncStartPayload — ANC_PREFILL_DATE OFF', () => {
  const gestationalWeek = FIRST_TARGET - OFFER_LEAD_WEEKS;
  const now = new Date('2026-07-01T10:00:00Z');

  it('prefill.date is absent (undefined) when ancPrefillDateEnabled=false', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: false,
    })!;
    expect(result.prefill.date).toBeUndefined();
  });

  it('prefill.dateLabel is dateLabelOff when ancPrefillDateEnabled=false', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: false,
    })!;
    expect(result.prefill.dateLabel).toEqual(ANC_CATALOG_COPY.dateLabelOff);
  });

  it('resurfacesAt is still computed (flag-independent)', () => {
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: false,
    })!;
    expect(result.resurfacesAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

// ─── Past-date clamping ───────────────────────────────────────────────────────

describe('buildAncStartPayload — past-date clamping (PAST_CLAMP_DAYS)', () => {
  it('prefill.date is clamped to now+PAST_CLAMP_DAYS when nextTargetDate is in the past', () => {
    // Set up: use a very old EDD so nextTargetDate is definitely in the past
    const ancientEdd = '2020-01-01';
    const gestationalWeek = FIRST_TARGET - OFFER_LEAD_WEEKS;
    const now = new Date('2026-07-01T10:00:00Z');
    const result = buildAncStartPayload({
      edd: ancientEdd,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    // Compute expected clamped date
    const clampedMs = now.getTime() + PAST_CLAMP_DAYS * 86_400_000;
    const c = new Date(clampedMs);
    const y = c.getUTCFullYear();
    const m = String(c.getUTCMonth() + 1).padStart(2, '0');
    const d = String(c.getUTCDate()).padStart(2, '0');
    const expectedClamp = `${y}-${m}-${d}`;
    expect(result.prefill.date).toBe(expectedClamp);
  });

  it('resurfacesAt uses UNCLAMPED nextTargetDate (not the clamped prefill date)', () => {
    const ancientEdd = '2020-01-01';
    const gestationalWeek = FIRST_TARGET - OFFER_LEAD_WEEKS;
    const now = new Date('2026-07-01T10:00:00Z');
    const result = buildAncStartPayload({
      edd: ancientEdd,
      gestationalWeek,
      now,
      ancPrefillDateEnabled: true,
    })!;
    const nextTargetDate = weekToTargetDate(ancientEdd, FIRST_TARGET);
    const expectedResurfaces = new Date(`${nextTargetDate}T00:00`).toISOString();
    expect(result.resurfacesAt).toBe(expectedResurfaces);
    // And it should differ from the clamped prefill date
    expect(result.prefill.date).not.toBe(nextTargetDate);
  });
});

// ─── Guard: null return when preconditions not met ────────────────────────────

describe('buildAncStartPayload — guard cases (return null)', () => {
  it('returns null when edd is null', () => {
    const result = buildAncStartPayload({
      edd: null,
      gestationalWeek: FIRST_TARGET - OFFER_LEAD_WEEKS,
      now: new Date('2026-07-01T10:00:00Z'),
      ancPrefillDateEnabled: true,
    });
    expect(result).toBeNull();
  });

  it('returns null when edd is undefined', () => {
    const result = buildAncStartPayload({
      edd: undefined,
      gestationalWeek: FIRST_TARGET - OFFER_LEAD_WEEKS,
      now: new Date('2026-07-01T10:00:00Z'),
      ancPrefillDateEnabled: true,
    });
    expect(result).toBeNull();
  });

  it('returns null when gestationalWeek >= max target (no nextTargetWeek)', () => {
    const maxW = Math.max(...ANC_TARGET_WEEKS);
    const result = buildAncStartPayload({
      edd: FUTURE_EDD,
      gestationalWeek: maxW,
      now: new Date('2026-07-01T10:00:00Z'),
      ancPrefillDateEnabled: true,
    });
    expect(result).toBeNull();
  });
});
