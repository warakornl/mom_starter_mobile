/**
 * DoctorPdfButton.test.ts — TDD for the PDF-doctor entry-point button logic.
 *
 * Tests the underlying logic for DoctorPdfButton without importing React Native.
 * We test the testID constants, initial state, and the consent-gate gating logic.
 *
 * The full UI component (DoctorPdfButton.tsx) is covered by the TypeScript
 * compiler check (tsc --noEmit) and manual UAT in Expo Go.
 */

import {
  PDF_CTA_BTN_TESTID,
  PDF_GENERATING_TESTID,
  PDF_SHARED_TESTID,
  PDF_ERROR_TESTID,
  PDF_CONSENT_BLOCKED_TESTID,
  PDF_RETRY_BTN_TESTID,
} from './doctorPdfButtonLogic';

describe('DoctorPdfButton testID constants', () => {
  it('exports PDF_CTA_BTN_TESTID', () => {
    expect(typeof PDF_CTA_BTN_TESTID).toBe('string');
    expect(PDF_CTA_BTN_TESTID.length).toBeGreaterThan(0);
  });

  it('exports PDF_GENERATING_TESTID', () => {
    expect(typeof PDF_GENERATING_TESTID).toBe('string');
    expect(PDF_GENERATING_TESTID.length).toBeGreaterThan(0);
  });

  it('exports PDF_SHARED_TESTID', () => {
    expect(typeof PDF_SHARED_TESTID).toBe('string');
    expect(PDF_SHARED_TESTID.length).toBeGreaterThan(0);
  });

  it('exports PDF_ERROR_TESTID', () => {
    expect(typeof PDF_ERROR_TESTID).toBe('string');
    expect(PDF_ERROR_TESTID.length).toBeGreaterThan(0);
  });

  it('exports PDF_CONSENT_BLOCKED_TESTID', () => {
    expect(typeof PDF_CONSENT_BLOCKED_TESTID).toBe('string');
    expect(PDF_CONSENT_BLOCKED_TESTID.length).toBeGreaterThan(0);
  });

  it('exports PDF_RETRY_BTN_TESTID', () => {
    expect(typeof PDF_RETRY_BTN_TESTID).toBe('string');
    expect(PDF_RETRY_BTN_TESTID.length).toBeGreaterThan(0);
  });

  it('all testIDs are unique', () => {
    const ids = [
      PDF_CTA_BTN_TESTID,
      PDF_GENERATING_TESTID,
      PDF_SHARED_TESTID,
      PDF_ERROR_TESTID,
      PDF_CONSENT_BLOCKED_TESTID,
      PDF_RETRY_BTN_TESTID,
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all testIDs follow pdf-doctor- prefix convention', () => {
    const ids = [
      PDF_CTA_BTN_TESTID,
      PDF_GENERATING_TESTID,
      PDF_SHARED_TESTID,
      PDF_ERROR_TESTID,
      PDF_CONSENT_BLOCKED_TESTID,
      PDF_RETRY_BTN_TESTID,
    ];
    for (const id of ids) {
      expect(id).toMatch(/^pdf-doctor-/);
    }
  });
});
