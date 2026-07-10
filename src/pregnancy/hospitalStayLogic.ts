/**
 * hospitalStayLogic.ts — pure client-side validation for hospital stay dates.
 *
 * Grounded in: pregnancy-summary-design.md §1.3 (client-side validation rules)
 *
 * Rules (client enforces; server enforces byte-cap only):
 *   1. Each date must be ≤ today (retrospective data, not future).
 *   2. If both present: discharge ≥ admission.
 *   3. OQ-PS4: if admission is far from birthDate → WARN, not block.
 *      Threshold = 7 days (|admission - birthDate| > 7).
 *
 * §1.4 PIN: presence of ANY hospital-stay key in POST body = REAL mutation.
 * buildHospitalStayFields returns the correct wire-ready object:
 *   - absent state (undefined) → key NOT included → server leaves value unchanged
 *   - present date (YYYY-MM-DD) → key present as Base64 cipher → server stores
 *   - explicit null → key present as null → server clears column
 *
 * Security: NEVER log admission or discharge date values (health-adjacent PII).
 */

import { encodeDateForWire } from './hospitalStayCipher';

// ─── Validation types ─────────────────────────────────────────────────────────

export type HospitalDateValidationResult =
  | { valid: true }
  | { valid: false; error: 'discharge-before-admission' | 'date-in-future'; field: 'admission' | 'discharge' };

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate hospital admission and discharge dates.
 *
 * Checks (in order):
 *   1. admission > today → error date-in-future on 'admission'
 *   2. discharge > today → error date-in-future on 'discharge'
 *   3. both present and discharge < admission → error discharge-before-admission on 'discharge'
 *
 * Passing null/undefined for a date means "not set" — skips that check.
 */
export function validateHospitalDates(
  admission: string | null | undefined,
  discharge: string | null | undefined,
  today: string,
): HospitalDateValidationResult {
  if (admission != null && admission.length === 10 && admission > today) {
    return { valid: false, error: 'date-in-future', field: 'admission' };
  }
  if (discharge != null && discharge.length === 10 && discharge > today) {
    return { valid: false, error: 'date-in-future', field: 'discharge' };
  }
  if (
    admission != null && admission.length === 10 &&
    discharge != null && discharge.length === 10 &&
    discharge < admission
  ) {
    return { valid: false, error: 'discharge-before-admission', field: 'discharge' };
  }
  return { valid: true };
}

/**
 * OQ-PS4: warn (NOT block) if hospital admission date is more than 7 calendar
 * days away from the birth date.
 *
 * Returns true when the UI should show the warn dialog before proceeding.
 * Returns false when no warning is needed (dates close, or either date absent).
 */
export function shouldWarnAdmissionFarFromBirth(
  admission: string | null | undefined,
  birthDate: string | null | undefined,
): boolean {
  if (!admission || admission.length !== 10) return false;
  if (!birthDate || birthDate.length !== 10) return false;
  // Civil-date string comparison works for YYYY-MM-DD format.
  const admissionMs = Date.parse(admission);
  const birthMs = Date.parse(birthDate);
  if (isNaN(admissionMs) || isNaN(birthMs)) return false;
  const diffDays = Math.abs(admissionMs - birthMs) / (1000 * 60 * 60 * 24);
  return diffDays > 7;
}

// ─── Wire field builder ───────────────────────────────────────────────────────

/**
 * Hospital stay fields to include in POST /birth-event body.
 *
 * Only keys that should appear in the JSON body (undefined = omit = no mutation).
 * §1.4 PIN: presence of any key (value or explicit null) = REAL mutation (version bump).
 */
export interface HospitalStayWireFields {
  hospitalAdmissionDate?: string | null;  // Base64 cipher or null
  hospitalDischargeDate?: string | null;  // Base64 cipher or null
}

/**
 * Build the hospital stay fields for a POST /birth-event request body.
 *
 * Three-state semantics (CONTRACT-PINNED — pregnancy-summary-design.md §1.3):
 *   undefined (user never touched the field) → key OMITTED → server leaves unchanged
 *   null (user explicitly cleared the field)  → key present as null → server clears
 *   YYYY-MM-DD string                         → key present as Base64 cipher
 *
 * §1.4 PIN: when either key is present (any value including null), the POST is a
 * REAL mutation that must persist and bump version even if birthDate is unchanged.
 *
 * NEVER log any value (health-adjacent PII).
 */
export function buildHospitalStayFields(
  admission: string | null | undefined,
  discharge: string | null | undefined,
): HospitalStayWireFields {
  const fields: HospitalStayWireFields = {};

  if (admission !== undefined) {
    // Present: encode non-null values to Base64 cipher; pass null through
    fields.hospitalAdmissionDate = admission === null ? null : encodeDateForWire(admission);
  }
  if (discharge !== undefined) {
    fields.hospitalDischargeDate = discharge === null ? null : encodeDateForWire(discharge);
  }

  return fields;
}
