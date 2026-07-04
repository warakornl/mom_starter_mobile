/**
 * deleteFlowLogic — pure delete-gate state machine (§3, account-rights-behavior.md).
 *
 * Called when the user taps "Delete account" (confirm button, floor satisfied)
 * on the destructive confirm sheet. All side-effecting dependencies are injected
 * for full testability without a device.
 *
 * State machine transitions implemented (§3.2, exhaustive):
 *   STEPUP_CHECK
 *     ├─ level !== NONE → STEPUP_IN_FLIGHT → authenticate()
 *     │   ├─ success === true → DELETE_IN_FLIGHT → … (see below)
 *     │   ├─ non-success       → return auth_cancelled  (INVARIANT 3)
 *     │   └─ THROW             → STEPUP_AUTH_RETRY → retry authenticate()
 *     │       ├─ success === true  → DELETE_IN_FLIGHT
 *     │       ├─ non-success       → return auth_cancelled  (RULE 5 — not degraded)
 *     │       └─ THROW again       → return stepup_degraded (C-2 fail-open, TELEMETRY)
 *     ├─ level === NONE → DELETE_IN_FLIGHT (floor is sole gate)
 *     └─ THROW → STEPUP_PROBE_RETRY → retry getEnrolledLevel()
 *         ├─ returns level → re-apply predicate (blip cleared)
 *         └─ THROW again  → return stepup_degraded (C-2 fail-open, TELEMETRY)
 *
 *   DELETE_IN_FLIGHT → deleteAccountApi()
 *     ├─ ok: true (202)  → TEARDOWN → performLogout() → return delete_success  (INVARIANT 1)
 *     ├─ ok: false       → return delete_error  (INVARIANT 1 — no teardown)
 *     └─ THROW           → return delete_error  (network error, INVARIANT 1)
 *
 *   stepUpDegraded=true (C-2 already ratified for this session):
 *     → DELETE_IN_FLIGHT directly (floor is the sole gate; §3.2 last degrade-retap row)
 *
 * Critical invariants enforced (§3.3):
 *   (1) performLogout called ONLY after HTTP 202. Never on tap, cancel, or non-202.
 *   (2) Every non-success exit leaves account + data unchanged.
 *   (3) result.success === true is the ONLY pass for step-up.
 *   (4) DELETE_IN_FLIGHT emitted BEFORE calling deleteAccountApi → UI disables button.
 *   (5) Non-success NEVER degrades to floor (0f §2.5 rule 5 — prevents forced-fail bypass).
 *   (6) Type-to-confirm floor is always required — enforced by the CALLER before invoking.
 *   (8) THROW ≠ NONE ≠ non-success: THROW → retry → fail-open; non-success → cancel.
 */

import type { DeviceAuthAdapter } from './deviceAuthAdapter';
import { SECURITY_LEVEL_NONE } from './deviceAuthAdapter';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Intermediate machine states (fired via onStateChange so the UI can
 * disable/re-enable the confirm button — invariant 4).
 */
export type DeleteMachineState =
  | 'STEPUP_CHECK'
  | 'STEPUP_PROBE_RETRY'
  | 'STEPUP_IN_FLIGHT'
  | 'STEPUP_AUTH_RETRY'
  | 'DELETE_IN_FLIGHT'
  | 'TEARDOWN';

/**
 * Terminal outcome returned by `runDeleteGate()`.
 *
 * UI/hook maps this to the next screen state:
 *   delete_success  → performLogout already ran; navigate to S1.
 *   auth_cancelled  → return to CONFIRM_OPEN; floor stays satisfied (M-4).
 *   stepup_degraded → return to CONFIRM_OPEN with stepUpDegraded=true;
 *                     show non-alarming cancel-and-retry notice (C-2, §2.5).
 *   delete_error    → show DELETE_ERROR; calm Retry; stays signed in.
 */
export type DeleteGateOutcome =
  | { outcome: 'delete_success' }
  | { outcome: 'auth_cancelled' }
  | { outcome: 'stepup_degraded'; throwSite: 'probe' | 'authenticate' }
  | { outcome: 'delete_error'; code: string };

/**
 * Telemetry payload for C-2 degrade events.
 *
 * STRICT constraint (0f §2.5 rule 3, AR-AC-26):
 *   MUST contain ONLY error-class, platform, and throw-site.
 *   NO PII, NO health data, NO user-id, NO error message content.
 */
export interface DegradeTelemetryData {
  /** Constructor name of the thrown error (e.g. 'Error', 'TypeError'). Not the message. */
  errorClass: string;
  /** Device platform string (e.g. 'ios', 'android', 'unknown'). Not user-identifiable. */
  platform: string;
  /** Which step threw: 'probe' = getEnrolledLevelAsync, 'authenticate' = authenticateAsync. */
  throwSite: 'probe' | 'authenticate';
}

