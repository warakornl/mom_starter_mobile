/**
 * captureEcho.test.ts — RED phase (TDD)
 *
 * Tests for the live-preview "echo line" builder (capture-ui.md §0/§3/§8,
 * self-log-behavior.md §1, INV-S1).
 *
 * KEY INVARIANTS:
 *  - Values shown VERBATIM — no rounding, no unit conversion.
 *  - NEVER coloured or graded (INV-S1/AC-20): BP 150/95 renders identically to 110/70.
 *  - No health verdict words (normal/high/low/ไม่ปกติ) in any output.
 *  - Empty value → placeholder (type: 'placeholder').
 */

import {
  buildWeightEchoLine,
  buildBpEchoLine,
  buildTextEchoLine,
  type EchoLine,
} from './captureEcho';

// ── helpers ────────────────────────────────────────────────────────────────────

function echoText(line: EchoLine): string {
  if (line.type !== 'text') throw new Error('Expected text echo, got placeholder');
  return line.value;
}

// ── buildWeightEchoLine ────────────────────────────────────────────────────────

describe('buildWeightEchoLine (capture-ui §3.2 + §0 echo signature)', () => {
  it('th locale: matches spec example 64.2 กก. at 13:00', () => {
    expect(buildWeightEchoLine('64.2', '13:00', 'น้ำหนัก', 'กก.')).toEqual({
      type: 'text',
      value: '▪ น้ำหนัก 64.2 กก. · 13:00',
    });
  });

  it('uses ▪ logged-entry mark (design-system §6 LOGGED)', () => {
    expect(echoText(buildWeightEchoLine('64.2', '13:00', 'น้ำหนัก', 'กก.'))).toMatch(/^▪/);
  });

  it('shows value VERBATIM (no rounding)', () => {
    expect(echoText(buildWeightEchoLine('64.200', '09:10', 'น้ำหนัก', 'กก.'))).toContain('64.200');
  });

  it('th: includes Thai unit กก.', () => {
    expect(echoText(buildWeightEchoLine('64.2', '13:00', 'น้ำหนัก', 'กก.'))).toContain('กก.');
  });

  it('trims whitespace from value', () => {
    expect(echoText(buildWeightEchoLine('  64.2  ', '13:00', 'น้ำหนัก', 'กก.'))).toContain('64.2');
  });

  it('returns placeholder type when value is empty', () => {
    expect(buildWeightEchoLine('', '13:00', 'น้ำหนัก', 'กก.').type).toBe('placeholder');
    expect(buildWeightEchoLine('   ', '13:00', 'น้ำหนัก', 'กก.').type).toBe('placeholder');
  });

  it('time is shown verbatim at end of line', () => {
    const text = echoText(buildWeightEchoLine('64.2', '09:10', 'น้ำหนัก', 'กก.'));
    expect(text).toMatch(/09:10$/);
  });
});

// ── buildBpEchoLine ────────────────────────────────────────────────────────────

describe('buildBpEchoLine (capture-ui §3.3 + INV-S1 no-colour/no-grade)', () => {
  it('th locale: matches spec example 120/78 mmHg at 13:00', () => {
    expect(buildBpEchoLine('120', '78', '13:00', 'ความดัน', 'mmHg')).toEqual({
      type: 'text',
      value: '▪ ความดัน 120/78 mmHg · 13:00',
    });
  });

  it('uses "/" separator between systolic and diastolic', () => {
    expect(echoText(buildBpEchoLine('120', '78', '13:00', 'ความดัน', 'mmHg'))).toContain('120/78');
  });

  it('includes mmHg unit', () => {
    expect(echoText(buildBpEchoLine('120', '78', '13:00', 'ความดัน', 'mmHg'))).toContain('mmHg');
  });

  describe('INV-S1 — BP 150/95 and 110/70 render identical structure (no grading)', () => {
    it('150/95 does not contain any grade/verdict word', () => {
      const text = echoText(buildBpEchoLine('150', '95', '13:00', 'ความดัน', 'mmHg'));
      expect(text).not.toMatch(/normal|high|low|ไม่ปกติ|สูง|ต่ำ|abnormal/i);
    });
    it('110/70 does not contain any grade/verdict word', () => {
      const text = echoText(buildBpEchoLine('110', '70', '13:00', 'ความดัน', 'mmHg'));
      expect(text).not.toMatch(/normal|high|low|ไม่ปกติ|สูง|ต่ำ|abnormal/i);
    });
    it('150/95 and 110/70 follow identical format pattern', () => {
      const extreme = echoText(buildBpEchoLine('150', '95', '13:00', 'ความดัน', 'mmHg'));
      const normal = echoText(buildBpEchoLine('110', '70', '13:00', 'ความดัน', 'mmHg'));
      // Both must match same regex; only the numbers differ
      const pattern = /^▪ ความดัน \d+\/\d+ mmHg · \d{2}:\d{2}$/;
      expect(extreme).toMatch(pattern);
      expect(normal).toMatch(pattern);
    });
    it('both produce type "text" (no difference in structure)', () => {
      expect(buildBpEchoLine('150', '95', '13:00', 'ความดัน', 'mmHg').type).toBe(
        buildBpEchoLine('110', '70', '13:00', 'ความดัน', 'mmHg').type,
      );
    });
  });

  it('returns placeholder when systolic is empty', () => {
    expect(buildBpEchoLine('', '78', '13:00', 'ความดัน', 'mmHg').type).toBe('placeholder');
  });
  it('returns placeholder when diastolic is empty', () => {
    expect(buildBpEchoLine('120', '', '13:00', 'ความดัน', 'mmHg').type).toBe('placeholder');
  });
  it('returns placeholder when both are empty', () => {
    expect(buildBpEchoLine('', '', '13:00', 'ความดัน', 'mmHg').type).toBe('placeholder');
  });
});

