/**
 * kickCountLogic tests — TDD (failing first).
 *
 * Covers:
 *  - tap(): +1 per tap
 *  - undo(): -1 (floor 0)
 *  - finalize(): creates completed session with correct fields
 *  - cancel(): no session row, no enqueue
 *  - gestationalWeekAtStart: golden-vector conformance (D4/DRIFT-1)
 *  - computeDurationSeconds: monotonic delta
 *  - consent gate: no draft created without general_health
 *  - INV-K2 (no valence): getSessionRenderData count=3 vs count=10 identical except number
 *  - INV-K3: no conditional UI by count (always-on end session)
 *  - SC-K6a: module visibility gate (gestationalWeek < 32 → not visible)
 *  - Terminal-status guard: only completed in queue
 */

import {
  tap,
  undo,
  computeGestationalWeekAtStart,
  computeDurationSeconds,
  finalizeSession,
  cancelSession,
  shouldShowModule,
  isStartAllowedByWeek,
  getProgressDisplay,
  getSessionRenderData,
  createTapHandler,
  createUndoHandler,
  isConsentGateOpen,
  newDraftId,
} from './kickCountLogic';
import { computeGestationalAge, civilDaysBetween, parseCivilDateMs } from '../pregnancy/gestationalAge';
import type { KickCountDraft } from './kickCountTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDraft(overrides: Partial<KickCountDraft> = {}): KickCountDraft {
  return {
    localDraftId: 'draft-0001',
    startedAt: '2026-06-30T09:15',
    movementCount: 0,
    targetCount: 10,
    gestationalWeekAtStart: 34,
    sessionStartMonotonicMs: 0,
    note: null,
    ...overrides,
  };
}

// ─── tap() ───────────────────────────────────────────────────────────────────

describe('tap()', () => {
  it('increments movementCount by 1', () => {
    const draft = makeDraft({ movementCount: 3 });
    const updated = tap(draft);
    expect(updated.movementCount).toBe(4);
  });

  it('returns a new object (immutable update)', () => {
    const draft = makeDraft({ movementCount: 7 });
    const updated = tap(draft);
    expect(updated).not.toBe(draft);
  });

  it('increments beyond target (no cap at 10 — K-5b)', () => {
    const draft = makeDraft({ movementCount: 10 });
    const updated = tap(draft);
    expect(updated.movementCount).toBe(11);
  });
});

// ─── undo() ──────────────────────────────────────────────────────────────────

describe('undo()', () => {
  it('decrements movementCount by 1 when count >= 1', () => {
    const draft = makeDraft({ movementCount: 5 });
    const updated = undo(draft);
    expect(updated.movementCount).toBe(4);
  });

  it('returns count=0 unchanged (floor at 0)', () => {
    const draft = makeDraft({ movementCount: 0 });
    const updated = undo(draft);
    expect(updated.movementCount).toBe(0);
  });

  it('returns a new object (immutable update)', () => {
    const draft = makeDraft({ movementCount: 3 });
    const updated = undo(draft);
    expect(updated).not.toBe(draft);
  });
});

// ─── computeGestationalWeekAtStart() — golden-vector conformance ─────────────

