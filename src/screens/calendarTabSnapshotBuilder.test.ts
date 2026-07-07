/**
 * calendarTabSnapshotBuilder.test.ts — TDD tests for the profileSnapshot
 * builder extracted from CalendarTabScreen's GET /v1/pregnancy-profile handler.
 *
 * Design-reviewer's #1 build risk (F2):
 *   CalendarTabScreen calls setSnapshot() after a successful GET so that
 *   non-tab screens (KickCount*, Settings, DoctorPdf, Suggestions) keep their
 *   props via useProfileSnapshot(). The critical question is: does the snapshot
 *   contain the correct values (non-stale, non-undefined) for each lifecycle?
 *
 * These tests verify that the extracted buildCalendarTabSnapshot function
 * produces the exact values that CalendarTabScreen writes into
 * PregnancyProfileContext after a successful GET.
 *
 * Coverage:
 *   1. Pregnant path — gestationalWeek, edd, todayCivil, lifecycle, consent
 *   2. Postpartum path — gestationalWeek=0, edd preserved, lifecycle=postpartum
 *   3. Wk≥32 pregnant — kick-count card sentinel (gestationalWeek correct)
 *   4. generalHealthConsented flag is threaded through correctly
 *   5. todayCivil comes from the caller (not hardcoded)
 */

import { buildCalendarTabSnapshot } from './calendarTabSnapshotBuilder';
import type { PregnancyProfile } from '../pregnancy/types';
import type { GestationalAge } from '../pregnancy/gestationalAge';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

function makePregnantProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-001',
    edd: '2026-02-10',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    birthDate: null,
    version: 1,
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
    // GestationalAgeSnapshot fields (advisory — client re-derives locally)
    gestationalWeek: 34,
    gestationalDay: 0,
    daysRemaining: 42,
    progress: 0.85,
    currentStage: 'T3',
    deliveryWindowActive: false,
    ...overrides,
  };
}

function makePostpartumProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-002',
    edd: '2026-01-15',
    eddBasis: 'due_date',
    lifecycle: 'postpartum',
    birthDate: '2026-01-20',
    version: 2,
    createdAt: '2025-05-01T00:00:00Z',
    updatedAt: '2026-01-20T00:00:00Z',
    // GestationalAgeSnapshot fields (null when postpartum per api-contract)
    gestationalWeek: null,
    gestationalDay: null,
    daysRemaining: null,
    progress: null,
    currentStage: 'postpartum',
    deliveryWindowActive: false,
    ...overrides,
  };
}

function makeGestationalAge(week: number): GestationalAge {
  const daysPregnant = week * 7;
  return {
    daysPregnant,
    gestationalWeek: week,
    gestationalDay: 0,
    currentStage: week >= 28 ? 'T3' : week >= 14 ? 'T2' : 'T1',
    progress: week / 40,
    daysRemaining: (40 - week) * 7,
    deliveryWindowActive: week >= 37,
    displayedWeek: Math.max(0, week),
    suppressDayDisplay: week < 0,
  };
}

// ─── Pregnant path ─────────────────────────────────────────────────────────────

