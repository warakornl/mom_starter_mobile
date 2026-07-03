/**
 * captureScreenLogic.test.ts — RED phase (TDD)
 *
 * Tests for CaptureScreen's pure logic:
 *  1. encodeFieldToBase64  — MVP base64 encoding (mirrors K-7 carry-forward)
 *  2. buildSelfLogInput    — field population per metricType (self-log-behavior.md §1)
 *                            and base64 encoding of value/note fields
 *  3. getDefaultTime       — capture-ui.md §2 default time rules
 *  4. buildLoggedAt        — floating-civil YYYY-MM-DDTHH:mm (FLAG-1)
 *  5. isSaveGatedByConsent — self-log-behavior.md §B.4 general_health gate
 *  6. isSaveEnabled        — capture-ui.md §5 Save button predicate
 *
 * These pure functions are the extractable "screen test" contract, covering:
 *  - Type selection → correct value fields populated (metricType swaps region)
 *  - Save writes correct base64 SelfLogInput (all value fields base64-encoded)
 *  - Declined general_health gates the save (isSaveGatedByConsent returns true)
 */

import {
  encodeFieldToBase64,
  decodeFieldFromBase64,
  buildSelfLogInput,
  getDefaultTime,
  buildLoggedAt,
  isSaveGatedByConsent,
  isSaveEnabled,
  orchestrateSave,
} from './captureScreenLogic';

// ─── encodeFieldToBase64 ──────────────────────────────────────────────────────

