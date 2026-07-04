/**
 * DeviceAuthAdapter — thin wrapper over expo-local-authentication native API.
 *
 * Pattern mirrors notificationsAdapter.ts:
 *   - Pure `DeviceAuthAdapter` interface — the seam pure logic depends on.
 *   - `createMockDeviceAuthAdapter(config)` — fully injectable mock for Jest.
 *   - `createRealDeviceAuthAdapter()` — production impl using dynamic require
 *     so the module is importable in Node.js / Jest without crashing.
 *
 * Security (0f §2.5, AR-AC-10):
 *   The step-up predicate in `deleteFlowLogic.ts` is:
 *     `level !== SECURITY_LEVEL_NONE`  → step-up required
 *     `level === SECURITY_LEVEL_NONE`  → floor is the sole gate
 *
 *   NEVER compare against SecurityLevel.BIOMETRIC — SDK-51 deprecates that
 *   member in favour of BIOMETRIC_WEAK (= 2) and BIOMETRIC_STRONG (= 3);
 *   an equality check on a possibly-undefined/renamed member would mis-route
 *   a real enrolled device to the floor-only path (spec I-1, 0f §2.5 rule 5).
 *
 *   [verify-current-docs] expo-local-authentication@14.0.1 SecurityLevel values
 *   confirmed from package types:
 *     NONE = 0, SECRET = 1, BIOMETRIC_WEAK = 2, BIOMETRIC_STRONG = 3.
 *   BIOMETRIC (= 2) is a deprecated alias for BIOMETRIC_WEAK — DO NOT compare.
 *
 * iOS: NSFaceIDUsageDescription must be declared in app.json (see app.json).
 * [verify-current-docs] authenticateAsync({disableDeviceFallback:false}) on
 *   passcode-only devices (no biometric) must be verified on-device (Phase 1):
 *   confirm it prompts the device passcode and returns success on iOS + Android.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The integer value of SecurityLevel.NONE from expo-local-authentication.
 *
 * Used as the sole reference point for the enum-agnostic step-up predicate:
 *   `level !== SECURITY_LEVEL_NONE` → enrolled (step-up required)
 *   `level === SECURITY_LEVEL_NONE` → not enrolled (floor is the sole gate)
 *
 * This integer (0) is stable across all known SDK-51 builds of the package.
 * [verify-current-docs] SDK-51 enum: NONE=0, SECRET=1, BIOMETRIC_WEAK=2,
 * BIOMETRIC_STRONG=3. Predicate is correct regardless of BIOMETRIC member naming.
 */
export const SECURITY_LEVEL_NONE = 0;

// ─── Interface (mockable seam) ────────────────────────────────────────────────

/**
 * Mockable seam for expo-local-authentication.
 * Pure delete-flow state machine logic (`deleteFlowLogic.ts`) depends only on
 * this interface — never on the native module directly.
 */
export interface DeviceAuthAdapter {
  /**
   * Returns the enrolled security level of the device.
   * Wraps `getEnrolledLevelAsync()` from expo-local-authentication.
   *
   * Return values (matching SecurityLevel):
   *   0 (NONE)             — no biometric or passcode enrolled
   *   1 (SECRET)           — device passcode / PIN / pattern enrolled
   *   2 (BIOMETRIC_WEAK)   — weak biometric (e.g. 2D face scan)
   *   3 (BIOMETRIC_STRONG) — strong biometric (fingerprint, 3D face)
   *
   * MAY THROW on transient native errors (bridge stall, module unavailable).
   * Callers MUST apply the C-2 retry policy (§2.5, deleteFlowLogic.ts).
   * A THROW is NOT equivalent to returning NONE — do not silently collapse them.
   */
  getEnrolledLevel(): Promise<number>;

  /**
   * Requests biometric or device-passcode authentication from the user.
   * Wraps `authenticateAsync({ disableDeviceFallback: false })`.
   *
   * `disableDeviceFallback: false` — prefer biometric; device passcode is the
   * OS fallback. Setting this to true would block passcode-only devices (§3.5).
   *
   * Returns:
   *   { success: true }               — authentication passed
   *   { success: false, error: "…" }  — any non-success outcome:
   *     user_cancel / system_cancel / app_cancel / user_fallback /
   *     lockout / authentication_failed
   *
   * IMPORTANT: non-success is NOT a throw. A non-success result means
   * "cancel = no delete" and MUST NOT degrade to the floor (0f §2.5 rule 5).
   * A THROW triggers the C-2 retry → degrade path. These are distinct cases.
   *
   * MAY THROW on transient native errors. Callers apply C-2 retry policy.
   *
   * @param promptMessage - Shown to the user in the biometric/passcode dialog.
   */
  authenticate(promptMessage: string): Promise<{ success: boolean; error?: string }>;
}

// ─── Mock adapter (for unit tests) ───────────────────────────────────────────

