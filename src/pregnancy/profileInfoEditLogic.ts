/**
 * profileInfoEditLogic — pure outcome-resolution and helper functions for
 * ProfileInfoEditScreen (edit mother first/last name + baby name).
 *
 * Design contrast with profileEditLogic.ts:
 *   - LIFECYCLE-AGNOSTIC: works for both pregnant and postpartum profiles.
 *     Unlike ProfileEditScreen which gates on pregnant only (AC-2).
 *   - No EDD validation: this screen does not edit the due date.
 *   - No dirty-change guard (simpler UX for optional fields).
 *
 * Security:
 *   - GET 401 / PUT 401 → session-expired → caller runs performLogout (SD-5).
 *   - Form state holds DECODED plaintext identity PII — NEVER log (callers must ensure).
 *   - PUT body contains Base64 ciphertext (MVP no-op cipher) via buildNamePutFields.
 *   - PDPA § 2.5: name fields are identity PII; handled with same care as health data.
 */

import type { GetProfileResult, PutProfileResult, PregnancyProfile, PregnancyProfileInput } from './types';
import { decodeNameFromWire, buildNamePutFields } from './nameFieldCipher';

// ─── Outcome types ────────────────────────────────────────────────────────────

/** Outcome of resolving a GET /v1/pregnancy-profile result for ProfileInfoEditScreen. */
export type InfoEditGetOutcome =
  | { type: 'loading' }
  | { type: 'show-form'; profile: PregnancyProfile }
  | { type: 'session-expired' }
  | { type: 'not-found' }
  | { type: 'error'; retryable: true };

/** Outcome of resolving a PUT /v1/pregnancy-profile result for ProfileInfoEditScreen. */
export type InfoEditPutOutcome =
  | { type: 'saved'; profile: PregnancyProfile }
  | { type: 'session-expired' }
  | { type: 'conflict' }
  | { type: 'precondition' }
  | { type: 'generic-error' };

// ─── Form state ────────────────────────────────────────────────────────────────

/**
 * Form state for ProfileInfoEditScreen.
 * Holds decoded plaintext strings (empty string = absent/not set).
 *
 * Empty string in the form represents "absent / not set" (maps to null in PUT).
 * Non-empty string represents a name value (maps to base64 in PUT).
 *
 * NEVER log any of these values (PDPA identity PII).
 */
export interface NameFormState {
  motherFirstName: string; // empty = absent
  motherLastName: string;  // empty = absent
  babyName: string;        // empty = absent
}

// ─── GET outcome resolver ─────────────────────────────────────────────────────

/**
 * Resolve a GET /v1/pregnancy-profile result into an InfoEditGetOutcome.
 *
 * Key difference from profileEditLogic.resolveEditGetOutcome:
 *   - 200 with ANY lifecycle → show-form (no pregnant-only guard).
 *   - This screen is lifecycle-agnostic (OQ-N-LifecycleAgnostic from spec).
 *
 * @param result - null means the GET is still in flight (loading state).
 */
export function resolveInfoEditGetOutcome(
  result: GetProfileResult | null,
): InfoEditGetOutcome {
  if (result === null) {
    return { type: 'loading' };
  }

  if (result.ok) {
    // Lifecycle-agnostic: pregnant AND postpartum both get the edit form
    return { type: 'show-form', profile: result.profile };
  }

  // Error cases — note 404 in GetProfileResult has a specific type
  if (result.status === 401) {
    return { type: 'session-expired' };
  }

  if (result.status === 404) {
    return { type: 'not-found' };
  }

  return { type: 'error', retryable: true };
}

// ─── PUT outcome resolver ─────────────────────────────────────────────────────

/**
 * Resolve a PUT /v1/pregnancy-profile result into an InfoEditPutOutcome.
 *
 * Handles the full error matrix from api-contract.md PUT section.
 * 403 consent_required: not expected for name-only edits (no general_health
 *   gate on name fields per spec), but handled defensively as generic-error.
 */
export function resolveInfoEditPutOutcome(
  result: PutProfileResult,
): InfoEditPutOutcome {
  if (result.ok) {
    return { type: 'saved', profile: result.profile };
  }

  if (result.status === 401) {
    return { type: 'session-expired' };
  }

  if (result.status === 409) {
    return { type: 'conflict' };
  }

  if (result.status === 428) {
    return { type: 'precondition' };
  }

  // 422, 403, 500, network, other
  return { type: 'generic-error' };
}

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a single name input value.
 *
 * Rules (api-contract.md: client trims + enforces ≤100 chars):
 *   - null / undefined / empty → OK (all name fields are optional)
 *   - trimmed.length > 100 → error 'profileInfo.validation.nameTooLong'
 *
 * Returns null on valid input, the i18n error key on invalid.
 *
 * NEVER log the input value (PDPA identity PII).
 */
export function validateNameInput(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (trimmed === '') return null;
  if (trimmed.length > 100) {
    return 'profileInfo.validation.nameTooLong';
  }
  return null;
}

// ─── Form state builder ───────────────────────────────────────────────────────

/**
 * Build the initial form state from a profile (GET response).
 *
 * Decodes the Base64 ciphertext name fields back to plaintext strings.
 * Absent or null name fields become empty string in the form (no-name display).
 *
 * NEVER log the resulting strings (PDPA identity PII).
 */
export function buildFormStateFromProfile(profile: PregnancyProfile): NameFormState {
  return {
    motherFirstName: decodeNameFromWire(profile.motherFirstName) ?? '',
    motherLastName:  decodeNameFromWire(profile.motherLastName) ?? '',
    babyName:        decodeNameFromWire(profile.babyName) ?? '',
  };
}

// ─── PUT input builder ────────────────────────────────────────────────────────

/**
 * Build the PUT /v1/pregnancy-profile request body from form state and the
 * current profile (provides edd + version for the no-op-PUT pin).
 *
 * PUT body semantics (api-contract.md L576 scoped exception):
 *   - edd is ALWAYS included (echoed from the profile — required for PUT).
 *   - Name fields use buildNamePutFields: empty → null (clear), non-empty → base64.
 *   - All three name fields are ALWAYS included in the body (clear vs set).
 *     This ensures the server always knows the intended final state.
 *
 * Note: version is sent as the If-Match header by putProfile(), not in the body.
 *
 * NEVER log name fields from formState or the returned input (PDPA identity PII).
 */
export function buildInfoEditPutInput(
  profile: PregnancyProfile,
  formState: NameFormState,
): PregnancyProfileInput {
  const nameFields = buildNamePutFields({
    motherFirstName: formState.motherFirstName,
    motherLastName: formState.motherLastName,
    babyName: formState.babyName,
  });

  return {
    edd: profile.edd,
    ...nameFields,
  };
}
