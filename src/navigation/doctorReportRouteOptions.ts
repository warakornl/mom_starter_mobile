/**
 * doctorReportRouteOptions.ts
 *
 * Route options for the DoctorReport root-stack screen.
 *
 * headerShown: false — native header is suppressed. DoctorPdfScreen renders its
 * own in-screen headerRow that carries BOTH a title (t('pdf.screen.builderTitle'))
 * and a back button (onBack → navigation.goBack) in every render state. Enabling
 * the native header on top of that produces two stacked headers.
 *
 * This constant is the single source of truth so a TDD guard can assert the
 * intent directly (src/navigation/doctorReportRouteOptions.test.ts).
 */

import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export const DOCTOR_REPORT_ROUTE_OPTIONS: NativeStackNavigationOptions = {
  headerShown: false,
};
