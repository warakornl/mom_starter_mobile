/**
 * lossOfflineApplyWiring — unit tests (TDD, written BEFORE the implementation).
 *
 * Extracted from RootNavigator's LossConfirm onOfflineApply render-prop so the
 * REAL wiring (buildLossOptimisticApply -> setSnapshot + profileVerbQueue.enqueue
 * + persist, atomically) is testable against the REAL profileVerbQueue
 * singleton — not a rig that pre-establishes queue state.
 *
 * RootNavigator.tsx's LossConfirm screen calls this function directly (see
 * the onOfflineApply prop) — this is the real production caller, not a
 * duplicate/parallel implementation of the same logic (never re-implement
 * the logic under test — call the real module).
 */

import { runLossOfflineApply } from './lossOfflineApplyWiring';
import { profileVerbQueue, resetProfileVerbQueue } from './profileVerbSyncSingleton';
import type { ProfileSnapshot } from './PregnancyProfileContext';

beforeEach(async () => {
  await resetProfileVerbQueue();
});

function makeSnapshot(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    gestationalWeek: 10, edd: '2026-06-01', todayCivil: '2026-01-05',
    lifecycle: 'pregnant', generalHealthConsented: true,
    ...overrides,
  };
}

describe('runLossOfflineApply — RED-LINE: raw flip + atomic enqueue against the REAL queue', () => {
  it('flips the snapshot to lifecycle:"ended" (setSnapshot called with the EXACT literal) and enqueues a REAL loss_event entry', () => {
    let setSnapshotCalledWith: ProfileSnapshot | null = null;
    let navigated = false;

    runLossOfflineApply({
      prevSnapshot: makeSnapshot(),
      baseVersion: 5,
      lossDate: '2026-01-01',
      setSnapshot: (s: ProfileSnapshot) => { setSnapshotCalledWith = s; },
      onNavigateSettled: () => { navigated = true; },
    });

    expect(setSnapshotCalledWith).not.toBeNull();
    expect(setSnapshotCalledWith!.lifecycle).toBe('ended');
    expect(navigated).toBe(true);

    const entries = profileVerbQueue.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].verb).toBe('loss_event');
    expect(entries[0].intendedLifecycle).toBe('ended');
    expect(entries[0].body).toEqual({ lossDate: '2026-01-01' });
  });

  it('FAILS CLOSED on known-withdrawn consent: no setSnapshot call, no enqueue, no navigation', () => {
    let setSnapshotCalled = false;
    let navigated = false;

    runLossOfflineApply({
      prevSnapshot: makeSnapshot({ generalHealthConsented: false }),
      baseVersion: 5,
      lossDate: '2026-01-01',
      setSnapshot: () => { setSnapshotCalled = true; },
      onNavigateSettled: () => { navigated = true; },
    });

    expect(setSnapshotCalled).toBe(false);
    expect(navigated).toBe(false);
    expect(profileVerbQueue.getEntries()).toHaveLength(0);
  });

  it('suppresses on a null snapshot (GAP-2 §17.8): no flip, no enqueue, no navigation', () => {
    let setSnapshotCalled = false;
    let navigated = false;

    runLossOfflineApply({
      prevSnapshot: null,
      baseVersion: 5,
      lossDate: '',
      setSnapshot: () => { setSnapshotCalled = true; },
      onNavigateSettled: () => { navigated = true; },
    });

    expect(setSnapshotCalled).toBe(false);
    expect(navigated).toBe(false);
    expect(profileVerbQueue.getEntries()).toHaveLength(0);
  });
});
