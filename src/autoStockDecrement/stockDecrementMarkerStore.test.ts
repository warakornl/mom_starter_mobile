/**
 * stockDecrementMarkerStore.test.ts — TDD RED → GREEN for the on-device-only
 * StockDecrementMarker applied-set (skip-if-seen idempotency store).
 *
 * Source: auto-stock-decrement-functional.md §2 (step 3), §3 (step 3),
 *   D-3 (record marker on every gate-admitted event, including no-op),
 *   D-6 (marker↔draw atomicity — tested in triggerEngine tests),
 *   E-10 (skip-if-seen, not recompute-to-same-end-state),
 *   INV-ASD-5 (never a plaintext FK on the supplies row — upheld by being
 *               a separate health-side store),
 *   INV-ASD-8 (mobile-local-only; never in push/pull payload).
 *
 * Security: all UUIDs are synthetic test fixtures — no real health data.
 */

import {
  createStockDecrementMarkerStore,
  type StockDecrementMarkerStore,
} from './stockDecrementMarkerStore';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID   = 'aaaaaaaa-0000-4000-8000-000000000001';
const OCCURRENCE_1 = 'bbbbbbbb-0000-4000-8000-000000000002';
const OCCURRENCE_2 = 'cccccccc-0000-4000-8000-000000000003';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StockDecrementMarkerStore — skip-if-seen (E-10 / D-3)', () => {
  let store: StockDecrementMarkerStore;

  beforeEach(() => {
    store = createStockDecrementMarkerStore();
  });

  it('hasSeen() returns false for unseen id', () => {
    expect(store.hasSeen(SESSION_ID)).toBe(false);
  });

  it('markSeen() then hasSeen() returns true', () => {
    store.markSeen(SESSION_ID, 'infant_feeding');
    expect(store.hasSeen(SESSION_ID)).toBe(true);
  });

  it('markSeen() with general_health then hasSeen() returns true', () => {
    store.markSeen(OCCURRENCE_1, 'general_health');
    expect(store.hasSeen(OCCURRENCE_1)).toBe(true);
  });

  it('distinct ids are independent (no cross-contamination)', () => {
    store.markSeen(SESSION_ID, 'infant_feeding');
    expect(store.hasSeen(OCCURRENCE_1)).toBe(false);
    expect(store.hasSeen(OCCURRENCE_2)).toBe(false);
  });

  it('marking same id twice is idempotent (no error, still hasSeen=true)', () => {
    store.markSeen(SESSION_ID, 'infant_feeding');
    expect(() => store.markSeen(SESSION_ID, 'infant_feeding')).not.toThrow();
    expect(store.hasSeen(SESSION_ID)).toBe(true);
  });

  it('stores multiple distinct ids', () => {
    store.markSeen(SESSION_ID, 'infant_feeding');
    store.markSeen(OCCURRENCE_1, 'general_health');
    store.markSeen(OCCURRENCE_2, 'general_health');
    expect(store.hasSeen(SESSION_ID)).toBe(true);
    expect(store.hasSeen(OCCURRENCE_1)).toBe(true);
    expect(store.hasSeen(OCCURRENCE_2)).toBe(true);
  });

  it('reset() clears all markers', () => {
    store.markSeen(SESSION_ID, 'infant_feeding');
    store.markSeen(OCCURRENCE_1, 'general_health');
    store.reset();
    expect(store.hasSeen(SESSION_ID)).toBe(false);
    expect(store.hasSeen(OCCURRENCE_1)).toBe(false);
  });

  it('getCount() returns correct count of marked ids', () => {
    expect(store.getCount()).toBe(0);
    store.markSeen(SESSION_ID, 'infant_feeding');
    expect(store.getCount()).toBe(1);
    store.markSeen(OCCURRENCE_1, 'general_health');
    expect(store.getCount()).toBe(2);
    store.markSeen(SESSION_ID, 'infant_feeding'); // duplicate — no increase
    expect(store.getCount()).toBe(2);
  });
});
