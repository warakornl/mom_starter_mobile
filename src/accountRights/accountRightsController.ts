/**
 * accountRightsController — pure testable decision logic for the Account Rights UI.
 *
 * This module contains ONLY pure functions (no React, no RN, no I/O).
 * All decision points that are hard to test in a mounted screen component are
 * extracted here so they can be covered by fast unit tests (accountRightsController.test.ts).
 *
 * Three behaviors covered:
 *   1. 401-routing decision: export/delete 401 → session-expired, not EXPORT_ERROR
 *   2. nudge-return-to-confirm: any export outcome from the nudge → CONFIRM_OPEN
 *   3. synchronous-disable guard (E-13): second confirm-tap is suppressed before re-render
 *
 * @see account-rights-behavior.md §2.3 (export 401), §3.2 (delete 401),
 *      §3.9 / AR-AC-19 (nudge return), §3.3(4) / E-13 (double-tap guard)
 */

import type { ExportOutcome } from './exportOrchestration';
import type { ExportAccountResult, DeleteAccountResult } from './accountApiClient';

// ─── Session-expired sentinel ──────────────────────────────────────────────────

/**
 * Sentinel error code returned by the session-aware API wrappers (injected into
 * runExport / runDeleteGate) when the server responds with HTTP 401.
 *
 * On seeing this code the screen calls `onSessionExpired()` (→ S1) rather than
 * surfacing an export/delete error card (§2.3 E-20, §3.2 E-21).
 *
 * Never shown to the user.  Never logged with PII.
 */
export const SESSION_EXPIRED_CODE = 'session_expired';

/**
 * Returns true iff the given error code is the session-expired sentinel.
 * Used by both the export outcome handler and the delete outcome handler.
 */
export function isSessionExpiredCode(code: string): boolean {
  return code === SESSION_EXPIRED_CODE;
}

// ─── Export outcome resolution ────────────────────────────────────────────────

/**
 * Result tags returned by resolveExportOutcome — the screen maps each to state.
 *
 *   session_expired  — call onSessionExpired() → navigate to S1 (§2.3 E-20)
 *   restore_confirm  — nudge export ended; restore delete confirm sheet (§3.9, AR-AC-19)
 *   show_error       — surface EXPORT_ERROR card (§2.3)
 *   show_404         — surface EXPORT_UNAVAILABLE_404 notice (§2.5)
 *   set_idle         — silently return to EXPORT_IDLE (success or nav-away abort)
 */
export type ExportOutcomeAction =
  | 'session_expired'
  | 'restore_confirm'
  | 'show_error'
  | 'show_404'
  | 'set_idle';

/**
 * Pure decision function: maps an ExportOutcome + context to a screen action.
 *
 * @param outcome   - the terminal result from runExport()
 * @param fromNudge - true when the export was launched from the delete-sheet nudge
 *
 * Logic:
 *   - 401 (SESSION_EXPIRED_CODE) → session_expired regardless of nudge context
 *   - nudge context, any non-401 → restore_confirm (AR-AC-15/19 — floor text intact)
 *   - EXPORT_ERROR               → show_error
 *   - EXPORT_UNAVAILABLE_404     → show_404
 *   - EXPORT_IDLE                → set_idle  (success or aborted nav-away)
 */
export function resolveExportOutcome(
  outcome: ExportOutcome,
  fromNudge: boolean,
): ExportOutcomeAction {
  // 401 always overrides nudge context — the session is gone, must sign out.
  if (outcome.phase === 'EXPORT_ERROR' && isSessionExpiredCode(outcome.error)) {
    return 'session_expired';
  }

  // Nudge context: ANY non-401 outcome → return to confirm (AR-AC-15/19).
  // The user is never auto-advanced into delete and never left stranded.
  if (fromNudge) {
    return 'restore_confirm';
  }

  // Normal (non-nudge) export outcomes:
  if (outcome.phase === 'EXPORT_ERROR') return 'show_error';
  if (outcome.phase === 'EXPORT_UNAVAILABLE_404') return 'show_404';
  return 'set_idle'; // EXPORT_IDLE: success (OS share sheet resolved) or nav-away abort
}

