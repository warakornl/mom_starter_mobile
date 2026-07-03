/**
 * captureScreenLogic — pure business logic for CaptureScreen (Quick Capture).
 *
 * Extracted for unit-testability; CaptureScreen.tsx imports and wires these.
 *
 * Implements:
 *  - encodeFieldToBase64: MVP plaintext-bytes-base64 encoding (K-7 carry-forward)
 *  - buildSelfLogInput:   build SelfLogInput per metricType (self-log-behavior §1)
 *  - getDefaultTime:      default HH:mm per capture-ui §2 (now / 12:00)
 *  - buildLoggedAt:       floating-civil "YYYY-MM-DDTHH:mm" (FLAG-1)
 *  - isSaveGatedByConsent: general_health gate (self-log-behavior §B.4)
 *  - isSaveEnabled:       aggregate Save-button predicate (capture-ui §5)
 *
 * Security:
 *  - NEVER log valueNumeric / valueText / note — MOTHER-health SD-5.
 *  - encodeFieldToBase64 output must not be logged either.
 */

import type { SelfLogInput, SelfLogMetricType } from '../sync/syncTypes';

// ─── Base64 encoding (MVP: plaintext bytes base64-encoded) ────────────────────

/**
 * Encode a UTF-8 string to base64 (MVP posture — K-7 carry-forward).
 *
 * MVP: plaintext bytes base64-encoded; AES-GCM encryption is a carry-forward
 * to be wired by appsec-engineer before production egress (same flag as K-7).
 * The server stores the bytes verbatim as ciphertext and never parses them
 * (D3/D4: server does not bound-check or interpret encrypted values).
 *
 * Works in:
 *  - Node.js / Jest test environment (Buffer available globally)
 *  - React Native / Hermes (TextEncoder + btoa — available RN 0.71+)
 *
 * NEVER log the return value (SD-5: no health plaintext in logs).
 */
export function encodeFieldToBase64(text: string): string {
  // Node.js / Jest test environment — Buffer is globally available
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  // React Native / Hermes: TextEncoder handles UTF-8 (Thai chars) correctly
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const chars = Array.from(bytes, (b: number) => String.fromCharCode(b));
  return btoa(chars.join(''));
}

// ─── SelfLogInput builder ─────────────────────────────────────────────────────

/**
 * Form value payload — raw user-typed strings before encoding.
 * CaptureScreen populates this from its form state.
 */
export interface CaptureFormValues {
  metricType: SelfLogMetricType;
  /** Weight input string (weight only; e.g. "64.2") */
  weightValue?: string;
  /** Systolic reading string (blood_pressure only; e.g. "120") */
  systolicValue?: string;
  /** Diastolic reading string (blood_pressure only; e.g. "78") */
  diastolicValue?: string;
  /** Descriptive text value (swelling / lochia / symptom only) */
  textValue?: string;
  /**
   * Floating-civil "YYYY-MM-DDTHH:mm" — the loggedAt calendar bucket key (FLAG-1).
   * No offset; never UTC-normalized. Built by buildLoggedAt().
   */
  loggedAt: string;
  /** Optional free-text note (any metricType; never parsed — INV-S4) */
  note?: string;
}

/**
 * Build a SelfLogInput from form values, base64-encoding all value/note fields.
 *
 * Per self-log-behavior.md §1 (field population rules):
 *   weight          → valueNumeric (encoded kg string) + unit="kg"
 *   blood_pressure  → valueNumeric (systolic, encoded) +
 *                     valueNumericSecondary (diastolic, encoded) + unit="mmHg"
 *   swelling/lochia/symptom → valueText (encoded) + unit=null
 *
 * All unused value fields are set to null (contract: unused = null, not absent).
 *
 * Security: NEVER log any field of CaptureFormValues or the returned
 * SelfLogInput — these contain MOTHER-health data (SD-5).
 */