describe('buildCalendarTabSnapshot — pregnant path', () => {
  it('sets lifecycle to pregnant', () => {
    const profile = makePregnantProfile();
    const ga = makeGestationalAge(20);
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: '2025-09-01',
    });
    expect(result.lifecycle).toBe('pregnant');
  });

  it('sets gestationalWeek from GestationalAge (not advisory profile.gestationalWeek)', () => {
    // profile.gestationalWeek is advisory server-snapshot (may be stale);
    // ga.gestationalWeek is freshly client-derived from EDD + civil today.
    const profile = makePregnantProfile({ gestationalWeek: 99 }); // stale server advisory
    const ga = makeGestationalAge(34); // fresh client computation
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: false,
      todayCivil: '2025-09-01',
    });
    // Must use ga.gestationalWeek (client-derived) — not the stale advisory value
    expect(result.gestationalWeek).toBe(34);
  });

  it('sets edd from profile.edd', () => {
    const profile = makePregnantProfile({ edd: '2026-02-10' });
    const ga = makeGestationalAge(34);
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: '2025-09-01',
    });
    expect(result.edd).toBe('2026-02-10');
  });

  it('passes todayCivil from caller (not hardcoded)', () => {
    const profile = makePregnantProfile();
    const ga = makeGestationalAge(20);
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: '2025-11-15',
    });
    expect(result.todayCivil).toBe('2025-11-15');
  });

  it('threads generalHealthConsented through — false', () => {
    const profile = makePregnantProfile();
    const ga = makeGestationalAge(20);
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: false,
      todayCivil: '2025-09-01',
    });
    expect(result.generalHealthConsented).toBe(false);
  });

  it('threads generalHealthConsented through — true', () => {
    const profile = makePregnantProfile();
    const ga = makeGestationalAge(34);
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: '2025-09-01',
    });
    expect(result.generalHealthConsented).toBe(true);
  });

  it('wk≥32 snapshot gestationalWeek triggers kick-count card gate (≥32)', () => {
    const profile = makePregnantProfile();
    const ga = makeGestationalAge(32);
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: '2025-09-01',
    });
    expect(result.gestationalWeek).toBeGreaterThanOrEqual(32);
  });

  it('exact snapshot shape for pregnant wk34 — all fields non-undefined', () => {
    const profile = makePregnantProfile({ edd: '2026-02-10' });
    const ga = makeGestationalAge(34);
    const snapshot = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: '2026-07-06',
    });
    expect(snapshot).toEqual({
      gestationalWeek: 34,
      edd: '2026-02-10',
      todayCivil: '2026-07-06',
      lifecycle: 'pregnant',
      generalHealthConsented: true,
      birthDate: null,
    });
  });

  it('pregnant snapshot has birthDate null (no birth event yet)', () => {
    const profile = makePregnantProfile({ birthDate: null });
    const ga = makeGestationalAge(20);
    const result = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: '2026-07-06',
    });
    expect(result.birthDate).toBeNull();
  });
});

// ─── Postpartum path ───────────────────────────────────────────────────────────

describe('buildCalendarTabSnapshot — postpartum path', () => {
  it('sets lifecycle to postpartum', () => {
    const profile = makePostpartumProfile();
    const result = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: false,
      todayCivil: '2026-03-01',
    });
    expect(result.lifecycle).toBe('postpartum');
  });

  it('sets gestationalWeek to 0 (baby is born — weeks no longer applicable)', () => {
    const profile = makePostpartumProfile();
    const result = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: true,
      todayCivil: '2026-03-01',
    });
    expect(result.gestationalWeek).toBe(0);
  });

  it('preserves edd from profile even in postpartum (DoctorPdf may need it)', () => {
    const profile = makePostpartumProfile({ edd: '2026-01-15' });
    const result = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: false,
      todayCivil: '2026-03-01',
    });
    expect(result.edd).toBe('2026-01-15');
  });

  it('exact snapshot shape for postpartum — all fields non-undefined', () => {
    const profile = makePostpartumProfile({ edd: '2026-01-15' });
    const snapshot = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: true,
      todayCivil: '2026-03-01',
    });
    expect(snapshot).toEqual({
      gestationalWeek: 0,
      edd: '2026-01-15',
      todayCivil: '2026-03-01',
      lifecycle: 'postpartum',
      generalHealthConsented: true,
      birthDate: '2026-01-20',
    });
  });

  it('postpartum snapshot includes birthDate from profile', () => {
    const profile = makePostpartumProfile({ birthDate: '2026-02-05' });
    const result = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: true,
      todayCivil: '2026-03-15',
    });
    expect(result.birthDate).toBe('2026-02-05');
  });

  it('postpartum snapshot with absent birthDate has birthDate null (defensive)', () => {
    // birthDate missing on profile — builder must not propagate undefined
    const profile = makePostpartumProfile({ birthDate: null });
    const result = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: true,
      todayCivil: '2026-03-01',
    });
    expect(result.birthDate).toBeNull();
  });

  it('no snapshot field is undefined — postpartum (birthDate is string, not null)', () => {
    // makePostpartumProfile has birthDate: '2026-01-20' (non-null)
    const profile = makePostpartumProfile();
    const snapshot = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: true,
      todayCivil: '2026-03-01',
    });
    for (const [_key, value] of Object.entries(snapshot)) {
      expect(value).not.toBeUndefined();
    }
    // birthDate is explicitly provided for postpartum, so it is a string not null
    expect(snapshot.birthDate).toBe('2026-01-20');
  });
});
