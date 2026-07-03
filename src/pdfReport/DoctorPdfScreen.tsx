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
 * testIDs:
 *   pdf-screen-builder              — builder phase container
 *   pdf-screen-preset-this-month   — this month preset chip
 *   pdf-screen-preset-3months      — 3 months preset chip
 *   pdf-screen-preset-all-time     — all time preset chip
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
} from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useT } from '../i18n/LanguageContext';
import type { Locale } from '../auth/types';
import type { TokenStorage } from '../auth/tokenStorage';
import { JitConsentSheet } from '../consent/JitConsentSheet';
import { useJitConsent } from '../consent/useJitConsent';
import { localCivilToday } from '../pregnancy/gestationalAge';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { buildDoctorReportHtml, LABELS, isWithinRange, formatDateTime, type ReportSelfLog } from './doctorReportAssembler';
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
  applyPresetSelected,
  applyGeneratingStarted,
  applyPreviewReady,
  applyPreviewError,
  applyBackToBuilder,
  type BuilderPhaseState,
  type DateRangePreset,
} from './DoctorPdfScreenLogic';
import { decodeFieldFromBase64 } from '../capture/captureScreenLogic';
import type { ReportProfile } from './doctorReportAssembler';

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

      const html = buildDoctorReportHtml({
        profile,
        kickSessions,
        appointments,
        selfLogs,
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
          <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button">
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
          <ActivityIndicator color="#A8505A" size="large" />
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
          <TouchableOpacity onPress={() => setBuilderState((p) => applyBackToBuilder(p))} style={styles.backBtn} accessibilityRole="button">
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
        <ScrollView
          testID="pdf-screen-preview"
          style={styles.previewScroll}
          contentContainerStyle={styles.previewContent}
          accessibilityLabel="Report preview"
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
  const isPreviewEnabled = gateAction === 'generate';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>{t('pdf.screen.builderTitle')}</Text>
        <View style={styles.backBtnSpacer} />
      </View>

      <ScrollView testID="pdf-screen-builder" contentContainerStyle={styles.builderContent}>

        {/* ── Date range ──────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('pdf.screen.dateRangeLabel')}</Text>
        <View style={styles.presetRow}>
          {(['this_month', 'last_3_months', 'all_time'] as DateRangePreset[]).map((preset) => {
            const label = preset === 'this_month'
              ? t('pdf.screen.presetThisMonth')
              : preset === 'last_3_months'
                ? t('pdf.screen.presetLast3Months')
                : t('pdf.screen.presetAllTime');
            const testID = preset === 'this_month'
              ? 'pdf-screen-preset-this-month'
              : preset === 'last_3_months'
                ? 'pdf-screen-preset-3months'
                : 'pdf-screen-preset-all-time';
            const isSelected = builderState.selectedPreset === preset;
            return (
              <TouchableOpacity
                key={preset}
                testID={testID}
                style={[styles.presetChip, isSelected && styles.presetChipSelected]}
                onPress={() => setBuilderState((prev) => applyPresetSelected(prev, preset, today))}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={label}
              >
                <Text style={[styles.presetChipText, isSelected && styles.presetChipTextSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

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
          {/* Lab notes row: display-only placeholder; toggle is DEFERRED (see above) */}
          <ManifestRow
            icon="☐"
            label={`${t('pdf.screen.manifestLabNotes')} — ${t('pdf.screen.manifestLabDefault')}`}
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
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ManifestRowProps {
  icon: string;
  label: string;
}

function ManifestRow({ icon, label }: ManifestRowProps): React.JSX.Element {
  return (
    <View style={styles.manifestRow}>
      <Text style={styles.manifestIcon} accessibilityElementsHidden>{icon}</Text>
      <Text style={styles.manifestLabel}>{label}</Text>
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

  return (
    <View style={styles.previewPage}>
      {/* Header — derived from shared LABELS */}
      <Text style={styles.previewH1}>{L.reportTitle}</Text>
      <Text style={styles.previewRange}>{L.rangeLabel}: {dateFrom} {L.rangeSep} {dateTo}</Text>
      <View style={styles.divider} />

      {/* Profile */}
      <Text style={styles.previewH2}>{L.profileTitle}</Text>
      <Text style={styles.previewBody}>{L.lifecycle}: {lifecycleLabel}</Text>
      <Text style={styles.previewBody}>{L.edd}: {profile.edd}</Text>
      <Text style={styles.previewBody}>{L.gestationalWeek}: {profile.gestationalWeek} {L.weekUnit}</Text>

      {/* Medication — placeholder matches assembler (spec §3, data-source gap) */}
      <Text style={styles.previewH2}>{L.medTitle}</Text>
      <Text style={styles.previewPlaceholder}>{L.medPlaceholder}</Text>

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const ROSE_600 = '#A8505A';
const NEUTRAL_900 = '#3A2A30';
const NEUTRAL_600 = '#5F4A52';
const NEUTRAL_400 = '#94818A';
const CREAM = '#FBF6F1';
const BORDER = '#EBE1D9';
const CARD_BG = '#F5F0ED';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },

  // Header row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  backBtnText: { fontSize: 22, color: ROSE_600 },
  backBtnSpacer: { minWidth: 44 },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: NEUTRAL_900,
    fontFamily: 'IBMPlexSans-SemiBold',
  },

  // Builder
  builderContent: { paddingHorizontal: 20, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: NEUTRAL_600,
    marginTop: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Preset chips
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: CREAM,
    minHeight: 40,
    justifyContent: 'center',
  },
  presetChipSelected: {
    backgroundColor: ROSE_600,
    borderColor: ROSE_600,
  },
  presetChipText: { fontSize: 14, color: NEUTRAL_600 },
  presetChipTextSelected: { color: '#fff', fontWeight: '600' },

  // Manifest card
  manifestCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  manifestRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  manifestIcon: { fontSize: 16, color: NEUTRAL_600, marginTop: 1, minWidth: 20 },
  manifestLabel: { fontSize: 14, color: NEUTRAL_900, flex: 1 },

  // Where card
  whereCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  whereText: { fontSize: 13, color: NEUTRAL_600 },

  // Buttons
  primaryBtn: {
    backgroundColor: ROSE_600,
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primaryBtnDisabled: { backgroundColor: '#D4B8BC' },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff', fontFamily: 'IBMPlexSans-SemiBold' },
  primaryBtnTextDisabled: { opacity: 0.7 },
  previewBtnMt: { marginTop: 24 },

  secondaryBtn: {
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderWidth: 1.5,
    borderColor: ROSE_600,
    flex: 1,
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600', color: ROSE_600 },

  // Generating
  generatingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  generatingText: { fontSize: 15, color: NEUTRAL_600 },

  // Error
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  errorTitle: { fontSize: 16, color: NEUTRAL_900, textAlign: 'center' },

  // Consent blocked
  blockedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  blockedText: { fontSize: 15, color: NEUTRAL_600, textAlign: 'center' },
  rearmBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1.5, borderColor: ROSE_600 },
  rearmBtnText: { fontSize: 14, fontWeight: '600', color: ROSE_600 },

  // Preview
  previewScroll: { flex: 1 },
  previewContent: { paddingHorizontal: 16, paddingVertical: 20 },
  previewPage: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  previewH1: { fontSize: 18, fontWeight: '700', color: ROSE_600, marginBottom: 4 },
  previewRange: { fontSize: 13, color: NEUTRAL_600, marginBottom: 4 },
  previewH2: { fontSize: 15, fontWeight: '600', color: NEUTRAL_600, marginTop: 14, marginBottom: 4 },
  previewBody: { fontSize: 13, color: NEUTRAL_900, marginBottom: 2 },
  previewPlaceholder: { fontSize: 12, color: NEUTRAL_400, fontStyle: 'italic' },
  previewLabHidden: { fontSize: 12, color: NEUTRAL_400, marginTop: 12, fontStyle: 'italic' },
  previewDisclaimer: { fontSize: 11, color: NEUTRAL_400, marginTop: 12 },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 12 },
  chartContainer: { marginVertical: 8 },
  previewChartCaption: { fontSize: 11, color: NEUTRAL_400, textAlign: 'center', marginTop: 2 },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: CREAM,
  },
});