export function buildSelfLogInput(values: CaptureFormValues): SelfLogInput {
  const { metricType, loggedAt, note } = values;
  const encodedNote =
    note?.trim() ? encodeFieldToBase64(note.trim()) : null;

  switch (metricType) {
    case 'weight':
      return {
        metricType,
        loggedAt,
        valueNumeric: encodeFieldToBase64((values.weightValue ?? '').trim()),
        valueNumericSecondary: null,
        valueText: null,
        unit: 'kg',
        note: encodedNote,
      };

    case 'blood_pressure':
      return {
        metricType,
        loggedAt,
        valueNumeric: encodeFieldToBase64((values.systolicValue ?? '').trim()),
        valueNumericSecondary: encodeFieldToBase64((values.diastolicValue ?? '').trim()),
        valueText: null,
        unit: 'mmHg',
        note: encodedNote,
      };

    case 'swelling':
    case 'lochia':
    case 'symptom':
      return {
        metricType,
        loggedAt,
        valueNumeric: null,
        valueNumericSecondary: null,
        valueText: encodeFieldToBase64((values.textValue ?? '').trim()),
        unit: null,
        note: encodedNote,
      };
  }
}

// ─── Default time logic ───────────────────────────────────────────────────────

/**
 * Get the default HH:mm time for a capture form.
 *
 * Per capture-ui.md §2 (entry from Day-Detail / Home):
 *   - Launched from a reminder occurrence → use the occurrence's scheduled time
 *     (caller passes this explicitly as `defaultTime` prop; use as-is).
 *   - Today selected → current local wall-clock time HH:mm.
 *   - Non-today date → "12:00" (civil noon; a sensible default, editable).
 *
 * Editing time never converts zones — this is floating-civil (FLAG-1).
 *
 * @param dateCivil   YYYY-MM-DD of the selected civil day
 * @param todayCivil  YYYY-MM-DD of today's civil day
 * @param nowDate     Optional override for "now" (defaults to new Date(); useful in tests)
 */
export function getDefaultTime(
  dateCivil: string,
  todayCivil: string,
  nowDate?: Date,
): string {
  if (dateCivil !== todayCivil) return '12:00';
  const now = nowDate ?? new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Build the floating-civil loggedAt string "YYYY-MM-DDTHH:mm" (FLAG-1).
 *
 * No UTC offset, no trailing Z. The date part is the civil calendar bucket key.
 * Never zone-converts — editing time is civil-clock, not UTC (FLAG-1 / capture-ui §2).
 */
export function buildLoggedAt(dateCivil: string, time: string): string {
  return `${dateCivil}T${time}`;
}

// ─── Consent gate ─────────────────────────────────────────────────────────────

/**
 * Returns true when the Save action must be gated by a consent nudge.
 *
 * Self-logs are MOTHER-health data (SD-5). Per self-log-behavior.md §B.4 + D6:
 *   - general_health must be granted BEFORE persisting any self-log value.
 *   - If absent or withdrawn → gate Save; show JIT nudge; hold entered values.
 *   - Browsing is NEVER blocked; only the health-write action is gated.
 *
 * Returns false (not gated) when general_health is granted → normal save path.
 */
export function isSaveGatedByConsent(generalHealthGranted: boolean): boolean {
  return !generalHealthGranted;
}

// ─── Save-enabled predicate ───────────────────────────────────────────────────

export interface SaveEnabledParams {
  metricType: SelfLogMetricType;
  /** Weight field result.storable (weight only) */
  weightStorable?: boolean;
  /** Systolic field result.storable (blood_pressure only) */
  systolicStorable?: boolean;
  /** Diastolic field result.storable (blood_pressure only) */
  diastolicStorable?: boolean;
  /** ValueText field storable (swelling / lochia / symptom) */
  textStorable?: boolean;
  /** Time field result.storable */
  timeStorable: boolean;
}

/**
 * Returns true when all required form fields are in a storable state.
 *
 * Per capture-ui.md §5 (screen states):
 *   - Save disabled until required value(s) exist and are well-formed.
 *   - Blood pressure requires BOTH systolic AND diastolic to be storable.
 *   - Out-of-range values are still storable (typo hint shown, Save still enabled).
 *   - Empty value → Save disabled (storable: false from validation).
 */
export function isSaveEnabled(params: SaveEnabledParams): boolean {
  const { metricType, timeStorable } = params;
  if (!timeStorable) return false;

  switch (metricType) {
    case 'weight':
      return params.weightStorable === true;
    case 'blood_pressure':
      return params.systolicStorable === true && params.diastolicStorable === true;
    case 'swelling':
    case 'lochia':
    case 'symptom':
      return params.textStorable === true;
  }
}
