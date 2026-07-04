/**
 * medicationCaptureLogic.test.ts — RED phase (TDD)
 *
 * Tests for the pure medication-capture logic:
 *  1. buildMedicationLogInput  — builds MedicationLogInput per status + base64 note
 *  2. buildMedicationEchoLine  — verbatim echo; INV-M2 (equal weight, no shaming)
 *  3. orchestrateMedicationSave — consent-gate; gate→grant persists via addLog
 *
 * NO component harness — all functions are pure (no React Native imports).
 *
 * Key invariants under test:
 *   INV-M1: echo never contains a grade/verdict word (no "good/poor/normal/high").
 *   INV-M2: taken and missed produce IDENTICAL structural output — no shaming;
 *           both return { type: 'text' } with the same format pattern.
 *   INV-M4: plan name + dose shown VERBATIM — never translated or modified.
 *
 * Security: test fixtures are synthetic — never log real health values (SD-5).
 */

import {
  buildMedicationLogInput,
  buildMedicationEchoLine,
  orchestrateMedicationSave,
} from './medicationCaptureLogic';
import { decodeFieldFromBase64 } from './captureScreenLogic';
import type { MedicationLogInput } from '../sync/syncTypes';

// ─── helpers ─────────────────────────────────────────────────────────────────

function decode(b64: string | null | undefined): string {
  if (b64 == null || b64 === '') throw new Error('expected base64 but got: ' + String(b64));
  return Buffer.from(b64, 'base64').toString('utf8');
}

// ─── buildMedicationLogInput ──────────────────────────────────────────────────

describe('buildMedicationLogInput (medication-behavior §1.2 + §B.3)', () => {
  const PLAN_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
  const OCC_TIME = '2026-07-04T08:05';

  // ── status = taken ────────────────────────────────────────────────────────

  describe('status = taken', () => {
    let input: MedicationLogInput;
    beforeAll(() => {
      input = buildMedicationLogInput(PLAN_ID, 'taken', OCC_TIME);
    });

    it('medicationPlanId is the supplied plan id', () => {
      expect(input.medicationPlanId).toBe(PLAN_ID);
    });
    it('status is "taken"', () => {
      expect(input.status).toBe('taken');
    });
    it('occurrenceTime is passed through unchanged (FLAG-1 floating-civil)', () => {
      expect(input.occurrenceTime).toBe(OCC_TIME);
    });
    it('occurrenceTime contains no Z / UTC offset (floating-civil — FLAG-1)', () => {
      expect(input.occurrenceTime).not.toContain('Z');
      expect(input.occurrenceTime).not.toContain('+');
      expect(input.occurrenceTime).not.toContain('UTC');
    });
    it('note is null when not supplied', () => {
      expect(input.note).toBeNull();
    });
  });

  // ── status = missed ───────────────────────────────────────────────────────

  describe('status = missed', () => {
    let input: MedicationLogInput;
    beforeAll(() => {
      input = buildMedicationLogInput(PLAN_ID, 'missed', OCC_TIME);
    });

    it('status is "missed"', () => {
      expect(input.status).toBe('missed');
    });
    it('medicationPlanId is the supplied plan id', () => {
      expect(input.medicationPlanId).toBe(PLAN_ID);
    });
    it('occurrenceTime is passed through unchanged', () => {
      expect(input.occurrenceTime).toBe(OCC_TIME);
    });
    it('note is null when not supplied', () => {
      expect(input.note).toBeNull();
    });
  });

  // ── ad-hoc (no plan) ──────────────────────────────────────────────────────

  describe('ad-hoc dose (medicationPlanId = null)', () => {
    it('null planId → medicationPlanId is null in the input', () => {
      const input = buildMedicationLogInput(null, 'taken', OCC_TIME);
      expect(input.medicationPlanId).toBeNull();
    });
    it('undefined planId → medicationPlanId is null in the input', () => {
      const input = buildMedicationLogInput(undefined, 'taken', OCC_TIME);
      expect(input.medicationPlanId).toBeNull();
    });
    it('ad-hoc missed: status still "missed" (D3 — ad-hoc excluded from adherence, §A.5)', () => {
      const input = buildMedicationLogInput(null, 'missed', OCC_TIME);
      expect(input.status).toBe('missed');
      expect(input.medicationPlanId).toBeNull();
    });
  });

  // ── note base64 encoding ──────────────────────────────────────────────────

  describe('note encoding (D4 — base64, never parsed)', () => {
    it('note is base64-encoded when supplied', () => {
      const input = buildMedicationLogInput(PLAN_ID, 'taken', OCC_TIME, 'ก่อนอาหาร');
      expect(typeof input.note).toBe('string');
      expect(decode(input.note)).toBe('ก่อนอาหาร');
    });

    it('Thai note round-trips correctly (multi-byte UTF-8)', () => {
      const note = 'หลังอาหารเช้า ดื่มน้ำเยอะๆ';
      const input = buildMedicationLogInput(PLAN_ID, 'taken', OCC_TIME, note);
      expect(decodeFieldFromBase64(input.note)).toBe(note);
    });

    it('note is null when not supplied', () => {
      const input = buildMedicationLogInput(PLAN_ID, 'taken', OCC_TIME);
      expect(input.note).toBeNull();
    });

    it('note is null for empty string', () => {
      const input = buildMedicationLogInput(PLAN_ID, 'taken', OCC_TIME, '');
      expect(input.note).toBeNull();
    });

    it('note is null for whitespace-only string', () => {
      const input = buildMedicationLogInput(PLAN_ID, 'taken', OCC_TIME, '   ');
      expect(input.note).toBeNull();
    });

    it('note is trimmed before encoding', () => {
      const input = buildMedicationLogInput(PLAN_ID, 'taken', OCC_TIME, '  ก่อนนอน  ');
      expect(decode(input.note)).toBe('ก่อนนอน');
    });
  });

  // ── occurrenceTime format ─────────────────────────────────────────────────

  describe('occurrenceTime (FLAG-1 — floating-civil YYYY-MM-DDTHH:mm)', () => {
    it('combines civil date and time correctly', () => {
      const input = buildMedicationLogInput(null, 'taken', '2026-07-04T12:00');
      expect(input.occurrenceTime).toBe('2026-07-04T12:00');
    });
    it('is passed through verbatim — no zone normalization', () => {
      const input = buildMedicationLogInput(null, 'taken', '2026-07-04T23:59');
      expect(input.occurrenceTime).toBe('2026-07-04T23:59');
    });
  });
});

