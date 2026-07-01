/**
 * kickCountLogic — pure business logic for the kick-count feature.
 *
 * All functions are pure (immutable input/output) — no side effects.
 * Side effects (persist draft, insert completed row) are in the caller screens.
 * EXCEPTION: createTapHandler is a factory that WIRES injected side-effects
 *   (setDraft/persist) into a functional-updater tap handler — see Y-7 below.
 *
 * Source of truth:
 *   kick-count-functional-spec.md §B (draft lifecycle), §C (screens), §D (INVs)
 *   api-contract.md §"Gestational-age & stage computation" (golden algorithm)
 *   kick-count.md (frontend-spec rev 4) — K-5b, K-5c, K-5d, INV-K2/K3/K6
 *
 * Safety invariants (all are testable):
 *   INV-K2: no verdict/valence — count=3 and count=10 produce identical shape
 *            from getSessionRenderData(); only the count number differs.
 *   INV-K3: no conditional UI by count — getProgressDisplay() returns the same
 *            keys regardless of count; endSession is always enabled (B1).
 *   INV-K6: safety strip + disclaimer are not derived from logic here — they
 *            are static content in the screen components (always-on).
 *
 * D4 / DRIFT-1:
 *   computeGestationalWeekAtStart uses the EXACT same algorithm as
 *   gestationalAge.ts (Math.floor + Euclidean mod) — golden-vector conformance
 *   is tested by kickCountLogic.test.ts.
 *   durationSeconds uses monotonic elapsed — server stores verbatim.
 *
 * Security: never log movementCount or any draft/session field (MOTHER-health K-8).
 */

import { v4 as uuidv4 } from 'uuid';
import type { KickCountDraft, KickCountSessionRecord } from './kickCountTypes';
import type { Lifecycle } from '../pregnancy/types';
// Y-4: import shared helpers instead of local copy (prevents DRIFT-1 algorithm drift).
// parseCivilDateMs and civilDaysBetween are the canonical implementations;
// importing them ensures kickCountLogic never drifts from gestationalAge.ts.
import { civilDaysBetween, parseCivilDateMs } from '../pregnancy/gestationalAge';

// ─── Re-export for callers that need both Lifecycle and the civil helpers ──────

export type { Lifecycle };
// Re-export so callers can import from a single kick-count entry point if needed.
export { civilDaysBetween, parseCivilDateMs };

/**
 * Derive the gestational week at session start from the stored EDD and a
 * civil "today" (the device's local date at session-start time).
 *
 * CANONICAL algorithm (data-model §3.1, api-contract §"Gestational-age"):
 *   daysUntilEdd    = civilDaysBetween(today, edd)
 *   daysPregnant    = 280 - daysUntilEdd
 *   gestationalWeek = Math.floor(daysPregnant / 7)   // MANDATORY floor
 *
 * This must be byte-identical to computeGestationalAge() in gestationalAge.ts.
 * Both must pass the same golden test-vectors (data-model §3.1).
 *
 * D4/DRIFT-1: server stores this value verbatim, does not recompute.
 *
 * @param edd   The stored civil due date (YYYY-MM-DD, zoneless).
 * @param today The device's local civil date at session start (YYYY-MM-DD).
 * @returns     gestationalWeek (completed weeks, may be negative for far-future EDD).
 */
export function computeGestationalWeekAtStart(edd: string, today: string): number {
  const daysUntilEdd = civilDaysBetween(today, edd);
  const daysPregnant = 280 - daysUntilEdd;
  // MANDATORY: Math.floor (not Math.trunc) for negative daysPregnant
  return Math.floor(daysPregnant / 7);
}

// ─── Duration computation (monotonic clock, B.3) ──────────────────────────────

/**
 * Compute durationSeconds from monotonic elapsed time.
 *
 * Uses monotonic start/end (e.g. performance.now() values in milliseconds)
 * to avoid DST/clock-adjust errors (B.3 / OQ-K-D).
 *
 * Server stores verbatim (D4). The result may differ from (endedAt − startedAt)
 * if the device clock adjusted mid-session — this is intentional and accepted.
 *
 * @param startMs  Monotonic ms at session start (e.g. performance.now()).
 * @param endMs    Monotonic ms at session end.
 * @returns        Integer seconds elapsed (floor).
 */
export function computeDurationSeconds(startMs: number, endMs: number): number {
  return Math.floor((endMs - startMs) / 1000);
}

// ─── tap() — +1 per tap ───────────────────────────────────────────────────────

