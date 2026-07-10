/**
 * hospitalStayCipher — encode/decode for hospital admission/discharge date fields.
 *
 * MVP no-op cipher: base64(utf8(date)) — same seam as deliveryType/birthNote/name fields.
 * The real AES-256-GCM path is gated on the KMS/EAS milestone (carry-forward).
 *
 * Wire format: Base64 ciphertext string.
 *   GET response → server sends Base64 → client decodes to civil date (YYYY-MM-DD).
 *   POST /birth-event → client encodes civil date to Base64 → server stores as bytea.
 *
 * ── AAD registry (appsec mandate — pregnancy-summary-design.md §1.2) ──────────
 * When real FieldCipher/AES-GCM ships, hospital stay fields are ROW-PER-ACCOUNT
 * (one pregnancy_profile per account), so the AAD `recordId` MUST equal accountId
 * NOT the pregnancy_profile row id (RULING 2b).
 *
 *   ('pregnancyProfile', 'hospitalAdmissionDate', accountId)
 *   ('pregnancyProfile', 'hospitalDischargeDate', accountId)
 *
 * Null-vs-absent semantics (CONTRACT-PINNED §1.3):
 *   - absent key   = leave stored value UNCHANGED
 *   - present value (Base64) = set/replace
 *   - explicit null = clear column to NULL
 *
 * §1.4 PIN: presence of ANY hospital-stay key in POST /birth-event body = REAL
 * mutation (bumps version) even when birthDate is unchanged.
 * NEVER byte-diff ciphers to detect no-ops — random-IV means same plaintext
 * produces different ciphertext bytes on each encode.
 *
 * Security:
 *   NEVER log decoded date values (health-adjacent PII — PDPA ม.26).
 *   NEVER pass decoded values in route params (SD-9).
 */

import { encodeFieldToBase64, decodeFieldFromBase64 } from '../capture/captureScreenLogic';

// ─── Encode (POST write path) ─────────────────────────────────────────────────

/**
 * Encode a hospital civil date (YYYY-MM-DD) for wire transmission.
 *
 * MVP: base64(utf8(date)) — no-op cipher.
 * Returns null for null / undefined / empty / whitespace-only input so the POST
 * body can carry explicit null to signal "clear this field".
 *
 * NEVER log the input or return value (health-adjacent PII).
 */
export function encodeDateForWire(civilDate: string | null | undefined): string | null {
  if (civilDate == null) return null;
  const trimmed = civilDate.trim();
  if (trimmed === '') return null;
  return encodeFieldToBase64(trimmed);
}

// ─── Decode (GET/display path) ────────────────────────────────────────────────

/**
 * Decode a hospital date field from wire format (GET /pregnancy-profile response).
 *
 * MVP: base64 → utf8 — inverse of encodeDateForWire.
 * Returns null for null / undefined / empty input (absent or unset date).
 *
 * NEVER log the return value (health-adjacent PII).
 */
export function decodeDateFromWire(b64: string | null | undefined): string | null {
  return decodeFieldFromBase64(b64);
}
