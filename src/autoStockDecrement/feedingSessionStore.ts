/**
 * feedingSessionStore.ts — In-memory store for FeedingSession records.
 *
 * T-F signal (auto-stock-decrement-functional.md §2):
 *   commitLocalFormula() is the production entry point for the formula-feed
 *   trigger. It:
 *     1. Persists the FeedingSession to this in-memory store (Step 1 — the
 *        immutable log, committed in its own transaction before the D-6 block).
 *     2. Returns the stored session id (for use as the idempotency key in
 *        commitFormulaFeedDecrement, which is called immediately after by the
 *        caller to fire the D-6 atomic side-effect: draw + marker).
 *
 * Immutable event union:
 *   FeedingSessions are create-only (append-only log). Corrections are new
 *   superseding rows; never overwrite (offline-secure-data-findings.md).
 *
 * Security:
 *   - NEVER log sessionId, amountSubUnits, or startedAt (K-8 / SD-5).
 *   - This store is health-side (infant_feeding + general_health gate at
 *     commit time via FormulaFeedSection consent check).
 *   - reset() clears all state (call on sign-out — PDPA data isolation).
 *
 * Source:
 *   auto-stock-decrement-functional.md §2 (T-F sequence),
 *   auto-stock-decrement-architecture.md §2 (FeedingSession entity).
 */

import type { FeedingSessionRecord } from '../sync/syncTypes';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface FeedingSessionStore {
  /**
   * Persist a formula FeedingSession locally (Step 1 of the T-F sequence).
   *
   * Immutable-event: if a session with this id already exists, the call is a
   * no-op (idempotent create). Returns the session id (for use as idempotency
   * key in commitFormulaFeedDecrement).
   *
   * NEVER log sessionId or amountSubUnits (K-8 / SD-5).
   */
  commitLocalFormula(session: FeedingSessionRecord): string;

  /**
   * Look up a session by id (including all kinds). Returns undefined if absent.
   * Used by the sync client's feedingSessions pull adapter.
   */
  getById(id: string): FeedingSessionRecord | undefined;

  /**
   * All stored sessions (for sync push). Append-only.
   */
  getAll(): FeedingSessionRecord[];

  /**
   * Number of sessions stored (diagnostics only).
   */
  getCount(): number;

  /**
   * Clear all sessions (call on sign-out — PDPA data isolation / SD-5).
   */
  reset(): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createFeedingSessionStore(): FeedingSessionStore {
  // Append-only event log: id → FeedingSessionRecord
  const sessions = new Map<string, FeedingSessionRecord>();

  return {
    commitLocalFormula(session: FeedingSessionRecord): string {
      // Idempotent create: if already stored, return the existing id.
      if (!sessions.has(session.id)) {
        sessions.set(session.id, { ...session });
      }
      return session.id;
    },

    getById(id: string): FeedingSessionRecord | undefined {
      return sessions.get(id);
    },

    getAll(): FeedingSessionRecord[] {
      return Array.from(sessions.values());
    },

    getCount(): number {
      return sessions.size;
    },

    reset(): void {
      sessions.clear();
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Module-level FeedingSession store singleton.
 *
 * Used by FormulaFeedSection.onSubmitFormulaFeed → commitFormulaFeedDecrement
 * (T-F path). Cleared on sign-out via feedingSessionStore.reset().
 *
 * NEVER log session contents (K-8 / SD-5).
 */
export const feedingSessionStore = createFeedingSessionStore();