/** Injectable dependencies for `runDeleteGate`. */
export interface RunDeleteGateDeps {
  /**
   * When true: a prior C-2 throw-degrade occurred this session.
   * The caller re-tapped confirm after seeing the non-alarming notice.
   * Skip step-up; go directly to DELETE (§3.2).
   */
  stepUpDegraded: boolean;

  /** Injectable device-auth adapter. Tests inject createMockDeviceAuthAdapter(). */
  deviceAuth: DeviceAuthAdapter;

  /**
   * Calls DELETE /v1/account; returns { ok: true } on 202, { ok: false } otherwise.
   * Tests inject a mock. Production wires accountApiClient.deleteAccount.
   * MAY THROW on network-level failures — treated as delete_error (§3.2).
   */
  deleteAccountApi: (token: string) => Promise<{ ok: true } | { ok: false; code: string }>;

  /**
   * Runs teardown (clear tokens + ALL health stores) and navigates to S1.
   * Called ONLY after HTTP 202 (invariant 1). Tests inject a spy.
   * If this throws, complete teardown best-effort and still return delete_success (E-18).
   */
  performLogout: () => Promise<void>;

  /**
   * Emits a C-2 degrade telemetry event.
   * Receives ONLY DegradeTelemetryData — no PII, no health, no user-id.
   */
  telemetry: (event: string, data: DegradeTelemetryData) => void;

  /** Returns the current Bearer access token for the DELETE call. NEVER logged. */
  getToken: () => string;

  /**
   * Message shown to the user in the biometric/passcode dialog.
   * Default: 'Confirm delete account'. Pass localized string from UI.
   */
  promptMessage?: string;

  /**
   * Callback fired on each intermediate state transition.
   * Drives the UI to disable/re-enable the confirm button (invariant 4).
   */
  onStateChange?: (state: DeleteMachineState) => void;

