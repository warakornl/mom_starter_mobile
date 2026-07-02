/**
 * Phase 4 fixes — behavioral tests (TDD, written BEFORE implementation).
 *
 * F1: dequeue-on-retry-success
 *   S8 withdrawal enqueues on POST failure; a subsequent successful retry
 *   must REMOVE the entry so (a) the "รอซิงค์" badge clears and (b)
 *   drainConsentQueue does not re-POST a duplicate row.
 *
 * F2: highest-risk behavioral coverage (TDD gap)
 *   - applyGrantError / applyPostStart state transitions (useJitConsentLogic)
 *   - dual-gate live: evaluateJitGate wired to createConsentStore.isGranted
 *
 * All tests use pure logic (createConsentSync / createConsentStore / logic fns)
 * — no RN render required.
 *
 * Design ref: first-run-consent.md §4.2 (queue), §4.7 (dual-gate), §3.2 (JIT)
 */

import { createConsentSync } from './consentSync';
import type { ConsentQueueStorage } from './consentQueue';
import { createConsentStore } from './consentStore';
import { evaluateJitGate } from './jitConsentLogic';
import {
  initialJitState,
  applyGrantError,
  applyPostStart,
  type JitState,
} from './useJitConsentLogic';

// ─── In-memory storage helpers ────────────────────────────────────────────────

