/**
 * jitConsentLogic — pure logic for JIT (just-in-time) consent gates.
 *
 * Design ref: first-run-consent.md §3.2, §4.7
 * Copy ref:   consent-copy.md §6 (parental attestation, ม.20)
 *
 * Exports:
 *   requiresParentalAttestation — true for infant_feeding + child_health (ม.20)
 *   isDualGatedWithGeneralHealth — true for infant_feeding + child_health (§4.7)
 *   evaluateJitGate — returns gate result with correct precedence (§4.7)
 *   isGrantEnabled  — Grant button enablement (attestation gate)
 *
 * Decision precedence for evaluateJitGate (§4.7):
 *   1. already_granted → no JIT action needed
 *   2. dual-gated AND general_health not granted → show general_health gate FIRST
 *   3. show_jit → show the type-specific JIT sheet
 *
 * PDPA compliance:
 *   - infant_feeding and child_health are data about the CHILD (ม.20).
 *     The parental attestation checkbox ("I am the parent/guardian") must be
 *     ticked BEFORE the Grant button is enabled. The checkbox is NEVER pre-ticked.
 *   - The dual-gate enforces the server contract: no child data can be saved
 *     unless general_health (mother's logging consent) is also granted.
 *
 * No React imports — pure TypeScript functions are fully testable without RN.
 */

import type { ConsentType } from './types';

// ─── Gate result type ─────────────────────────────────────────────────────────

/**
 * Result of evaluating whether to show a JIT consent sheet.
 *
 *   already_granted        — type is already granted; feature can proceed
 *   general_health_needed  — dual-gate: must grant general_health first (§4.7)
 *   show_jit               — show the JIT consent sheet for this type
 */
export type JitGateResult =
  | 'already_granted'
  | 'general_health_needed'
  | 'show_jit';

// ─── Parental attestation ─────────────────────────────────────────────────────

/**
 * Returns true if this consent type requires the user to tick the parental
 * attestation checkbox BEFORE the Grant button is enabled.
 *
 * Applies to: infant_feeding, child_health (both involve a child's data, ม.20).
 * The checkbox wording: "ฉันเป็นผู้ปกครอง/ผู้ใช้อำนาจปกครองของเด็กคนนี้"
 * i18n key: consent.{type}.parental_attest_label
 *
 * PDPA rule: NEVER pre-tick this checkbox (ม.19 requires affirmative action).
 */
export function requiresParentalAttestation(type: ConsentType): boolean {
  return type === 'infant_feeding' || type === 'child_health';
}

// ─── Dual-gate ────────────────────────────────────────────────────────────────

/**
 * Returns true if this consent type is dual-gated with general_health.
 *
 * The server contract (§4.7) prevents saving any child data without
 * general_health consent. Therefore, if general_health is not granted,
 * the general_health JIT gate must be shown before the feature-specific JIT.
 *
 * Applies to: infant_feeding (explicit in §4.7) and child_health (same contract).
 */
export function isDualGatedWithGeneralHealth(type: ConsentType): boolean {
  return type === 'infant_feeding' || type === 'child_health';
}

// ─── Gate evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluates the JIT gate for a given consent type using the correct precedence.
 *
 * Decision order (§4.7):
 *   1. If `type` is already granted → 'already_granted'
 *   2. If `type` is dual-gated AND general_health is NOT granted → 'general_health_needed'
 *   3. Otherwise → 'show_jit'
 *
 * @param type      - The feature-specific consent type to check
 * @param isGranted - Function returning true if a given type is currently granted
 *                    (typically: consentStore.isGranted, fail-closed returns false)
 */
export function evaluateJitGate(
  type: ConsentType,
  isGranted: (t: ConsentType) => boolean,
): JitGateResult {
  // Step 1: already granted — no JIT needed
  if (isGranted(type)) {
    return 'already_granted';
  }

  // Step 2: dual-gate check — show general_health gate FIRST (§4.7)
  if (isDualGatedWithGeneralHealth(type) && !isGranted('general_health')) {
    return 'general_health_needed';
  }

  // Step 3: show the feature-specific JIT sheet
  return 'show_jit';
}

// ─── Grant button enablement ──────────────────────────────────────────────────

/**
 * Returns true if the Grant button should be enabled.
 *
 * For types requiring parental attestation (infant_feeding, child_health):
 *   Grant is DISABLED until the parental attestation checkbox is ticked.
 *   This enforces the affirmative-action requirement for ม.20 (parental consent).
 *
 * For all other types: Grant is always enabled once the JIT sheet is shown.
 *
 * @param type             - The consent type for this JIT sheet
 * @param parentalAttested - Whether the user has ticked the parental checkbox
 *                           (must be false by default; NEVER pre-set to true)
 */
export function isGrantEnabled(
  type: ConsentType,
  parentalAttested: boolean,
): boolean {
  if (requiresParentalAttestation(type)) {
    return parentalAttested;
  }
  return true;
}
