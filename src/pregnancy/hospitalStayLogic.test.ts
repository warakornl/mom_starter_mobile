/**
 * hospitalStayLogic.test.ts — TDD tests for hospital-stay client validation.
 *
 * Covers: pregnancy-summary-design.md §1.3 (client validation rules) + §1.4 PIN.
 *
 * Rules under test:
 *   HV-1: date ≤ today (both admission and discharge)
 *   HV-2: discharge ≥ admission (when both present)
 *   HV-3: OQ-PS4 warn-not-block when admission > 7 days from birthDate
 *   HV-4: §1.4 PIN — buildHospitalStayFields includes key ↔ presence = mutation
 *   HV-5: absent (undefined) → key omitted (no mutation)
 *   HV-6: explicit null → key present as null (clears column)
 *   HV-7: Base64 no-op cipher (base64(utf8(date))) for present dates
 */

import {
  validateHospitalDates,
  shouldWarnAdmissionFarFromBirth,
  buildHospitalStayFields,
} from './hospitalStayLogic';
import { decodeDateFromWire } from './hospitalStayCipher';

const TODAY = '2026-07-10';

// ─── validateHospitalDates ────────────────────────────────────────────────────

describe('validateHospitalDates', () => {
  // HV-1: admission in future
  it('[HV-1a] admission > today → date-in-future on admission', () => {
    const result = validateHospitalDates('2026-07-11', null, TODAY);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('date-in-future');
      expect(result.field).toBe('admission');
    }
  });

  // HV-1: discharge in future
  it('[HV-1b] discharge > today → date-in-future on discharge', () => {
    const result = validateHospitalDates('2026-07-08', '2026-07-11', TODAY);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('date-in-future');
      expect(result.field).toBe('discharge');
    }
  });

  // HV-1: same day as today is allowed
  it('[HV-1c] admission == today → valid', () => {
    const result = validateHospitalDates(TODAY, null, TODAY);
    expect(result.valid).toBe(true);
  });

  // HV-2: discharge before admission
  it('[HV-2a] discharge < admission → discharge-before-admission', () => {
    const result = validateHospitalDates('2026-07-08', '2026-07-07', TODAY);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('discharge-before-admission');
      expect(result.field).toBe('discharge');
    }
  });

  // HV-2: same day is allowed (discharge == admission)
  it('[HV-2b] discharge == admission → valid', () => {
    const result = validateHospitalDates('2026-07-08', '2026-07-08', TODAY);
    expect(result.valid).toBe(true);
  });

  // HV-2: discharge after admission → valid
  it('[HV-2c] discharge > admission → valid', () => {
    const result = validateHospitalDates('2026-07-08', '2026-07-09', TODAY);
    expect(result.valid).toBe(true);
  });

  // Missing dates — both absent → valid (optional fields)
  it('[HV-1d] both absent → valid', () => {
    const result = validateHospitalDates(null, null, TODAY);
    expect(result.valid).toBe(true);
  });

  // Only admission → valid (discharge optional)
  it('[HV-2d] only admission set (past) → valid', () => {
    const result = validateHospitalDates('2026-07-05', null, TODAY);
    expect(result.valid).toBe(true);
  });

  // Only discharge → valid (admission optional)
  it('[HV-2e] only discharge set (past) → valid', () => {
    const result = validateHospitalDates(null, '2026-07-06', TODAY);
    expect(result.valid).toBe(true);
  });

  // Priority: future date takes precedence over discharge-before-admission
  it('[HV-1e] discharge in future takes priority over discharge-before-admission', () => {
    // admission=2026-07-10, discharge=2026-07-20 (future) — future check fires first
    const result = validateHospitalDates('2026-07-10', '2026-07-20', TODAY);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('date-in-future');
    }
  });
});

// ─── shouldWarnAdmissionFarFromBirth (OQ-PS4) ────────────────────────────────

