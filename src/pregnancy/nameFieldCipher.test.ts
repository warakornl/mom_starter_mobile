/**
 * nameFieldCipher.test.ts — TDD: encode/decode for mother/baby name fields.
 *
 * Spec: name-fields-design.md Decision 2 / api-contract.md L681-683
 *
 * MVP no-op cipher: base64(utf8(name)) — identical to encodeFieldToBase64/
 * decodeFieldFromBase64 in captureScreenLogic.ts (health note cipher seam).
 *
 * AAD registry note (appsec mandate, name-fields-design.md §Decision 2):
 *   When the real FieldCipher/AES-GCM path lands, AAD recordId for the three
 *   name fields MUST equal accountId (row-per-account; NOT profile row id).
 *   These are registered in the field-aad-registry constant in the api repo:
 *     pregnancyProfile/motherFirstName  → recordId = accountId
 *     pregnancyProfile/motherLastName   → recordId = accountId
 *     pregnancyProfile/babyName         → recordId = accountId
 *   The MVP no-op path uses no AAD; this comment is the client-side reminder.
 *
 * Tests verify:
 *   1. encodeNameForWire — base64 encode + roundtrip
 *   2. decodeNameFromWire — base64 decode + roundtrip
 *   3. null/empty input → null (absent value)
 *   4. Thai multi-byte roundtrip
 *   5. buildNamePutFields — present/null/absent semantics for PUT body
 *   6. PUT null = CLEAR, PUT absent = LEAVE UNCHANGED (api-contract L576 scoped exception)
 */

import {
  encodeNameForWire,
  decodeNameFromWire,
  buildNamePutFields,
} from './nameFieldCipher';

// ─── 1. encodeNameForWire ─────────────────────────────────────────────────────

describe('encodeNameForWire — base64 MVP no-op cipher', () => {
  it('encodes ASCII string to base64', () => {
    const result = encodeNameForWire('Alice');
    expect(typeof result).toBe('string');
    // base64 of 'Alice' is 'QWxpY2U='
    expect(result).toBe(Buffer.from('Alice', 'utf8').toString('base64'));
  });

  it('encodes Thai UTF-8 string to base64', () => {
    const result = encodeNameForWire('สมหญิง');
    expect(typeof result).toBe('string');
    expect(result).toBe(Buffer.from('สมหญิง', 'utf8').toString('base64'));
  });

  it('returns null for null input (absent field)', () => {
    expect(encodeNameForWire(null)).toBeNull();
  });

  it('returns null for undefined input (absent field)', () => {
    expect(encodeNameForWire(undefined)).toBeNull();
  });

  it('returns null for empty string (treat as absent)', () => {
    expect(encodeNameForWire('')).toBeNull();
  });

  it('returns null for whitespace-only string (trim → empty → absent)', () => {
    expect(encodeNameForWire('   ')).toBeNull();
  });

  it('trims leading/trailing whitespace before encoding', () => {
    const result = encodeNameForWire('  Alice  ');
    const expected = Buffer.from('Alice', 'utf8').toString('base64');
    expect(result).toBe(expected);
  });
});

// ─── 2. decodeNameFromWire ─────────────────────────────────────────────────────

describe('decodeNameFromWire — base64 MVP no-op decode', () => {
  it('decodes base64 ASCII back to plaintext', () => {
    const b64 = Buffer.from('Alice', 'utf8').toString('base64');
    expect(decodeNameFromWire(b64)).toBe('Alice');
  });

  it('decodes base64 Thai UTF-8 back to plaintext', () => {
    const b64 = Buffer.from('สมหญิง', 'utf8').toString('base64');
    expect(decodeNameFromWire(b64)).toBe('สมหญิง');
  });

  it('returns null for null input', () => {
    expect(decodeNameFromWire(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(decodeNameFromWire(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeNameFromWire('')).toBeNull();
  });

  it('roundtrip: encode then decode returns original string', () => {
    const original = 'นิชา ณ สายน้ำ';
    const encoded = encodeNameForWire(original);
    expect(encoded).not.toBeNull();
    expect(decodeNameFromWire(encoded!)).toBe(original);
  });
});

// ─── 3. buildNamePutFields ────────────────────────────────────────────────────
//
// Implements the three-state null-vs-absent semantics from api-contract.md L576:
//   - Field ABSENT from request body → leave unchanged (omit the key)
//   - Field present with encoded value → set/replace stored value
//   - Field present with explicit null → clear to NULL (api-contract scoped exception)
//
// On the client side:
//   - `undefined` input = user did NOT interact with the field → OMIT key (absent)
//   - `null` input = user explicitly cleared the field → send explicit null
//   - non-empty string = user entered a name → send base64 encoded value

describe('buildNamePutFields — null-vs-absent PUT semantics', () => {
  it('omits key when value is undefined (absent = leave unchanged)', () => {
    const fields = buildNamePutFields({
      motherFirstName: undefined,
      motherLastName: undefined,
      babyName: undefined,
    });
    expect('motherFirstName' in fields).toBe(false);
    expect('motherLastName' in fields).toBe(false);
    expect('babyName' in fields).toBe(false);
  });

  it('sends explicit null when value is null (clear to NULL)', () => {
    const fields = buildNamePutFields({
      motherFirstName: null,
      motherLastName: null,
      babyName: null,
    });
    expect(fields.motherFirstName).toBeNull();
    expect(fields.motherLastName).toBeNull();
    expect(fields.babyName).toBeNull();
  });

  it('sends base64 encoded value for non-empty string', () => {
    const fields = buildNamePutFields({
      motherFirstName: 'Alice',
      motherLastName: 'Smith',
      babyName: 'Bob',
    });
    expect(fields.motherFirstName).toBe(Buffer.from('Alice', 'utf8').toString('base64'));
    expect(fields.motherLastName).toBe(Buffer.from('Smith', 'utf8').toString('base64'));
    expect(fields.babyName).toBe(Buffer.from('Bob', 'utf8').toString('base64'));
  });

  it('sends null for empty-string value (empty = clear intent, per contract)', () => {
    // Empty string after trim → treat as clearing the field
    const fields = buildNamePutFields({
      motherFirstName: '',
      motherLastName: '  ',
      babyName: '',
    });
    expect(fields.motherFirstName).toBeNull();
    expect(fields.motherLastName).toBeNull();
    expect(fields.babyName).toBeNull();
  });

  it('mixes absent, null, and value correctly', () => {
    const fields = buildNamePutFields({
      motherFirstName: 'สมหญิง',
      motherLastName: null,   // explicit clear
      babyName: undefined,    // unchanged (omit)
    });
    const b64 = Buffer.from('สมหญิง', 'utf8').toString('base64');
    expect(fields.motherFirstName).toBe(b64);
    expect(fields.motherLastName).toBeNull();
    expect('babyName' in fields).toBe(false);
  });
});
