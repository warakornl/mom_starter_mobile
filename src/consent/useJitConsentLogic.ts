/**
 * useJitConsentLogic — pure state-transition helpers for useJitConsent hook.
 *
 * Extracted so they can be unit-tested without React or React Native imports.
 *
 * Design ref: first-run-consent.md §3.2, §4.7
 * No React imports — fully testable in node environment.
 */

// ─── JIT hook state ───────────────────────────────────────────────────────────

export interface JitState {
  /** True while the POST /account/consents is in flight */
  isLoading: boolean;
  /** Non-null when the last POST failed (shows error panel in sheet) */
  error: string | null;
  /**
   * Whether the parental attestation checkbox has been ticked.
   * ALWAYS starts false (PDPA ม.20 — affirmative action required).
   * Relevant only for infant_feeding and child_health.
   */
  parentalAttested: boolean;
  /**
   * True when user tapped Decline / "Not now" / "Hide notes".
   * Used to show the inline blocked message in place of the feature trigger.
   */
  declined: boolean;
}

// ─── Initializer ─────────────────────────────────────────────────────────────

/**
 * Returns the initial JIT state.
 *
 * PDPA ม.20 — parentalAttested is ALWAYS false on init.
 * The checkbox must be ticked by the user; it is NEVER pre-ticked.
 */
export function initialJitState(): JitState {
  return {
    isLoading:       false,
    error:           null,
    parentalAttested: false,
    declined:        false,
  };
}

// ─── State transitions ────────────────────────────────────────────────────────

/**
 * Returns new state after a successful POST granted:true.
 * Clears loading, clears error, clears declined flag.
 */
export function applyGrantSuccess(prev: JitState): JitState {
  return {
    ...prev,
    isLoading: false,
    error:     null,
    declined:  false,
  };
}

/**
 * Returns new state after a POST failure.
 * Stops loading, sets the error message, preserves everything else.
 */
export function applyGrantError(prev: JitState, message: string): JitState {
  return {
    ...prev,
    isLoading: false,
    error:     message,
  };
}

/**
 * Returns new state when the user taps Decline / "Not now" / "Hide notes".
 * Sets declined=true; clears loading and error (no POST is made on decline).
 */
export function applyDecline(prev: JitState): JitState {
  return {
    ...prev,
    isLoading: false,
    error:     null,
    declined:  true,
  };
}

/**
 * Returns new state when POST is about to be dispatched.
 */
export function applyPostStart(prev: JitState): JitState {
  return {
    ...prev,
    isLoading: true,
    error:     null,
  };
}

/**
 * Returns new state when the user taps "Try again" after a decline.
 *
 * Spec §4: decline must be frictionless AND re-armable — the user can try
 * again without remounting. This resets `declined` so the consent sheet
 * appears again. Does NOT optimistically grant consent.
 *
 * PDPA ม.19: withdrawal (and decline) as easy as granting.
 */
export function applyRearm(prev: JitState): JitState {
  return {
    ...prev,
    declined:  false,
    isLoading: false,
    error:     null,
  };
}
