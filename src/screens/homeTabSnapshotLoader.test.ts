/**
 * homeTabSnapshotLoader.test.ts
 *
 * TDD tests for the loadProfileIntoSnapshot orchestration function.
 *
 * FIX 1 (mobile-reviewer CHANGES-REQUESTED): replace the snapshot-path tests
 * that only asserted `typeof HomeTabScreen === 'function'` (no behavioral
 * coverage) with real behavioral assertions that fail if the snapshot write
 * becomes lazy, conditional, or is removed.
 *
 * These tests use no React Native or react-navigation APIs — the function is
 * pure async and fully injectable, runnable in the ts-jest Node environment.
 *
 * Assertions per test:
 *   1. null token        → onLogout called; setSnapshot NOT called; getProfile NOT called
 *   2. 200 pregnant      → setSnapshot called ONCE with the built snapshot;
 *                          onLogout and onNeedsProfile NOT called
 *   3. 200 postpartum    → setSnapshot called ONCE with postpartum snapshot;
 *                          onLogout and onNeedsProfile NOT called
 *   4. 404 not found     → onNeedsProfile called; setSnapshot NOT called
 *   5. 401 unauthorized  → onLogout called; setSnapshot NOT called
 *
 * Failure contracts (review sentinel):
 *   - If setSnapshot is made lazy (e.g. debounced, or moved to a timeout),
 *     test 2 will fail because the spy will not be called at assertion time.
 *   - If setSnapshot is removed, test 2 fails on "called once" assertion.
 *   - If the conditional (`if result.ok`) is inverted, test 4/5 will catch the
 *     snapshot being called on error.
 */

import { loadProfileIntoSnapshot } from './homeTabSnapshotLoader';
import { buildCalendarTabSnapshot } from './calendarTabSnapshotBuilder';
import { computeGestationalAge } from '../pregnancy/gestationalAge';
import { computePostpartumAge } from '../pregnancy/postpartumAge';
import type { PregnancyProfile } from '../pregnancy/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = '2026-07-06';

function makePregnantProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-snap-001',
    edd: '2026-12-01',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    birthDate: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    gestationalWeek: 28,
    gestationalDay: 0,
    daysRemaining: 148,
    progress: 0.7,
    currentStage: 'T3',
    deliveryWindowActive: false,
    ...overrides,
  };
}

function makeEndedProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-snap-003',
    edd: '2026-02-10',
    eddBasis: 'due_date',
    lifecycle: 'ended',
    birthDate: null,
    version: 4,
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

function makePostpartumProfile(): PregnancyProfile {
  return {
    id: 'p-snap-002',
    edd: '2026-03-01',
    eddBasis: 'due_date',
    lifecycle: 'postpartum',
    birthDate: '2026-03-03',
    version: 2,
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2026-03-03T08:00:00Z',
    gestationalWeek: null,
    gestationalDay: null,
    daysRemaining: null,
    progress: null,
    currentStage: 'T3',
    deliveryWindowActive: false,
    postpartumDays: 125,
    postpartumWeek: 17,
    postpartumDay: 6,
  };
}

// ─── loadProfileIntoSnapshot — behavioral wiring ──────────────────────────────

