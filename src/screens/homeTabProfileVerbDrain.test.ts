/**
 * homeTabProfileVerbDrain — unit tests (TDD, written BEFORE the implementation).
 *
 * Extracted pure drain-trigger logic HomeTabScreen's AppState 'active'
 * handler calls (same handler that already calls drainConsentQueue,
 * HomeTabScreen.tsx ~line 762) — OR-STRUCT-1: the profileVerbQueue drain
 * host is HomeTabScreen's existing AppState handler, no new scheduler.
 *
 * This suite runs the REAL profileVerbQueue + profileVerbSyncSingleton
 * modules (not a rig injecting a pre-resolved outcome) — it enqueues a
 * real entry, calls the real runHomeTabProfileVerbDrain(), and asserts the
 * real dispatch was invoked and the real queue mutated. Network I/O is
 * stubbed only at the fetch boundary (createPregnancyClient's fetchFn),
 * per the "mock boundaries only" testing discipline.
 */

import { runHomeTabProfileVerbDrain } from './homeTabProfileVerbDrain';
import { profileVerbQueue, resetProfileVerbQueue, resetProfileVerbSyncEngine } from '../pregnancy/profileVerbSyncSingleton';
import { applyAdoptedProfileToHomeTab } from './homeTabAdoptOnDrain';
import type { TokenStorage } from '../auth/tokenStorage';
import type { PregnancyProfile } from '../pregnancy/types';
import type { ProfileSnapshot } from '../pregnancy/PregnancyProfileContext';

function fakeTokenStorage(accessToken: string | null): TokenStorage {
  return {
    load: async () => (accessToken ? { accessToken, refreshToken: 'r' } : null),
    save: async () => {},
    clear: async () => {},
  } as TokenStorage;
}

beforeEach(async () => {
  await resetProfileVerbQueue();
  resetProfileVerbSyncEngine();
});

describe('runHomeTabProfileVerbDrain', () => {
  it('drains a real queued edit_profile entry via the real fetch boundary (200 -> removed)', async () => {
    profileVerbQueue.enqueue({
      verb: 'edit_profile',
      targetProfileId: 'profile-1',
      baseVersion: 5,
      body: { edd: '2026-08-01' },
      clientDate: '2026-01-05',
      intendedLifecycle: null,
    });
    await profileVerbQueue.persist();

    const fetchFn = jest.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'profile-1', version: 6, edd: '2026-08-01', eddBasis: 'due_date',
          lifecycle: 'pregnant', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          gestationalWeek: 10, gestationalDay: 2, daysRemaining: 100, progress: 0.3,
          currentStage: 'T1', deliveryWindowActive: false,
        }),
        { status: 200 },
      ),
    );

    let adoptedVersion: number | null = null;
    await runHomeTabProfileVerbDrain({
      tokenStorage: fakeTokenStorage('tok'),
      apiBaseUrl: 'https://api.test',
      liveProfileVersion: 5,
      fetchFn,
      onAdopt: (p: PregnancyProfile) => { adoptedVersion = p.version; },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(adoptedVersion).toBe(6);
    expect(profileVerbQueue.getEntries()).toHaveLength(0);
  });

  it('does nothing when there is no access token (session not live) — never throws', async () => {
    profileVerbQueue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-1', baseVersion: 5,
      body: {}, clientDate: '2026-01-05', intendedLifecycle: null,
    });
    const fetchFn = jest.fn();

    await expect(
      runHomeTabProfileVerbDrain({
        tokenStorage: fakeTokenStorage(null),
        apiBaseUrl: 'https://api.test',
        liveProfileVersion: 5,
        fetchFn,
        onAdopt: () => {},
      }),
    ).resolves.not.toThrow();

    expect(fetchFn).not.toHaveBeenCalled();
    // Entry stays queued — nothing lost.
    expect(profileVerbQueue.getEntries()).toHaveLength(1);
  });

  it('does nothing when the queue is empty (no-op fast path)', async () => {
    const fetchFn = jest.fn();
    await runHomeTabProfileVerbDrain({
      tokenStorage: fakeTokenStorage('tok'),
      apiBaseUrl: 'https://api.test',
      liveProfileVersion: 5,
      fetchFn,
      onAdopt: () => {},
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── RED-LINE (appsec + mobile-reviewer BLOCKER): a queued loss that drains
  // successfully must adopt lifecycle:'ended' into the shared ProfileSnapshot —
  // NEVER snap back to 'pregnant'. This test drives the REAL production path
  // end-to-end: a real profileVerbQueue entry -> real runHomeTabProfileVerbDrain
  // -> real drainProfileVerbQueue -> real dispatchProfileVerbEntry (loss_event ->
  // client.recordLossEvent) -> real onAdopt handler (applyAdoptedProfileToHomeTab,
  // the exact function HomeTabScreen.tsx wires in production). Only the fetch
  // boundary is stubbed. No snapshot is injected — it is BUILT by the real code.
  it('a queued loss_event that drains 200 with lifecycle:"ended" adopts a snapshot with lifecycle:"ended" (NEVER "pregnant")', async () => {
    profileVerbQueue.enqueue({
      verb: 'loss_event',
      targetProfileId: 'profile-loss-1',
      baseVersion: 5,
      body: { lossDate: '2026-01-10' },
      clientDate: '2026-01-10',
      intendedLifecycle: 'ended',
    });
    await profileVerbQueue.persist();

    const fetchFn = jest.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'profile-loss-1',
          version: 6,
          edd: '2026-02-10',
          eddBasis: 'due_date',
          lifecycle: 'ended',
          birthDate: null,
          createdAt: '2025-06-01T00:00:00Z',
          updatedAt: '2026-01-10T00:00:00Z',
          gestationalWeek: null,
          gestationalDay: null,
          daysRemaining: null,
          progress: null,
          currentStage: 'T3',
          deliveryWindowActive: false,
        }),
        { status: 200 },
      ),
    );

    let adoptedSnapshot: ProfileSnapshot | null = null;
    const setState = jest.fn();
    const setSnapshot = jest.fn((snap: ProfileSnapshot) => { adoptedSnapshot = snap; });

    await runHomeTabProfileVerbDrain({
      tokenStorage: fakeTokenStorage('tok'),
      apiBaseUrl: 'https://api.test',
      liveProfileVersion: 5,
      fetchFn,
      onAdopt: (profile: PregnancyProfile) => {
        // This IS the real production onAdopt wiring — see HomeTabScreen.tsx.
        applyAdoptedProfileToHomeTab({
          profile,
          generalHealthConsented: true,
          setState,
          setSnapshot,
          setLoadedEdd: () => {},
          setLoadedBirthDate: () => {},
        });
      },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(profileVerbQueue.getEntries()).toHaveLength(0);
    expect(setSnapshot).toHaveBeenCalledTimes(1);
    expect(adoptedSnapshot).not.toBeNull();
    expect(adoptedSnapshot!.lifecycle).toBe('ended');
    expect(adoptedSnapshot!.lifecycle).not.toBe('pregnant');
  });
});