/**
 * Return a new draft with movementCount incremented by 1.
 *
 * No cap at targetCount (count can exceed 10 — K-5b: no conditional UI at 10).
 * Caller must persist the returned draft (B.1: persist every mutation).
 */
export function tap(draft: KickCountDraft): KickCountDraft {
  return { ...draft, movementCount: draft.movementCount + 1 };
}

// ─── undo() — -1 (floor 0) ────────────────────────────────────────────────────

/**
 * Return a new draft with movementCount decremented by 1, floored at 0.
 *
 * The −1 button is disabled at count=0 (interactivity only — not valence).
 * Visual appearance is unchanged at count=0 vs count≥1 (frontend-spec §SC-K1).
 * Caller must persist the returned draft.
 */
export function undo(draft: KickCountDraft): KickCountDraft {
  return { ...draft, movementCount: Math.max(0, draft.movementCount - 1) };
}

// ─── finalizeSession() — create completed row ─────────────────────────────────

/**
 * Finalize the draft into a completed KickCountSessionRecord.
 *
 * Rules (B.1):
 *   - status = 'completed' always (finishing at count=3 = finishing at count=10 — INV-K2)
 *   - id = draft.localDraftId (carry through)
 *   - durationSeconds from monotonic elapsed (B.3)
 *   - endedAt = provided civil datetime (caller supplies localCivilNow)
 *   - version = 0 (create sentinel — server assigns ≥ 1)
 *   - count=0 is valid (B1: end session is always-on)
 *
 * @param draft          The current in-progress draft.
 * @param endMonotonicMs Monotonic ms at finalize time (e.g. performance.now()).
 * @param endedAtCivil   Floating-civil end time "YYYY-MM-DDTHH:mm" (FLAG-1).
 */