describe('computeGestationalWeekAtStart() — golden vectors (data-model §3.1)', () => {
  // Golden test vectors from data-model §3.1:
  // daysPregnant = 280 - daysUntilEdd
  // gestationalWeek = Math.floor(daysPregnant / 7)
  // EDD = today + daysUntilEdd  →  today = EDD - daysUntilEdd

  const vectors: Array<{ today: string; edd: string; expectedWeek: number; label: string }> = [
    // wk 0: daysPregnant=0, edd=today+280
    { today: '2026-01-01', edd: '2026-10-08', expectedWeek: 0, label: 'wk 0 (LMP day)' },
    // wk 1: daysPregnant=7
    { today: '2026-01-08', edd: '2026-10-08', expectedWeek: 1, label: 'wk 1' },
    // wk 13 boundary (T1 top): daysPregnant=91
    { today: '2026-04-03', edd: '2026-10-08', expectedWeek: 13, label: 'wk 13 (T1 top)' },
    // wk 14 (T2 start): daysPregnant=98
    { today: '2026-04-10', edd: '2026-10-08', expectedWeek: 14, label: 'wk 14 (T2 start)' },
    // wk 27 (T2 top): daysPregnant=189
    { today: '2026-07-10', edd: '2026-10-08', expectedWeek: 27, label: 'wk 27 (T2 top)' },
    // wk 28 (T3 start): daysPregnant=196
    { today: '2026-07-17', edd: '2026-10-08', expectedWeek: 28, label: 'wk 28 (T3 start)' },
    // wk 32 (kick-count gate): daysPregnant=224
    { today: '2026-08-14', edd: '2026-10-08', expectedWeek: 32, label: 'wk 32 (kick gate)' },
    // wk 34 (example from spec): daysPregnant=238
    { today: '2026-08-28', edd: '2026-10-08', expectedWeek: 34, label: 'wk 34' },
    // wk 37 (delivery window): daysPregnant=259
    { today: '2026-09-18', edd: '2026-10-08', expectedWeek: 37, label: 'wk 37' },
    // wk 40 (EDD): daysPregnant=280
    { today: '2026-10-08', edd: '2026-10-08', expectedWeek: 40, label: 'wk 40 (EDD)' },
    // wk 41 (past EDD): daysPregnant=287
    { today: '2026-10-15', edd: '2026-10-08', expectedWeek: 41, label: 'wk 41 (past EDD)' },
    // Negative band: daysPregnant=-1 → floor(-1/7)=-1
    { today: '2025-12-31', edd: '2026-10-08', expectedWeek: -1, label: 'negative band wk -1' },
    // Negative band: daysPregnant=-7 → floor(-7/7)=-1
    { today: '2025-12-25', edd: '2026-10-08', expectedWeek: -1, label: 'negative band wk -1 boundary' },
    // Negative band: daysPregnant=-28 → floor(-28/7)=-4
    { today: '2025-12-04', edd: '2026-10-08', expectedWeek: -4, label: 'negative band wk -4' },
  ];

  for (const { today, edd, expectedWeek, label } of vectors) {
    it(`${label}: today=${today}, edd=${edd} → week=${expectedWeek}`, () => {
      const week = computeGestationalWeekAtStart(edd, today);
      expect(week).toBe(expectedWeek);
    });
  }

  it('invariant: week*7 + day === daysPregnant for all test vectors', () => {
    for (const { today, edd } of vectors) {
      const week = computeGestationalWeekAtStart(edd, today);
      const daysUntilEdd =
        (new Date(edd).getTime() - new Date(today).getTime()) / 86_400_000;
      const daysPregnant = 280 - daysUntilEdd;
      const day = ((daysPregnant % 7) + 7) % 7;
      expect(week * 7 + day).toBeCloseTo(daysPregnant, 5);
    }
  });
});

// ─── computeDurationSeconds() ────────────────────────────────────────────────

describe('computeDurationSeconds()', () => {
  it('returns integer seconds from monotonic delta', () => {
    const startMs = 10_000; // 10 seconds in
    const endMs = 730_000; // 12 min 10 sec in
    const duration = computeDurationSeconds(startMs, endMs);
    expect(duration).toBe(720);
  });

  it('rounds down to whole seconds', () => {
    const duration = computeDurationSeconds(0, 1500); // 1.5 seconds
    expect(duration).toBe(1);
  });

  it('returns 0 for zero elapsed', () => {
    expect(computeDurationSeconds(1000, 1000)).toBe(0);
  });
});

// ─── finalizeSession() ───────────────────────────────────────────────────────

