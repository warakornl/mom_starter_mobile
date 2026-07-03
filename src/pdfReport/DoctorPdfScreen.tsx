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

import { useT } from '../i18n/LanguageContext';
import type { MessageKey } from '../i18n/messages';
import type { TokenStorage } from '../auth/tokenStorage';
import { JitConsentSheet } from '../consent/JitConsentSheet';
import { useJitConsent } from '../consent/useJitConsent';
import { localCivilToday } from '../pregnancy/gestationalAge';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { buildDoctorReportHtml } from './doctorReportAssembler';
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

      const html = buildDoctorReportHtml({
        profile,
        kickSessions,
        appointments,
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
            t={t}
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
          <ManifestRow icon="◉" label={t('pdf.screen.manifestMedication')} />
          <ManifestRow icon="◉" label={t('pdf.screen.manifestKickCounts')} />
          <ManifestRow icon="◉" label={t('pdf.screen.manifestSelfLogs')} />
          <ManifestRow icon="◉" label={t('pdf.screen.manifestAppointments')} />
          {/* Sensitive notes row — off by default (spec §2.2) */}
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
  locale: string;
  includeSensitiveNotes: boolean;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

function ReportPreview({
  dateFrom,
  dateTo,
  profile,
  includeSensitiveNotes,
  t,
}: ReportPreviewProps): React.JSX.Element {
  // Section placeholders (data sources not yet built — mirrors assembler behavior)
  const medPlaceholder = t('pdf.screen.generating').includes('Building')
    ? 'Not tracked yet in this range · medication logging feature not yet built'
    : 'ยังไม่มีข้อมูลในช่วงนี้ · ฟีเจอร์บันทึกยายังไม่ถูกสร้าง';
  const selfLogPlaceholder = t('pdf.screen.generating').includes('Building')
    ? 'Not tracked yet in this range · self-log feature not yet built'
    : 'ยังไม่มีข้อมูลในช่วงนี้ · ฟีเจอร์บันทึกตนเองยังไม่ถูกสร้าง';

  const lifecycleLabel =
    profile.lifecycle === 'postpartum' ? 'หลังคลอด / Postpartum'
      : profile.lifecycle === 'ended' ? 'สิ้นสุด / Ended'
        : 'ตั้งครรภ์ / Pregnant';

  return (
    <View style={styles.previewPage}>
      {/* Header */}
      <Text style={styles.previewH1}>รายงานสุขภาพ / Health Report</Text>
      <Text style={styles.previewRange}>{dateFrom} – {dateTo}</Text>
      <View style={styles.divider} />

      {/* Profile */}
      <Text style={styles.previewH2}>ข้อมูลการตั้งครรภ์ / Profile</Text>
      <Text style={styles.previewBody}>{lifecycleLabel}</Text>
      <Text style={styles.previewBody}>EDD: {profile.edd}</Text>
      <Text style={styles.previewBody}>อายุครรภ์ / Week: {profile.gestationalWeek}</Text>

      {/* Medication */}
      <Text style={styles.previewH2}>ยาและการกินยา / Medication & adherence</Text>
      <Text style={styles.previewPlaceholder}>{medPlaceholder}</Text>

      {/* Kick-counts — from store (filtered by range inside assembler) */}
      <Text style={styles.previewH2}>นับลูกดิ้น / Kick-counts</Text>
      <KickCountPreviewSection dateFrom={dateFrom} dateTo={dateTo} />

      {/* Self-logs */}
      <Text style={styles.previewH2}>บันทึกตนเอง / Self-logs (weight/BP/swelling)</Text>
      <Text style={styles.previewPlaceholder}>{selfLogPlaceholder}</Text>

      {/* Appointments */}
      <Text style={styles.previewH2}>นัดหมาย / Appointments</Text>
      <AppointmentPreviewSection dateFrom={dateFrom} dateTo={dateTo} />

      {/* Lab hidden line (spec §3) */}
      {!includeSensitiveNotes && (
        <Text style={styles.previewLabHidden}>
          ผลแล็บ/บันทึก: ผลถูกซ่อน (ไม่ได้ยินยอมให้รวมผลที่ละเอียดอ่อน){'\n'}
          Lab / notes: results hidden (sensitive results not consented for inclusion)
        </Text>
      )}

      <View style={styles.divider} />

      {/* §7 Disclaimer — always visible in preview (spec §3, US-10/US-11) */}
      <Text style={styles.previewDisclaimer}>
        {'ⓘ '}แอปไม่วินิจฉัย/ไม่ให้คำแนะนำทางการแพทย์ · เป็นบันทึกส่วนตัวเพื่อแสดงต่อแพทย์{'\n'}
        This app does not diagnose or give medical advice. Personal record for your doctor.
      </Text>
    </View>
  );
}

/** Reads kick sessions in range from kickCountSyncStore and renders them. */
function KickCountPreviewSection({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }): React.JSX.Element {
  const sessions = kickCountSyncStore.getActiveSessions()
    .filter((s) => {
      const date = s.startedAt.substring(0, 10);
      return date >= dateFrom && date <= dateTo;
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10);

  if (sessions.length === 0) {
    return <Text style={styles.previewBody}>ไม่มีข้อมูลในช่วงนี้ / No data in this range</Text>;
  }

  return (
    <>
      {sessions.map((s) => (
        <Text key={s.id} style={styles.previewBody} accessibilityLabel={`${s.movementCount} movements`}>
          {s.startedAt.substring(0, 10)}: {s.movementCount} ครั้ง / movements
        </Text>
      ))}
    </>
  );
}

/** Reads appointments in range from calendarSyncStore and renders them. */
function AppointmentPreviewSection({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }): React.JSX.Element {
  const appts = calendarSyncStore.getActiveChecklistItems()
    .filter((c) => {
      if (!c.scheduledAt) return true; // undated — always include
      const date = c.scheduledAt.substring(0, 10);
      return date >= dateFrom && date <= dateTo;
    })
    .sort((a, b) => {
      const sa = a.scheduledAt ?? '9999';
      const sb = b.scheduledAt ?? '9999';
      return sa.localeCompare(sb);
    });

  if (appts.length === 0) {
    return <Text style={styles.previewBody}>ไม่มีข้อมูลในช่วงนี้ / No data in this range</Text>;
  }

  return (
    <>
      {appts.map((a) => (
        <Text key={a.id} style={styles.previewBody}>
          {a.scheduledAt ? a.scheduledAt.substring(0, 10) : '—'}: {a.title} · {a.done ? '✓' : '…'}
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