export function finalizeSession(
  draft: KickCountDraft,
  endMonotonicMs: number,
  endedAtCivil: string,
): KickCountSessionRecord {
  const durationSeconds = computeDurationSeconds(draft.sessionStartMonotonicMs, endMonotonicMs);
  const now = new Date().toISOString();

  return {
    id: draft.localDraftId,
    startedAt: draft.startedAt,
    endedAt: endedAtCivil,
    movementCount: draft.movementCount,
    targetCount: 10, // Locked in MVP (D5)
    status: 'completed',
    durationSeconds,
    gestationalWeekAtStart: draft.gestationalWeekAtStart,
    note: draft.note ?? null,
    // create sentinel: version=0 → server assigns ≥ 1 in applied[]
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// ─── cancelSession() — no row, no egress ─────────────────────────────────────

/**
 * Cancel the in-progress draft — returns null (no session row produced).
 *
 * B.1 cancel rule: crypto-shred the draft from encrypted store (caller calls
 * clearDraft() after this returns null). No queue entry, no egress.
 *
 * Returning null here makes the "no row, no enqueue" contract explicit and
 * testable (US-K3 test: after cancel, no row in history, no push).
 */
export function cancelSession(_draft: KickCountDraft): null {
  return null;
}

// ─── Module visibility gate (SC-K6a / D6) ────────────────────────────────────

/**
 * Determine whether the kick-count MODULE should be visible at all.
 *
 * D6 / SC-K6a / SC-K6b:
 *   - gestationalWeek < 32 (pregnant) → module NOT rendered (no entry, no teaser)
 *   - gestationalWeek ≥ 32 AND lifecycle=pregnant → full access
 *   - lifecycle=postpartum → read-only history visible (SC-K6b)
 *
 * @param gestationalWeek  Client-derived current week (may be negative for far EDD).
 * @param lifecycle        Current pregnancy lifecycle.
 */
export function shouldShowModule(gestationalWeek: number, lifecycle: Lifecycle): boolean {
  if (lifecycle === 'postpartum') return true; // read-only history visible
  return gestationalWeek >= 32;
}

/**
 * Determine whether "Start Session" is allowed.
 *
 * Starting is only allowed for wk ≥ 32 and lifecycle = pregnant.
 * Postpartum = read-only (no new sessions).
 */
export function isStartAllowedByWeek(gestationalWeek: number, lifecycle: Lifecycle): boolean {
  return lifecycle === 'pregnant' && gestationalWeek >= 32;
}

// ─── Progress display — K-5b no-valence ──────────────────────────────────────

/**
 * Progress counter data for SC-K1.
 *
 * K-5b invariant (testable): the shape returned is IDENTICAL for count=3 and
 * count=10 — no extra field appears at count=10 (no `finished`, no `verdict`,
 * no `highlight`). Only the `count` number changes.
 *
 * The denominator "/10" is shown in the visual as a descriptive counter
 * (OQ-UI-K7: pending clinical sign-off; the SR label never includes "/10").
 */
export interface ProgressDisplay {
  count: number;
  targetCount: number;
}

export function getProgressDisplay(count: number, targetCount: number): ProgressDisplay {
  return { count, targetCount };
}

// ─── Session render data — INV-K2 no-valence ─────────────────────────────────

/**
 * Render data for a session card (history row / summary).
 *
 * INV-K2 (testable): getSessionRenderData(3) and getSessionRenderData(10)
 * must have the same shape — no extra key appears for high/low counts.
 * Only the `count` field value differs.
 *
 * No verdict field, no highlight, no isComplete, no targetMet.
 */
export interface SessionRenderData {
  count: number;
}

export function getSessionRenderData(count: number): SessionRenderData {
  return { count };
}

// ─── newDraftId() — CSPRNG UUIDv4 (was Math.random) ───────────────────────────

/**
 * Canonical lowercase UUIDv4 for local draft/session ids, via the app-wide
 * `uuid` v4 (CSPRNG-backed). Replaces the previous Math.random() generator.
 * Matches the pattern already used by Calendar/Supplies screens.
 */
export function newDraftId(): string {
  return uuidv4();
}

// ─── isConsentGateOpen() — consent footgun fix (Y-6 / appsec-1.3) ─────────────

/**
 * The general-health consent gate is OPEN only when consent is explicitly true.
 * Absent/false → CLOSED (fail-safe). Never defaults open — this replaces the
 * `generalHealthConsented = true` default-param footgun in the counting screen.
 */
export function isConsentGateOpen(generalHealthConsented: boolean): boolean {
  return generalHealthConsented === true;
}

// ─── createTapHandler() — Y-7 rapid-tap fix (functional updater) ──────────────

/** setState-style updater accepting a functional updater (React setDraft shape). */
type DraftUpdater = (updater: (prev: KickCountDraft | null) => KickCountDraft | null) => void;

export interface TapHandlerDeps {
  /** React state setter — MUST accept a functional updater. */
  setDraft: DraftUpdater;
  /** Persist a draft (e.g. serial-queued saveDraft). */
  persist: (draft: KickCountDraft) => Promise<void>;
  /** Called after a successful persist (e.g. setPhase('counting')). */
  onSaved?: () => void;
  /** Called if persist rejects (e.g. setPhase('save-error') — SC-K1). */
  onError?: () => void;
}

/**
 * Y-7 fix: return a tap handler that uses the FUNCTIONAL-updater form, so rapid
 * taps within one render frame each compose on the LATEST draft rather than a
 * stale closure snapshot (which dropped counts). Persist is derived from the new
 * value inside the updater (per-tap persistence, B.1/Y4); the save-error path is
 * preserved via onError (SC-K1). The count is never lost from in-memory state.
 *
 * FOLLOW-UP (tracked in Backlog): the persist side-effect runs INSIDE the setState
 * updater. Safe in RN's current legacy (non-concurrent) mode, but under StrictMode
 * or concurrent rendering the updater double-invokes → double persist/onSaved. Move
 * persist out of the updater before enabling either. Count integrity survives (serial
 * queue writes the same value); only phase/persist would fire twice.
 */
export function createTapHandler(deps: TapHandlerDeps): () => void {
  const { setDraft, persist, onSaved, onError } = deps;
  return () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const updated = tap(prev);
      void persist(updated).then(
        () => onSaved?.(),
        () => onError?.(),
      );
      return updated;
    });
  };
}

// ─── createUndoHandler() — rapid-undo fix (functional updater, mirrors tap) ────

/**
 * Same-class fix as createTapHandler for the −1 button. Uses the FUNCTIONAL-updater
 * form so rapid undos — and undos interleaved with queued taps — compose on the
 * LATEST draft instead of a stale closure snapshot (which dropped undos AND could
 * clobber composed tap counts). Floors at 0: at count 0 it is a no-op (no persist),
 * matching the button being disabled at 0. Persist/onSaved/onError mirror tap (SC-K1).
 */
export function createUndoHandler(deps: TapHandlerDeps): () => void {
  const { setDraft, persist, onSaved, onError } = deps;
  return () => {
    setDraft((prev) => {
      if (!prev || prev.movementCount === 0) return prev; // disabled at 0 — no write
      const updated = undo(prev);
      void persist(updated).then(
        () => onSaved?.(),
        () => onError?.(),
      );
      return updated;
    });
  };
}