describe('finalizeSession()', () => {
  it('produces a completed session with status=completed', () => {
    const draft = makeDraft({ movementCount: 7 });
    const session = finalizeSession(draft, 8000, '2026-06-30T09:28');
    expect(session.status).toBe('completed');
  });

  it('id = localDraftId (carry through)', () => {
    const draft = makeDraft({ localDraftId: 'my-uuid-123' });
    const session = finalizeSession(draft, 0, '2026-06-30T09:28');
    expect(session.id).toBe('my-uuid-123');
  });

  it('movementCount = draft.movementCount (verbatim)', () => {
    const draft = makeDraft({ movementCount: 3 });
    const session = finalizeSession(draft, 0, '2026-06-30T09:28');
    expect(session.movementCount).toBe(3);
  });

  it('count=0 finalize is valid (completed)', () => {
    const draft = makeDraft({ movementCount: 0 });
    const session = finalizeSession(draft, 0, '2026-06-30T09:28');
    expect(session.status).toBe('completed');
    expect(session.movementCount).toBe(0);
  });

  it('durationSeconds computed from monotonic delta (B.3)', () => {
    const draft = makeDraft({ sessionStartMonotonicMs: 1000 });
    const endMs = 121_000; // 2 min elapsed
    const session = finalizeSession(draft, endMs, '2026-06-30T09:28');
    expect(session.durationSeconds).toBe(120);
  });

  it('endedAt = provided civil datetime', () => {
    const draft = makeDraft();
    const session = finalizeSession(draft, 0, '2026-06-30T09:28');
    expect(session.endedAt).toBe('2026-06-30T09:28');
  });

  it('version = 0 (create sentinel)', () => {
    const draft = makeDraft();
    const session = finalizeSession(draft, 0, '2026-06-30T09:28');
    expect(session.version).toBe(0);
  });

  it('targetCount = 10', () => {
    const draft = makeDraft({ targetCount: 10 });
    const session = finalizeSession(draft, 0, '2026-06-30T09:28');
    expect(session.targetCount).toBe(10);
  });

  it('finishing at count=10 vs count=3 produces completed session — no status difference (INV-K2)', () => {
    const s3 = finalizeSession(makeDraft({ movementCount: 3 }), 0, '2026-06-30T09:28');
    const s10 = finalizeSession(makeDraft({ movementCount: 10 }), 0, '2026-06-30T09:28');
    // Only movementCount differs — no extra fields, no verdict
    expect(s3.status).toBe(s10.status);
    expect(s3.targetCount).toBe(s10.targetCount);
    // The only difference is movementCount
    expect(s10.movementCount).toBe(10);
    expect(s3.movementCount).toBe(3);
  });
});

// ─── cancelSession() ─────────────────────────────────────────────────────────

describe('cancelSession()', () => {
  it('returns null (no row produced, no sync entry)', () => {
    const draft = makeDraft({ movementCount: 5 });
    const result = cancelSession(draft);
    expect(result).toBeNull();
  });
});

// ─── shouldShowModule() / isStartAllowedByWeek() — SC-K6a/D6 ─────────────────

describe('shouldShowModule()', () => {
  it('returns false when gestationalWeek < 32 (SC-K6a)', () => {
    expect(shouldShowModule(31, 'pregnant')).toBe(false);
  });

  it('returns false when gestationalWeek = 0 (pre-wk32)', () => {
    expect(shouldShowModule(0, 'pregnant')).toBe(false);
  });

  it('returns true when gestationalWeek = 32 (gate edge)', () => {
    expect(shouldShowModule(32, 'pregnant')).toBe(true);
  });

  it('returns true when gestationalWeek > 32 (e.g. 34)', () => {
    expect(shouldShowModule(34, 'pregnant')).toBe(true);
  });

  it('returns true for postpartum (read-only history visible)', () => {
    expect(shouldShowModule(40, 'postpartum')).toBe(true);
  });
});

describe('isStartAllowedByWeek()', () => {
  it('returns false before wk32', () => {
    expect(isStartAllowedByWeek(31, 'pregnant')).toBe(false);
  });

  it('returns true at wk32', () => {
    expect(isStartAllowedByWeek(32, 'pregnant')).toBe(true);
  });

  it('returns false for postpartum (read-only, no new sessions)', () => {
    expect(isStartAllowedByWeek(40, 'postpartum')).toBe(false);
  });
});

// ─── getProgressDisplay() — K-5b no-valence ──────────────────────────────────

