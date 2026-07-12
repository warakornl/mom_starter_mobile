/**
 * homeTabAdoptOnDrain.test.ts — TDD tests for the extracted onAdopt handler
 * (profileVerbQueue drain success path).
 *
 * RED-LINE regression (appsec + mobile-reviewer BLOCKER): a loss (lifecycle
 * 'ended') that drains successfully via the offline queue MUST produce a
 * ProfileSnapshot with lifecycle:'ended' — NEVER 'pregnant'. Before the fix,
 * calendarTabSnapshotBuilder.ts hard-coded lifecycle:'pregnant' in every
 * non-postpartum branch, so this exact path silently re-opened the loss gate
 * (the "แก้ไขข้อมูลตั้งครรภ์" edit button, kick-count card, suggestions, etc.
 * all reappeared for a mother who had just recorded a loss).
 */

import { applyAdoptedProfileToHomeTab } from './homeTabAdoptOnDrain';
import type { PregnancyProfile } from '../pregnancy/types';
import type { ProfileSnapshot } from '../pregnancy/PregnancyProfileContext';

function makeEndedProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-adopt-001',
    edd: '2026-02-10',
    eddBasis: 'due_date',
    lifecycle: 'ended',
    birthDate: null,
    version: 6,
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2026-01-10T00:00:00Z',
    gestationalWeek: null,
    gestationalDay: null,
    daysRemaining: null,
    progress: null,
    currentStage: 'T3',
    deliveryWindowActive: false,
    ...overrides,
  };
}

function makePregnantProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-adopt-002',
    edd: '2026-08-01',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    birthDate: null,
    version: 7,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-05T00:00:00Z',
    gestationalWeek: 10,
    gestationalDay: 2,
    daysRemaining: 100,
    progress: 0.3,
    currentStage: 'T1',
    deliveryWindowActive: false,
    ...overrides,
  };
}

function makePostpartumProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-adopt-003',
    edd: '2026-01-15',
    eddBasis: 'due_date',
    lifecycle: 'postpartum',
    birthDate: '2026-01-20',
    version: 8,
    createdAt: '2025-05-01T00:00:00Z',
    updatedAt: '2026-01-20T00:00:00Z',
    gestationalWeek: null,
    gestationalDay: null,
    daysRemaining: null,
    progress: null,
    currentStage: 'postpartum',
    deliveryWindowActive: false,
    ...overrides,
  };
}

describe('applyAdoptedProfileToHomeTab — RED-LINE loss-gate wiring', () => {
  it('an adopted ended profile produces a snapshot with lifecycle:"ended" — NEVER "pregnant"', () => {
    const profile = makeEndedProfile();
    const setState = jest.fn();
    const setSnapshot = jest.fn();

    applyAdoptedProfileToHomeTab({
      profile,
      generalHealthConsented: true,
      setState,
      setSnapshot,
      setLoadedEdd: jest.fn(),
      setLoadedBirthDate: jest.fn(),
    });

    expect(setSnapshot).toHaveBeenCalledTimes(1);
    const snapshotArg = setSnapshot.mock.calls[0][0] as ProfileSnapshot;
    expect(snapshotArg.lifecycle).toBe('ended');
    expect(snapshotArg.lifecycle).not.toBe('pregnant');

    // Local screen state: 'ended' profiles are represented via kind:'pregnant'
    // carrying the raw profile (isLoss derived at render time) — see module doc.
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pregnant', profile }),
    );
  });

  it('an adopted pregnant profile produces a snapshot with lifecycle:"pregnant"', () => {
    const profile = makePregnantProfile();
    const setState = jest.fn();
    const setSnapshot = jest.fn();

    applyAdoptedProfileToHomeTab({
      profile,
      generalHealthConsented: true,
      setState,
      setSnapshot,
      setLoadedEdd: jest.fn(),
      setLoadedBirthDate: jest.fn(),
    });

    const snapshotArg = setSnapshot.mock.calls[0][0] as ProfileSnapshot;
    expect(snapshotArg.lifecycle).toBe('pregnant');
  });

  it('an adopted postpartum profile produces a snapshot with lifecycle:"postpartum"', () => {
    const profile = makePostpartumProfile();
    const setState = jest.fn();
    const setSnapshot = jest.fn();
    const setLoadedBirthDate = jest.fn();
    const setLoadedEdd = jest.fn();

    applyAdoptedProfileToHomeTab({
      profile,
      generalHealthConsented: false,
      setState,
      setSnapshot,
      setLoadedEdd,
      setLoadedBirthDate,
    });

    const snapshotArg = setSnapshot.mock.calls[0][0] as ProfileSnapshot;
    expect(snapshotArg.lifecycle).toBe('postpartum');
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'postpartum', profile }),
    );
    expect(setLoadedBirthDate).toHaveBeenCalledWith('2026-01-20');
    expect(setLoadedEdd).toHaveBeenCalledWith(null);
  });
});
