/**
 * profileEditLogic — pure outcome-resolution functions for the edit-pregnancy-profile flow.
 *
 * All functions are pure (no side effects, no network, no navigation) so they are
 * fully unit-testable without a React or navigation environment.
 *
 * These functions drive ProfileEditScreen's state machine:
 *
 *   Entry GET outcome:
 *     null              → loading       (GET in flight — AC-18)
 *     200 + pregnant    → show-form     (happy path — AC-4/AC-5/AC-6)
 *     200 + other       → guard-not-editable (backstop — §2.5)
 *     404               → not-found    (AC-14)
 *     401               → session-expired   (AC-13, SD-5)
 *     5xx / network     → error (retryable) (§7)
 *
 *   PUT outcome:
 *     200/201 ok        → saved         (AC-7 — caller does goBack; no reset)
 *     401               → session-expired   (AC-13, SD-5)
 *     409               → conflict      (AC-10 — reload form to latest profile)
 *     422               → validation
 *     403 consent_req   → consent-required
 *     428               → precondition
 *     other             → generic-error
 *
 *   No-token (GET or PUT):
 *     missing token     → session-expired (AC-13, SD-5 — same teardown as server 401)
 *
 * Security:
 *   'session-expired' outcome MUST be handled by running the full performLogout teardown
 *   (clearTokens + ALL health stores) THEN navigating to Welcome. The caller (ProfileEditScreen,
 *   wired by RootNavigator) is responsible for this — it receives an `onSessionExpired` prop
 *   that routes through `buildSessionExpiredRunner` / `performLogout`.
 *   See RootNavigator.tsx (L242-257) and sessionExpiredRunner.ts.
 *
 * AC-9: no reanchor() on save — EDD edits do not touch reminder anchoring (§4.2).
 */

import type { GetProfileResult, PutProfileResult, PregnancyProfile } from './types';
import type { Lifecycle } from './types';

// ─── Outcome types ────────────────────────────────────────────────────────────

/** Outcome of resolving a GET /v1/pregnancy-profile result for the edit host. */
export type EditGetOutcome =
  | { type: 'loading' }
  | { type: 'show-form'; profile: PregnancyProfile }
  | { type: 'session-expired' }
  | { type: 'not-found' }
  | { type: 'guard-not-editable' }
  | { type: 'error'; retryable: true };

/** Outcome of resolving a PUT /v1/pregnancy-profile result for the edit host. */
export type EditPutOutcome =
  | { type: 'saved'; profile: PregnancyProfile }
  | { type: 'session-expired' }
  | { type: 'conflict'; currentProfile: PregnancyProfile | null }
  | { type: 'validation' }
  | { type: 'consent-required' }
  | { type: 'precondition' }
  | { type: 'generic-error' };

/** Outcome when no token is available (applies to both GET and PUT pre-flight). */
export type EditNoTokenOutcome = { type: 'session-expired' };

// ─── AC-2: Settings row visibility ───────────────────────────────────────────

/**
 * AC-2 — "shown iff lifecycle === 'pregnant'".
 *
 * Fail-closed: null / undefined / unknown / postpartum / ended all return false.
 * Postpartum: EDD editing is meaningless (§2.2).
 * Ended: absence is the kindest state (§2.3 emotional harm guard).
 * Unknown/not-loaded: never show a row that would 404 on tap (§1.2).
 */
export function shouldShowEditPregnancyRow(
  lifecycle: Lifecycle | null | undefined,
): boolean {
  return lifecycle === 'pregnant';
}

// ─── AC-18 + AC-13 + AC-14: GET outcome resolver ─────────────────────────────

/**
 * Resolve the outcome of a GET /v1/pregnancy-profile call during edit entry.
 *
 * Accepts `null` to represent the in-flight loading state (AC-18).
 *
 * AC-13 (BLOCKING): status 401 → 'session-expired' (both no-token and server-401
 * use resolveEditNoTokenOutcome() and this function respectively — see §7.1).
 */
export function resolveEditGetOutcome(
  result: GetProfileResult | null,
): EditGetOutcome {
  if (result === null) {
    return { type: 'loading' };
  }

  if (!result.ok) {
    if (result.status === 401) return { type: 'session-expired' };
    if (result.status === 404) return { type: 'not-found' };
    return { type: 'error', retryable: true };
  }

  // 200 — check lifecycle
  const { profile } = result;
  if (profile.lifecycle !== 'pregnant') {
    return { type: 'guard-not-editable' };
  }

  return { type: 'show-form', profile };
}

// ─── AC-13 + AC-7 + AC-10: PUT outcome resolver ──────────────────────────────

/**
 * Resolve the outcome of a PUT /v1/pregnancy-profile call during edit save.
 *
 * AC-13 (BLOCKING): status 401 (server-returned) → 'session-expired'.
 * AC-10 (R-3): status 409 → 'conflict' with currentProfile from body (G-4).
 * AC-7 (R-2): ok=true → 'saved'; caller must do goBack(), NOT reset-to-Home.
 * AC-9: 'saved' carries NO reanchor/reschedule field (§4.2 explicit NON-ripple).
 *
 * Note: PutProfileResult is extended (types.ts + pregnancyApiClient.ts) to carry
 * `currentProfile: PregnancyProfile | null` on the 409 variant (G-4).
 */
export function resolveEditPutOutcome(result: PutProfileResult): EditPutOutcome {
  if (result.ok) {
    // AC-7: goBack (not reset). AC-9: no reanchor field.
    return { type: 'saved', profile: result.profile };
  }

  if (result.status === 401) {
    return { type: 'session-expired' };
  }

  if (result.status === 409) {
    // G-4: currentProfile is now parsed from the 409 body by pregnancyApiClient.
    const currentProfile =
      (result as { currentProfile?: PregnancyProfile | null }).currentProfile ?? null;
    return { type: 'conflict', currentProfile };
  }

  if (result.status === 422) return { type: 'validation' };
  if (result.status === 403 && result.code === 'consent_required') {
    return { type: 'consent-required' };
  }
  if (result.status === 428) return { type: 'precondition' };

  return { type: 'generic-error' };
}

// ─── AC-13: No-token resolver (shared for GET and PUT pre-flight) ─────────────

/**
 * Resolves the outcome when the token storage has no token.
 *
 * AC-13 (BLOCKING): missing token = expired session → 'session-expired'.
 * Applies to both GET pre-flight (edit host before calling getProfile) and
 * PUT pre-flight (ProfileSetupScreen.handleSave before calling putProfile).
 *
 * The caller must handle 'session-expired' by invoking onSessionExpired() which
 * runs buildSessionExpiredRunner (clearTokens + ALL health stores + navigate to Welcome).
 * SD-5: a missing token means the session is dead — leaving the user on an
 * authenticated screen with health stores populated risks cross-account PHI leak.
 */
export function resolveEditNoTokenOutcome(): EditNoTokenOutcome {
  return { type: 'session-expired' };
}