/** Config for createMockDeviceAuthAdapter. */
export interface MockDeviceAuthConfig {
  /**
   * The SecurityLevel integer to return from getEnrolledLevel().
   * Default: SECURITY_LEVEL_NONE (0).
   * Overridden by getEnrolledLevelImpl if both are provided.
   */
  enrolledLevel?: number;

  /**
   * Custom implementation for getEnrolledLevel().
   * Allows simulating throws (C-2 native error scenarios).
   * Takes priority over enrolledLevel.
   */
  getEnrolledLevelImpl?: () => Promise<number>;

  /**
   * Custom implementation for authenticate().
   * Allows full control including throws.
   * Takes priority over authSuccess / authError.
   */
  authenticateImpl?: (promptMessage: string) => Promise<{ success: boolean; error?: string }>;

  /**
   * Shorthand: when true, authenticate() resolves { success: true }.
   * Used by: getEnrolledLevelImpl / authenticateImpl absent.
   */
  authSuccess?: boolean;

  /**
   * Shorthand: the error string on non-success authenticate().
   * Default: 'user_cancel'. Used when authSuccess is not true.
   */
  authError?: string;
}

/**
 * Creates a mock DeviceAuthAdapter for unit tests.
 *
 * All behaviors are injectable via `config`. No native modules are touched.
 *
 * @example
 * // Enrolled device, auth succeeds:
 * const mock = createMockDeviceAuthAdapter({ enrolledLevel: 3, authSuccess: true });
 *
 * // NONE device (floor only):
 * const mock = createMockDeviceAuthAdapter({ enrolledLevel: 0 });
 *
 * // Simulating C-2 probe throw:
 * const mock = createMockDeviceAuthAdapter({
 *   getEnrolledLevelImpl: async () => { throw new Error('native error'); },
 * });
 */
export function createMockDeviceAuthAdapter(config: MockDeviceAuthConfig): DeviceAuthAdapter {
  return {
    async getEnrolledLevel(): Promise<number> {
      if (config.getEnrolledLevelImpl) {
        return config.getEnrolledLevelImpl();
      }
      return config.enrolledLevel ?? SECURITY_LEVEL_NONE;
    },

    async authenticate(promptMessage: string): Promise<{ success: boolean; error?: string }> {
      if (config.authenticateImpl) {
        return config.authenticateImpl(promptMessage);
      }
      if (config.authSuccess === true) {
        return { success: true };
      }
      return { success: false, error: config.authError ?? 'user_cancel' };
    },
  };
}

// ─── Real adapter (expo-local-authentication) ─────────────────────────────────

/**
 * Creates the production DeviceAuthAdapter backed by expo-local-authentication.
 *
 * Uses dynamic require (like pdfService.ts / notificationsAdapter.ts) so that
 * this module remains importable in Jest / Node.js without crashing on the
 * native module.  Do NOT import this function in test files.
 *
 * [verify-current-docs] expo-local-authentication@14.0.1 SDK-51:
 *   getEnrolledLevelAsync() → Promise<SecurityLevel> (integer 0–3)
 *   authenticateAsync({ disableDeviceFallback: false }) → Promise<LocalAuthenticationResult>
 *   LocalAuthenticationResult = { success: true } | { success: false; error: string }
 *
 * Phase-1 on-device checks required:
 *   - Confirm getEnrolledLevelAsync() returns the expected level on test devices.
 *   - Confirm authenticateAsync({disableDeviceFallback:false}) prompts passcode
 *     on passcode-only (no biometric) iOS + Android devices and returns success.
 *   - Confirm BIOMETRIC_STRONG (= 3) is returned on fingerprint/3D-face devices.
 */
export function createRealDeviceAuthAdapter(): DeviceAuthAdapter {
  // Dynamic require keeps Jest from blowing up on the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const LocalAuth = require('expo-local-authentication') as typeof import('expo-local-authentication');

  return {
    async getEnrolledLevel(): Promise<number> {
      // Returns SecurityLevel enum value: 0=NONE, 1=SECRET, 2=BIOMETRIC_WEAK, 3=BIOMETRIC_STRONG.
      // [verify-current-docs] SDK-51: getEnrolledLevelAsync() returns SecurityLevel integer.
      // The returned value is used with the enum-agnostic predicate: level !== SECURITY_LEVEL_NONE.
      return LocalAuth.getEnrolledLevelAsync();
    },

    async authenticate(promptMessage: string): Promise<{ success: boolean; error?: string }> {
      // disableDeviceFallback: false → prefer biometric; device passcode is OS fallback.
      // This allows passcode-only devices (SECRET level) to pass step-up (§3.5).
      // [verify-current-docs] Verify on real passcode-only device that passcode prompt
      //   appears and success is returned (Phase-1 gate — 0f §3 checklist step 2).
      const result = await LocalAuth.authenticateAsync({
        promptMessage,
        disableDeviceFallback: false,
      });
      if (result.success) {
        return { success: true };
      }
      // result.success === false: error contains the non-success reason string.
      // This is NOT a throw — caller must NOT degrade to floor for non-success (rule 5).
      return { success: false, error: result.error };
    },
  };
}