class InMemoryQueueStorage implements ConsentQueueStorage {
  data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

// ─── F1 / F2-S8: removePending — dequeue-on-retry-success ────────────────────

describe('F1 removePending — S8 withdrawal enqueue on failure + dequeue on retry success', () => {
  it('queue has a pending entry after POST failure enqueue', async () => {
    const storage = new InMemoryQueueStorage();
    const { queue } = createConsentSync(storage, { postConsent: jest.fn() } as never);

    // ManageConsentsScreen.postConsentChange: failure path → enqueue
    if (!queue.hasPendingEntry('general_health', false)) {
      queue.enqueue('general_health', false, 'v1.0-th');
      await queue.persist();
    }

    expect(queue.hasPendingEntry('general_health', false)).toBe(true);

    // Entry must be persisted so drainConsentQueue can pick it up after restart
    const stored = await storage.load();
    const parsed = JSON.parse(stored ?? '[]') as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it('removePending removes the entry and badge clears (hasPendingEntry → false)', async () => {
    const storage = new InMemoryQueueStorage();
    const { queue } = createConsentSync(storage, { postConsent: jest.fn() } as never);

    // Enqueue as if the POST failed
    queue.enqueue('general_health', false, 'v1.0-th');
    await queue.persist();
    expect(queue.hasPendingEntry('general_health', false)).toBe(true);

    // Inline retry succeeds → removePending (F1 fix)
    queue.removePending('general_health', false);
    await queue.persist();

    // Badge cleared
    expect(queue.hasPendingEntry('general_health', false)).toBe(false);
    expect(queue.getEntries()).toHaveLength(0);

    // Persisted removal — drainConsentQueue will find nothing to re-POST
    const stored = await storage.load();
    const parsed = JSON.parse(stored ?? '[]') as unknown[];
    expect(parsed).toHaveLength(0);
  });

  it('removePending does NOT remove a still-pending DIFFERENT action (guard)', () => {
    const storage = new InMemoryQueueStorage();
    const { queue } = createConsentSync(storage, { postConsent: jest.fn() } as never);

    // Two distinct pending entries
    queue.enqueue('general_health', false, 'v1.0-th'); // withdrawal
    queue.enqueue('cloud_storage', true, 'v1.0-th');   // grant (different type)

    // Remove only the general_health withdrawal
    queue.removePending('general_health', false);

    // cloud_storage grant must be untouched
    expect(queue.hasPendingEntry('cloud_storage', true)).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
  });

  it('removePending(type, granted=true) does NOT remove a pending withdrawal for the same type', () => {
    const storage = new InMemoryQueueStorage();
    const { queue } = createConsentSync(storage, { postConsent: jest.fn() } as never);

    // Pending withdrawal
    queue.enqueue('general_health', false, 'v1.0-th');

    // Caller mistakenly tries to dequeue a grant (different direction)
    queue.removePending('general_health', true);

    // Withdrawal remains
    expect(queue.hasPendingEntry('general_health', false)).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
  });

  it('removePending on empty queue is a no-op (does not throw)', () => {
    const storage = new InMemoryQueueStorage();
    const { queue } = createConsentSync(storage, { postConsent: jest.fn() } as never);

    expect(() => queue.removePending('general_health', false)).not.toThrow();
    expect(queue.getEntries()).toHaveLength(0);
  });
});

// ─── F2: applyGrantError state transition ─────────────────────────────────────

describe('applyGrantError — state transition on POST failure (F2)', () => {
  const base: JitState = initialJitState();

  it('sets isLoading to false', () => {
    const loading: JitState = { ...base, isLoading: true };
    expect(applyGrantError(loading, 'save_failed').isLoading).toBe(false);
  });

  it('sets the error message', () => {
    const result = applyGrantError(base, 'save_failed');
    expect(result.error).toBe('save_failed');
  });

  it('preserves parentalAttested when error occurs', () => {
    const attested: JitState = { ...base, parentalAttested: true };
    expect(applyGrantError(attested, 'err').parentalAttested).toBe(true);
  });

  it('preserves declined flag', () => {
    // edge case: declined should not change on an error (no action was taken)
    const declined: JitState = { ...base, declined: true };
    expect(applyGrantError(declined, 'err').declined).toBe(true);
  });
});

// ─── F2: applyPostStart state transition ─────────────────────────────────────

describe('applyPostStart — state transition when POST dispatched (F2)', () => {
  const base: JitState = initialJitState();

  it('sets isLoading to true', () => {
    expect(applyPostStart(base).isLoading).toBe(true);
  });

  it('clears any prior error', () => {
    const withError: JitState = { ...base, error: 'previous_error' };
    expect(applyPostStart(withError).error).toBeNull();
  });

  it('preserves parentalAttested while loading', () => {
    const attested: JitState = { ...base, parentalAttested: true };
    expect(applyPostStart(attested).parentalAttested).toBe(true);
  });

  it('preserves declined flag while loading', () => {
    const declined: JitState = { ...base, declined: true };
    expect(applyPostStart(declined).declined).toBe(true);
  });
});

// ─── F2: dual-gate live — evaluateJitGate wired to createConsentStore ─────────

describe('dual-gate live — evaluateJitGate wired to consentStore.isGranted (§4.7 F2)', () => {
  it('limited-mode user (general_health not granted) reaching infant_feeding → general_health_needed', () => {
    const store = createConsentStore();
    // general_health NOT granted (fail-closed default)
    const gate = evaluateJitGate('infant_feeding', (t) => store.isGranted(t));
    expect(gate).toBe('general_health_needed');
  });

  it('after granting general_health → infant_feeding returns show_jit', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');

    const gate = evaluateJitGate('infant_feeding', (t) => store.isGranted(t));
    expect(gate).toBe('show_jit');
  });

  it('after granting both general_health AND infant_feeding → already_granted', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    store.setGranted('infant_feeding', true, 'v1.0-th');

    const gate = evaluateJitGate('infant_feeding', (t) => store.isGranted(t));
    expect(gate).toBe('already_granted');
  });

  it('child_health also triggers general_health_needed when general_health is absent (§4.7)', () => {
    const store = createConsentStore();
    // general_health NOT granted
    const gate = evaluateJitGate('child_health', (t) => store.isGranted(t));
    expect(gate).toBe('general_health_needed');
  });

  it('child_health returns show_jit once general_health is granted', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');

    const gate = evaluateJitGate('child_health', (t) => store.isGranted(t));
    expect(gate).toBe('show_jit');
  });

  it('pdf_egress is NOT dual-gated — returns show_jit even without general_health', () => {
    const store = createConsentStore();
    // general_health NOT granted — but pdf_egress has no dual-gate
    const gate = evaluateJitGate('pdf_egress', (t) => store.isGranted(t));
    expect(gate).toBe('show_jit');
  });
});