// ── buildTextEchoLine ─────────────────────────────────────────────────────────

describe('buildTextEchoLine (capture-ui §3.2 — swelling / lochia / symptom)', () => {
  it('th swelling: matches spec example', () => {
    expect(buildTextEchoLine('บวม', 'เล็กน้อย', '13:00')).toEqual({
      type: 'text',
      value: '▪ บวม เล็กน้อย · 13:00',
    });
  });

  it('th lochia: uses น้ำคาวปลา label', () => {
    expect(buildTextEchoLine('น้ำคาวปลา', 'สีแดง', '13:00')).toEqual({
      type: 'text',
      value: '▪ น้ำคาวปลา สีแดง · 13:00',
    });
  });

  it('th symptom: uses อาการ label', () => {
    expect(buildTextEchoLine('อาการ', 'คลื่นไส้', '13:00')).toEqual({
      type: 'text',
      value: '▪ อาการ คลื่นไส้ · 13:00',
    });
  });

  it('shows value VERBATIM — never interpreted', () => {
    const text = echoText(buildTextEchoLine('อาการ', 'ปวดหัวมาก', '09:00'));
    expect(text).toContain('ปวดหัวมาก');
  });

  it('returns placeholder when valueText is empty', () => {
    expect(buildTextEchoLine('บวม', '', '13:00').type).toBe('placeholder');
    expect(buildTextEchoLine('น้ำคาวปลา', '   ', '13:00').type).toBe('placeholder');
  });

  it('does not add any grade/verdict word to text-type echo', () => {
    // INV-S4: valueText is never parsed/interpreted
    const text = echoText(buildTextEchoLine('อาการ', 'ไม่สบาย', '10:00'));
    expect(text).not.toMatch(/serious|severe|normal|grade/i);
    expect(text).toContain('ไม่สบาย');
  });
});

// ─── Blocker #6: locale-aware echo — en parity tests (RED → GREEN) ───────────
//
// The echo builders must accept caller-supplied label/unit so CaptureScreen
// can pass i18n strings. Hard-coded Thai is the bug — en users see Thai labels.
//
// These tests currently FAIL because:
//  - buildWeightEchoLine has no label/unit params → TypeScript error on extra args
//    (we work around with type cast to prove the runtime behaviour before fix)
//  - After fix: caller passes (value, time, label, unit) — fully locale-aware.

describe('blocker #6 — locale-aware echo labels and units (en parity)', () => {
  it('en locale weight echo: ▪ Weight 64.2 kg · 13:00', () => {
    expect(buildWeightEchoLine('64.2', '13:00', 'Weight', 'kg')).toEqual({
      type: 'text',
      value: '▪ Weight 64.2 kg · 13:00',
    });
  });

  it('en locale BP echo: ▪ Blood pressure 120/78 mmHg · 13:00', () => {
    expect(buildBpEchoLine('120', '78', '13:00', 'Blood pressure', 'mmHg')).toEqual({
      type: 'text',
      value: '▪ Blood pressure 120/78 mmHg · 13:00',
    });
  });

  it('en locale swelling echo uses caller-supplied "Swelling" label', () => {
    expect(buildTextEchoLine('Swelling', 'mild', '13:00')).toEqual({
      type: 'text',
      value: '▪ Swelling mild · 13:00',
    });
  });

  it('th locale weight echo still works: ▪ น้ำหนัก 64.2 กก. · 13:00', () => {
    expect(buildWeightEchoLine('64.2', '13:00', 'น้ำหนัก', 'กก.')).toEqual({
      type: 'text',
      value: '▪ น้ำหนัก 64.2 กก. · 13:00',
    });
  });

  it('th locale BP echo still works: ▪ ความดัน 120/78 mmHg · 13:00', () => {
    expect(buildBpEchoLine('120', '78', '13:00', 'ความดัน', 'mmHg')).toEqual({
      type: 'text',
      value: '▪ ความดัน 120/78 mmHg · 13:00',
    });
  });
});