describe('getProgressDisplay() — K-5b no-valence', () => {
  it('returns count and targetCount for count=3', () => {
    const result = getProgressDisplay(3, 10);
    expect(result.count).toBe(3);
    expect(result.targetCount).toBe(10);
  });

  it('returns count and targetCount for count=10 (no extra field)', () => {
    const result = getProgressDisplay(10, 10);
    expect(result.count).toBe(10);
    expect(result.targetCount).toBe(10);
  });

  it('count=3 and count=10 produce same shape (only number differs — INV-K2)', () => {
    const r3 = getProgressDisplay(3, 10);
    const r10 = getProgressDisplay(10, 10);
    const keys3 = Object.keys(r3).sort();
    const keys10 = Object.keys(r10).sort();
    // Same keys — no extra "finished" or "verdict" field appears at count=10
    expect(keys3).toEqual(keys10);
  });

  it('returns count=0 with targetCount=10 (count=0 still valid, B1)', () => {
    const result = getProgressDisplay(0, 10);
    expect(result.count).toBe(0);
    expect(result.targetCount).toBe(10);
  });
});

// ─── Y-4: algo parity — kickCountLogic vs gestationalAge (DRIFT-1) ───────────

describe('Y-4: computeGestationalWeekAtStart parity with computeGestationalAge (DRIFT-1)', () => {
  // Both functions MUST give the same gestationalWeek for any (edd, today) pair.
  // kickCountLogic must import civilDaysBetween/parseCivilDateMs from gestationalAge.ts
  // (not copy-paste them) to prevent algorithm drift (D4/DRIFT-1).

  const parityVectors = [
    { today: '2026-06-30', edd: '2026-10-08' },
    { today: '2026-08-14', edd: '2026-10-08' }, // wk 32
    { today: '2026-01-01', edd: '2026-10-08' }, // wk 0
    { today: '2025-12-31', edd: '2026-10-08' }, // negative
  ];

  for (const { today, edd } of parityVectors) {
    it(`today=${today}, edd=${edd}: computeGestationalWeekAtStart matches computeGestationalAge`, () => {
      const fromLogic = computeGestationalWeekAtStart(edd, today);
      const fromGestAge = computeGestationalAge(edd, today).gestationalWeek;
      expect(fromLogic).toBe(fromGestAge);
    });
  }

  it('parseCivilDateMs is exported from gestationalAge.ts (Y-4 import check)', () => {
    // If this import fails, it means parseCivilDateMs is not exported
    expect(typeof parseCivilDateMs).toBe('function');
    expect(parseCivilDateMs('2026-06-30')).toBe(Date.UTC(2026, 5, 30));
  });

  it('civilDaysBetween is exported from gestationalAge.ts (Y-4 import check)', () => {
    expect(typeof civilDaysBetween).toBe('function');
    expect(civilDaysBetween('2026-06-30', '2026-07-07')).toBe(7);
  });
});

// ─── getSessionRenderData() — INV-K2 no-valence ──────────────────────────────

describe('getSessionRenderData() — INV-K2 (no verdict, no status field)', () => {
  it('renders count=3 and count=10 identically except the count number', () => {
    const r3 = getSessionRenderData(3);
    const r10 = getSessionRenderData(10);
    // Only count differs — no extra verdict, color, or state field
    expect({ ...r3, count: undefined }).toEqual({ ...r10, count: undefined });
  });

  it('does not include any verdict/valence field', () => {
    const result = getSessionRenderData(7);
    const keys = Object.keys(result);
    // Denylist: no field named verdict, complete, goal, target_met, highlight
    expect(keys).not.toContain('verdict');
    expect(keys).not.toContain('complete');
    expect(keys).not.toContain('goal');
    expect(keys).not.toContain('targetMet');
    expect(keys).not.toContain('highlight');
    expect(keys).not.toContain('isComplete');
  });
});

// ─── Y-7: createTapHandler — rapid-tap must not drop counts ──────────────────

/**
 * Faithful model of React's setState batching: functional updaters are queued
 * and applied in order on flush(). snapshot() returns the last COMMITTED value
 * (what a stale closure would capture) — it does NOT reflect queued-but-unflushed
 * updates. This lets us prove the functional-updater fix survives rapid taps that
 * fire within a single render frame (before any re-render/flush).
 */