// ─── buildMedicationEchoLine ──────────────────────────────────────────────────

describe('buildMedicationEchoLine (capture-ui §3.1 + INV-M1/M2/M4)', () => {
  const TAKEN_LABEL = 'กินแล้ว';
  const MISSED_LABEL = 'ไม่ได้กิน';
  const TAKEN_EN = 'Taken';
  const MISSED_EN = 'Not taken';

  // ── spec example ───────────────────────────────────────────────────────────

  it('th taken: matches spec example — ▪ Triferdine 150 · กินแล้ว 08:05', () => {
    const line = buildMedicationEchoLine(
      'Triferdine 150', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
    );
    expect(line).toEqual({
      type: 'text',
      value: '▪ Triferdine 150 · กินแล้ว 08:05',
    });
  });

  it('th missed: same structure as taken — only label differs (INV-M2)', () => {
    const line = buildMedicationEchoLine(
      'Triferdine 150', null, 'missed', '08:05', TAKEN_LABEL, MISSED_LABEL,
    );
    expect(line).toEqual({
      type: 'text',
      value: '▪ Triferdine 150 · ไม่ได้กิน 08:05',
    });
  });

  // ── INV-M2 — equal visual weight / no shaming ─────────────────────────────

  describe('INV-M2 — taken and missed have IDENTICAL structural treatment (no shaming)', () => {
    it('taken returns { type: "text" } (not placeholder — status is always a valid value)', () => {
      expect(buildMedicationEchoLine(
        'Triferdine 150', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      ).type).toBe('text');
    });
    it('missed returns { type: "text" } — NOT a placeholder or error type (no shaming)', () => {
      expect(buildMedicationEchoLine(
        'Triferdine 150', null, 'missed', '08:05', TAKEN_LABEL, MISSED_LABEL,
      ).type).toBe('text');
    });
    it('taken and missed match the same format pattern (only label text differs)', () => {
      const takenLine = buildMedicationEchoLine(
        'Triferdine 150', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      const missedLine = buildMedicationEchoLine(
        'Triferdine 150', null, 'missed', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      // Both must match: ▪ {planName} · {statusLabel} {time}
      const pattern = /^▪ .+ · .+ \d{2}:\d{2}$/;
      if (takenLine.type === 'text') expect(takenLine.value).toMatch(pattern);
      if (missedLine.type === 'text') expect(missedLine.value).toMatch(pattern);
    });
    it('missed echo does not contain any shame/failure word (AC-20)', () => {
      const line = buildMedicationEchoLine(
        'Triferdine 150', null, 'missed', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      if (line.type === 'text') {
        expect(line.value).not.toMatch(/fail|skip|miss|ลืม|พลาด|ไม่ดี|wrong/i);
      }
    });
  });

  // ── INV-M1 — no grade/verdict words ──────────────────────────────────────

  describe('INV-M1 — no grade/verdict words in echo (AC-20)', () => {
    it('taken echo has no grade word', () => {
      const line = buildMedicationEchoLine(
        'Triferdine 150', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      if (line.type === 'text') {
        expect(line.value).not.toMatch(/good|poor|normal|abnormal|high|low|pass/i);
      }
    });
    it('missed echo has no grade word', () => {
      const line = buildMedicationEchoLine(
        'Triferdine 150', null, 'missed', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      if (line.type === 'text') {
        expect(line.value).not.toMatch(/good|poor|normal|abnormal|high|low|pass/i);
      }
    });
  });

  // ── INV-M4 — plan name/dose verbatim ─────────────────────────────────────

  describe('INV-M4 — plan name and dose shown VERBATIM (never translated)', () => {
    it('plan name is shown verbatim (ASCII + number)', () => {
      const line = buildMedicationEchoLine(
        'Triferdine 150', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      if (line.type === 'text') {
        expect(line.value).toContain('Triferdine 150');
      }
    });
    it('plan name with Thai characters is shown verbatim', () => {
      const line = buildMedicationEchoLine(
        'ยาเม็ดวิตามินซี', null, 'taken', '09:00', TAKEN_LABEL, MISSED_LABEL,
      );
      if (line.type === 'text') {
        expect(line.value).toContain('ยาเม็ดวิตามินซี');
      }
    });
    it('dose is appended verbatim when present', () => {
      const line = buildMedicationEchoLine(
        'Triferdine 150', '1 เม็ด', 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      if (line.type === 'text') {
        expect(line.value).toContain('Triferdine 150');
        expect(line.value).toContain('1 เม็ด');
      }
    });
    it('dose absent → no dose in echo', () => {
      const withDose = buildMedicationEchoLine(
        'Triferdine 150', '1 เม็ด', 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      const noDose = buildMedicationEchoLine(
        'Triferdine 150', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      // withDose should be longer (includes the dose text)
      if (withDose.type === 'text' && noDose.type === 'text') {
        expect(withDose.value.length).toBeGreaterThan(noDose.value.length);
      }
    });
    it('dose with empty string is treated as absent (no trailing space)', () => {
      const line = buildMedicationEchoLine(
        'Triferdine 150', '', 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      );
      expect(line).toEqual({
        type: 'text',
        value: '▪ Triferdine 150 · กินแล้ว 08:05',
      });
    });
  });

  // ── no plan name (ad-hoc) → placeholder ──────────────────────────────────

  describe('ad-hoc — no plan name', () => {
    it('empty planName returns placeholder (no empty ▪  · status echo)', () => {
      expect(buildMedicationEchoLine(
        '', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
      ).type).toBe('placeholder');
    });
    it('whitespace-only planName returns placeholder', () => {
      expect(buildMedicationEchoLine(
        '  ', null, 'missed', '08:05', TAKEN_LABEL, MISSED_LABEL,
      ).type).toBe('placeholder');
    });
  });

  // ── uses ▪ logged-entry mark ──────────────────────────────────────────────

  it('echo line starts with ▪ (design-system §6 LOGGED mark)', () => {
    const line = buildMedicationEchoLine(
      'Triferdine 150', null, 'taken', '08:05', TAKEN_LABEL, MISSED_LABEL,
    );
    if (line.type === 'text') {
      expect(line.value).toMatch(/^▪/);
    }
  });

  // ── en parity ─────────────────────────────────────────────────────────────

  describe('en locale parity (caller-supplied labels — INV-M4 / capture-ui §7)', () => {
    it('en taken: ▪ Triferdine 150 · Taken 08:05', () => {
      expect(buildMedicationEchoLine(
        'Triferdine 150', null, 'taken', '08:05', TAKEN_EN, MISSED_EN,
      )).toEqual({
        type: 'text',
        value: '▪ Triferdine 150 · Taken 08:05',
      });
    });
    it('en missed: ▪ Triferdine 150 · Not taken 08:05', () => {
      expect(buildMedicationEchoLine(
        'Triferdine 150', null, 'missed', '08:05', TAKEN_EN, MISSED_EN,
      )).toEqual({
        type: 'text',
        value: '▪ Triferdine 150 · Not taken 08:05',
      });
    });
    it('en taken and missed both type="text" (INV-M2)', () => {
      expect(buildMedicationEchoLine(
        'Triferdine 150', null, 'taken', '08:05', TAKEN_EN, MISSED_EN,
      ).type).toBe('text');
      expect(buildMedicationEchoLine(
        'Triferdine 150', null, 'missed', '08:05', TAKEN_EN, MISSED_EN,
      ).type).toBe('text');
    });
  });
});

// ─── orchestrateMedicationSave ────────────────────────────────────────────────

describe('orchestrateMedicationSave (medication-behavior §B.4 — consent-gated save)', () => {
  const PLAN_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
  const CIVIL = '2026-07-04';
  const TIME = '08:05';

  // ── skip ──────────────────────────────────────────────────────────────────

  it('returns action=skip when saveEnabled=false (§5 Save disabled until valid)', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: false,
      consentGranted: true,
      planId: PLAN_ID,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    expect(result.action).toBe('skip');
  });

  // ── gate — consent absent ────────────────────────────────────────────────

  it('returns action=gate when consent absent (fail-closed — §B.4)', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: false,
      planId: PLAN_ID,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    expect(result.action).toBe('gate');
  });

  it('gate result carries the correctly-built MedicationLogInput payload', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: false,
      planId: PLAN_ID,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    expect(result.action).toBe('gate');
    if (result.action !== 'gate') return;
    expect(result.payload.medicationPlanId).toBe(PLAN_ID);
    expect(result.payload.status).toBe('taken');
    expect(result.payload.occurrenceTime).toBe(`${CIVIL}T${TIME}`);
    expect(result.payload.note).toBeNull();
  });

  it('gate with missed status carries status=missed in payload', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: false,
      planId: PLAN_ID,
      status: 'missed',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    if (result.action === 'gate') {
      expect(result.payload.status).toBe('missed');
    }
  });

  // ── persist — consent granted ────────────────────────────────────────────

  it('returns action=persist when consent granted', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: PLAN_ID,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    expect(result.action).toBe('persist');
  });

  it('persist payload has medicationPlanId + status + occurrenceTime', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: PLAN_ID,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    if (result.action !== 'persist') return;
    expect(result.payload.medicationPlanId).toBe(PLAN_ID);
    expect(result.payload.status).toBe('taken');
    expect(result.payload.occurrenceTime).toBe('2026-07-04T08:05');
  });

  // ── note in payload ───────────────────────────────────────────────────────

  it('note is base64-encoded in the payload', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: PLAN_ID,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
      noteText: 'ก่อนอาหารเช้า',
    });
    if (result.action !== 'persist') return;
    expect(result.payload.note).not.toBeNull();
    expect(decodeFieldFromBase64(result.payload.note)).toBe('ก่อนอาหารเช้า');
  });

  it('absent noteText → note is null in payload', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: PLAN_ID,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    if (result.action !== 'persist') return;
    expect(result.payload.note).toBeNull();
  });

  // ── gate and persist payloads are identical ───────────────────────────────

  it('gate payload === persist payload for the same form state (no stale-closure bug)', () => {
    const common = {
      saveEnabled: true,
      planId: PLAN_ID,
      status: 'taken' as const,
      dateCivil: CIVIL,
      timeStr: TIME,
      noteText: 'หลังอาหาร',
    };
    const gated = orchestrateMedicationSave({ ...common, consentGranted: false });
    const free  = orchestrateMedicationSave({ ...common, consentGranted: true });
    expect(gated.action).toBe('gate');
    expect(free.action).toBe('persist');
    if (gated.action === 'gate' && free.action === 'persist') {
      expect(gated.payload).toEqual(free.payload);
    }
  });

  // ── ad-hoc (no plan) ──────────────────────────────────────────────────────

  it('ad-hoc (planId=null) persist payload has null medicationPlanId', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: null,
      status: 'taken',
      dateCivil: CIVIL,
      timeStr: TIME,
    });
    if (result.action !== 'persist') return;
    expect(result.payload.medicationPlanId).toBeNull();
  });

  // ── occurrenceTime is floating-civil ─────────────────────────────────────

  it('occurrenceTime = dateCivil + T + timeStr (FLAG-1, no zone)', () => {
    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: null,
      status: 'taken',
      dateCivil: '2026-07-05',
      timeStr: '12:30',
    });
    if (result.action !== 'persist') return;
    expect(result.payload.occurrenceTime).toBe('2026-07-05T12:30');
    expect(result.payload.occurrenceTime).not.toContain('Z');
    expect(result.payload.occurrenceTime).not.toContain('+');
  });
});