describe('loadProfileIntoSnapshot — snapshot-write wiring', () => {
  it('null token → onLogout called; setSnapshot never called; getProfile never called', async () => {
    const setSnapshot = jest.fn();
    const onLogout = jest.fn();
    const onNeedsProfile = jest.fn();
    const getProfile = jest.fn();

    await loadProfileIntoSnapshot({
      accessToken: null,
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: true,
      setSnapshot,
      onLogout,
      onNeedsProfile,
    });

    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(setSnapshot).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('200 pregnant → setSnapshot called exactly once with correctly-built snapshot', async () => {
    const profile = makePregnantProfile();
    const setSnapshot = jest.fn();
    const onLogout = jest.fn();
    const onNeedsProfile = jest.fn();
    const getProfile = jest.fn().mockResolvedValue({ ok: true, profile });

    await loadProfileIntoSnapshot({
      accessToken: 'tok-test-1',
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: true,
      setSnapshot,
      onLogout,
      onNeedsProfile,
    });

    expect(setSnapshot).toHaveBeenCalledTimes(1);

    // Recompute expected snapshot exactly as the function does (no copying)
    const ga = computeGestationalAge(profile.edd, TODAY);
    const expectedSnapshot = buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented: true,
      todayCivil: TODAY,
    });
    expect(setSnapshot).toHaveBeenCalledWith(expectedSnapshot);

    expect(onLogout).not.toHaveBeenCalled();
    expect(onNeedsProfile).not.toHaveBeenCalled();
  });

  it('200 postpartum → setSnapshot called once with ga=null postpartum snapshot', async () => {
    const profile = makePostpartumProfile();
    const setSnapshot = jest.fn();
    const onLogout = jest.fn();
    const onNeedsProfile = jest.fn();
    const onPostpartum = jest.fn();
    const getProfile = jest.fn().mockResolvedValue({ ok: true, profile });

    await loadProfileIntoSnapshot({
      accessToken: 'tok-test-2',
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: false,
      setSnapshot,
      onLogout,
      onNeedsProfile,
      onPostpartum,
    });

    expect(setSnapshot).toHaveBeenCalledTimes(1);

    const expectedSnapshot = buildCalendarTabSnapshot({
      profile,
      ga: null,
      generalHealthConsented: false,
      todayCivil: TODAY,
    });
    expect(setSnapshot).toHaveBeenCalledWith(expectedSnapshot);

    // Postpartum snapshot must have gestationalWeek=0 (not from profile)
    const snapshotArg = setSnapshot.mock.calls[0][0] as { gestationalWeek: number; lifecycle: string };
    expect(snapshotArg.gestationalWeek).toBe(0);
    expect(snapshotArg.lifecycle).toBe('postpartum');

    // onPostpartum callback fired with computed pp
    expect(onPostpartum).toHaveBeenCalledTimes(1);
    const [_profileArg, ppArg] = onPostpartum.mock.calls[0] as [unknown, { postpartumDays: number }];
    const pp = computePostpartumAge(profile.birthDate!, TODAY);
    expect(ppArg.postpartumDays).toBe(pp.postpartumDays);

    expect(onLogout).not.toHaveBeenCalled();
    expect(onNeedsProfile).not.toHaveBeenCalled();
  });

  it('200 ended (loss) → setSnapshot called once with lifecycle:"ended", NEVER "pregnant" (RED-LINE)', async () => {
    // RED-LINE regression (appsec + mobile-reviewer BLOCKER): the normal
    // online GET path fed an 'ended' profile into the same `else` branch as
    // 'pregnant' (line ~121), which called buildCalendarTabSnapshot without
    // ever distinguishing 'ended' — the builder then hard-coded
    // lifecycle:'pregnant'. That means even a plain online refresh (no queue
    // involved at all) could snap a mother who just recorded a loss straight
    // back into the pregnant loss-gate-open state. This test fails if that
    // regresses.
    const profile = makeEndedProfile();
    const setSnapshot = jest.fn();
    const onLogout = jest.fn();
    const onNeedsProfile = jest.fn();
    const getProfile = jest.fn().mockResolvedValue({ ok: true, profile });

    await loadProfileIntoSnapshot({
      accessToken: 'tok-test-ended',
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: true,
      setSnapshot,
      onLogout,
      onNeedsProfile,
    });

    expect(setSnapshot).toHaveBeenCalledTimes(1);
    const snapshotArg = setSnapshot.mock.calls[0][0] as { lifecycle: string };
    expect(snapshotArg.lifecycle).toBe('ended');
    expect(snapshotArg.lifecycle).not.toBe('pregnant');

    expect(onLogout).not.toHaveBeenCalled();
    expect(onNeedsProfile).not.toHaveBeenCalled();
  });

  it('404 not-found → onNeedsProfile called; setSnapshot never called', async () => {
    const setSnapshot = jest.fn();
    const onLogout = jest.fn();
    const onNeedsProfile = jest.fn();
    const getProfile = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'No profile yet',
    });

    await loadProfileIntoSnapshot({
      accessToken: 'tok-test-3',
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: true,
      setSnapshot,
      onLogout,
      onNeedsProfile,
    });

    expect(onNeedsProfile).toHaveBeenCalledTimes(1);
    expect(setSnapshot).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('401 unauthorized → onLogout called; setSnapshot never called', async () => {
    const setSnapshot = jest.fn();
    const onLogout = jest.fn();
    const onNeedsProfile = jest.fn();
    const getProfile = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    });

    await loadProfileIntoSnapshot({
      accessToken: 'tok-expired',
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: true,
      setSnapshot,
      onLogout,
      onNeedsProfile,
    });

    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(setSnapshot).not.toHaveBeenCalled();
    expect(onNeedsProfile).not.toHaveBeenCalled();
  });

  it('server error (500) → onError called; setSnapshot never called', async () => {
    const setSnapshot = jest.fn();
    const onLogout = jest.fn();
    const onNeedsProfile = jest.fn();
    const onError = jest.fn();
    const getProfile = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      code: 'server_error',
      message: 'Internal server error',
    });

    await loadProfileIntoSnapshot({
      accessToken: 'tok-test-4',
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: true,
      setSnapshot,
      onLogout,
      onNeedsProfile,
      onError,
    });

    expect(onError).toHaveBeenCalledWith('Internal server error');
    expect(setSnapshot).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
    expect(onNeedsProfile).not.toHaveBeenCalled();
  });

  it('setSnapshot receives correct generalHealthConsented=false when consent not granted', async () => {
    const profile = makePregnantProfile();
    const setSnapshot = jest.fn();
    const getProfile = jest.fn().mockResolvedValue({ ok: true, profile });

    await loadProfileIntoSnapshot({
      accessToken: 'tok-test-5',
      getProfile,
      todayCivil: TODAY,
      generalHealthConsented: false, // ← explicitly NOT granted
      setSnapshot,
      onLogout: jest.fn(),
      onNeedsProfile: jest.fn(),
    });

    expect(setSnapshot).toHaveBeenCalledTimes(1);
    const snapshotArg = setSnapshot.mock.calls[0][0] as { generalHealthConsented: boolean };
    expect(snapshotArg.generalHealthConsented).toBe(false);
  });
});
