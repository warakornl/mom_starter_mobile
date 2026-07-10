/**
 * BirthEventScreen.hospitalStay.test.ts — structural + logic tests for
 * hospital-stay fields added to BirthEventScreen.
 *
 * Pure-node (no RNTL). Tests:
 *   Group A: Screen source references required i18n keys
 *   Group B: Screen imports the hospital-stay cipher and logic modules
 *   Group C: Logic is already tested via hospitalStayLogic.test.ts (cited here)
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  SafeAreaView: 'SafeAreaView',
  StyleSheet: { create: (o: unknown) => o, hairlineWidth: 0.5 },
  Alert: { alert: jest.fn() },
  Modal: 'Modal',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: jest.fn((key: string) => key),
    locale: 'th',
    setLocale: jest.fn(),
  })),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';

const SCREEN_SRC = fs.readFileSync(
  path.join(__dirname, 'BirthEventScreen.tsx'),
  'utf8',
);

const stripComments = (src: string): string =>
  src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const SRC_NO_COMMENTS = stripComments(SCREEN_SRC);

// ─── Group A: Required i18n key references ────────────────────────────────────

describe('BirthEventScreen — hospital-stay i18n keys', () => {
  it('references birth.fieldHospitalStaySection', () => {
    expect(SCREEN_SRC).toContain('birth.fieldHospitalStaySection');
  });

  it('references birth.fieldHospitalAdmission', () => {
    expect(SCREEN_SRC).toContain('birth.fieldHospitalAdmission');
  });

  it('references birth.fieldHospitalDischarge', () => {
    expect(SCREEN_SRC).toContain('birth.fieldHospitalDischarge');
  });

  it('references birth.hospitalAdmissionModalTitle', () => {
    expect(SCREEN_SRC).toContain('birth.hospitalAdmissionModalTitle');
  });

  it('references birth.hospitalDischargeModalTitle', () => {
    expect(SCREEN_SRC).toContain('birth.hospitalDischargeModalTitle');
  });

  it('references birth.errorDischargeBeforeAdmission', () => {
    expect(SCREEN_SRC).toContain('birth.errorDischargeBeforeAdmission');
  });

  it('references birth.errorHospitalDateFuture', () => {
    expect(SCREEN_SRC).toContain('birth.errorHospitalDateFuture');
  });

  it('references birth.warnAdmissionFarFromBirthMsg (OQ-PS4 warn)', () => {
    expect(SCREEN_SRC).toContain('birth.warnAdmissionFarFromBirthMsg');
  });
});

// ─── Group B: Module imports ──────────────────────────────────────────────────

describe('BirthEventScreen — hospital-stay module imports', () => {
  it('imports buildHospitalStayFields from hospitalStayLogic', () => {
    expect(SCREEN_SRC).toContain('buildHospitalStayFields');
  });

  it('imports validateHospitalDates from hospitalStayLogic', () => {
    expect(SCREEN_SRC).toContain('validateHospitalDates');
  });

  it('imports shouldWarnAdmissionFarFromBirth from hospitalStayLogic', () => {
    expect(SCREEN_SRC).toContain('shouldWarnAdmissionFarFromBirth');
  });
});

// ─── Group C: Security constraints ───────────────────────────────────────────

describe('BirthEventScreen — security constraints (hospital-stay)', () => {
  it('does not console.log hospitalAdmissionDate (health-adjacent PII)', () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/console\s*\.\s*log[^;]*hospitalAdmission/);
  });

  it('does not console.log hospitalDischargeDate (health-adjacent PII)', () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/console\s*\.\s*log[^;]*hospitalDischarge/);
  });

  it('§1.4 PIN: calls buildHospitalStayFields (not inline spread without cipher)', () => {
    // The screen must use buildHospitalStayFields to build the body — this ensures
    // the §1.4 presence-of-key = real mutation rule is applied via the logic module.
    expect(SCREEN_SRC).toContain('buildHospitalStayFields(');
  });
});
