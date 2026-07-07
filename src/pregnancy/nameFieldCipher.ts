/**
 * nameFieldCipher — encode/decode for pregnancy-profile name fields.
 *
 * MVP no-op cipher: base64(utf8(name)) — the same seam as the health-note
 * ciphers in captureScreenLogic.ts (encodeFieldToBase64 / decodeFieldFromBase64).
 * The real AES-256-GCM path is gated on the KMS/EAS milestone (carry-forward).
 *
 * Wire format: Base64 ciphertext string — matches deliveryType/birthNote.
 *   GET response → server sends Base64 → client decodes to UTF-8 for display.
 *   PUT request  → client encodes UTF-8 to Base64 → server stores as bytea.
 *
 * ── AAD registry (appsec mandate — name-fields-design.md Decision 2/§3) ────────
 * When the real FieldCipher/AES-GCM path lands, the three name fields are
 * ROW-PER-ACCOUNT (one pregnancy_profile per account), so the AAD `recordId`
 * MUST equal accountId — NOT the pregnancy_profile row id.
 * Using the profile row id would cause all names to fail decryption when the
 * real cipher is enabled. The code registry constant (mom_starter_api repo) is:
 *
 *   (collection, fieldName, recordIdSelector)
 *   ('pregnancyProfile', 'motherFirstName', accountId)
 *   ('pregnancyProfile', 'motherLastName',  accountId)
 *   ('pregnancyProfile', 'babyName',        accountId)
 *
 * The committed golden vectors in the api repo are the byte-contract.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PUT null-vs-absent semantics (api-contract.md L576 scoped exception):
 *   - absent key   = leave stored value UNCHANGED (omit the key in the JSON body)
 *   - present value = set/replace stored value
 *   - explicit null = clear to NULL (client trims → empty → sends null)
 *
 * Security:
 *   NEVER log decoded name values — they are identity PII (PDPA).
 *   NEVER pass decoded names in route params (SD-9).
 */

import { encodeFieldToBase64, decodeFieldFromBase64 } from '../capture/captureScreenLogic';

// ─── Encode (PUT write path) ──────────────────────────────────────────────────

/**
 * Encode a name field for wire transmission (PUT /pregnancy-profile).
 *
 * MVP: base64(utf8(name)) — no-op cipher identical to the health-note seam.
 *
 * Returns null for null / undefined / empty / whitespace-only input so the
 * PUT body uses explicit null to signal "clear this field" and the server
 * sets the column to NULL (api-contract L576: "explicit null = clear to NULL").
 *
 * NEVER log the input or return value (PDPA identity PII).
 */
export function encodeNameForWire(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (trimmed === '') return null;
  return encodeFieldToBase64(trimmed);
}

// ─── Decode (GET/display path) ────────────────────────────────────────────────

/**
 * Decode a name field from wire format (GET /pregnancy-profile response).
 *
 * MVP: base64 → utf8 — inverse of encodeNameForWire.
 *
 * Returns null for null / undefined / empty input (absent or unset name).
 *
 * NEVER log the return value (PDPA identity PII).
 */
export function decodeNameFromWire(b64: string | null | undefined): string | null {
  return decodeFieldFromBase64(b64);
}

// ─── PUT field builder ────────────────────────────────────────────────────────

/**
 * Input to buildNamePutFields: the three name states from the edit form.
 *
 * - undefined = the user did NOT interact with this field
 *              → key is OMITTED from the PUT body (leave unchanged on server)
 * - null      = the user explicitly cleared this field
 *              → key is present with null (server clears column to NULL)
 * - string    = the user entered or retained a name value
 *              → key is present with base64-encoded value
 */
export interface NameFieldInputs {
  motherFirstName?: string | null;
  motherLastName?: string | null;
  babyName?: string | null;
}

/**
 * Result of buildNamePutFields: only the keys that should appear in the PUT body.
 *
 * Undefined values are omitted so JSON.stringify produces the correct wire shape.
 */
export interface NamePutFields {
  motherFirstName?: string | null;
  motherLastName?: string | null;
  babyName?: string | null;
}

/**
 * Build the name fields for a PUT /pregnancy-profile request body.
 *
 * Implements the three-state null-vs-absent contract (api-contract.md L576):
 *   undefined  → OMIT key (leave value unchanged on server)
 *   null       → include key as null (server clears to NULL)
 *   empty/ws   → treated as null (send null to clear, since empty-plaintext
 *                is indistinguishable from null inside an encrypted bytea)
 *   non-empty  → include key as base64-encoded string
 *
 * Note: a PUT carrying ANY name key (value or null) is a REAL mutation that
 * always persists and bumps `version` even when edd is unchanged — this is
 * the OQ-9 no-op scoped exception pinned in api-contract.md L576.
 *
 * NEVER log any value from the input or output (PDPA identity PII).
 */
export function buildNamePutFields(inputs: NameFieldInputs): NamePutFields {
  const result: NamePutFields = {};

  // Helper: only assign when the caller passed something (not undefined)
  function assign<K extends keyof NameFieldInputs>(key: K, value: NameFieldInputs[K]): void {
    if (value === undefined) return; // omit key → leave unchanged
    if (value === null) {
      (result as Record<string, null>)[key] = null; // explicit null → clear
    } else {
      const encoded = encodeNameForWire(value);
      (result as Record<string, string | null>)[key] = encoded; // null if empty/ws → clear
    }
  }

  assign('motherFirstName', inputs.motherFirstName);
  assign('motherLastName', inputs.motherLastName);
  assign('babyName', inputs.babyName);

  return result;
}