class BatchedState {
  private committed: KickCountDraft | null;
  private queue: Array<(prev: KickCountDraft | null) => KickCountDraft | null> = [];
  constructor(initial: KickCountDraft | null) {
    this.committed = initial;
  }
  // React-like setter accepting a functional updater.
  setDraft = (updater: (prev: KickCountDraft | null) => KickCountDraft | null): void => {
    this.queue.push(updater);
  };
  // Stale snapshot — the value a closure captured between renders.
  snapshot(): KickCountDraft | null {
    return this.committed;
  }
  // A render: apply every queued updater in order.
  flush(): void {
    for (const u of this.queue) this.committed = u(this.committed);
    this.queue = [];
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createTapHandler() — Y-7 rapid-tap (functional updater)', () => {
  it('10 rapid taps within one frame all count (no stale-closure drop)', () => {
    const state = new BatchedState(makeDraft({ movementCount: 0 }));
    const handleTap = createTapHandler({
      setDraft: state.setDraft,
      persist: () => Promise.resolve(),
    });
    // Fire 10 taps BEFORE any re-render (queue not yet flushed).
    for (let i = 0; i < 10; i++) handleTap();
    state.flush();
    expect(state.snapshot()?.movementCount).toBe(10);
  });

  it('persists each tap with the composed running count [1,2,3,...]', () => {
    const persisted: number[] = [];
    const state = new BatchedState(makeDraft({ movementCount: 0 }));
    const handleTap = createTapHandler({
      setDraft: state.setDraft,
      persist: (d) => {
        persisted.push(d.movementCount);
        return Promise.resolve();
      },
    });
    for (let i = 0; i < 3; i++) handleTap();
    state.flush(); // persist runs inside each updater during flush
    expect(persisted).toEqual([1, 2, 3]);
  });

  it('routes a successful persist to onSaved', async () => {
    const state = new BatchedState(makeDraft({ movementCount: 0 }));
    const onSaved = jest.fn();
    const onError = jest.fn();
    const handleTap = createTapHandler({
      setDraft: state.setDraft,
      persist: () => Promise.resolve(),
      onSaved,
      onError,
    });
    handleTap();
    state.flush();
    await tick();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes a failed persist to onError (SC-K1 save-error), count kept', async () => {
    const state = new BatchedState(makeDraft({ movementCount: 0 }));
    const onSaved = jest.fn();
    const onError = jest.fn();
    const handleTap = createTapHandler({
      setDraft: state.setDraft,
      persist: () => Promise.reject(new Error('keychain fail')),
      onSaved,
      onError,
    });
    handleTap();
    state.flush();
    await tick();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    // count is NOT lost from in-memory state even though persist failed
    expect(state.snapshot()?.movementCount).toBe(1);
  });

  it('REGRESSION MODEL: a stale-closure handler collapses 10 taps → 1', () => {
    // This models the OLD (buggy) handler: it read a snapshot from the closure
    // and set an absolute value, so taps firing before a re-render all saw the
    // same count and overwrote each other. Proves the bug the fix addresses.
    const state = new BatchedState(makeDraft({ movementCount: 0 }));
    const staleHandler = () => {
      const prev = state.snapshot(); // stale — captured between renders
      const updated = prev ? tap(prev) : prev;
      state.setDraft(() => updated); // absolute set, ignores latest queued value
    };
    for (let i = 0; i < 10; i++) staleHandler();
    state.flush();
    expect(state.snapshot()?.movementCount).toBe(1); // dropped 9 taps
  });
});

// ─── createUndoHandler — rapid-undo must not drop/clobber (same class as Y-7) ──

