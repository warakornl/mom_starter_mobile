/**
 * doctorPdfButtonLogic — pure constants and helpers for DoctorPdfButton.
 *
 * Extracted from the React Native component so these can be imported and
 * unit-tested in Node without triggering React Native module resolution.
 *
 * No React Native imports allowed here.
 */

// ─── testID constants ─────────────────────────────────────────────────────────

/** testID for the default CTA button (idle state). */
export const PDF_CTA_BTN_TESTID = 'pdf-doctor-cta-btn';

/** testID for the generating state indicator. */
export const PDF_GENERATING_TESTID = 'pdf-doctor-generating';

/** testID for the shared (success) state container. */
export const PDF_SHARED_TESTID = 'pdf-doctor-shared';

/** testID for the error state container. */
export const PDF_ERROR_TESTID = 'pdf-doctor-error';

/** testID for the consent-blocked inline message. */
export const PDF_CONSENT_BLOCKED_TESTID = 'pdf-doctor-consent-blocked';

/** testID for the retry button in the error state. */
export const PDF_RETRY_BTN_TESTID = 'pdf-doctor-retry-btn';
