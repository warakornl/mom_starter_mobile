/**
 * PregnancySummaryScreen — "สรุปการตั้งครรภ์ (Pregnancy Summary)"
 *
 * Read-only recap screen. Reached from ProfileHub → "สรุปการตั้งครรภ์" row.
 *
 * Implements:
 *   - docs/product/pregnancy-summary.md §3 (trimester aggregation, delivery)
 *   - docs/api-spec/pregnancy-summary-design.md §2 (mobile-only, no summary endpoint)
 *   - docs/legal/pregnancy-summary-legal.md §3 (VERBATIM disclaimer G-summary-1)
 *
 * ── MANDATORY LEGAL CONSTRAINTS (G-PS-a..g) ────────────────────────────────────
 * G-PS-a: Disclaimer always-on (short inline + ≥44dp link to full version).
 * G-PS-b (INV-PS1): NO verdict/badge/color/assessment/recommendation copy anywhere.
 * G-PS-c: "จาก X วันที่บันทึก" MUST display adjacent to avg kicks — always-on.
 * G-PS-d: NO cross-trimester trend/comparison (↑↓→ forbidden; each trimester is separate).
 * G-PS-e (INV-PS4): aggregates only current-user data; no external reference.
 * G-PS-f (INV-PS2 / K-8): avgKicksPerDay computed on-device, NEVER logged/sent to analytics.
 * G-PS-g: NOT framed as a complete medical record; disclaimer makes this explicit.
 *
 * ── DESIGN: Clean (flat, no shadow) ───────────────────────────────────────────
 * Uses T.cardRadius, T.hairline, T.sectionLabel* from src/theme/tokens.ts.
 * No elevation, no shadowColor.
 *
 * ── ACCESSIBILITY ─────────────────────────────────────────────────────────────
 * Disclaimer "ดูเพิ่มเติม" link is a standalone TouchableOpacity (≥44dp).
 * It is NOT nested inside an accessibilityRole="text" parent (see baby-size fix).
 *
 * ── INV-PS3 ───────────────────────────────────────────────────────────────────
 * This screen is READ-ONLY. It MUST NOT write to any sync store.
 *
 * Security:
 *   K-8: avgKicksPerDay / movementCount / sums must NEVER be logged or sent to analytics.
 *   NEVER log deliveryType, hospitalAdmissionDate, or hospitalDischargeDate (health PII).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT } from '../i18n/LanguageContext';
import { formatCivilDate, type MessageKey } from '../i18n/messages';
import type { Locale } from '../auth/types';
import { T } from '../theme/tokens';
import { buildPregnancySummary } from './pregnancySummary';
import type { TrimesterData, KicksSummaryData, MedSummaryData, DeliveryRecordData } from './pregnancySummary';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { medicationLogSyncStore } from '../medication/medicationLogSyncStore';
import { medicationPlanSyncStore } from '../medication/medicationPlanSyncStore';
import { decodeNameFromWire } from './nameFieldCipher';
import { localCivilToday } from './gestationalAge';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PregnancySummaryScreenProps {
  /** Civil EDD YYYY-MM-DD, or null when not set (needsEdd state). */
  edd: string | null;
  /** Civil birth date YYYY-MM-DD, or null when still pregnant. */
  birthDate: string | null;
  /**
   * Decoded delivery type (e.g. "vaginal" | "cesarean" | "other" | "prefer_not").
   * NEVER log this value (health PII).
   */
  deliveryType: string | null;
  /**
   * Decoded hospital admission civil date YYYY-MM-DD, or null.
   * NEVER log this value (health-adjacent PII).
   */
  hospitalAdmissionDate: string | null;
  /**
   * Decoded hospital discharge civil date YYYY-MM-DD, or null.
   * NEVER log this value (health-adjacent PII).
   */
  hospitalDischargeDate: string | null;
  /**
   * Navigate to the profile-setup screen to set EDD.
   * Shown in the needsEdd state.
   */
  onSetEdd?: () => void;
  /** Navigate back. */
  onBack?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PregnancySummaryScreen({
  edd,
  birthDate,
  deliveryType,
  hospitalAdmissionDate,
  hospitalDischargeDate,
  onSetEdd,
  onBack,
}: PregnancySummaryScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const [showFullDisclaimer, setShowFullDisclaimer] = useState(false);

  // ── Build on-device summary ───────────────────────────────────────────────
  // INV-PS3: read-only — no store writes. K-8: raw counts never logged.
  // Spec §3.2: MUST use getCompletedSessions() — getActiveSessions() is banned
  // by name for summary aggregation (DEFECT-PS-1 guard).
  const sessions = kickCountSyncStore.getCompletedSessions();
  const logs = medicationLogSyncStore.getLogs();
  const rawPlans = medicationPlanSyncStore.getPlans();

  // Decode plan names from Base64 cipher before passing to pure aggregation fn.
  // NEVER log decoded plan names (health PII).
  const plans = rawPlans.map((p) => ({
    planId: p.id,
    name: decodeNameFromWire(p.name) ?? '',
  }));

  const today = localCivilToday();

  // buildPregnancySummary is pure (no I/O, no side effects).
  // K-8: avgKicksPerDay is display-only; this fn does not log or egress it.
  const summary = buildPregnancySummary({
    edd,
    birthDate,
    deliveryType,
    hospitalAdmissionDate,
    hospitalDischargeDate,
    completedKickSessions: sessions,
    medicationLogs: logs,
    plans,
    today,
  });

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderSectionLabel(label: string): React.JSX.Element {
    return (
      <Text style={styles.sectionLabel} accessibilityRole="header">
        {label.toUpperCase()}
      </Text>
    );
  }

  /**
   * G-PS-c: avgKicksPerDay and "จาก X วันที่บันทึก" MUST be adjacent always-on.
   * K-8: the avg value goes to display only; NEVER to a log call.
   */
  function renderKicksData(kicks: KicksSummaryData): React.JSX.Element {
    return (
      <View style={styles.kicksRow}>
        <Text style={styles.kicksAvg}>
          {t('pregnancySummary.kicks.avgPerDay', { avg: String(kicks.avgKicksPerDay) })}
        </Text>
        {/* G-PS-c: daysWithData MUST be shown adjacent — not as tooltip */}
        <Text style={styles.kicksDays}>
          {t('pregnancySummary.kicks.daysWithData', { days: String(kicks.daysWithData) })}
        </Text>
      </View>
    );
  }

  function renderMedRow(med: MedSummaryData, idx: number): React.JSX.Element {
    return (
      <View key={`med-${med.planId ?? 'adhoc'}-${idx}`} style={styles.medRow}>
        <Text style={styles.medLabel}>{med.label}</Text>
        <Text style={styles.medDays}>
          {t('pregnancySummary.meds.distinctDays', { days: String(med.distinctDayCount) })}
        </Text>
      </View>
    );
  }

  function renderTrimester(
    titleKey: 'pregnancySummary.t1' | 'pregnancySummary.t2' | 'pregnancySummary.t3',
    data: TrimesterData,
  ): React.JSX.Element {
    return (
      <View style={styles.trimesterSection}>
        {/* Trimester header — G-PS-d: standalone fact, no comparison to other trimesters */}
        <Text style={styles.trimesterTitle}>{t(titleKey)}</Text>

        {/* Kicks subsection */}
        {renderSectionLabel(t('pregnancySummary.kicks.sectionLabel'))}
        {data.kicks != null
          ? renderKicksData(data.kicks)
          : (
            <Text style={styles.emptyText}>
              {t('pregnancySummary.kicks.noData')}
            </Text>
          )}

        {/* Medications subsection */}
        {renderSectionLabel(t('pregnancySummary.meds.sectionLabel'))}
        {data.medications.length > 0
          ? data.medications.map(renderMedRow)
          : (
            <Text style={styles.emptyText}>
              {t('pregnancySummary.meds.noData')}
            </Text>
          )}
      </View>
    );
  }

  function renderDelivery(delivery: DeliveryRecordData | null): React.JSX.Element {
    return (
      <View style={styles.deliverySection}>
        {renderSectionLabel(t('pregnancySummary.delivery.sectionLabel'))}
        {delivery == null ? (
          <Text style={styles.emptyText}>
            {t('pregnancySummary.delivery.noData')}
          </Text>
        ) : (
          <View style={styles.deliveryRows}>
            {/* Delivery type */}
            <View style={styles.deliveryRow}>
              <Text style={styles.deliveryRowLabel}>
                {t('pregnancySummary.delivery.typeLabel')}
              </Text>
              <Text style={styles.deliveryRowValue}>
                {delivery.deliveryType != null
                  ? resolveDeliveryTypeLabel(delivery.deliveryType, t)
                  : t('pregnancySummary.delivery.notSpecified')}
              </Text>
            </View>
            {/* Hospital admission */}
            <View style={styles.deliveryRow}>
              <Text style={styles.deliveryRowLabel}>
                {t('pregnancySummary.delivery.admissionLabel')}
              </Text>
              <Text style={styles.deliveryRowValue}>
                {delivery.hospitalAdmissionDate != null
                  ? formatCivilDate(delivery.hospitalAdmissionDate, locale as Locale)
                  : t('pregnancySummary.delivery.notSpecified')}
              </Text>
            </View>
            {/* Hospital discharge */}
            <View style={styles.deliveryRow}>
              <Text style={styles.deliveryRowLabel}>
                {t('pregnancySummary.delivery.dischargeLabel')}
              </Text>
              <Text style={styles.deliveryRowValue}>
                {delivery.hospitalDischargeDate != null
                  ? formatCivilDate(delivery.hospitalDischargeDate, locale as Locale)
                  : t('pregnancySummary.delivery.notSpecified')}
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  // ── needsEdd state ────────────────────────────────────────────────────────

  if (summary.needsEdd) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.navBar}>
          {onBack && (
            <TouchableOpacity onPress={onBack} accessibilityRole="button" style={styles.backBtn}>
              <Text style={styles.backBtnText}>{'‹'}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.navTitle} accessibilityRole="header">
            {t('pregnancySummary.navTitle')}
          </Text>
        </View>
        <View style={styles.noEddState}>
          <Text style={styles.noEddText}>{t('pregnancySummary.noEddPrompt')}</Text>
          {onSetEdd && (
            <TouchableOpacity
              style={styles.noEddAction}
              onPress={onSetEdd}
              accessibilityRole="button"
              accessibilityLabel={t('pregnancySummary.noEddAction')}
            >
              <Text style={styles.noEddActionText}>{t('pregnancySummary.noEddAction')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        {onBack && (
          <TouchableOpacity onPress={onBack} accessibilityRole="button" style={styles.backBtn}>
            <Text style={styles.backBtnText}>{'‹'}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.navTitle} accessibilityRole="header">
          {t('pregnancySummary.navTitle')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        accessibilityRole="none"
      >
        {/* ── G-PS-a: Disclaimer — always-on (short + "ดูเพิ่มเติม" link ≥44dp) ── */}
        {/*
          a11y: the disclaimer TouchableOpacity link MUST NOT be nested inside
          an accessibilityRole="text" parent (baby-size a11y fix precedent).
          The short text and the link are siblings in a plain View.
        */}
        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerText}>
            {t('pregnancySummary.disclaimer.short')}
          </Text>
          {/* Link is a STANDALONE TouchableOpacity — NOT inside accessibilityRole="text" */}
          <TouchableOpacity
            onPress={() => setShowFullDisclaimer(true)}
            accessibilityRole="link"
            accessibilityLabel={t('pregnancySummary.disclaimer.seeMore')}
            style={styles.disclaimerLink}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.disclaimerLinkText}>
              {t('pregnancySummary.disclaimer.seeMore')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Partial note: still pregnant */}
        {birthDate == null && (
          <Text style={styles.partialNote}>
            {t('pregnancySummary.partialNote')}
          </Text>
        )}

        {/* ── Trimester sections (G-PS-d: independent facts, no cross-trimester comparison) ── */}
        {renderTrimester('pregnancySummary.t1', summary.T1)}
        <View style={styles.divider} />
        {renderTrimester('pregnancySummary.t2', summary.T2)}
        <View style={styles.divider} />
        {renderTrimester('pregnancySummary.t3', summary.T3)}
        <View style={styles.divider} />

        {/* ── Delivery record (NOT trimester-bucketed per §3.1 must-pin) ──────── */}
        {renderDelivery(summary.delivery)}

      </ScrollView>

      {/* ── Full disclaimer modal ─────────────────────────────────────────── */}
      <Modal
        visible={showFullDisclaimer}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFullDisclaimer(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalFullDisclaimerText}>
                {t('pregnancySummary.disclaimer.full')}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowFullDisclaimer(false)}
              accessibilityRole="button"
              accessibilityLabel={'ปิด'}
            >
              <Text style={styles.modalCloseBtnText}>{'ปิด'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Delivery type label resolution ──────────────────────────────────────────

/**
 * Resolve a delivery type string to a catalog label.
 * Falls back to the raw value if not recognized (future-proof).
 *
 * G-PS-b: labels are FACTUAL only — no valence/comparison copy.
 * Reuses existing birth.delivery.* catalog keys.
 */
const DELIVERY_TYPE_KEYS: Record<string, MessageKey> = {
  vaginal: 'birth.delivery.vaginal',
  cesarean: 'birth.delivery.cesarean',
  other: 'birth.delivery.other',
  prefer_not: 'birth.delivery.prefer_not',
};

function resolveDeliveryTypeLabel(
  deliveryType: string,
  t: (key: MessageKey) => string,
): string {
  const key = DELIVERY_TYPE_KEYS[deliveryType];
  return key != null ? t(key) : deliveryType;
}

// ─── Styles (Clean: flat, no shadow, T tokens) ────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },

  // Nav bar
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.hairline,
    backgroundColor: '#FBF6F1',
  },
  navTitle: {
    flex: 1,
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 17,
    lineHeight: 24,
    color: '#3A2A30',
    textAlign: 'center',
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  backBtnText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 24,
    color: '#3A2A30',
  },

  // Scroll content
  scrollContent: {
    padding: 16,
    gap: 12,
  },

  // Disclaimer (G-PS-a — always-on)
  disclaimerBox: {
    backgroundColor: '#F5EDE8',
    borderRadius: T.cardRadius,
    borderWidth: 1,
    borderColor: T.hairline,
    padding: 12,
    gap: 4,
    // Note: flat (no shadow, no elevation) per Clean design
  },
  disclaimerText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#5F4A52',
  },
  // "ดูเพิ่มเติม" link — standalone TouchableOpacity ≥44dp
  // NOT inside accessibilityRole="text" parent (a11y requirement)
  disclaimerLink: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  disclaimerLinkText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 13,
    lineHeight: 20,
    color: '#9B1C35',
  },

  // Partial note
  partialNote: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#5F4A52',
    textAlign: 'center',
  },

  // Section label (T tokens — Clean)
  sectionLabel: {
    fontFamily: T.sectionLabelFontFamily,
    fontSize: T.sectionLabelFontSize,
    letterSpacing: T.sectionLabelLetterSpacing,
    color: T.sectionLabelColor,
    marginTop: 8,
    marginBottom: 4,
  },

  // Trimester section
  trimesterSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: T.cardRadius,
    borderWidth: 1,
    borderColor: T.hairline,
    padding: 12,
    gap: 4,
    // Clean: no shadow, no elevation
  },
  trimesterTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    lineHeight: 24,
    color: '#3A2A30',
    marginBottom: 4,
  },

  // Kicks (G-PS-c: avg + daysWithData adjacent)
  kicksRow: {
    gap: 2,
  },
  kicksAvg: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A2A30',
  },
  // G-PS-c: daysWithData immediately below avgPerDay — never hidden/tooltip
  kicksDays: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#5F4A52',
  },

  // Medications
  medRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  medLabel: {
    flex: 1,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#3A2A30',
  },
  medDays: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#5F4A52',
    marginLeft: 8,
  },

  // Empty states
  emptyText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#94818A',
    paddingVertical: 4,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: T.hairline,
    marginVertical: 4,
  },

  // Delivery section
  deliverySection: {
    backgroundColor: '#FFFFFF',
    borderRadius: T.cardRadius,
    borderWidth: 1,
    borderColor: T.hairline,
    padding: 12,
    gap: 4,
    // Clean: no shadow, no elevation
  },
  deliveryRows: {
    gap: 6,
  },
  deliveryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  deliveryRowLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#5F4A52',
    flex: 1,
  },
  deliveryRowValue: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#3A2A30',
    flex: 1,
    textAlign: 'right',
  },

  // noEdd state
  noEddState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  noEddText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 24,
    color: '#5F4A52',
    textAlign: 'center',
  },
  noEddAction: {
    backgroundColor: '#9B1C35',
    borderRadius: T.cardRadius,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noEddActionText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    lineHeight: 24,
    color: '#FFFFFF',
  },

  // Full disclaimer modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FBF6F1',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    maxHeight: '70%',
    gap: 16,
  },
  modalFullDisclaimerText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 24,
    color: '#3A2A30',
  },
  modalCloseBtn: {
    backgroundColor: '#9B1C35',
    borderRadius: T.cardRadius,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
  },
  modalCloseBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    lineHeight: 24,
    color: '#FFFFFF',
  },
});
