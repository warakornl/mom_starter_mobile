/**
 * monthYearFormatter — re-export shim.
 *
 * The implementation has moved to src/i18n/messages.ts (next to formatCivilDate)
 * so CalendarScreen and other non-PDF screens can import from the shared i18n
 * module without a cross-domain pdfReport dependency.
 *
 * DoctorPdfScreen and monthYearFormatter.test.ts continue to import from here
 * with no change required.
 */

export { formatYearMonth } from '../i18n/messages';