describe('createUndoHandler() — rapid-undo (functional updater)', () => {
  it('10 rapid undos within one frame floor at 0 (no negative, no stale drop)', () => {
    const state = new BatchedState(makeDraft({ movementCount: 5 }));
    const handleUndo = createUndoHandler({
      setDraft: state.setDraft,
      persist: () => Promise.resolve(),
    });
    for (let i = 0; i < 10; i++) handleUndo();
    state.flush();
    expect(state.snapshot()?.movementCount).toBe(0);
  });

  it('does NOT clobber composed tap counts when interleaved with taps', () => {
    // The exact hazard the reviewer flagged: functional tap-updaters are queued,
    // then an undo handler runs before flush. A stale-closure undo (absolute set)
    // would overwrite the composed tap counts. The functional undo must compose.
    const state = new BatchedState(makeDraft({ movementCount: 0 }));
    const handleTap = createTapHandler({ setDraft: state.setDraft, persist: () => Promise.resolve() });
    const handleUndo = createUndoHandler({ setDraft: state.setDraft, persist: () => Promise.resolve() });
    handleTap(); handleTap(); handleTap(); // queue +1 +1 +1
    handleUndo();                          // queue -1  (must see composed 3, not stale 0)
    state.flush();
    expect(state.snapshot()?.movementCount).toBe(2); // 3 taps - 1 undo
  });

  it('persists each undo with the composed running count [2,1]', () => {
    const persisted: number[] = [];
    const state = new BatchedState(makeDraft({ movementCount: 3 }));
    const handleUndo = createUndoHandler({
      setDraft: state.setDraft,
      persist: (d) => { persisted.push(d.movementCount); return Promise.resolve(); },
    });
    handleUndo(); handleUndo();
    state.flush();
    expect(persisted).toEqual([2, 1]);
  });

  it('is a no-op at count 0 — no persist, count stays 0', () => {
    const persisted: number[] = [];
    const state = new BatchedState(makeDraft({ movementCount: 0 }));
    const handleUndo = createUndoHandler({
      setDraft: state.setDraft,
      persist: (d) => { persisted.push(d.movementCount); return Promise.resolve(); },
    });
    handleUndo();
    state.flush();
    expect(state.snapshot()?.movementCount).toBe(0);
    expect(persisted).toEqual([]); // disabled at 0 → no write
  });

  it('routes a failed persist to onError (save-error), count kept', async () => {
    const state = new BatchedState(makeDraft({ movementCount: 2 }));
    const onSaved = jest.fn();
    const onError = jest.fn();
    const handleUndo = createUndoHandler({
      setDraft: state.setDraft,
      persist: () => Promise.reject(new Error('keychain fail')),
      onSaved,
      onError,
    });
    handleUndo();
    state.flush();
    await tick();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(state.snapshot()?.movementCount).toBe(1); // decremented in-memory, not lost
  });

  it('REGRESSION MODEL: a stale-closure undo clobbers preceding taps', () => {
    // Byte-faithful model of the OLD handleUndo: it early-returns at count 0, so
    // the clobber only manifests when the stale snapshot is > 0. Committed=3, then
    // 3 taps queue (composed would be 6); the stale undo reads the committed 3,
    // computes undo(3)=2, and ABSOLUTE-sets it — overwriting the queued taps.
    const state = new BatchedState(makeDraft({ movementCount: 3 }));
    const handleTap = createTapHandler({ setDraft: state.setDraft, persist: () => Promise.resolve() });
    const staleUndo = () => {
      const prev = state.snapshot();            // stale — committed 3, ignores queued taps
      if (!prev || prev.movementCount === 0) return; // old guard: no-op at 0
      const updated = undo(prev);
      state.setDraft(() => updated);            // absolute set → clobbers the queued taps
    };
    handleTap(); handleTap(); handleTap();      // queue → would compose to 6
    staleUndo();                                // stale sees 3 → sets 2, wiping the 3 taps
    state.flush();
    expect(state.snapshot()?.movementCount).toBe(2); // BUG: correct functional value is 5
  });
});

// ─── isConsentGateOpen() — consent footgun fix ───────────────────────────────

describe('isConsentGateOpen() — fail-safe consent gate', () => {
  it('OPEN only when consent is explicitly true', () => {
    expect(isConsentGateOpen(true)).toBe(true);
  });
  it('CLOSED when consent is false', () => {
    expect(isConsentGateOpen(false)).toBe(false);
  });
  it('CLOSED when consent is absent/undefined (no default-open footgun)', () => {
    expect(isConsentGateOpen(undefined as unknown as boolean)).toBe(false);
  });
});

// ─── newDraftId() — CSPRNG UUIDv4 ────────────────────────────────────────────

describe('newDraftId() — canonical UUIDv4', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  it('returns a canonical lowercase UUIDv4', () => {
    expect(newDraftId()).toMatch(UUID_V4);
  });
  it('generates unique ids (1000 samples, no collisions)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newDraftId());
    expect(ids.size).toBe(1000);
  });
});