// ─── Synchronous double-tap guard (E-13) ──────────────────────────────────────

/**
 * Result tags from acquireDeleteLock.
 *   acquired      — this is the first tap; the lock is now held; proceed with gate
 *   already_locked — a prior tap is still in-flight; suppress this one (E-13)
 */
export type LockResult = 'acquired' | 'already_locked';

/**
 * Attempts to acquire the delete-confirm in-flight lock SYNCHRONOUSLY.
 *
 * CRITICAL (E-13, 0f rule 2b, AR-AC-16):
 *   The lock is set synchronously (ref mutation, not setState) so that a rapid
 *   double-tap is suppressed immediately — before React's next render cycle, before
 *   any awaited microtask, and before `runDeleteGate` is called.
 *
 *   Using a React ref (useRef) rather than state ensures the mutation is visible to
 *   the NEXT call on the SAME synchronous call stack, which a state update cannot
 *   guarantee in concurrent mode.
 *
 * @param ref  - a { current: boolean } mutable ref (from useRef<boolean>(false))
 * @returns 'acquired' if this call owns the lock; 'already_locked' if not
 */
export function acquireDeleteLock(ref: { current: boolean }): LockResult {
  if (ref.current) {
    return 'already_locked'; // second tap — suppress; no state change
  }
  ref.current = true; // set SYNCHRONOUSLY before any async work
  return 'acquired';
}

/**
 * Releases the delete-confirm lock after runDeleteGate returns a terminal outcome.
 *
 * Called when:
 *   - auth_cancelled → button re-enables immediately (M-4)
 *   - stepup_degraded → show notice; button re-enables (C-2)
 *   - delete_error → show error; button re-enables for Retry
 *   - delete_success → screen tears down; release is academic but correct
 *
 * NOT called during DELETE_IN_FLIGHT (button stays disabled until outcome arrives).
 *
 * @param ref - the same ref passed to acquireDeleteLock
 */
export function releaseDeleteLock(ref: { current: boolean }): void {
  ref.current = false;
}

// ─── 401 mappers — pure functions extracted for testability (I-2) ─────────────

/**
 * Pure 401 mapper for the export endpoint.
 *
 * Maps a raw ExportAccountResult: if the HTTP status is 401 the result is replaced
 * by the session-expired sentinel WITHOUT a `message` field, so that downstream
 * `message ?? code` always resolves to SESSION_EXPIRED_CODE (not a stale server
 * message from the raw response).
 *
 * Every other result (200 ok, 404, 5xx, timeout, network, aborted) passes through
 * UNCHANGED — the mapper must not alter non-401 results.
 *
 * @see account-rights-behavior.md §2.3 E-20
 */
export function mapExport401(result: ExportAccountResult): ExportAccountResult {
  if (!result.ok && result.status === 401) {
    // Return without a message field so `message ?? code` resolves to session_expired.
    return { ok: false, status: 401, code: SESSION_EXPIRED_CODE };
  }
  return result;
}

/**
 * The simplified shape that `runDeleteGate.deleteAccountApi` accepts.
 * Message is intentionally absent: callers key on `code` alone for routing.
 */
export type MappedDeleteResult = { ok: true } | { ok: false; code: string };

/**
 * Pure 401 mapper for the delete endpoint.
 *
 * Normalises a raw DeleteAccountResult to the simpler shape that `runDeleteGate`
 * expects (`{ ok: true } | { ok: false; code: string }`):
 *   - 401          → `{ ok: false, code: SESSION_EXPIRED_CODE }` (no message — prevents
 *                     stale message leaking to the downstream `message ?? code` resolver)
 *   - ok: true     → `{ ok: true }`
 *   - any other err → `{ ok: false, code: result.code }` (status + message stripped)
 *
 * @see account-rights-behavior.md §3.2 E-21
 */
export function mapDelete401(result: DeleteAccountResult): MappedDeleteResult {
  if (result.ok) return { ok: true };
  if (result.status === 401) {
    // Return without message so `message ?? code` resolves to SESSION_EXPIRED_CODE.
    return { ok: false, code: SESSION_EXPIRED_CODE };
  }
  return { ok: false, code: result.code };
}
