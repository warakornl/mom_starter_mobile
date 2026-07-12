/**
 * lossOptimisticApply — unit tests (TDD, written BEFORE the implementation).
 *
 * The NEW client-side optimistic-apply producer for the loss verb, per
 * docs/functional-spec/direct-rest-offline-resilience-functional.md §7.2 /
 * §7.1 (G-OR-1/2, OR-INV-6/7/8/12) and the architecture's BLOCKER-1
 * correction: today the flip to 'ended' only arrives from a server
 * round-trip (HomeTabScreen's post-focus GET) — this module is the NEW
 * producer that flips the RAW snapshot directly, offline-safe.
 *
 * RED-LINE assertions under test (per the epic's non-negotiable rules):
 *   - predicate/field EXACTLY `lifecycle: 'ended'` (no other enum/string).
 *   - the raw snapshot is threaded through — NEVER `?? 'pregnant'` anywhere
 *     in this module (fail-open = red-line defect).
 *   - fail-closed on known-withdrawn consent (§17.4 / G-OR-1..3): NO flip,
 *     NO enqueue.
 *   - null snapshot input fails toward SUPPRESS (§17.8 GAP-2) — this
 *     function never fabricates a snapshot out of nothing; it requires a
 *     non-null previous snapshot to build the optimistic one from (raw
 *     wiring discipline — a null snapshot must not be defaulted).
 */

import { buildLossOptimisticApply } from './lossOptimisticApply';
import type { ProfileSnapshot } from './PregnancyProfileContext';

function makeSnapshot(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    gestationalWeek: 10,
    edd: '2026-06-01',
    todayCivil: '2026-01-05',
    lifecycle: 'pregnant',
    generalHealthConsented: true,
    ...overrides,
  };
}

describe('buildLossOptimisticApply — consent gate (G-OR-1/2/3, OR-INV-12)', () => {
  it('proceeds (apply+enqueue) when cached general_health consent is granted', () => {
    const result = buildLossOptimisticApply({
      prevSnapshot: makeSnapshot(),
      generalHealthConsented: true,
      targetProfileId: 'profile-1',
      baseVersion: 5,
      lossDate: '2026-01-01',
      clientDate: '2026-01-05',
    });

    expect(result.kind).toBe('apply');
    if (result.kind === 'apply') {
      expect(result.optimisticSnapshot.lifecycle).toBe('ended'); // EXACT predicate
      expect(result.enqueueParams.verb).toBe('loss_event');
      expect(result.enqueueParams.intendedLifecycle).toBe('ended');
      expect(result.enqueueParams.body).toEqual({ lossDate: '2026-01-01' });
    }
  });

  it('FAILS CLOSED (no apply, no enqueue) when consent is known-withdrawn — §17.4', () => {
    const result = buildLossOptimisticApply({
      prevSnapshot: makeSnapshot(),
      generalHealthConsented: false,
      targetProfileId: 'profile-1',
      baseVersion: 5,
      lossDate: '2026-01-01',
      clientDate: '2026-01-05',
    });

    expect(result.kind).toBe('consent_required');
  });
});

describe('buildLossOptimisticApply — RAW snapshot mutation (RED-LINE: no fail-open)', () => {
  it('sets lifecycle to the LITERAL string "ended" — never any other value', () => {
    const result = buildLossOptimisticApply({
      prevSnapshot: makeSnapshot({ lifecycle: 'pregnant' }),
      generalHealthConsented: true,
      targetProfileId: 'profile-1',
      baseVersion: 5,
      lossDate: '',
      clientDate: '2026-01-05',
    });
    expect(result.kind).toBe('apply');
    if (result.kind === 'apply') {
      expect(result.optimisticSnapshot.lifecycle).toBe('ended');
      expect(result.optimisticSnapshot.lifecycle === 'ended').toBe(true);
    }
  });

  it('preserves gestationalWeek/edd from prevSnapshot (no lossDate = omitted body, LOSS-INV-11)', () => {
    const result = buildLossOptimisticApply({
      prevSnapshot: makeSnapshot({ edd: '2026-09-01', gestationalWeek: 20 }),
      generalHealthConsented: true,
      targetProfileId: 'profile-1',
      baseVersion: 5,
      lossDate: '',
      clientDate: '2026-01-05',
    });
    expect(result.kind).toBe('apply');
    if (result.kind === 'apply') {
      expect(result.optimisticSnapshot.edd).toBe('2026-09-01');
      expect(result.enqueueParams.body).toEqual({});
    }
  });

  it('retains prevServerSnapshot for rollback (OR-ROLL-1) — the ORIGINAL raw snapshot, untouched', () => {
    const prev = makeSnapshot({ lifecycle: 'pregnant' });
    const result = buildLossOptimisticApply({
      prevSnapshot: prev,
      generalHealthConsented: true,
      targetProfileId: 'profile-1',
      baseVersion: 5,
      lossDate: '2026-01-01',
      clientDate: '2026-01-05',
    });
    expect(result.kind).toBe('apply');
    if (result.kind === 'apply') {
      expect(result.prevServerSnapshot).toEqual(prev);
      expect(result.prevServerSnapshot).not.toBe(result.optimisticSnapshot); // distinct objects
    }
  });

  it('never emits a "?? \'pregnant\'" fallback: the produced snapshot object has NO code path defaulting lifecycle when prevSnapshot exists', () => {
    // Structural guard: assert the source does not contain the forbidden
    // fallback token, which is the exact class of bug this red-line forbids.
    // (Complements the runtime assertions above — this is a static check.)
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, 'lossOptimisticApply.ts'), 'utf8');
    expect(src).not.toMatch(/\?\?\s*['"]pregnant['"]/);
  });
});

describe('buildLossOptimisticApply — null snapshot fails toward suppress (§17.8 GAP-2)', () => {
  it('returns kind "suppress" when prevSnapshot is null — never fabricates a snapshot', () => {
    const result = buildLossOptimisticApply({
      prevSnapshot: null,
      generalHealthConsented: true,
      targetProfileId: 'profile-1',
      baseVersion: 5,
      lossDate: '',
      clientDate: '2026-01-05',
    });
    expect(result.kind).toBe('suppress');
  });
});

describe('buildLossOptimisticApply — no celebratory UI (SENS-2) / idempotency (OR-INV-4)', () => {
  it('the enqueueParams never carry a pre-minted idempotencyKey (queue mints it, not this producer)', () => {
    const result = buildLossOptimisticApply({
      prevSnapshot: makeSnapshot(),
      generalHealthConsented: true,
      targetProfileId: 'profile-1',
      baseVersion: 5,
      lossDate: '2026-01-01',
      clientDate: '2026-01-05',
    });
    expect(result.kind).toBe('apply');
    if (result.kind === 'apply') {
      expect((result.enqueueParams as unknown as Record<string, unknown>).idempotencyKey).toBeUndefined();
    }
  });
});