describe('encodeFieldToBase64 (MVP: plaintext bytes base64-encoded, K-7 carry-forward)', () => {
  function decode(b64: string): string {
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  it('encodes ASCII string and decodes back correctly', () => {
    const enc = encodeFieldToBase64('64.2');
    expect(typeof enc).toBe('string');
    expect(enc.length).toBeGreaterThan(0);
    expect(decode(enc)).toBe('64.2');
  });

  it('encodes BP systolic "120" correctly', () => {
    expect(decode(encodeFieldToBase64('120'))).toBe('120');
  });

  it('encodes BP diastolic "78" correctly', () => {
    expect(decode(encodeFieldToBase64('78'))).toBe('78');
  });

  it('encodes Thai (UTF-8) text correctly — Thai chars roundtrip', () => {
    const thai = 'เล็กน้อย';
    expect(decode(encodeFieldToBase64(thai))).toBe(thai);
  });

  it('encodes Thai symptom note correctly', () => {
    const text = 'คลื่นไส้ ก่อนข้าวเช้า';
    expect(decode(encodeFieldToBase64(text))).toBe(text);
  });

  it('produces a valid base64 string (only base64 chars)', () => {
    const enc = encodeFieldToBase64('test');
    expect(enc).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

// ─── buildSelfLogInput ────────────────────────────────────────────────────────

describe('buildSelfLogInput — type selection swaps value region + base64 encoding', () => {
  const LOGGED_AT = '2026-06-28T13:00';

  function decode(b64: string | null | undefined): string {
    if (!b64) throw new Error('expected a base64 value');
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  // ── weight ─────────────────────────────────────────────────────────────────
  describe('weight', () => {
    const input = buildSelfLogInput({
      metricType: 'weight',
      weightValue: '64.2',
      loggedAt: LOGGED_AT,
    });

    it('sets metricType = weight', () => {
      expect(input.metricType).toBe('weight');
    });
    it('sets unit = kg', () => {
      expect(input.unit).toBe('kg');
    });
    it('encodes valueNumeric as base64 of "64.2"', () => {
      expect(decode(input.valueNumeric)).toBe('64.2');
    });
    it('valueNumericSecondary is null (weight has no secondary)', () => {
      expect(input.valueNumericSecondary).toBeNull();
    });
    it('valueText is null (weight uses numeric field)', () => {
      expect(input.valueText).toBeNull();
    });
    it('loggedAt is passed through unchanged (FLAG-1: floating-civil)', () => {
      expect(input.loggedAt).toBe(LOGGED_AT);
    });
  });

  // ── blood_pressure ─────────────────────────────────────────────────────────
  describe('blood_pressure', () => {
    const input = buildSelfLogInput({
      metricType: 'blood_pressure',
      systolicValue: '120',
      diastolicValue: '78',
      loggedAt: LOGGED_AT,
    });

    it('sets metricType = blood_pressure', () => {
      expect(input.metricType).toBe('blood_pressure');
    });
    it('sets unit = mmHg', () => {
      expect(input.unit).toBe('mmHg');
    });
    it('encodes systolic in valueNumeric', () => {
      expect(decode(input.valueNumeric)).toBe('120');
    });
    it('encodes diastolic in valueNumericSecondary', () => {
      expect(decode(input.valueNumericSecondary)).toBe('78');
    });
    it('valueText is null', () => {
      expect(input.valueText).toBeNull();
    });

    it('INV-S1: extreme BP 150/95 same structure as 110/70', () => {
      const extreme = buildSelfLogInput({
        metricType: 'blood_pressure',
        systolicValue: '150',
        diastolicValue: '95',
        loggedAt: LOGGED_AT,
      });
      const normal = buildSelfLogInput({
        metricType: 'blood_pressure',
        systolicValue: '110',
        diastolicValue: '70',
        loggedAt: LOGGED_AT,
      });
      // Same fields populated; only encoded values differ
      expect(Object.keys(extreme)).toEqual(Object.keys(normal));
      expect(extreme.unit).toBe(normal.unit);
      expect(extreme.metricType).toBe(normal.metricType);
    });
  });

  // ── swelling ───────────────────────────────────────────────────────────────
  describe('swelling', () => {
    const input = buildSelfLogInput({
      metricType: 'swelling',
      textValue: 'เล็กน้อย',
      loggedAt: LOGGED_AT,
    });

    it('sets metricType = swelling', () => {
      expect(input.metricType).toBe('swelling');
    });
    it('unit is null (text-only type)', () => {
      expect(input.unit).toBeNull();
    });
    it('encodes valueText as base64 of Thai text', () => {
      expect(decode(input.valueText)).toBe('เล็กน้อย');
    });
    it('valueNumeric is null', () => {
      expect(input.valueNumeric).toBeNull();
    });
    it('valueNumericSecondary is null', () => {
      expect(input.valueNumericSecondary).toBeNull();
    });
  });

  // ── lochia ─────────────────────────────────────────────────────────────────
  describe('lochia', () => {
    it('encodes valueText for lochia', () => {
      const input = buildSelfLogInput({
        metricType: 'lochia',
        textValue: 'สีชมพู',
        loggedAt: LOGGED_AT,
      });
      expect(decode(input.valueText)).toBe('สีชมพู');
      expect(input.unit).toBeNull();
    });
  });

  // ── symptom ────────────────────────────────────────────────────────────────
  describe('symptom', () => {
    it('encodes valueText for symptom', () => {
      const input = buildSelfLogInput({
        metricType: 'symptom',
        textValue: 'คลื่นไส้',
        loggedAt: LOGGED_AT,
      });
      expect(decode(input.valueText)).toBe('คลื่นไส้');
    });
  });

  // ── note ───────────────────────────────────────────────────────────────────
  describe('note encoding', () => {
    it('encodes note as base64 when provided', () => {
      const input = buildSelfLogInput({
        metricType: 'weight',
        weightValue: '64.2',
        loggedAt: LOGGED_AT,
        note: 'ก่อนข้าวเช้า',
      });
      expect(typeof input.note).toBe('string');
      expect(decode(input.note)).toBe('ก่อนข้าวเช้า');
    });

    it('note is null when not provided', () => {
      const input = buildSelfLogInput({
        metricType: 'weight',
        weightValue: '64.2',
        loggedAt: LOGGED_AT,
      });
      expect(input.note).toBeNull();
    });

    it('note is null for empty string', () => {
      const input = buildSelfLogInput({
        metricType: 'weight',
        weightValue: '64.2',
        loggedAt: LOGGED_AT,
        note: '',
      });
      expect(input.note).toBeNull();
    });
  });
});

// ─── getDefaultTime ───────────────────────────────────────────────────────────

describe('getDefaultTime (capture-ui §2 — now on today / 12:00 on non-today)', () => {
  it('returns 12:00 for a non-today date', () => {
    expect(getDefaultTime('2026-06-01', '2026-06-28')).toBe('12:00');
  });

  it('returns current HH:mm for today (pinned time)', () => {
    const fixed = new Date('2026-06-28T09:15:00');
    expect(getDefaultTime('2026-06-28', '2026-06-28', fixed)).toBe('09:15');
  });

  it('pads single-digit hours and minutes', () => {
    const fixed = new Date('2026-06-28T05:03:00');
    expect(getDefaultTime('2026-06-28', '2026-06-28', fixed)).toBe('05:03');
  });

  it('midnight (00:00) on today returns 00:00', () => {
    const fixed = new Date('2026-06-28T00:00:00');
    expect(getDefaultTime('2026-06-28', '2026-06-28', fixed)).toBe('00:00');
  });
});

// ─── buildLoggedAt ────────────────────────────────────────────────────────────

describe('buildLoggedAt (FLAG-1: floating-civil YYYY-MM-DDTHH:mm)', () => {
  it('combines civil date and HH:mm time', () => {
    expect(buildLoggedAt('2026-06-28', '13:00')).toBe('2026-06-28T13:00');
  });

  it('no UTC offset — no Z or + in the string', () => {
    const result = buildLoggedAt('2026-06-28', '09:00');
    expect(result).not.toContain('Z');
    expect(result).not.toContain('+');
    expect(result).not.toContain('UTC');
  });
});

// ─── isSaveGatedByConsent ─────────────────────────────────────────────────────

describe('isSaveGatedByConsent (self-log-behavior.md §B.4 — general_health gate)', () => {
  it('NOT gated when general_health is granted (normal save path)', () => {
    expect(isSaveGatedByConsent(true)).toBe(false);
  });

  it('GATED — declined general_health gates the save with nudge', () => {
    expect(isSaveGatedByConsent(false)).toBe(true);
  });

  it('fail-closed: absent consent (false) triggers gate — browsing not blocked', () => {
    // Browsing is never blocked; only the health-write action is gated (§B.4)
    expect(isSaveGatedByConsent(false)).toBe(true);
  });
});

// ─── isSaveEnabled ────────────────────────────────────────────────────────────

describe('isSaveEnabled (capture-ui §5 — Save disabled until value exists)', () => {
  it('weight: enabled when weightStorable=true and timeStorable=true', () => {
    expect(isSaveEnabled({ metricType: 'weight', weightStorable: true, timeStorable: true })).toBe(true);
  });

  it('weight: disabled when weightStorable=false (empty/non-number)', () => {
    expect(isSaveEnabled({ metricType: 'weight', weightStorable: false, timeStorable: true })).toBe(false);
  });

  it('weight: disabled when timeStorable=false', () => {
    expect(isSaveEnabled({ metricType: 'weight', weightStorable: true, timeStorable: false })).toBe(false);
  });

  it('blood_pressure: enabled when BOTH systolic AND diastolic storable', () => {
    expect(isSaveEnabled({
      metricType: 'blood_pressure',
      systolicStorable: true,
      diastolicStorable: true,
      timeStorable: true,
    })).toBe(true);
  });

  it('blood_pressure: disabled when only systolic provided (diastolic missing)', () => {
    expect(isSaveEnabled({
      metricType: 'blood_pressure',
      systolicStorable: true,
      diastolicStorable: false,
      timeStorable: true,
    })).toBe(false);
  });

  it('blood_pressure: disabled when only diastolic provided', () => {
    expect(isSaveEnabled({
      metricType: 'blood_pressure',
      systolicStorable: false,
      diastolicStorable: true,
      timeStorable: true,
    })).toBe(false);
  });

  it('swelling: enabled when textStorable=true', () => {
    expect(isSaveEnabled({ metricType: 'swelling', textStorable: true, timeStorable: true })).toBe(true);
  });
  it('lochia: enabled when textStorable=true', () => {
    expect(isSaveEnabled({ metricType: 'lochia', textStorable: true, timeStorable: true })).toBe(true);
  });
  it('symptom: disabled when textStorable=false', () => {
    expect(isSaveEnabled({ metricType: 'symptom', textStorable: false, timeStorable: true })).toBe(false);
  });
});

// ─── orchestrateSave (blocker #1 / #2 — consent-gated save) ───────────────────
//
// These tests prove the FIX for the stale-callback bug:
//  - The payload is built from the form state AT THE MOMENT SAVE IS CALLED,
//    not captured by a stale memoised callback.
//  - When consent is absent the orchestration returns { action: 'gate', payload }
//    so the caller can store the LIVE payload in a ref and persist it after grant.
//  - The caller NEVER needs to re-call a stale handleSave.
//
// RED: these fail until orchestrateSave is exported from captureScreenLogic.ts.

describe('orchestrateSave (blocker #1 + #2 — consent-gated save, stale-callback fix)', () => {
  const LOGGED_AT = '2026-06-28T13:00';

  function decode(b64: string | null | undefined): string {
    if (!b64) throw new Error('expected base64');
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  // ── (a) addSelfLog NOT called while general_health absent ─────────────────

  it('(a) returns action=gate when consent NOT granted — addSelfLog must NOT be called', () => {
    const result = orchestrateSave({
      saveEnabled: true,
      consentGranted: false,
      metricType: 'weight',
      dateCivil: '2026-06-28',
      timeStr: '13:00',
      weightValue: '64.2',
    });
    expect(result.action).toBe('gate');
    // The caller checks action === 'gate' before calling addSelfLog — so it is never called
  });

  it('action=skip when saveEnabled=false — no payload, no gate, no persist', () => {
    const result = orchestrateSave({
      saveEnabled: false,
      consentGranted: false,
      metricType: 'weight',
      dateCivil: '2026-06-28',
      timeStr: '13:00',
      weightValue: '64.2',
    });
    expect(result.action).toBe('skip');
  });

  // ── (b) After Grant: addSelfLog IS called with the correct payload ─────────

  it('(b) weight: gate result payload has correct value — caller persists it on grant', () => {
    const result = orchestrateSave({
      saveEnabled: true,
      consentGranted: false,
      metricType: 'weight',
      dateCivil: '2026-06-28',
      timeStr: '13:00',
      weightValue: '64.2',
    });
    expect(result.action).toBe('gate');
    if (result.action !== 'gate') return;
    // Payload is built from the LIVE form values, not from mount-time empty state
    expect(result.payload.metricType).toBe('weight');
    expect(decode(result.payload.valueNumeric)).toBe('64.2');
    expect(result.payload.loggedAt).toBe(LOGGED_AT);
    expect(result.payload.unit).toBe('kg');
  });

  it('(b) blood_pressure: gate result payload has systolic AND diastolic', () => {
    const result = orchestrateSave({
      saveEnabled: true,
      consentGranted: false,
      metricType: 'blood_pressure',
      dateCivil: '2026-06-28',
      timeStr: '13:00',
      systolicValue: '120',
      diastolicValue: '78',
    });
    expect(result.action).toBe('gate');
    if (result.action !== 'gate') return;
    expect(result.payload.metricType).toBe('blood_pressure');
    expect(decode(result.payload.valueNumeric)).toBe('120');
    expect(decode(result.payload.valueNumericSecondary)).toBe('78');
    expect(result.payload.unit).toBe('mmHg');
  });

  it('when consentGranted=true returns action=persist with weight payload', () => {
    const result = orchestrateSave({
      saveEnabled: true,
      consentGranted: true,
      metricType: 'weight',
      dateCivil: '2026-06-28',
      timeStr: '13:00',
      weightValue: '64.2',
    });
    expect(result.action).toBe('persist');
    if (result.action !== 'persist') return;
    expect(decode(result.payload.valueNumeric)).toBe('64.2');
  });

  it('gate payload and persist payload are identical SelfLogInputs for the same form state', () => {
    const common = {
      saveEnabled: true,
      metricType: 'weight' as const,
      dateCivil: '2026-06-28',
      timeStr: '13:00',
      weightValue: '64.2',
    };
    const gated = orchestrateSave({ ...common, consentGranted: false });
    const free  = orchestrateSave({ ...common, consentGranted: true });
    // Same payload regardless of consent path — stale-callback bug would produce empty payload
    expect(gated.action).toBe('gate');
    expect(free.action).toBe('persist');
    if (gated.action === 'gate' && free.action === 'persist') {
      expect(gated.payload).toEqual(free.payload);
    }
  });
});

// ─── buildLoggedAt reflects edited time (blocker #4) ─────────────────────────

describe('buildLoggedAt reflects edited time (blocker #4 — time picker must call setTimeStr)', () => {
  it('different timeStr values produce different loggedAt (proves setTimeStr must be wired)', () => {
    const at1200 = buildLoggedAt('2026-06-28', '12:00');
    const at1430 = buildLoggedAt('2026-06-28', '14:30');
    expect(at1200).toBe('2026-06-28T12:00');
    expect(at1430).toBe('2026-06-28T14:30');
    expect(at1200).not.toBe(at1430);
  });

  it('edited minute is reflected — 13:00 vs 13:45 produce distinct loggedAt', () => {
    expect(buildLoggedAt('2026-06-28', '13:00')).not.toBe(buildLoggedAt('2026-06-28', '13:45'));
  });
});

// ─── decodeFieldFromBase64 (SD-5 — blocker) ──────────────────────────────────
//
// RED phase: these tests fail until decodeFieldFromBase64 is exported from
// captureScreenLogic.ts. The encode side (encodeFieldToBase64) is already
// tested; the decode side and the round-trip have no coverage.
//
// Boundary under test: the Hermes atob+TextDecoder vs Node Buffer divergence
// for Thai multi-byte UTF-8.
//
// Security: test values here are test fixtures only — never log health values.

describe('decodeFieldFromBase64 (SD-5 — shared codec, inverse of encodeFieldToBase64)', () => {
  // ── Null / empty guard ───────────────────────────────────────────────────────

  it('returns null for null input', () => {
    expect(decodeFieldFromBase64(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(decodeFieldFromBase64(undefined)).toBeNull();
  });

  it('returns null for empty-string input', () => {
    expect(decodeFieldFromBase64('')).toBeNull();
  });

  // ── Direct decode from known base64 constant ─────────────────────────────────
  // "NjQuMg==" is the standard base64 encoding of ASCII "64.2"

  it('decodes known base64 constant "NjQuMg==" to "64.2"', () => {
    expect(decodeFieldFromBase64('NjQuMg==')).toBe('64.2');
  });

  // ── Round-trip: decodeFieldFromBase64(encodeFieldToBase64(x)) === x ──────────

  it('round-trip: "64.2" (weight value) encodes then decodes identically', () => {
    const original = '64.2';
    expect(decodeFieldFromBase64(encodeFieldToBase64(original))).toBe(original);
  });

  it('round-trip: Thai "เล็กน้อย" (swelling value, 3-byte UTF-8 chars)', () => {
    const original = 'เล็กน้อย';
    expect(decodeFieldFromBase64(encodeFieldToBase64(original))).toBe(original);
  });

  it('round-trip: Thai "หมายเหตุพิเศษ" (note value)', () => {
    const original = 'หมายเหตุพิเศษ';
    expect(decodeFieldFromBase64(encodeFieldToBase64(original))).toBe(original);
  });

  it('round-trip: emoji "👶" (4-byte UTF-8 sequence)', () => {
    const original = '👶';
    expect(decodeFieldFromBase64(encodeFieldToBase64(original))).toBe(original);
  });
});