  /**
   * Async sleep function — injectable so tests skip the 250 ms C-2 backoff.
   * Default: real 250 ms setTimeout-based sleep.
   * Tests inject: `async (_ms: number) => {}` (no-op).
   */
  sleepMs?: (ms: number) => Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PROMPT_MESSAGE = 'Confirm delete account';
const C2_BACKOFF_MS = 250;
const PROBE_TELEMETRY_EVENT = 'delete_stepup_probe_throw_degraded';
const AUTH_TELEMETRY_EVENT = 'delete_stepup_authenticate_throw_degraded';

// ─── Private helpers ──────────────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts the constructor name of an error WITHOUT capturing any message content.
 * The message may contain PII (e.g. user-submitted strings that leaked into an error).
 * We take ONLY the class name — safe to include in telemetry per AR-AC-26.
 */
function getErrorClass(e: unknown): string {
  if (e instanceof Error) return e.constructor.name || 'Error';
  if (typeof e === 'string') return 'StringError';
  return 'UnknownError';
}

/** Resolves platform without any user-identifiable data. */
function resolvePlatform(): string {
  // EXPO_OS is set by the Expo runtime (ios | android | web).
  // In Jest (Node.js) it is undefined → 'unknown'.
  if (typeof process !== 'undefined' && process.env['EXPO_OS']) {
    return process.env['EXPO_OS'];
  }
  return 'unknown';
}

// ─── State machine ────────────────────────────────────────────────────────────

/**
 * runDeleteGate — drives step-up → DELETE → teardown for one confirm-button tap.
 *
 * Pre-condition (caller enforces): the type-to-confirm floor is already satisfied.
 * This function NEVER removes the floor gate — it only runs the step-up and DELETE
 * logic on top of an already-satisfied floor.
 *
 * @returns Terminal DeleteGateOutcome.
 */
export async function runDeleteGate(deps: RunDeleteGateDeps): Promise<DeleteGateOutcome> {
  const {
    stepUpDegraded,
    deviceAuth,
    deleteAccountApi,
    performLogout,
    telemetry,
    getToken,
    promptMessage = DEFAULT_PROMPT_MESSAGE,
    onStateChange,
    sleepMs = defaultSleep,
  } = deps;

  // ── Step-up gate ─────────────────────────────────────────────────────────────
  if (!stepUpDegraded) {
    // STEPUP_CHECK: evaluate the enrolled security level.
    onStateChange?.('STEPUP_CHECK');

    let level: number;
    try {
      level = await deviceAuth.getEnrolledLevel();
    } catch (e1) {
      // First probe throw → STEPUP_PROBE_RETRY: wait C2_BACKOFF_MS then retry once.
      onStateChange?.('STEPUP_PROBE_RETRY');
      await sleepMs(C2_BACKOFF_MS);
      try {
        level = await deviceAuth.getEnrolledLevel();
        // Retry succeeded (blip cleared — common case). Fall through to predicate below.
      } catch (e2) {
        // Retry threw again → C-2 fail-OPEN to floor (NON-SILENT).
        // INVARIANT 8: THROW ≠ NONE — do NOT collapse into NONE path.
        telemetry(PROBE_TELEMETRY_EVENT, {
          errorClass: getErrorClass(e2),
          platform: resolvePlatform(),
          throwSite: 'probe',
        });
        // No DELETE, no teardown. Caller shows non-alarming notice + sets stepUpDegraded=true.
        return { outcome: 'stepup_degraded', throwSite: 'probe' };
      }
    }

    // Step-up predicate (I-1, enum-agnostic / fail-safe):
    //   level !== NONE → enrolled device → step-up required.
    //   level === NONE → floor is the sole gate → skip step-up.
    //
    // [verify-current-docs] SDK-51 SecurityLevel enum values (confirmed from @14.0.1 types):
    //   NONE = 0, SECRET = 1, BIOMETRIC_WEAK = 2, BIOMETRIC_STRONG = 3.
    //   BIOMETRIC (= 2, deprecated alias) — DO NOT compare by name; use numeric predicate.
    //   Any non-zero level (biometric of any strength OR device passcode/PIN) → step-up.
    if (level !== SECURITY_LEVEL_NONE) {
      // STEPUP_IN_FLIGHT: authenticate running; confirm button must be disabled (invariant 4).
      onStateChange?.('STEPUP_IN_FLIGHT');

      let authResult: { success: boolean; error?: string };
      try {
        authResult = await deviceAuth.authenticate(promptMessage);
      } catch (e1) {
        // First authenticate throw → STEPUP_AUTH_RETRY.
        onStateChange?.('STEPUP_AUTH_RETRY');
        await sleepMs(C2_BACKOFF_MS);
        try {
          authResult = await deviceAuth.authenticate(promptMessage);
          // Retry returned a result — fall through to success check below.
        } catch (e2) {
          // Retry threw again → C-2 fail-OPEN (NON-SILENT). Same policy as probe.
          telemetry(AUTH_TELEMETRY_EVENT, {
            errorClass: getErrorClass(e2),
            platform: resolvePlatform(),
            throwSite: 'authenticate',
          });
          return { outcome: 'stepup_degraded', throwSite: 'authenticate' };
        }
      }

      // INVARIANT 3 (critical): result.success === true is the ONLY pass.
      // All non-success outcomes (user_cancel / system_cancel / app_cancel /
      // user_fallback / lockout / authentication_failed) → cancel = no delete.
      // INVARIANT 8 / RULE 5: non-success is NOT a throw and MUST NOT degrade to floor.
      // A forced biometric-fail must NOT reach the floor-skip path.
      if (!authResult.success) {
        return { outcome: 'auth_cancelled' };
      }
      // authResult.success === true → proceed to DELETE.
    }
    // level === NONE → floor is sole gate; no step-up; proceed directly to DELETE.
  }
  // stepUpDegraded === true → C-2 degrade already ratified for this session;
  // floor (already satisfied, enforced by caller) is the sole gate; skip step-up.

  // ── DELETE ───────────────────────────────────────────────────────────────────
  // INVARIANT 4 (anti double-fire): emit DELETE_IN_FLIGHT BEFORE calling the API.
  // The UI must disable the confirm button for the entire in-flight window and
  // only re-enable it when a non-success outcome is returned.
  onStateChange?.('DELETE_IN_FLIGHT');

  let deleteResult: { ok: true } | { ok: false; code: string };
  try {
    deleteResult = await deleteAccountApi(getToken());
  } catch {
    // Network-level throw (offline, timeout, bridge error) → DELETE_ERROR.
    // INVARIANT 1: NO teardown, NO sign-out, NO local clear. Stays signed in.
    return { outcome: 'delete_error', code: 'network_error' };
  }

  if (!deleteResult.ok) {
    // Non-202 status (5xx, 4xx, timeout-after-network-reply) → DELETE_ERROR.
    // INVARIANT 1: NO teardown. Stays signed in, data intact.
    return { outcome: 'delete_error', code: deleteResult.code };
  }

  // ── HTTP 202 → TEARDOWN ──────────────────────────────────────────────────────
  // INVARIANT 1 (CRITICAL): performLogout is called HERE AND ONLY HERE — after 202.
  // This is the ONLY place in the codebase where teardown is triggered by delete.
  // Never on the tap, never on step-up, never on a non-202, never on cancel.
  onStateChange?.('TEARDOWN');
  try {
    await performLogout();
  } catch {
    // E-18: if performLogout throws mid-teardown, still navigate to S1.
    // The account is gone server-side; leaving her "signed in" is worse than a partial
    // logout. Tokens are best-effort cleared; the UI navigates to S1 via delete_success.
    // Log this locally without PII — not surfaced to the user.
  }

  return { outcome: 'delete_success' };
}
