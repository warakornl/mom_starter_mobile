/**
 * medicationPlanFormLogic.test.ts — TDD RED phase (Slice 2, Task 8).
 *
 * Covers:
 *  1. buildScheduleRuleFromPicker — FLAG-4 MedicationScheduleRule per freq
 *  2. buildMedicationPlanInput    — base64 name/dose + scheduleRule + active
 *  3. validateMedSchedule         — typo-guard validation (name, time, interval)
 *  4. isMedSaveEnabled            — aggregate save-button predicate
 *  5. orchestrateMedSave          — consent-gated orchestration:
 *       - skip when saveEnabled=false
 *       - gate when general_health not granted (payload held)
 *       - persist when general_health granted
 *       - grant path: payload built from CURRENT params (no stale-callback)
 *
 * Security: NEVER log name, dose, or scheduleRule (SD-2/SD-5).
 */

import {
  buildScheduleRuleFromPicker,
  buildMedicationPlanInput,
  validateMedSchedule,
  isMedSaveEnabled,
  orchestrateMedSave,
  type SchedulePickerState,
} from './medicationPlanFormLogic';

// Helper to decode base64 → UTF-8 (Node Buffer available in Jest)
function b64Decode(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

// ── Default picker states ──────────────────────────────────────────────────────

const DAILY_PICKER: SchedulePickerState = {
  freq: 'daily',
  startDate: '2026-07-04',
  startTime: '08:00',
  timesOfDay: ['08:00'],
  interval: 2,
};

const EVERY_N_PICKER: SchedulePickerState = {
  freq: 'every_n_days',
  startDate: '2026-07-04',
  startTime: '08:00',
  timesOfDay: ['08:00'],
  interval: 2,
};

const ONE_OFF_PICKER: SchedulePickerState = {
  freq: 'one_off',
  startDate: '2026-07-04',
  startTime: '09:30',
  timesOfDay: [],
  interval: 2,
};

// ─── 1. buildScheduleRuleFromPicker ───────────────────────────────────────────

describe('buildScheduleRuleFromPicker — FLAG-4 MedicationScheduleRule', () => {
  describe('daily', () => {
    const rule = buildScheduleRuleFromPicker(DAILY_PICKER);

    it('freq = daily', () => {
      expect(rule.freq).toBe('daily');
    });

    it('startAt = startDate + first timesOfDay (YYYY-MM-DDTHH:mm)', () => {
      expect(rule.startAt).toBe('2026-07-04T08:00');
    });

    it('timesOfDay contains the times, sorted ascending', () => {
      expect(rule.timesOfDay).toEqual(['08:00']);
    });

    it('interval is absent for daily', () => {
      expect(rule.interval).toBeUndefined();
    });

    it('until is absent (omitted in MVP picker)', () => {
      expect(rule.until).toBeUndefined();
    });
  });

  describe('daily with multiple times', () => {
    const multi: SchedulePickerState = {
      ...DAILY_PICKER,
      timesOfDay: ['14:00', '08:00'], // unsorted input
    };
    const rule = buildScheduleRuleFromPicker(multi);

    it('timesOfDay is sorted ascending', () => {
      expect(rule.timesOfDay).toEqual(['08:00', '14:00']);
    });

    it('startAt uses the first ascending time', () => {
      expect(rule.startAt).toBe('2026-07-04T08:00');
    });
  });

  describe('every_n_days', () => {
    const rule = buildScheduleRuleFromPicker(EVERY_N_PICKER);

    it('freq = every_n_days', () => {
      expect(rule.freq).toBe('every_n_days');
    });

    it('interval is present and equals 2', () => {
      expect(rule.interval).toBe(2);
    });

    it('startAt = startDate + first timesOfDay', () => {
      expect(rule.startAt).toBe('2026-07-04T08:00');
    });

    it('timesOfDay is present', () => {
      expect(rule.timesOfDay).toEqual(['08:00']);
    });
  });

  describe('every_n_days interval canonicalisation', () => {
    it('interval >= 2 is kept as-is', () => {
      const rule = buildScheduleRuleFromPicker({ ...EVERY_N_PICKER, interval: 3 });
      expect(rule.interval).toBe(3);
    });

    it('interval value is preserved exactly (boundary = 2)', () => {
      const rule = buildScheduleRuleFromPicker({ ...EVERY_N_PICKER, interval: 2 });
      expect(rule.interval).toBe(2);
    });
  });

  describe('one_off', () => {
    const rule = buildScheduleRuleFromPicker(ONE_OFF_PICKER);

    it('freq = one_off', () => {
      expect(rule.freq).toBe('one_off');
    });

    it('startAt = startDate + startTime', () => {
      expect(rule.startAt).toBe('2026-07-04T09:30');
    });

    it('timesOfDay is absent (forbidden for one_off)', () => {
      expect(rule.timesOfDay).toBeUndefined();
    });

    it('interval is absent (forbidden for one_off)', () => {
      expect(rule.interval).toBeUndefined();
    });
  });
});

// ─── 2. buildMedicationPlanInput ─────────────────────────────────────────────

describe('buildMedicationPlanInput — base64 encoding + scheduleRule + active', () => {
  describe('name encoding', () => {
    it('encodes ASCII name to base64', () => {
      const input = buildMedicationPlanInput('Triferdine 150', '', DAILY_PICKER, true);
      expect(b64Decode(input.name)).toBe('Triferdine 150');
    });

    it('encodes Thai name to base64 (UTF-8 roundtrip)', () => {
      const thai = 'ไทรเฟอดีน 150';
      const input = buildMedicationPlanInput(thai, '', DAILY_PICKER, true);
      expect(b64Decode(input.name)).toBe(thai);
    });

    it('trims whitespace before encoding', () => {
      const input = buildMedicationPlanInput('  Folic Acid  ', '', DAILY_PICKER, true);
      expect(b64Decode(input.name)).toBe('Folic Acid');
    });

    it('produces a valid base64 string (only base64 chars)', () => {
      const input = buildMedicationPlanInput('Metformin', '', DAILY_PICKER, true);
      expect(input.name).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe('dose encoding', () => {
    it('encodes non-empty dose to base64', () => {
      const input = buildMedicationPlanInput('Folic Acid', '1 เม็ด', DAILY_PICKER, true);
      expect(b64Decode(input.dose as string)).toBe('1 เม็ด');
    });

    it('dose is null when empty string passed', () => {
      const input = buildMedicationPlanInput('Folic Acid', '', DAILY_PICKER, true);
      expect(input.dose).toBeNull();
    });

    it('dose is null when whitespace-only passed', () => {
      const input = buildMedicationPlanInput('Folic Acid', '   ', DAILY_PICKER, true);
      expect(input.dose).toBeNull();
    });

    it('dose is trimmed before encoding', () => {
      const input = buildMedicationPlanInput('Test', '  500 mg  ', DAILY_PICKER, true);
      expect(b64Decode(input.dose as string)).toBe('500 mg');
    });
  });

  describe('scheduleRule', () => {
    it('daily freq builds correct scheduleRule', () => {
      const input = buildMedicationPlanInput('Drug', '', DAILY_PICKER, true);
      expect(input.scheduleRule?.freq).toBe('daily');
      expect(input.scheduleRule?.startAt).toBe('2026-07-04T08:00');
    });

    it('every_n_days freq includes interval', () => {
      const input = buildMedicationPlanInput('Drug', '', EVERY_N_PICKER, true);
      expect(input.scheduleRule?.freq).toBe('every_n_days');
      expect(input.scheduleRule?.interval).toBe(2);
    });

    it('one_off freq has no timesOfDay', () => {
      const input = buildMedicationPlanInput('Drug', '', ONE_OFF_PICKER, true);
      expect(input.scheduleRule?.freq).toBe('one_off');
      expect(input.scheduleRule?.timesOfDay).toBeUndefined();
    });

    it('null pickerState produces null scheduleRule (PRN/ad-hoc)', () => {
      const input = buildMedicationPlanInput('Drug', '', null, true);
      expect(input.scheduleRule).toBeNull();
    });
  });

  describe('active flag', () => {
    it('active=true is preserved', () => {
      const input = buildMedicationPlanInput('Drug', '', DAILY_PICKER, true);
      expect(input.active).toBe(true);
    });

    it('active=false is preserved (pre-planned medication)', () => {
      const input = buildMedicationPlanInput('Drug', '', DAILY_PICKER, false);
      expect(input.active).toBe(false);
    });
  });
});

// ─── 3. validateMedSchedule — typo-guard validation ──────────────────────────

describe('validateMedSchedule — typo-guard only (never clinical)', () => {
  describe('name validation', () => {
    it('empty name returns nameError (typo-guard message key)', () => {
      const errs = validateMedSchedule('', DAILY_PICKER);
      expect(errs.nameError).toBeTruthy();
    });

    it('whitespace-only name returns nameError', () => {
      const errs = validateMedSchedule('   ', DAILY_PICKER);
      expect(errs.nameError).toBeTruthy();
    });

    it('non-empty name clears nameError', () => {
      const errs = validateMedSchedule('Triferdine 150', DAILY_PICKER);
      expect(errs.nameError).toBe('');
    });
  });

  describe('time validation (daily / every_n_days)', () => {
    it('daily with empty timesOfDay returns timeError', () => {
      const errs = validateMedSchedule('Drug', { ...DAILY_PICKER, timesOfDay: [] });
      expect(errs.timeError).toBeTruthy();
    });

    it('every_n_days with empty timesOfDay returns timeError', () => {
      const errs = validateMedSchedule('Drug', { ...EVERY_N_PICKER, timesOfDay: [] });
      expect(errs.timeError).toBeTruthy();
    });

    it('daily with at least one time clears timeError', () => {
      const errs = validateMedSchedule('Drug', DAILY_PICKER);
      expect(errs.timeError).toBe('');
    });

    it('one_off never requires timesOfDay (no timeError)', () => {
      const errs = validateMedSchedule('Drug', ONE_OFF_PICKER);
      expect(errs.timeError).toBe('');
    });

    it('null picker (PRN) has no timeError', () => {
      const errs = validateMedSchedule('Drug', null);
      expect(errs.timeError).toBe('');
    });
  });

  describe('interval validation (every_n_days)', () => {
    it('interval < 2 returns intervalError (medication-specific rule)', () => {
      const errs = validateMedSchedule('Drug', { ...EVERY_N_PICKER, interval: 1 });
      expect(errs.intervalError).toBeTruthy();
    });

    it('interval = 1 returns intervalError (canonicalises to daily, forbidden here)', () => {
      const errs = validateMedSchedule('Drug', { ...EVERY_N_PICKER, interval: 1 });
      expect(errs.intervalError).toBeTruthy();
    });

    it('interval = 2 (minimum) returns no intervalError', () => {
      const errs = validateMedSchedule('Drug', { ...EVERY_N_PICKER, interval: 2 });
      expect(errs.intervalError).toBe('');
    });

    it('interval = 7 returns no intervalError', () => {
      const errs = validateMedSchedule('Drug', { ...EVERY_N_PICKER, interval: 7 });
      expect(errs.intervalError).toBe('');
    });

    it('daily freq does not check interval', () => {
      // interval field not relevant for daily
      const errs = validateMedSchedule('Drug', { ...DAILY_PICKER, interval: 1 });
      expect(errs.intervalError).toBe('');
    });

    it('one_off freq does not check interval', () => {
      const errs = validateMedSchedule('Drug', ONE_OFF_PICKER);
      expect(errs.intervalError).toBe('');
    });
  });

  describe('fully valid form', () => {
    it('daily valid: all errors empty', () => {
      const errs = validateMedSchedule('Triferdine 150', DAILY_PICKER);
      expect(errs.nameError).toBe('');
      expect(errs.timeError).toBe('');
      expect(errs.intervalError).toBe('');
    });

    it('every_n_days valid: all errors empty', () => {
      const errs = validateMedSchedule('Metformin', EVERY_N_PICKER);
      expect(errs.nameError).toBe('');
      expect(errs.timeError).toBe('');
      expect(errs.intervalError).toBe('');
    });

    it('one_off valid: all errors empty', () => {
      const errs = validateMedSchedule('Paracetamol', ONE_OFF_PICKER);
      expect(errs.nameError).toBe('');
      expect(errs.timeError).toBe('');
      expect(errs.intervalError).toBe('');
    });
  });
});

// ─── 4. isMedSaveEnabled — aggregate predicate ───────────────────────────────

describe('isMedSaveEnabled', () => {
  it('false when name is empty', () => {
    expect(isMedSaveEnabled('', DAILY_PICKER)).toBe(false);
  });

  it('false when name is whitespace-only', () => {
    expect(isMedSaveEnabled('   ', DAILY_PICKER)).toBe(false);
  });

  it('false when daily and timesOfDay is empty', () => {
    expect(isMedSaveEnabled('Drug', { ...DAILY_PICKER, timesOfDay: [] })).toBe(false);
  });

  it('false when every_n_days and timesOfDay is empty', () => {
    expect(isMedSaveEnabled('Drug', { ...EVERY_N_PICKER, timesOfDay: [] })).toBe(false);
  });

  it('false when every_n_days and interval < 2', () => {
    expect(isMedSaveEnabled('Drug', { ...EVERY_N_PICKER, interval: 1 })).toBe(false);
  });

  it('true when daily, name set, one time set', () => {
    expect(isMedSaveEnabled('Folic Acid', DAILY_PICKER)).toBe(true);
  });

  it('true when every_n_days, interval >= 2, one time set', () => {
    expect(isMedSaveEnabled('Metformin', EVERY_N_PICKER)).toBe(true);
  });

  it('true when one_off, name set', () => {
    expect(isMedSaveEnabled('Paracetamol', ONE_OFF_PICKER)).toBe(true);
  });

  it('true when PRN (null picker), name set', () => {
    expect(isMedSaveEnabled('Drug', null)).toBe(true);
  });
});

// ─── 5. orchestrateMedSave — consent-gated save orchestration ────────────────

describe('orchestrateMedSave — consent gate + stale-callback safety', () => {
  const BASE_PARAMS = {
    saveEnabled: true,
    consentGranted: true,
    name: 'Triferdine 150',
    dose: '1 เม็ด',
    pickerState: DAILY_PICKER,
    active: true,
  };

  describe('skip path — saveEnabled=false', () => {
    it('returns action=skip when saveEnabled=false', () => {
      const result = orchestrateMedSave({ ...BASE_PARAMS, saveEnabled: false });
      expect(result.action).toBe('skip');
    });

    it('returns no payload when skipping', () => {
      const result = orchestrateMedSave({ ...BASE_PARAMS, saveEnabled: false });
      expect('payload' in result).toBe(false);
    });
  });

  describe('gate path — general_health not granted', () => {
    const gated = orchestrateMedSave({ ...BASE_PARAMS, consentGranted: false });

    it('returns action=gate', () => {
      expect(gated.action).toBe('gate');
    });

    it('payload is present (values held — not wiped)', () => {
      expect('payload' in gated && gated.payload != null).toBe(true);
    });

    it('held payload has base64-encoded name', () => {
      if (gated.action !== 'gate') throw new Error('expected gate');
      expect(b64Decode(gated.payload.name)).toBe('Triferdine 150');
    });

    it('held payload has base64-encoded dose', () => {
      if (gated.action !== 'gate') throw new Error('expected gate');
      expect(b64Decode(gated.payload.dose as string)).toBe('1 เม็ด');
    });

    it('held payload reflects current active state', () => {
      if (gated.action !== 'gate') throw new Error('expected gate');
      expect(gated.payload.active).toBe(true);
    });

    it('held payload schedule freq is daily', () => {
      if (gated.action !== 'gate') throw new Error('expected gate');
      expect(gated.payload.scheduleRule?.freq).toBe('daily');
    });
  });

  describe('persist path — general_health granted', () => {
    const persisted = orchestrateMedSave({ ...BASE_PARAMS, consentGranted: true });

    it('returns action=persist', () => {
      expect(persisted.action).toBe('persist');
    });

    it('payload is present with base64-encoded name', () => {
      if (persisted.action !== 'persist') throw new Error('expected persist');
      expect(b64Decode(persisted.payload.name)).toBe('Triferdine 150');
    });
  });

  describe('stale-callback safety — payload always built from CURRENT params', () => {
    it('calling orchestrateMedSave twice with different names produces different payloads', () => {
      const r1 = orchestrateMedSave({ ...BASE_PARAMS, name: 'Folic Acid', consentGranted: false });
      const r2 = orchestrateMedSave({ ...BASE_PARAMS, name: 'Metformin', consentGranted: false });
      if (r1.action !== 'gate' || r2.action !== 'gate') throw new Error('expected gate');
      expect(b64Decode(r1.payload.name)).toBe('Folic Acid');
      expect(b64Decode(r2.payload.name)).toBe('Metformin');
    });

    it('after consent is granted, re-calling with same params produces a persist', () => {
      // Simulate: gate → user grants → re-call with same form state (current params)
      const gateResult = orchestrateMedSave({ ...BASE_PARAMS, consentGranted: false });
      expect(gateResult.action).toBe('gate');

      // User grants consent. Screen re-calls with consentGranted=true.
      const grantResult = orchestrateMedSave({ ...BASE_PARAMS, consentGranted: true });
      expect(grantResult.action).toBe('persist');
      if (grantResult.action !== 'persist') throw new Error('expected persist');
      // Payload holds the same values (no stale snapshot)
      expect(b64Decode(grantResult.payload.name)).toBe('Triferdine 150');
    });

    it('dose=empty becomes null in both gate and persist paths', () => {
      const r = orchestrateMedSave({ ...BASE_PARAMS, dose: '', consentGranted: true });
      if (r.action !== 'persist') throw new Error('expected persist');
      expect(r.payload.dose).toBeNull();
    });
  });

  describe('deactivate vs delete — not tested here (store-level); active=false path', () => {
    it('active=false plan persists correctly (pre-planned / inactive from form)', () => {
      const r = orchestrateMedSave({ ...BASE_PARAMS, active: false, consentGranted: true });
      if (r.action !== 'persist') throw new Error('expected persist');
      expect(r.payload.active).toBe(false);
    });
  });
});
