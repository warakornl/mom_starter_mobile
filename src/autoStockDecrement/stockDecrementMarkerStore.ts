/**
 * stockDecrementMarkerStore.ts — On-device-only StockDecrementMarker applied-set.
 *
 * Implements the skip-if-seen idempotency gate (D-3 / E-10).
 * The marker is mobile-local-only:
 *   - NEVER pushed or pulled (INV-ASD-8).
 *   - NEVER a plaintext FK on the supply row (INV-ASD-5).
 *   - Lives in the feed-log crypto-shred / GC circle tagged by consent_scope,
 *     so it is wiped with the feed log on account deletion.
 *   - Cleared on logout (reset()).
 *
 * The ACTUAL atomicity of markSeen() + draw is enforced by the caller
 * (decrementTriggerEngine.ts) by wrapping both in a single SQLite transaction
 * simulation (D-6). This store is the READ side (hasSeen) and the WRITE
 * side (markSeen); it does NOT enforce its own transaction.
 *
 * Source: auto-stock-decrement-functional.md §2/§3 step 3,
 *   D-3 (marker on every gate-admitted event), D-6 (atomicity with draw),
 *   E-10 (skip-if-seen), INV-ASD-5, INV-ASD-8.
 *
 * Security: completionEventId is health-adjacent — NEVER log (SD-5 / K-8).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarkerConsentScope = 'infant_feeding' | 'general_health';

/** A single idempotency marker entry (on-device only). */
export interface StockDecrementMarkerEntry {
  /** The completion event id (FeedingSession.id or ReminderOccurrence.id). */
  readonly completionEventId: string;
  /** Which consent scope this marker lives under (for crypto-shred alignment). */
  readonly consentScope: MarkerConsentScope;
  /** ISO UTC instant when the marker was recorded. */
  readonly appliedAt: string;
}

/** Public interface for the marker store. */
export interface StockDecrementMarkerStore {
  /**
   * Returns true if the completionEventId has already been applied.
   * Fail-closed: false when not seen.
   */
  hasSeen(completionEventId: string): boolean;

  /**
   * Record that the completionEventId has been applied.
   * Idempotent: calling twice with the same id is a no-op.
   * MUST be called atomically with the draw (D-6) by the caller.
   * NEVER log completionEventId (SD-5 / K-8).
   */
  markSeen(completionEventId: string, consentScope: MarkerConsentScope): void;

  /**
   * Number of recorded completion events (for diagnostics only, not business logic).
   */
  getCount(): number;

  /**
   * Clear all markers (call on sign-out / account-delete wipe).
   * INV-ASD-8: after reset, a replay will re-apply once correctly.
   */
  reset(): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an isolated in-memory StockDecrementMarkerStore.
 *
 * Production: one instance per app session (module-level singleton below).
 * Tests: create fresh instances per test via createStockDecrementMarkerStore().
 *
 * Note: in MVP this is in-memory only. A durable SQLite backing would be added
 * when the full SQLite layer ships (same carry-forward pattern as SyncStore).
 * For now, markers survive component remounts but reset on app restart.
 * After restart, a replay of any unprocessed local events (offline queue drain)
 * will re-derive the correct final state since draws also reset on restart.
 */
export function createStockDecrementMarkerStore(): StockDecrementMarkerStore {
  // Map from completionEventId → marker entry
  const seen = new Map<string, StockDecrementMarkerEntry>();

  return {
    hasSeen(completionEventId: string): boolean {
      return seen.has(completionEventId);
    },

    markSeen(completionEventId: string, consentScope: MarkerConsentScope): void {
      if (seen.has(completionEventId)) {
        // Idempotent: already recorded.
        return;
      }
      seen.set(completionEventId, {
        completionEventId,
        consentScope,
        appliedAt: new Date().toISOString(),
      });
    },

    getCount(): number {
      return seen.size;
    },

    reset(): void {
      seen.clear();
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Module-level singleton for the stock decrement marker store.
 *
 * Used by the decrement trigger engines to check/record completion event ids.
 * Cleared on sign-out via stockDecrementMarkerStore.reset().
 *
 * NEVER push this data to the server (INV-ASD-8).
 * NEVER put completionEventId on the supply row (INV-ASD-5).
 */
export const stockDecrementMarkerStore = createStockDecrementMarkerStore();
