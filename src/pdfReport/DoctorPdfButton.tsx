/**
 * DoctorPdfButton — on-device doctor-summary PDF entry point.
 *
 * Spec ref: pdf-doctor-ui.md (on-device approach, PDPA-friendly).
 *
 * Flow:
 *   1. User taps "สร้าง PDF ให้หมอ" (CTA).
 *   2. Consent gate: if pdf_egress not granted, show JitConsentSheet.
 *      • Grant  → proceed to step 3.
 *      • Decline → show consent-blocked inline message.
 *   3. Assemble report HTML from local data (profile, kick sessions,
 *      appointments, reminders, supplies).
 *   4. expo-print: printToFileAsync({ html }) → temp PDF file.
 *   5. expo-sharing: shareAsync(uri, { mimeType: 'application/pdf' })
 *      → OS share sheet; user decides where to send.
 *
 * States:
 *   idle            — default CTA button visible.
 *   generating      — spinner / disabled state while PDF is created.
 *   shared          — success confirmation ("แชร์ไฟล์แล้ว").
 *   error           — error message + retry button.
 *   consent_declined — blocked inline message.
 *
 * PDPA / Security:
 *   - No health data is transmitted to a server.
 *   - PDF is created in the device's temp file system.
 *   - The user explicitly chooses where to share via the OS sheet.
 *   - pdf_egress consent is required before generation (PDPA ม.26).
 *   - No auth tokens or credentials are included in the PDF output.
 *   - NEVER log health data from this component.
 *
 * testIDs (all prefixed 'pdf-doctor-'):
 *   pdf-doctor-cta-btn        — default generate button
 *   pdf-doctor-generating     — generating indicator
 *   pdf-doctor-shared         — success state
 *   pdf-doctor-error          — error state
 *   pdf-doctor-consent-blocked — consent declined message
 *   pdf-doctor-retry-btn      — retry button in error state
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { useT } from '../i18n/LanguageContext';
import type { TokenStorage } from '../auth/tokenStorage';
import { JitConsentSheet } from '../consent/JitConsentSheet';
import { useJitConsent } from '../consent/useJitConsent';
import type { ReportProfile, ReportKickSession, ReportAppointment } from './doctorReportAssembler';
import { buildDoctorReportHtml } from './doctorReportAssembler';
import { createProductionPdfService } from './pdfService';
import {
  initialDoctorPdfState,
  applyGenerateStart,
  applyGenerateSuccess,
  applyGenerateError,
  applyConsentDeclined,
  applyReset,
} from './doctorPdfLogic';
import { useState } from 'react';
import {
  PDF_CTA_BTN_TESTID,
  PDF_GENERATING_TESTID,
  PDF_SHARED_TESTID,
  PDF_ERROR_TESTID,
  PDF_CONSENT_BLOCKED_TESTID,
  PDF_RETRY_BTN_TESTID,
} from './doctorPdfButtonLogic';

// Re-export testID constants so callers can import from DoctorPdfButton directly.
export {
  PDF_CTA_BTN_TESTID,
  PDF_GENERATING_TESTID,
  PDF_SHARED_TESTID,
  PDF_ERROR_TESTID,
  PDF_CONSENT_BLOCKED_TESTID,
  PDF_RETRY_BTN_TESTID,
};

// ─── Lazy singleton for production ───────────────────────────────────────────

let _pdfService: ReturnType<typeof createProductionPdfService> | null = null;
function getPdfService(): ReturnType<typeof createProductionPdfService> {
  if (!_pdfService) _pdfService = createProductionPdfService();
  return _pdfService;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DoctorPdfButtonProps {
  /** Secure token storage — passed to useJitConsent for POST /consent. */
  tokenStorage: TokenStorage;
  /** API base URL — passed to useJitConsent for POST /consent. */
  apiBaseUrl: string;
  /**
   * All data for the report — assembled from local stores by the caller.
   * Keeping store access in the parent keeps this component pure and testable.
   */
  profile: ReportProfile;
  kickSessions: ReportKickSession[];
  appointments: ReportAppointment[];
  /** Civil "YYYY-MM-DD" report date — passed in so it can be mocked in tests. */
  reportDate: string;
  /** Civil "YYYY-MM-DD" start of report range. Defaults to epoch (all data). */
  dateFrom?: string;
  /** Civil "YYYY-MM-DD" end of report range. Defaults to far future (all data). */
  dateTo?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DoctorPdfButton({
  tokenStorage,
  apiBaseUrl,
  profile,
  kickSessions,
  appointments,
  reportDate,
  dateFrom = '1900-01-01',
  dateTo = '9999-12-31',
}: DoctorPdfButtonProps): React.JSX.Element {
  const { t, locale } = useT();
  const [pdfState, setPdfState] = useState(initialDoctorPdfState);

  // ── Consent gate ────────────────────────────────────────────────────────────
  const jit = useJitConsent('pdf_egress', tokenStorage, apiBaseUrl);

  // ── Generate + share ────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setPdfState((prev) => applyGenerateStart(prev));
    try {
      const html = buildDoctorReportHtml({
        profile,
        kickSessions,
        appointments,
        dateFrom,
        dateTo,
        reportDate,
        locale,
      });
      const result = await getPdfService().generateAndShare(html);
      if (result.ok) {
        setPdfState((prev) => applyGenerateSuccess(prev, result.fileUri));
      } else {
        setPdfState((prev) => applyGenerateError(prev, result.error));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      setPdfState((prev) => applyGenerateError(prev, msg));
    }
  }, [profile, kickSessions, appointments, dateFrom, dateTo, reportDate, locale]);

  // ── Handle CTA tap ──────────────────────────────────────────────────────────
  const handleCtaTap = useCallback(() => {
    if (jit.gate === 'already_granted') {
      void handleGenerate();
    }
    // If gate === 'show_jit', the JitConsentSheet is already visible.
    // If gate === 'general_health_needed', nothing happens (health consent needed first).
  }, [jit.gate, handleGenerate]);

  // ── JIT grant callback — generate immediately after consent ─────────────────
  const handleJitGrant = useCallback(() => {
    jit.grant();
    // After optimistic grant, gate becomes 'already_granted' on next render,
    // so we proceed to generate here directly.
    void handleGenerate();
  }, [jit, handleGenerate]);

  // ── JIT decline ─────────────────────────────────────────────────────────────
  const handleJitDecline = useCallback(() => {
    jit.decline();
    setPdfState((prev) => applyConsentDeclined(prev));
  }, [jit]);

  // ── Retry ───────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setPdfState((prev) => applyReset(prev));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  // JIT consent sheet shown when gate === 'show_jit'
  const showJitSheet = jit.gate === 'show_jit' && pdfState.status === 'idle';

  // ── Generating state ────────────────────────────────────────────────────────
  if (pdfState.status === 'generating') {
    return (
      <View testID={PDF_GENERATING_TESTID} style={styles.stateRow}>
        <ActivityIndicator color="#A8505A" />
        <Text style={styles.stateText}>{t('pdf.generating')}</Text>
      </View>
    );
  }

  // ── Shared (success) state ──────────────────────────────────────────────────
  if (pdfState.status === 'shared') {
    return (
      <View testID={PDF_SHARED_TESTID} style={styles.sharedContainer}>
        <Text style={styles.sharedLabel}>{t('pdf.shared')}</Text>
        <Text style={styles.sharedSubline}>{t('pdf.sharedSubline')}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel={t('pdf.cta')}
        >
          <Text style={styles.retryBtnText}>{t('pdf.cta')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (pdfState.status === 'error') {
    return (
      <View testID={PDF_ERROR_TESTID} style={styles.errorContainer}>
        <Text style={styles.errorText}>{t('pdf.error')}</Text>
        <TouchableOpacity
          testID={PDF_RETRY_BTN_TESTID}
          style={styles.retryBtn}
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel={t('pdf.retry')}
        >
          <Text style={styles.retryBtnText}>{t('pdf.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Consent declined state ──────────────────────────────────────────────────
  if (pdfState.status === 'consent_declined' || jit.declined) {
    return (
      <View testID={PDF_CONSENT_BLOCKED_TESTID} style={styles.blockedContainer}>
        <Text style={styles.blockedText}>{t('pdf.consentBlocked')}</Text>
      </View>
    );
  }

  // ── Idle / default state ────────────────────────────────────────────────────
  const isDisabled =
    jit.gate === 'general_health_needed' || jit.isLoading;

  return (
    <>
      <TouchableOpacity
        testID={PDF_CTA_BTN_TESTID}
        style={[styles.ctaBtn, isDisabled && styles.ctaBtnDisabled]}
        onPress={handleCtaTap}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('pdf.ctaA11y')}
        accessibilityState={{ disabled: isDisabled }}
      >
        <Text style={[styles.ctaBtnText, isDisabled && styles.ctaBtnTextDisabled]}>
          {t('pdf.cta')}
        </Text>
      </TouchableOpacity>

      {/* JIT consent sheet (shown when gate === 'show_jit') */}
      <JitConsentSheet
        type="pdf_egress"
        visible={showJitSheet}
        onGrant={handleJitGrant}
        onDecline={handleJitDecline}
        isLoading={jit.isLoading}
        error={jit.error}
        onRetry={handleJitGrant}
        parentalAttested={jit.parentalAttested}
        onParentalAttest={jit.setParentalAttested}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Default CTA button (rose/600)
  ctaBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginVertical: 8,
  },
  ctaBtnDisabled: {
    backgroundColor: '#D4B8BC',
  },
  ctaBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  ctaBtnTextDisabled: {
    opacity: 0.7,
  },

  // Generating state
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  stateText: {
    fontSize: 15,
    color: '#5F4A52',
    fontFamily: 'IBMPlexSans-Regular',
  },

  // Shared (success) state
  sharedContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  sharedLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#3D6647', // sage/700
  },
  sharedSubline: {
    fontSize: 13,
    color: '#94818A',
    textAlign: 'center',
    marginBottom: 8,
  },

  // Error state
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#5F4A52',
    textAlign: 'center',
  },

  // Retry button (shared between error and shared states)
  retryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A8505A',
    alignSelf: 'center',
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#A8505A',
    fontFamily: 'IBMPlexSans-SemiBold',
  },

  // Consent blocked inline
  blockedContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  blockedText: {
    fontSize: 14,
    color: '#5F4A52',
    textAlign: 'center',
  },
});