describe('shouldWarnAdmissionFarFromBirth', () => {
  const BIRTH_DATE = '2026-07-05';

  // HV-3: warn when > 7 days away
  it('[HV-3a] admission 8 days before birthDate → warn', () => {
    expect(shouldWarnAdmissionFarFromBirth('2026-06-27', BIRTH_DATE)).toBe(true);
  });

  it('[HV-3b] admission 8 days after birthDate → warn', () => {
    expect(shouldWarnAdmissionFarFromBirth('2026-07-13', BIRTH_DATE)).toBe(true);
  });

  // No warn within ≤ 7 days
  it('[HV-3c] admission 7 days before birthDate → no warn (boundary)', () => {
    expect(shouldWarnAdmissionFarFromBirth('2026-06-28', BIRTH_DATE)).toBe(false);
  });

  it('[HV-3d] admission == birthDate → no warn', () => {
    expect(shouldWarnAdmissionFarFromBirth(BIRTH_DATE, BIRTH_DATE)).toBe(false);
  });

  // No warn when dates absent
  it('[HV-3e] admission absent → no warn', () => {
    expect(shouldWarnAdmissionFarFromBirth(null, BIRTH_DATE)).toBe(false);
  });

  it('[HV-3f] birthDate absent → no warn', () => {
    expect(shouldWarnAdmissionFarFromBirth('2026-07-01', null)).toBe(false);
  });
});

// ─── buildHospitalStayFields (§1.4 PIN) ──────────────────────────────────────

describe('buildHospitalStayFields', () => {
  // HV-5: both undefined → no keys included
  it('[HV-5] both undefined → empty object (no-op; leaves stored values unchanged)', () => {
    const fields = buildHospitalStayFields(undefined, undefined);
    expect(Object.keys(fields)).toHaveLength(0);
    expect('hospitalAdmissionDate' in fields).toBe(false);
    expect('hospitalDischargeDate' in fields).toBe(false);
  });

  // HV-6: explicit null → key present as null (clears column)
  it('[HV-6a] admission=null → hospitalAdmissionDate: null in body (clears column)', () => {
    const fields = buildHospitalStayFields(null, undefined);
    expect('hospitalAdmissionDate' in fields).toBe(true);
    expect(fields.hospitalAdmissionDate).toBeNull();
    expect('hospitalDischargeDate' in fields).toBe(false);
  });

  it('[HV-6b] discharge=null → hospitalDischargeDate: null in body', () => {
    const fields = buildHospitalStayFields(undefined, null);
    expect('hospitalDischargeDate' in fields).toBe(true);
    expect(fields.hospitalDischargeDate).toBeNull();
    expect('hospitalAdmissionDate' in fields).toBe(false);
  });

  // HV-7: present date → Base64 no-op cipher (§1.4 PIN — key present = real mutation)
  it('[HV-7a] present admission date → Base64-encoded value (triggers mutation)', () => {
    const fields = buildHospitalStayFields('2026-07-08', undefined);
    expect('hospitalAdmissionDate' in fields).toBe(true);
    const encoded = fields.hospitalAdmissionDate;
    expect(typeof encoded).toBe('string');
    // Decode and verify round-trip
    expect(decodeDateFromWire(encoded)).toBe('2026-07-08');
  });

  it('[HV-7b] present discharge date → Base64-encoded value', () => {
    const fields = buildHospitalStayFields(undefined, '2026-07-10');
    expect('hospitalDischargeDate' in fields).toBe(true);
    const encoded = fields.hospitalDischargeDate;
    expect(typeof encoded).toBe('string');
    expect(decodeDateFromWire(encoded)).toBe('2026-07-10');
  });

  // HV-4: both present → both keys included (real mutation)
  it('[HV-4] both admission and discharge → both keys present (both mutations)', () => {
    const fields = buildHospitalStayFields('2026-07-08', '2026-07-10');
    expect('hospitalAdmissionDate' in fields).toBe(true);
    expect('hospitalDischargeDate' in fields).toBe(true);
    expect(decodeDateFromWire(fields.hospitalAdmissionDate)).toBe('2026-07-08');
    expect(decodeDateFromWire(fields.hospitalDischargeDate)).toBe('2026-07-10');
  });

  // §1.4 PIN: even when only one key is present, that alone makes it a real mutation
  it('[HV-4b] §1.4 PIN: one present key → wire body has that key (server must persist)', () => {
    const fields = buildHospitalStayFields('2026-07-08', undefined);
    // Only admission present — discharge omitted
    expect(Object.keys(fields)).toHaveLength(1);
    expect('hospitalAdmissionDate' in fields).toBe(true);
    expect('hospitalDischargeDate' in fields).toBe(false);
  });
});
