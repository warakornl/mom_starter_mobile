/**
 * captureValidation.test.ts — RED phase (TDD)
 *
 * Tests for the typo-guard validation logic (capture-ui.md §4,
 * self-log-behavior.md §2, INV-S1/INV-S3).
 *
 * KEY INVARIANTS:
 *  INV-S1 — extreme and normal values produce identical validation structure
 *            (BP 150 and 110 both storable; hint copy never grades value).
 *  INV-S3 — hint copy NEVER says "too high/low", "abnormal", "สูงเกิน", etc.
 *            only "double-check this number" (plausibility guard only).
 */

import {
  validateWeight,
  validateBP,
  validateTime,
  HINT_NOT_A_NUMBER,
  HINT_DOUBLE_CHECK,
  HINT_INVALID_TIME,
} from './captureValidation';

// ── validateWeight ────────────────────────────────────────────────────────────

describe('validateWeight (capture-ui §4 typo-guard 20–300 kg)', () => {
  describe('valid in-range values → storable: true, hint: null', () => {
    it.each([
      ['64.2'],
      ['20'],
      ['300'],
      ['100'],
      ['22.0'], // E6: extreme-but-valid — identical storable:true to any other in-range
      ['150.5'],
    ])('accepts %s', (v) => {
      expect(validateWeight(v)).toEqual({ storable: true, hint: null });
    });
  });

  describe('out-of-range but well-formed → storable: true, hint: DOUBLE_CHECK', () => {
    it('weight 19 (just below 20) shows double-check hint but is storable', () => {
      const r = validateWeight('19');
      expect(r.storable).toBe(true);
      expect(r.hint).toBe(HINT_DOUBLE_CHECK);
    });
    it('weight 301 (just above 300) shows double-check hint but is storable', () => {
      const r = validateWeight('301');
      expect(r.storable).toBe(true);
      expect(r.hint).toBe(HINT_DOUBLE_CHECK);
    });
    it('extreme weight 640 (slipped decimal) shows double-check hint but is storable', () => {
      const r = validateWeight('640');
      expect(r.storable).toBe(true);
      expect(r.hint).toBe(HINT_DOUBLE_CHECK);
    });
  });

  describe('non-number → storable: false, blocks Save', () => {
    it('blocks Save for "abc"', () => {
      expect(validateWeight('abc')).toEqual({ storable: false, hint: HINT_NOT_A_NUMBER });
    });
    it('blocks Save for "12x"', () => {
      expect(validateWeight('12x')).toEqual({ storable: false, hint: HINT_NOT_A_NUMBER });
    });
  });

  describe('empty input → storable: false, no hint (keeps Save disabled silently)', () => {
    it('blocks Save for empty string', () => {
      expect(validateWeight('')).toEqual({ storable: false, hint: null });
    });
    it('blocks Save for whitespace-only', () => {
      expect(validateWeight('   ')).toEqual({ storable: false, hint: null });
    });
  });

  describe('INV-S3 — hint copy must never constitute a health verdict', () => {
    it('out-of-range hint never contains "too high"/"too low"/"ไม่ปกติ"/"abnormal"', () => {
      const hint = validateWeight('1').hint!;
      expect(hint).not.toMatch(/too high|too low|ไม่ปกติ|abnormal|สูงเกิน|ต่ำเกิน/i);
    });
    it('NOT_A_NUMBER hint does not suggest medical action', () => {
      expect(HINT_NOT_A_NUMBER).not.toMatch(/high|low|normal|ผิดปกติ/i);
    });
    it('DOUBLE_CHECK hint is phrased as a neutral typing check', () => {
      expect(HINT_DOUBLE_CHECK).toContain('Double-check');
      expect(HINT_DOUBLE_CHECK).toContain('ตรวจสอบตัวเลขอีกครั้ง');
    });
  });
});

// ── validateBP ────────────────────────────────────────────────────────────────

describe('validateBP (capture-ui §3.3 + §4 — integer 30–300 mmHg, INV-S1/INV-S3)', () => {
  describe('valid in-range integer values', () => {
    it.each([
      ['30'],
      ['120'],
      ['78'],
      ['300'],
      ['150'],
      ['110'],
      ['95'],
      ['70'],
    ])('accepts %s', (v) => {
      expect(validateBP(v)).toEqual({ storable: true, hint: null });
    });
  });

  describe('INV-S1 — extreme vs normal BP produce identical validation result', () => {
    it('BP 150 (extreme high) and BP 110 (normal) produce identical validation', () => {
      expect(validateBP('150')).toEqual(validateBP('110'));
    });
    it('BP 95 (diastolic extreme) and BP 70 (normal) produce identical validation', () => {
      expect(validateBP('95')).toEqual(validateBP('70'));
    });
  });

  describe('out-of-range integer → storable: true, double-check hint', () => {
    it('29 (below 30) shows hint but storable', () => {
      const r = validateBP('29');
      expect(r.storable).toBe(true);
      expect(r.hint).toBe(HINT_DOUBLE_CHECK);
    });
    it('301 (above 300) shows hint but storable', () => {
      const r = validateBP('301');
      expect(r.storable).toBe(true);
      expect(r.hint).toBe(HINT_DOUBLE_CHECK);
    });
  });

  describe('non-number or non-integer → storable: false', () => {
    it('blocks Save for "abc"', () => {
      expect(validateBP('abc')).toEqual({ storable: false, hint: HINT_NOT_A_NUMBER });
    });
    it('blocks Save for decimal 120.5 (BP must be integer)', () => {
      expect(validateBP('120.5')).toEqual({ storable: false, hint: HINT_NOT_A_NUMBER });
    });
    it('blocks Save for empty', () => {
      expect(validateBP('')).toEqual({ storable: false, hint: null });
    });
  });

  describe('INV-S3 — BP hint never grades the value medically', () => {
    it('out-of-range BP hint never says "too high/low" or medical verdict', () => {
      const hint = validateBP('12').hint!;
      expect(hint).not.toMatch(/too high|too low|ไม่ปกติ|abnormal|สูงเกิน|ต่ำเกิน/i);
    });
  });
});

// ── validateTime ──────────────────────────────────────────────────────────────

describe('validateTime (capture-ui §4 — HH:mm format)', () => {
  describe('valid times', () => {
    it.each([
      ['13:00'],
      ['00:00'],
      ['23:59'],
      ['09:05'],
    ])('accepts %s', (v) => {
      expect(validateTime(v)).toEqual({ storable: true, hint: null });
    });
  });

  describe('invalid times → storable: false', () => {
    it('rejects 25:00 (invalid hour)', () => {
      expect(validateTime('25:00')).toEqual({ storable: false, hint: HINT_INVALID_TIME });
    });
    it('rejects 12:60 (invalid minute)', () => {
      expect(validateTime('12:60')).toEqual({ storable: false, hint: HINT_INVALID_TIME });
    });
    it('rejects non-time string', () => {
      expect(validateTime('not a time').storable).toBe(false);
    });
    it('rejects empty', () => {
      expect(validateTime('')).toEqual({ storable: false, hint: HINT_INVALID_TIME });
    });
  });
});
