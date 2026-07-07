/**
 * doctorReportRouteOptions.test.ts
 *
 * TDD guard: DoctorReport root-stack screen must suppress the native header
 * so that only DoctorPdfScreen's own in-screen headerRow is shown.
 *
 * Background: DoctorPdfScreen renders its own headerRow with BOTH a title
 * (t('pdf.screen.builderTitle')) and a back button (onBack → navigation.goBack)
 * in every render state. Enabling the native header (title option) on top of
 * that produces two stacked headers. The route options must keep headerShown:false.
 */

import { DOCTOR_REPORT_ROUTE_OPTIONS } from './doctorReportRouteOptions';

describe('DoctorReport route options — single-header guard', () => {
  it('headerShown is false (native header suppressed; screen owns its own header)', () => {
    expect(DOCTOR_REPORT_ROUTE_OPTIONS.headerShown).toBe(false);
  });

  it('does NOT set a native title (screen headerRow is the single title source)', () => {
    expect(DOCTOR_REPORT_ROUTE_OPTIONS).not.toHaveProperty('title');
  });

  it('does NOT set headerBackTitle (no native back — screen back button is the single back source)', () => {
    expect(DOCTOR_REPORT_ROUTE_OPTIONS).not.toHaveProperty('headerBackTitle');
  });
});
