/**
 * DoctorPdfScreen — Builder → Preview → Share screen for the doctor PDF.
 *
 * Spec ref: pdf-doctor-ui.md §1–§5, §6, §7
 *
 * Three phases:
 *   Builder   — date-range picker (presets) + manifest + "where it goes" block + Preview button
 *   Preview   — React Native component render of the same sections/disclaimer (faithful to PDF)
 *               + Print / Share / Save File action buttons
 *   Generating / Error — inline states with spinner / retry
 *
 * Consent gates:
 *   pdf_egress — required before generating. JIT sheet shown if not granted.
 *                On decline the blocked view shows a re-arm affordance (spec §4).
 *
 * Data minimization (spec §2, PDPA SD-9):
 *   Only data within the selected [dateFrom, dateTo] range reaches the assembler.
 *   The assembler is called ONLY when decidePdfEgressAction returns 'generate'.
 *
 * Preview implementation:
 *   Renders the report sections as React Native ScrollView components (no WebView
 *   required). The Print button calls expo-print's printAsync({ html }) which on
 *   iOS opens the native print dialog (faithful HTML preview). On Android, the share
 *   sheet provides the native PDF viewer.
 *
 * PDPA / Security:
 *   - No health data in route params (PDPA SD-9).
 *   - Reads data from module-level sync stores (same session — safe).
 *   - No auth tokens in the PDF or in any log call.
 *   - Share is explicit and per-act (not auto-upload).
 *
 * testIDs (v2: preset chips replaced by month picker fields per §8A.2):
 *   pdf-screen-builder              — builder phase container
 *   pdf-screen-month-from          — "Month from" touchable picker field (v2)
 *   pdf-screen-month-to            — "Month to" touchable picker field (v2)
 *   pdf-screen-preview-btn         — Preview button
 *   pdf-screen-generating           — generating spinner container
 *   pdf-screen-preview              — preview phase container
 *   pdf-screen-share-btn            — Share button in preview
 *   pdf-screen-print-btn            — Print button in preview
 *   pdf-screen-back-btn             — Back to builder from preview
 *   pdf-screen-error                — error state container
 *   pdf-screen-retry-btn            — Retry button in error state
 *   pdf-screen-consent-blocked      — consent-blocked container
 *   pdf-screen-rearm-btn            — re-arm button in blocked state
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  Modal,
} from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useT } from '../i18n/LanguageContext';
import type { Locale } from '../auth/types';
import type { TokenStorage } from '../auth/tokenStorage';
import { T } from '../theme/tokens';
import { JitConsentSheet } from '../consent/JitConsentSheet';
import { useJitConsent } from '../consent/useJitConsent';
import { localCivilToday } from '../pregnancy/gestationalAge';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { medicationPlanSyncStore } from '../medication/medicationPlanSyncStore';
import { medicationLogSyncStore } from '../medication/medicationLogSyncStore';
import { computeAdherence } from './medicationAdherence';
import {
  buildDoctorReportHtml,
  LABELS,
  isWithinRange,
  formatDateTime,
  type ReportSelfLog,
  type ReportMedicationPlan,
  type ReportMedicationLog,
} from './doctorReportAssembler';
import { kickCountChartSvg } from './reportCharts';
import { createProductionPdfService } from './pdfService';
import {
  decidePdfEgressAction,
  applyRearm as applyGateRearm,
  initialPdfEgressGateState,
  type PdfEgressGateState,
} from './consentGate';
import {
  builderPhaseInitial,
  applyMonthFromChanged,
  applyMonthToChanged,
  isDateRangeValid,
  applyGeneratingStarted,
  applyPreviewReady,
  applyPreviewError,
  applyBackToBuilder,
  type BuilderPhaseState,
} from './DoctorPdfScreenLogic';
import { decodeFieldFromBase64 } from '../capture/captureScreenLogic';
import type { ReportProfile } from './doctorReportAssembler';
import { formatYearMonth } from './monthYearFormatter';
import { TH_MONTHS_SHORT, EN_MONTHS_SHORT } from '../i18n/thaiDate';

// ─── Lazy production PDF service singleton ────────────────────────────────────

let _svc: ReturnType<typeof createProductionPdfService> | null = null;
function getPdfService() {
  if (!_svc) _svc = createProductionPdfService();
  return _svc;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DoctorPdfScreenProps {
  /** Secure token storage — for JIT consent POST. */
  tokenStorage: TokenStorage;
  /** API base URL — for JIT consent POST. */
  apiBaseUrl: string;
  /** Pregnancy profile for the report header. Provided by the caller (HomeScreen snapshot). */
  profile: ReportProfile;
  /** Navigate back to the previous screen. */
  onBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DoctorPdfScreen({
  tokenStorage,
  apiBaseUrl,
  profile,
  onBack,
}: DoctorPdfScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const today = localCivilToday();

  // ── Builder state ──────────────────────────────────────────────────────────
  const [builderState, setBuilderState] = useState<BuilderPhaseState>(() =>
    builderPhaseInitial(today),
  );

  // ── Gate state (session-level — persisted state is in consentStore) ────────
  const [gateState, setGateState] = useState<PdfEgressGateState>(initialPdfEgressGateState);

  // ── Month picker state (FIX 3: real month/year picker — §8A.2) ─────────────
  // pickerTarget: which field is being edited ('from' | 'to')
  // pickerYear/pickerMonth: the tentative selection inside the modal (1-indexed)
  type PickerTarget = 'from' | 'to';
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>('from');
  const [pickerYear, setPickerYear] = useState(0);
  const [pickerMonth, setPickerMonth] = useState(1); // 1-12

  function openPicker(target: PickerTarget): void {
    const src = target === 'from' ? builderState.monthFrom : builderState.monthTo;
    const [y, m] = src.split('-').map(Number);
    setPickerTarget(target);
    setPickerYear(y);
    setPickerMonth(m);
    setPickerVisible(true);
  }

  function confirmPicker(): void {
    const mm = pickerMonth < 10 ? `0${pickerMonth}` : `${pickerMonth}`;
    const yyyyMm = `${pickerYear}-${mm}`;
    if (pickerTarget === 'from') {
      setBuilderState((prev) => applyMonthFromChanged(prev, yyyyMm));
    } else {
      setBuilderState((prev) => applyMonthToChanged(prev, yyyyMm));
    }
    setPickerVisible(false);
  }

  // ── JIT consent hook ───────────────────────────────────────────────────────
  const jit = useJitConsent('pdf_egress', tokenStorage, apiBaseUrl);

  // Merge store-level consent into gate state on each render
  const currentGateState: PdfEgressGateState = {
    pdfEgressGranted: jit.gate === 'already_granted',
    declined: gateState.declined,
    generationError: builderState.generationError,
  };
  const gateAction = decidePdfEgressAction(currentGateState);

  // ── Preview / generate handler ─────────────────────────────────────────────
  const handlePreviewTap = useCallback(async () => {
    // Only call the assembler if consent is granted
    if (gateAction !== 'generate') return;

    setBuilderState((prev) => applyGeneratingStarted(prev));
    try {
      const { dateFrom, dateTo } = builderState;
      // Read from stores — range filtering done inside assembler (data minimization)
      const kickSessions = kickCountSyncStore.getActiveSessions().map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt ?? null,
        movementCount: s.movementCount,
        durationSeconds: s.durationSeconds ?? null,
        gestationalWeekAtStart: s.gestationalWeekAtStart ?? null,
        note: s.note ?? null,
      }));
      const appointments = calendarSyncStore.getActiveChecklistItems().map((c) => ({
        id: c.id,
        title: c.title,
        scheduledAt: c.scheduledAt ?? null,
        done: c.done,
        category: c.category,
        note: c.note ?? null,
      }));

      // Decode base64 self-log values before passing to the assembler (data minimization:
      // assembler filters by range; we pass all live records and let it filter).
      // Security: never log decoded values — MOTHER-health data (SD-5).
      const selfLogs: ReportSelfLog[] = selfLogSyncStore.getSelfLogs().map((s) => ({
        id: s.id,
        loggedAt: s.loggedAt,
        metricType: s.metricType,
        valueNumeric: decodeFieldFromBase64(s.valueNumeric),
        valueNumericSecondary: decodeFieldFromBase64(s.valueNumericSecondary),
        valueText: decodeFieldFromBase64(s.valueText),
        unit: s.unit ?? null,
        note: decodeFieldFromBase64(s.note),
      }));

      // Decode base64 medication plan name/dose before passing to the assembler.
      // getPlans() returns only live (non-deleted) plans. Deleted plan logs are
      // automatically routed to selfRecordedLogs by computeAdherence's orphan-routing
      // rule (any log whose planId is not in the passed plan set → self-recorded).
      // Security: NEVER log name or dose — SD-2/SD-5 drug-name health data.
      const medicationPlans: ReportMedicationPlan[] = medicationPlanSyncStore.getPlans().map((p) => ({
        id: p.id,
        name: decodeFieldFromBase64(p.name) ?? '',
        dose: decodeFieldFromBase64(p.dose) ?? null,
        scheduleRule: p.scheduleRule ?? null,
        active: p.active,
        deletedAt: p.deletedAt ?? null,
      }));

      // Decode medication log notes before passing to assembler.
      // Assembler filters by range; we pass all live logs.
      // Security: NEVER log occurrenceTime, note, or medicationPlanId — SD-5.
      const medicationLogs: ReportMedicationLog[] = medicationLogSyncStore
        .getLogs()
        .map((l) => ({
          id: l.id,
          medicationPlanId: l.medicationPlanId ?? null,
          occurrenceTime: l.occurrenceTime,
          status: l.status,
          note: decodeFieldFromBase64(l.note) ?? null,
        }));

      const html = buildDoctorReportHtml({
        profile,
        kickSessions,
        appointments,
        selfLogs,
        medicationPlans,
        medicationLogs,
        dateFrom,
        dateTo,
        reportDate: today,
        locale,
        includeSensitiveNotes: builderState.includeSensitiveNotes,
      });

      setBuilderState((prev) => applyPreviewReady(prev, html));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      setBuilderState((prev) => applyPreviewError(prev, msg));
    }
  }, [gateAction, builderState, profile, today, locale]);

  // ── Share handler ──────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!builderState.generatedHtml) return;
    try {
      const result = await getPdfService().generateAndShare(builderState.generatedHtml);
      if (!result.ok) {
        setBuilderState((prev) => applyPreviewError(prev, result.error));
      }
      // On success the OS share sheet handles the rest; stay in preview
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'share_error';
      setBuilderState((prev) => applyPreviewError(prev, msg));
    }
  }, [builderState.generatedHtml]);

  // ── Print handler (uses expo-print native dialog — iOS shows faithful preview) ──
  const handlePrint = useCallback(async () => {
    if (!builderState.generatedHtml) return;
    try {
      // Dynamic require to avoid native-module crash in Node/Jest
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Print = require('expo-print') as {
        printAsync: (opts: { html: string }) => Promise<void>;
      };
      await Print.printAsync({ html: builderState.generatedHtml });
    } catch {
      // Print cancelled by user is not an error; other errors surface quietly
    }
  }, [builderState.generatedHtml]);

  // ── Decline / re-arm ───────────────────────────────────────────────────────
  const handleDecline = useCallback(() => {
    jit.decline();
    setGateState((prev) => ({ ...prev, declined: true }));
  }, [jit]);

  const handleRearm = useCallback(() => {
    jit.rearm();
    setGateState(() => applyGateRearm(initialPdfEgressGateState));
    setBuilderState((prev) => applyBackToBuilder(prev));
  }, [jit]);

  // ── Grant ──────────────────────────────────────────────────────────────────
  const handleGrant = useCallback(() => {
    jit.grant();
    // After optimistic grant, gate evaluates 'already_granted' on next render;
    // the Preview button will be enabled for the next tap.
  }, [jit]);

  // ─────────────────────────────────────────────────────────────────────────
  // ── Render ───────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  // ── Consent blocked ────────────────────────────────────────────────────────
  if (gateAction === 'blocked') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          {/* mobile-reviewer 🟡 fix (cluster 6 review): had role but no
           * accessibilityLabel — a bare "‹" glyph announced with no meaning. */}
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('general.back')}
          >
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>{t('pdf.screen.builderTitle')}</Text>
          <View style={styles.backBtnSpacer} />
        </View>
        <View testID="pdf-screen-consent-blocked" style={styles.blockedContainer}>
          <Text style={styles.blockedText}>{t('pdf.consentBlocked')}</Text>
          <TouchableOpacity
            testID="pdf-screen-rearm-btn"
            style={styles.rearmBtn}
            onPress={handleRearm}
            accessibilityRole="button"
          >
            <Text style={styles.rearmBtnText}>{t('pdf.tryConsent')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── JIT consent sheet (pdf_egress not yet granted) ────────────────────────
  const showJitSheet = jit.gate === 'show_jit' && builderState.phase === 'builder';

  // ── Generating spinner ─────────────────────────────────────────────────────
  if (builderState.phase === 'generating') {
    return (
      <SafeAreaView style={styles.container}>
        <View testID="pdf-screen-generating" style={styles.generatingContainer}>
          <ActivityIndicator color={T.color.accent.interactive} size="large" />
          <Text style={styles.generatingText}>{t('pdf.screen.generating')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (builderState.phase === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          {/* mobile-reviewer 🟡 fix (cluster 6 review): had role but no
           * accessibilityLabel. */}
          <TouchableOpacity
            onPress={() => setBuilderState((p) => applyBackToBuilder(p))}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('general.back')}
          >
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>{t('pdf.screen.builderTitle')}</Text>
          <View style={styles.backBtnSpacer} />
        </View>
        <View testID="pdf-screen-error" style={styles.errorContainer}>
          <Text style={styles.errorTitle}>{t('pdf.screen.errorTitle')}</Text>
          <TouchableOpacity
            testID="pdf-screen-retry-btn"
            style={styles.primaryBtn}
            onPress={() => setBuilderState((p) => applyBackToBuilder(p))}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>{t('pdf.screen.retryBtn')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Preview phase ──────────────────────────────────────────────────────────
  if (builderState.phase === 'preview' && builderState.generatedHtml) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            testID="pdf-screen-back-btn"
            onPress={() => setBuilderState((p) => applyBackToBuilder(p))}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('pdf.screen.backToEdit')}
          >
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>{t('pdf.screen.previewNavTitle')}</Text>
          <View style={styles.backBtnSpacer} />
        </View>

        {/* PDF preview — scrollable native RN rendering (faithful to PDF sections) */}
        {/* mobile-reviewer 🟡 (cluster 6 review): hardcoded English
         * accessibilityLabel regardless of locale. REPORTED — needs an i18n
         * key (e.g. 'pdf.screen.previewA11yLabel'). Left as a literal (cannot
         * edit messages.ts — shared file) until that key lands; using the
         * existing previewNavTitle translation as an interim locale-correct
         * stand-in rather than a raw English string. */}
        <ScrollView
          testID="pdf-screen-preview"
          style={styles.previewScroll}
          contentContainerStyle={styles.previewContent}
          accessibilityLabel={t('pdf.screen.previewNavTitle')}
        >
          <ReportPreview
            html={builderState.generatedHtml}
            dateFrom={builderState.dateFrom}
            dateTo={builderState.dateTo}
            profile={profile}
            locale={locale}
            includeSensitiveNotes={builderState.includeSensitiveNotes}
          />
        </ScrollView>

        {/* Action bar: Print | Share */}
        <View style={styles.actionBar}>
          <TouchableOpacity
            testID="pdf-screen-print-btn"
            style={styles.secondaryBtn}
            onPress={() => void handlePrint()}
            accessibilityRole="button"
            accessibilityLabel={t('pdf.screen.printBtn')}
          >
            <Text style={styles.secondaryBtnText}>{t('pdf.screen.printBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="pdf-screen-share-btn"
            style={styles.primaryBtn}
            onPress={() => void handleShare()}
            accessibilityRole="button"
            accessibilityLabel={t('pdf.screen.shareBtn')}
          >
            <Text style={styles.primaryBtnText}>{t('pdf.screen.shareBtn')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Builder phase (default) ────────────────────────────────────────────────
  // v2 §8A.2: Preview enabled only when consent granted AND range valid (monthFrom ≤ monthTo).
  const isPreviewEnabled = gateAction === 'generate' && isDateRangeValid(builderState);
  const rangeError = !isDateRangeValid(builderState);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        {/* mobile-reviewer 🟡 fix (cluster 6 review): had role but no
         * accessibilityLabel — this is the 4th of 4 header back buttons
         * flagged in review (the preview-phase one already had a label). */}
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('general.back')}
        >
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>{t('pdf.screen.builderTitle')}</Text>
        <View style={styles.backBtnSpacer} />
      </View>

      <ScrollView testID="pdf-screen-builder" contentContainerStyle={styles.builderContent}>

        {/* ── Date range (v2 §8A.2): month picker fields (real modal picker) ── */}
        <Text style={styles.sectionLabel}>{t('pdf.screen.dateRangeLabel')}</Text>

        {/* Month from picker field — tapping opens month/year picker modal */}
        <Text style={styles.pickerFieldLabel}>{t('pdf.screen.monthFrom')}</Text>
        <TouchableOpacity
          testID="pdf-screen-month-from"
          style={styles.pickerField}
          onPress={() => openPicker('from')}
          accessibilityRole="button"
          accessibilityLabel={`${t('pdf.screen.monthFrom')}: ${formatYearMonth(builderState.monthFrom, locale)}`}
        >
          {/* Display in Thai long form (BE era) or English month+year */}
          <Text style={styles.pickerFieldValue}>
            {formatYearMonth(builderState.monthFrom, locale)}
          </Text>
          <Text style={styles.pickerFieldChevron}>{'›'}</Text>
        </TouchableOpacity>

        {/* Month to picker field — tapping opens month/year picker modal */}
        <Text style={styles.pickerFieldLabel}>{t('pdf.screen.monthTo')}</Text>
        <TouchableOpacity
          testID="pdf-screen-month-to"
          style={[styles.pickerField, rangeError && styles.pickerFieldError]}
          onPress={() => openPicker('to')}
          accessibilityRole="button"
          accessibilityLabel={`${t('pdf.screen.monthTo')}: ${formatYearMonth(builderState.monthTo, locale)}`}
        >
          <Text style={styles.pickerFieldValue}>
            {formatYearMonth(builderState.monthTo, locale)}
          </Text>
          <Text style={styles.pickerFieldChevron}>{'›'}</Text>
        </TouchableOpacity>

        {/* Inline validation error: shown when monthFrom > monthTo (spec §8A.2) */}
        {rangeError && (
          <Text style={styles.rangeError} accessibilityRole="alert">
            {t('pdf.screen.monthRangeError')}
          </Text>
        )}


        {/* ── Manifest (what's included) — spec §2 ─────────────────────── */}
        <Text style={styles.sectionLabel}>{t('pdf.screen.manifestTitle')}</Text>
        <View style={styles.manifestCard}>
          {/*
           * All ManifestRow entries are DISPLAY-ONLY (non-interactive).
           * The first four items are always included in the PDF.
           *
           * DEFERRED: sensitive_lab_results opt-in toggle (spec §2.2 / §4).
           * The spec requires a real Toggle gated by useJitConsent('sensitive_lab_results')
           * to wire BuilderPhaseState.includeSensitiveNotes=true. This is deferred to
           * a future slice because the sensitive_lab_results consent type and its
           * associated UX flow have not been fully specced for this release.
           * Safe default: sensitive notes are always hidden (includeSensitiveNotes=false),
           * so no unintended health-data egress occurs in the meantime.
           */}
          <ManifestRow icon="◉" label={t('pdf.screen.manifestMedication')} />
          <ManifestRow icon="◉" label={t('pdf.screen.manifestKickCounts')} />
          <ManifestRow icon="◉" label={t('pdf.screen.manifestSelfLogs')} />
          <ManifestRow icon="◉" label={t('pdf.screen.manifestAppointments')} />
          {/* Lab notes row: display-only placeholder; toggle is DEFERRED (see above).
           * mobile-reviewer fix (cluster 6 review): was icon="☐" — an empty
           * checkbox glyph that LOOKS tappable on a row with no onPress at
           * all (every other row uses the non-interactive "◉" filled dot).
           * Replaced with a plain non-interactive text badge (reusing the
           * existing manifestLabDefault "ค่าเริ่มต้น: ซ่อนไว้" / "Default:
           * hidden" copy — no new i18n key needed) instead of a
           * checkbox-shaped glyph. */}
          <ManifestRow
            icon="◉"
            label={t('pdf.screen.manifestLabNotes')}
            badge={t('pdf.screen.manifestLabDefault')}
          />
        </View>

        {/* ── Where this file goes — cloud_storage framing (spec §2.4) ─── */}
        <Text style={styles.sectionLabel}>{t('pdf.screen.whereTitle')}</Text>
        <View style={styles.whereCard}>
          <Text style={styles.whereText}>• {t('pdf.screen.whereLine1')}</Text>
          <Text style={styles.whereText}>• {t('pdf.screen.whereLine2')}</Text>
        </View>

        {/* ── Preview button ─────────────────────────────────────────────── */}
        <TouchableOpacity
          testID="pdf-screen-preview-btn"
          style={[styles.primaryBtn, styles.previewBtnMt, !isPreviewEnabled && styles.primaryBtnDisabled]}
          onPress={() => void handlePreviewTap()}
          disabled={!isPreviewEnabled}
          accessibilityRole="button"
          accessibilityLabel={t('pdf.screen.previewBtn')}
          accessibilityState={{ disabled: !isPreviewEnabled }}
        >
          <Text style={[styles.primaryBtnText, !isPreviewEnabled && styles.primaryBtnTextDisabled]}>
            {t('pdf.screen.previewBtn')}
          </Text>
        </TouchableOpacity>

      </ScrollView>

      {/* JIT consent sheet for pdf_egress */}
      <JitConsentSheet
        type="pdf_egress"
        visible={showJitSheet}
        onGrant={handleGrant}
        onDecline={handleDecline}
        isLoading={jit.isLoading}
        error={jit.error}
        onRetry={handleGrant}
        parentalAttested={jit.parentalAttested}
        onParentalAttest={jit.setParentalAttested}
      />

      {/* ── Month/year picker modal (FIX 3, §8A.2) ─────────────────────────── */}
      {/* Cross-platform modal with year stepper + 12-month grid.
       * Does NOT require @react-native-community/datetimepicker.
       * Mirrors the bottom-sheet modal pattern from ReminderFormScreen (§8A). */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerCard}>
            {/* Header row: cancel ─── title ─── done */}
            <View style={styles.pickerHeaderRow}>
              <TouchableOpacity
                style={styles.pickerCancelBtn}
                onPress={() => setPickerVisible(false)}
                accessibilityRole="button"
                accessibilityLabel={t('general.cancel')}
              >
                <Text style={styles.pickerCancelText}>{t('general.cancel')}</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>{t('picker.selectMonth')}</Text>
              <TouchableOpacity
                testID="pdf-picker-done"
                style={styles.pickerDoneBtn}
                onPress={confirmPicker}
                accessibilityRole="button"
                accessibilityLabel={t('general.done')}
              >
                <Text style={styles.pickerDoneText}>{t('general.done')}</Text>
              </TouchableOpacity>
            </View>

            {/* Year stepper: ‹ YYYY › */}
            <View style={styles.pickerYearRow}>
              {/* mobile-reviewer 🟡 (cluster 6 review): hardcoded English
               * a11y strings regardless of locale. REPORTED — needs i18n keys
               * 'picker.previousYear' / 'picker.nextYear'. Using the already
               * locale-correct year label text as an interim stand-in (still
               * announces meaningfully in both locales) until those keys land. */}
              <TouchableOpacity
                testID="pdf-picker-year-prev"
                style={styles.pickerStepBtn}
                onPress={() => setPickerYear((y) => y - 1)}
                accessibilityRole="button"
                accessibilityLabel={
                  locale === 'th' ? `พ.ศ. ก่อนหน้า ${pickerYear + 543 - 1}` : `Previous year, ${pickerYear - 1}`
                }
              >
                <Text style={styles.pickerStepText}>{'‹'}</Text>
              </TouchableOpacity>
              <Text style={styles.pickerYearLabel} testID="pdf-picker-year-label">
                {locale === 'th' ? `พ.ศ. ${pickerYear + 543}` : `${pickerYear}`}
              </Text>
              <TouchableOpacity
                testID="pdf-picker-year-next"
                style={styles.pickerStepBtn}
                onPress={() => setPickerYear((y) => y + 1)}
                accessibilityRole="button"
                accessibilityLabel={
                  locale === 'th' ? `พ.ศ. ถัดไป ${pickerYear + 543 + 1}` : `Next year, ${pickerYear + 1}`
                }
              >
                <Text style={styles.pickerStepText}>{'›'}</Text>
              </TouchableOpacity>
            </View>

            {/* 12-month grid: 3 rows × 4 cols */}
            <View style={styles.pickerMonthGrid}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const isSelected = m === pickerMonth;
                return (
                  <TouchableOpacity
                    key={m}
                    testID={`pdf-picker-month-${m}`}
                    style={[styles.pickerMonthCell, isSelected && styles.pickerMonthCellSelected]}
                    onPress={() => setPickerMonth(m)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      style={[
                        styles.pickerMonthLabel,
                        isSelected && styles.pickerMonthLabelSelected,
                      ]}
                    >
                      {locale === 'th'
                        ? (TH_MONTHS_SHORT[m - 1] ?? `${m}`)
                        : (EN_MONTHS_SHORT[m - 1] ?? `${m}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ManifestRowProps {
  icon: string;
  label: string;
  /**
   * Optional plain-text badge (mobile-reviewer fix, cluster 6 review) —
   * renders as non-interactive text, never a checkbox-shaped glyph.
   */
  badge?: string;
}

function ManifestRow({ icon, label, badge }: ManifestRowProps): React.JSX.Element {
  return (
    <View style={styles.manifestRow}>
      <Text style={styles.manifestIcon} accessibilityElementsHidden>{icon}</Text>
      <Text style={styles.manifestLabel}>
        {label}
        {badge != null ? (
          <Text style={styles.manifestBadge}>{'  · '}{badge}</Text>
        ) : null}
      </Text>
    </View>
  );
}

/**
 * ReportPreview — native React Native render of the PDF sections.
 *
 * Mirrors the HTML structure from doctorReportAssembler so what the mother sees
 * is faithful to what will be in the PDF (spec §3 anti-surprise guarantee).
 * Renders verbatim values — no grading, no colour-coding, no interpretation.
 *
 * This uses React Native components so no WebView is needed.
 */
interface ReportPreviewProps {
  html: string;    // kept for potential future WebView upgrade
  dateFrom: string;
  dateTo: string;
  profile: ReportProfile;
  locale: Locale;
  includeSensitiveNotes: boolean;
}

/**
 * ReportPreview — faithful native React Native render of the PDF sections.
 *
 * Section labels, placeholder text, and the §7 disclaimer are derived from
 * the same LABELS map used by doctorReportAssembler, so the preview and the
 * actual PDF output can never drift apart (spec §3 anti-surprise guarantee).
 *
 * Range filtering in KickCountPreviewSection and AppointmentPreviewSection
 * uses the exported isWithinRange helper from doctorReportAssembler — same
 * logic as the assembler's own filtering.
 */
function ReportPreview({
  dateFrom,
  dateTo,
  profile,
  locale,
  includeSensitiveNotes,
}: ReportPreviewProps): React.JSX.Element {
  // Use locale directly — never infer language from translated string content.
  const L = LABELS[locale];

  const lifecycleLabel =
    profile.lifecycle === 'postpartum' ? L.lifecyclePostpartum
      : profile.lifecycle === 'ended' ? L.lifecycleEnded
        : L.lifecyclePregnant;

  // mobile-reviewer fix (cluster 6 review): was raw ISO (dateFrom/dateTo,
  // e.g. "2026-06-01 – 2026-07-31") — a Gregorian date the mother never
  // picked in that form (the picker above is month/พ.ศ.-granularity). Reuses
  // the SAME formatYearMonth formatter as the correct พ.ศ. picker (single
  // source of truth — no risk of drifting into a different พ.ศ. convention).
  const rangeFromLabel = formatYearMonth(dateFrom.slice(0, 7), locale);
  const rangeToLabel = formatYearMonth(dateTo.slice(0, 7), locale);

  return (
    <View style={styles.previewPage}>
      {/* Header — derived from shared LABELS */}
      <Text style={styles.previewH1}>{L.reportTitle}</Text>
      <Text style={styles.previewRange}>{L.rangeLabel}: {rangeFromLabel} {L.rangeSep} {rangeToLabel}</Text>
      <View style={styles.divider} />

      {/* Profile */}
      <Text style={styles.previewH2}>{L.profileTitle}</Text>
      <Text style={styles.previewBody}>{L.lifecycle}: {lifecycleLabel}</Text>
      <Text style={styles.previewBody}>{L.edd}: {profile.edd}</Text>
      <Text style={styles.previewBody}>{L.gestationalWeek}: {profile.gestationalWeek} {L.weekUnit}</Text>

      {/* Medication — real data from stores, adherence computed on-device (RULING 7.3) */}
      <Text style={styles.previewH2}>{L.medTitle}</Text>
      <MedicationPreviewSection
        dateFrom={dateFrom}
        dateTo={dateTo}
        locale={locale}
        includeSensitiveNotes={includeSensitiveNotes}
      />

      {/* Kick-counts — SVG chart rendered from the SAME kickCountChartSvg function
          as the PDF assembler: preview == PDF (single source of truth). */}
      <Text style={styles.previewH2}>{L.kickTitle}</Text>
      <KickCountPreviewSection
        dateFrom={dateFrom}
        dateTo={dateTo}
        noDataLabel={L.noData}
        chartTitle={L.kickChartTitle}
        locale={locale}
      />

      {/* Self-logs — real data from selfLogSyncStore, decoded and filtered (spec §3) */}
      <Text style={styles.previewH2}>{L.selfLogTitle}</Text>
      <SelfLogPreviewSection
        dateFrom={dateFrom}
        dateTo={dateTo}
        locale={locale}
        includeSensitiveNotes={includeSensitiveNotes}
      />

      {/* Appointments — filtered by isWithinRange from assembler (same logic) */}
      <Text style={styles.previewH2}>{L.apptTitle}</Text>
      <AppointmentPreviewSection
        dateFrom={dateFrom}
        dateTo={dateTo}
        noDataLabel={L.noData}
        doneLabel={L.apptDone}
        pendingLabel={L.apptPending}
      />

      {/* Lab hidden line — uses shared labHiddenLine from LABELS (spec §3) */}
      {!includeSensitiveNotes && (
        <Text style={styles.previewLabHidden}>{L.labHiddenLine}</Text>
      )}

      <View style={styles.divider} />

      {/* §7 Disclaimer — uses shared disclaimer from LABELS (spec §3, US-10/US-11) */}
      <Text style={styles.previewDisclaimer}>{'ⓘ '}{L.disclaimer}</Text>
    </View>
  );
}

/**
 * KickCountPreviewSection — renders the kick-count bar chart SVG in the
 * native preview using react-native-svg's SvgXml.
 *
 * SINGLE SOURCE OF TRUTH: calls the SAME kickCountChartSvg function used by
 * doctorReportAssembler, so the preview and PDF are guaranteed to show the
 * same chart (spec §3 anti-surprise guarantee).
 *
 * CONSENT: only rendered when gateAction === 'generate' (post-consent path).
 *   The chart SVG is built from live store data only after pdf_egress is granted.
 *
 * K-5b: neutral ink — no valence coloring (enforced in reportCharts.ts).
 */
function KickCountPreviewSection({
  dateFrom,
  dateTo,
  noDataLabel,
  chartTitle,
  locale,
}: {
  dateFrom: string;
  dateTo: string;
  noDataLabel: string;
  chartTitle: string;
  locale: Locale;
}): React.JSX.Element {
  const L = LABELS[locale];

  // Apply the same filter / sort / cap as the PDF assembler (single source of truth)
  const inRange = kickCountSyncStore.getActiveSessions()
    .filter((s) => isWithinRange(s.startedAt, dateFrom, dateTo))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10);

  // Sort oldest-first for left-to-right time flow (mirrors assembler)
  const chronological = [...inRange].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );

  const chartData = chronological.map((s) => ({
    date: s.startedAt.substring(0, 10),
    count: s.movementCount,
  }));

  // Build the same caption line as the assembler
  const totalSessions = chartData.length;
  const captionLine =
    totalSessions === 0
      ? undefined
      : (() => {
          const avgCount = Math.round(
            chartData.reduce((sum, s) => sum + s.count, 0) / totalSessions,
          );
          return `${totalSessions} ${L.kickChartSessions} · ${L.kickChartAvg} ${avgCount} ${L.kickChartAvgUnit}`;
        })();

  // Generate the SVG using the same function as the PDF assembler
  const svgString = kickCountChartSvg(chartData, {
    noDataLabel,
    caption: captionLine,
    title: chartTitle,
    width: 320,   // narrower for mobile screen; proportions preserved
    height: 200,
  });

  return (
    <View
      style={styles.chartContainer}
      accessibilityLabel={chartTitle}
      accessibilityRole="image"
    >
      <SvgXml xml={svgString} width="100%" height={200} />
      {captionLine != null && (
        <Text style={styles.previewChartCaption}>{captionLine}</Text>
      )}
    </View>
  );
}

/**
 * SelfLogPreviewSection — native React Native preview of the self-log section.
 *
 * Reads from selfLogSyncStore, decodes base64 values, filters by range using
 * the same isWithinRange helper as the PDF assembler (single source of truth).
 *
 * Always rendered (numeric):  weight, blood_pressure — verbatim, no grading (INV-S1 / AC-20).
 * Gated (includeSensitiveNotes): swelling/lochia/symptom valueText; note (any type).
 *
 * Security: NEVER log decoded values (SD-5).
 */
function SelfLogPreviewSection({
  dateFrom,
  dateTo,
  locale,
  includeSensitiveNotes,
}: {
  dateFrom: string;
  dateTo: string;
  locale: Locale;
  includeSensitiveNotes: boolean;
}): React.JSX.Element {
  const L = LABELS[locale];

  // Decode + filter — same logic as handlePreviewTap / assembler (data minimization)
  const inRange = selfLogSyncStore
    .getSelfLogs()
    .filter((s) => isWithinRange(s.loggedAt, dateFrom, dateTo))
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

  if (inRange.length === 0) {
    return <Text style={styles.previewBody}>{L.selfLogNoData}</Text>;
  }

  return (
    <>
      {inRange.map((s) => {
        const dateStr = formatDateTime(s.loggedAt, locale);

        let line: string;
        if (s.metricType === 'weight') {
          const val = decodeFieldFromBase64(s.valueNumeric) ?? '';
          const unit = L.selfLogUnitKg;
          line = `${L.selfLogWeight} ${val} ${unit}`;
        } else if (s.metricType === 'blood_pressure') {
          const sys = decodeFieldFromBase64(s.valueNumeric) ?? '';
          const dia = decodeFieldFromBase64(s.valueNumericSecondary) ?? '';
          line = `${L.selfLogBP} ${sys}/${dia} ${L.selfLogUnitMmhg}`;
        } else {
          // swelling / lochia / symptom — valueText gated
          const metricLabel =
            s.metricType === 'swelling' ? L.selfLogSwelling
              : s.metricType === 'lochia' ? L.selfLogLochia
                : L.selfLogSymptom;
          if (includeSensitiveNotes) {
            const val = decodeFieldFromBase64(s.valueText) ?? '';
            line = `${metricLabel} ${val}`;
          } else {
            line = `${metricLabel} · ${L.selfLogValueHidden}`;
          }
        }

        const decodedNote = includeSensitiveNotes ? decodeFieldFromBase64(s.note) : null;

        return (
          <React.Fragment key={s.id}>
            <Text style={styles.previewBody}>{dateStr}: {line}</Text>
            {decodedNote ? (
              <Text style={styles.previewPlaceholder}>{L.selfLogNoteLabel}: {decodedNote}</Text>
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

/**
 * MedicationPreviewSection — native React Native preview of the medication section.
 *
 * Reads from medicationPlanSyncStore + medicationLogSyncStore, decodes base64 fields,
 * runs computeAdherence (same formula as PDF assembler — single source of truth).
 *
 * Adherence: plain count only — no grade, no colour (AC-20/INV-M1).
 * Note: gated on includeSensitiveNotes (§A.6).
 * Security: NEVER log name, dose, note, or occurrenceTime — SD-2/SD-5.
 */
function MedicationPreviewSection({
  dateFrom,
  dateTo,
  locale,
  includeSensitiveNotes,
}: {
  dateFrom: string;
  dateTo: string;
  locale: Locale;
  includeSensitiveNotes: boolean;
}): React.JSX.Element {
  const L = LABELS[locale];

  // Decode plans (live only) — deleted plan logs routed by orphan rule in computeAdherence
  const plans: ReportMedicationPlan[] = medicationPlanSyncStore.getPlans().map((p) => ({
    id: p.id,
    name: decodeFieldFromBase64(p.name) ?? '',
    dose: decodeFieldFromBase64(p.dose) ?? null,
    scheduleRule: p.scheduleRule ?? null,
    active: p.active,
    deletedAt: p.deletedAt ?? null,
  }));

  // Decode logs (all live — computeAdherence filters by range internally)
  const logs: ReportMedicationLog[] = medicationLogSyncStore.getLogs().map((l) => ({
    id: l.id,
    medicationPlanId: l.medicationPlanId ?? null,
    occurrenceTime: l.occurrenceTime,
    status: l.status,
    note: decodeFieldFromBase64(l.note) ?? null,
  }));

  const { planAdherences, selfRecordedLogs } = computeAdherence(plans, logs, dateFrom, dateTo);

  // Filter to logs in range for per-dose display
  const logsInRange = logs.filter((log) => {
    const d = log.occurrenceTime.substring(0, 10);
    return d >= dateFrom && d <= dateTo;
  });

  const hasData = planAdherences.length > 0 || selfRecordedLogs.length > 0;
  if (!hasData) {
    return <Text style={styles.previewBody}>{L.medNoData}</Text>;
  }

  return (
    <>
      {planAdherences.map((pa) => {
        const adherenceLine = pa.isPrn
          ? `${L.medTakenPrefix} ${pa.N} ${L.medTimes}`
          : `${L.medTakenPrefix} ${pa.N}/${pa.M} ${L.medDays}`;
        const planLogsInRange = logsInRange
          .filter((log) => log.medicationPlanId === pa.planId)
          .sort((a, b) => a.occurrenceTime.localeCompare(b.occurrenceTime));
        return (
          <React.Fragment key={pa.planId}>
            <Text style={styles.previewBody}>
              <Text style={{ fontWeight: 'bold' }}>{pa.name}</Text>
              {pa.dose ? ` ${pa.dose}` : ''}
            </Text>
            <Text style={styles.previewBody}>{adherenceLine}</Text>
            {planLogsInRange.map((log) => {
              const dateStr = formatDateTime(log.occurrenceTime, locale);
              const statusStr = log.status === 'taken' ? L.medTakenStatus : L.medMissedStatus;
              return (
                <React.Fragment key={log.id}>
                  <Text style={styles.previewBody}>  {dateStr}: {statusStr}</Text>
                  {includeSensitiveNotes && log.note ? (
                    <Text style={styles.previewBody}>  {L.selfLogNoteLabel}: {log.note}</Text>
                  ) : null}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
      {selfRecordedLogs.length > 0 && (
        <>
          <Text style={styles.previewBody}>{L.medAdHocLabel}</Text>
          {[...selfRecordedLogs]
            .sort((a, b) => a.occurrenceTime.localeCompare(b.occurrenceTime))
            .map((log) => {
              const dateStr = formatDateTime(log.occurrenceTime, locale);
              const statusStr = log.status === 'taken' ? L.medTakenStatus : L.medMissedStatus;
              return (
                <React.Fragment key={log.id}>
                  <Text style={styles.previewBody}>  {dateStr}: {statusStr}</Text>
                  {includeSensitiveNotes && log.note ? (
                    <Text style={styles.previewBody}>  {L.selfLogNoteLabel}: {log.note}</Text>
                  ) : null}
                </React.Fragment>
              );
            })}
        </>
      )}
    </>
  );
}

/** Reads appointments in range from calendarSyncStore and renders them. */
function AppointmentPreviewSection({
  dateFrom,
  dateTo,
  noDataLabel,
  doneLabel,
  pendingLabel,
}: {
  dateFrom: string;
  dateTo: string;
  noDataLabel: string;
  doneLabel: string;
  pendingLabel: string;
}): React.JSX.Element {
  // Uses isWithinRange from doctorReportAssembler — same filtering as the PDF assembler.
  const appts = calendarSyncStore.getActiveChecklistItems()
    .filter((c) => {
      if (!c.scheduledAt) return true; // undated — always include (mirrors assembler)
      return isWithinRange(c.scheduledAt, dateFrom, dateTo);
    })
    .sort((a, b) => {
      const sa = a.scheduledAt ?? '9999';
      const sb = b.scheduledAt ?? '9999';
      return sa.localeCompare(sb);
    });

  if (appts.length === 0) {
    return <Text style={styles.previewBody}>{noDataLabel}</Text>;
  }

  return (
    <>
      {appts.map((a) => (
        <Text key={a.id} style={styles.previewBody}>
          {a.scheduledAt ? a.scheduledAt.substring(0, 10) : '—'}: {a.title} · {a.done ? doneLabel : pendingLabel}
        </Text>
      ))}
    </>
  );
}

// ─── Styles — ห้องแม่ Phase 2 B4: full semantic T.* migration ────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.color.surface.base },

  // Header row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
  },
  backBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  backBtnText: { fontSize: 22, color: T.color.text.primary },
  backBtnSpacer: { minWidth: 44 },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    color: T.color.text.heading,
  },

  // Builder
  builderContent: { paddingHorizontal: 20, paddingBottom: 32 },
  sectionLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    letterSpacing: T.type.label.letterSpacing,
    color: T.color.text.botanical,
    marginTop: 20,
    marginBottom: 8,
  },

  // Month picker fields (v2 §8A.2 — replace preset chips)
  pickerFieldLabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    marginTop: 12,
    marginBottom: 4,
  },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: T.radius.md,
    borderWidth: 1.5,
    borderColor: T.color.surface.divider,
    backgroundColor: T.color.surface.base,
    minHeight: 48,
  },
  pickerFieldError: {
    borderColor: T.input.border.error,
  },
  pickerFieldValue: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.heading,
  },
  pickerFieldChevron: {
    fontSize: 18,
    color: T.color.text.primary,
  },
  rangeError: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.input.border.error,
    marginTop: 6,
  },

  // Manifest card
  manifestCard: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    padding: 16,
    gap: 10,
  },
  manifestRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  manifestIcon: { fontSize: 16, color: T.color.text.primary, marginTop: 1, minWidth: 20 },
  manifestLabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.heading,
    flex: 1,
  },
  // mobile-reviewer fix (cluster 6 review): plain-text badge replacing the
  // tappable-looking "☐" glyph on the lab-notes row.
  manifestBadge: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
  },

  // Where card
  whereCard: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    padding: 16,
    gap: 6,
  },
  whereText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.md,
    minHeight: T.button.primary.height,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primaryBtnDisabled: { backgroundColor: T.scrim.amber },
  primaryBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
  },
  primaryBtnTextDisabled: { opacity: 0.7 },
  previewBtnMt: { marginTop: 24 },

  secondaryBtn: {
    borderRadius: T.radius.md,
    minHeight: T.button.primary.height,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderWidth: 1.5,
    borderColor: T.color.accent.identity,
    flex: 1,
  },
  secondaryBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },

  // Generating
  generatingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  generatingText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },

  // Error
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  errorTitle: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.heading,
    textAlign: 'center',
  },

  // Consent blocked
  blockedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  blockedText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
    textAlign: 'center',
  },
  rearmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: T.radius.sm,
    borderWidth: 1.5,
    borderColor: T.color.accent.identity,
  },
  rearmBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
  },

  // Preview
  previewScroll: { flex: 1 },
  previewContent: { paddingHorizontal: 16, paddingVertical: 20 },
  previewPage: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.sm,
    padding: 20,
    ...T.elev[1],
  },
  previewH1: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.heading2.size,
    color: T.color.text.heading,
    marginBottom: 4,
  },
  previewRange: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    marginBottom: 4,
  },
  previewH2: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
    marginTop: 14,
    marginBottom: 4,
  },
  previewBody: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.heading,
    marginBottom: 2,
  },
  previewPlaceholder: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.micro.size,
    color: T.color.text.primary,
    fontStyle: 'italic',
  },
  previewLabHidden: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.micro.size,
    color: T.color.text.primary,
    marginTop: 12,
    fontStyle: 'italic',
  },
  previewDisclaimer: {
    fontFamily: T.type.micro.fontFamily,
    fontSize: T.type.micro.size,
    color: T.color.text.primary,
    marginTop: 12,
  },
  divider: { height: 1, backgroundColor: T.color.surface.divider, marginVertical: 12 },
  chartContainer: { marginVertical: 8 },
  previewChartCaption: {
    fontFamily: T.type.micro.fontFamily,
    fontSize: T.type.micro.size,
    color: T.color.text.primary,
    textAlign: 'center',
    marginTop: 2,
  },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: T.color.surface.divider,
    backgroundColor: T.color.surface.base,
  },

  // ── Month/year picker modal styles (FIX 3, §8A.2) ───────────────────────────
  pickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: T.scrim.color,
  },
  pickerCard: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 4,
  },
  pickerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
    marginBottom: 12,
  },
  pickerCancelBtn: { minWidth: 56, paddingVertical: 4 },
  pickerCancelText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },
  pickerTitle: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.heading,
    textAlign: 'center',
    flex: 1,
  },
  pickerDoneBtn: { minWidth: 56, paddingVertical: 4, alignItems: 'flex-end' },
  pickerDoneText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },

  // Year stepper row
  pickerYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 16,
  },
  pickerStepBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerStepText: { fontSize: 22, color: T.color.text.primary },
  pickerYearLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.bodyLarge.size,
    color: T.color.text.heading,
    minWidth: 100,
    textAlign: 'center',
  },

  // 12-month grid: 3 rows × 4 cols
  pickerMonthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  pickerMonthCell: {
    width: '22%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    backgroundColor: T.color.surface.base,
  },
  pickerMonthCellSelected: {
    backgroundColor: T.color.surface.wash.roselle,
    borderColor: T.color.accent.identity,
  },
  pickerMonthLabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.heading,
    textAlign: 'center',
  },
  pickerMonthLabelSelected: {
    fontFamily: T.type.label.fontFamily,
    color: T.color.text.heading,
  },
});
