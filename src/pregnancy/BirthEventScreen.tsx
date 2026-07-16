/**
 * BirthEventScreen — "ลูกคลอดแล้ว / Baby is here"
 *
 * Implements pregnancy-profile-ui.md §4 (Birth event) + §4.2 (Review screen)
 * + §4.4 (Screen states).
 *
 * All strings sourced from useT() / catalog (src/i18n/messages.ts).
 * Dates formatted via formatCivilDate (locale-aware, no "วันที่" prefix).
 * Delivery-type chip labels are derived from catalog keys.
 *
 * Records the birth by calling POST /v1/pregnancy-profile/birth-event with:
 *   - birthDate  (required, YYYY-MM-DD civil date, ≤ today)
 *   - deliveryType (optional, 4 choices)
 *   - birthNote (optional free text)
 *   - X-Client-Date header (MUST — prevents false 422 in TH UTC+7)
 *   - If-Match: "<version>" header (required; absent → 428)
 *
 * NOTE ON DATE/TIME DISCREPANCY:
 *   pregnancy-profile-ui §4.2.1 specifies a "birth date & time" picker, but
 *   api-contract.md §"Birth-event & postpartum counting" (OQ-11 RESOLVED) pins
 *   `birthDate` as a floating-civil DATE (YYYY-MM-DD, no time component).
 *   This screen implements per the contract: date only, no time-of-day.
 *   Flag to the System Analyst / UX designer to reconcile the spec (data-model
 *   notes time-of-birth belongs to a future BabyProfile, out of scope for MVP).
 *
 * NOTE ON ENCRYPTION:
 *   deliveryType and birthNote are "client-encrypted" fields per data-model §3.1
 *   (ruling 4 — AES-GCM before transmission).  This MVP implementation sends
 *   them as plaintext strings pending the encryption utility from appsec-engineer.
 *   NEVER log these values.
 *
 * Screen states (§4.4):
 *   editing  — form ready for input
 *   saving   — POST in-flight (button spinner)
 *   error    — inline, non-blocking error note with Retry
 *
 * Accessibility: all touch targets ≥ 48dp (height set in StyleSheet),
 * accessible labels on every interactive element, non-color chip selection
 * cue (checkmark + border change).
 *
 * Security: NEVER log accessToken, deliveryType, or birthNote.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';
import { createPregnancyClient } from './pregnancyApiClient';
import { localCivilToday } from './gestationalAge';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { formatCivilDate, type MessageKey } from '../i18n/messages';
import {
  validateHospitalDates,
  shouldWarnAdmissionFarFromBirth,
  buildHospitalStayFields,
} from './hospitalStayLogic';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BirthEventScreenProps {
  /** Shared secure token storage — used to read accessToken. */
  tokenStorage: TokenStorage;
  /** API base URL from src/config.ts. */
  apiBaseUrl: string;
  /** The current profile version (for If-Match: "<version>" header). */
  profileVersion: number;
  /** Navigate back / reset to Home after a successful birth-event recording. */
  onBirthRecorded: () => void;
  /** Navigate back without saving. */
  onCancel: () => void;
}

// ─── Delivery type options ────────────────────────────────────────────────────

type DeliveryType = 'vaginal' | 'cesarean' | 'other' | 'prefer_not';

const DELIVERY_TYPES: readonly DeliveryType[] = ['vaginal', 'cesarean', 'other', 'prefer_not'];

/** Type-safe map from DeliveryType → catalog key for chip labels. */
const DELIVERY_LABEL_KEYS: Record<DeliveryType, MessageKey> = {
  vaginal: 'birth.delivery.vaginal',
  cesarean: 'birth.delivery.cesarean',
  other: 'birth.delivery.other',
  prefer_not: 'birth.delivery.prefer_not',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function BirthEventScreen({
  tokenStorage,
  apiBaseUrl,
  profileVersion,
  onBirthRecorded,
  onCancel,
}: BirthEventScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  // ── Form state ────────────────────────────────────────────────────────────
  const [birthDate, setBirthDate] = useState<string>('');
  const [deliveryType, setDeliveryType] = useState<DeliveryType | null>(null);
  const [birthNote, setBirthNote] = useState<string>('');

  // Hospital-stay fields (both optional — pregnancy-summary-design.md §1.3)
  // NEVER log these values (health-adjacent PII, PDPA ม.26).
  const [admissionDate, setAdmissionDate] = useState<string>('');
  const [dischargeDate, setDischargeDate] = useState<string>('');
  const [hospitalErrorMsg, setHospitalErrorMsg] = useState<string | null>(null);

  // ── Date picker modals ────────────────────────────────────────────────────
  // Birth date modal
  const [showDateModal, setShowDateModal] = useState(false);
  const [dateInputText, setDateInputText] = useState<string>('');
  // Hospital admission modal
  const [showAdmissionModal, setShowAdmissionModal] = useState(false);
  const [admissionInputText, setAdmissionInputText] = useState<string>('');
  // Hospital discharge modal
  const [showDischargeModal, setShowDischargeModal] = useState(false);
  const [dischargeInputText, setDischargeInputText] = useState<string>('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // mobile-reviewer fix (cluster 6 review, พ.ศ. round-trip trap): inline guard
  // message shown UNDER the date modal input when a typed year looks like a
  // Buddhist-Era (พ.ศ.) year instead of the raw Gregorian year the field
  // actually stores. Cleared whenever the modal input changes.
  const [dateModalGuardMsg, setDateModalGuardMsg] = useState<string | null>(null);

  // ── Validation ────────────────────────────────────────────────────────────
  const canSave = birthDate.length === 10 && !saving && hospitalErrorMsg == null;

  // ─── Handlers ────────────────────────────────────────────────────────────

  function handleDateConfirm(): void {
    const trimmed = dateInputText.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      Alert.alert(t('birth.dateFormatAlertTitle'), t('birth.dateFormatAlertMsg'));
      return;
    }

    // mobile-reviewer fix (cluster 6 review, พ.ศ. round-trip trap): the field
    // DISPLAYS via formatCivilDate (which shows พ.ศ. = Gregorian+543) but is
    // TYPED/STORED as raw Gregorian YYYY-MM-DD. A mother who sees "พ.ศ. 2569"
    // on screen and types "2569" back into this field would silently record a
    // birth date 543 years in the future. year > 2100 is not a plausible
    // Gregorian birth year in this app — reject inline (no Continue-anyway
    // path for BE-year values; this is a data-corruption trap, not a
    // borderline typo like a 1-2 day future slip).
    const year = Number(trimmed.slice(0, 4));
    if (year > 2100) {
      setDateModalGuardMsg(t('birth.dateFormatAlertMsg'));
      return;
    }
    setDateModalGuardMsg(null);

    // Soft guard: birth date should not be in the future (§5 — non-blocking typo hint).
    // The server enforces the actual bound; this is a UX convenience only.
    // (year > 2100 is handled above and never reaches this Continue-anyway path.)
    const today = localCivilToday();
    if (trimmed > today) {
      Alert.alert(
        t('birth.futureDateTitle'),
        t('birth.futureDateMessage'),
        [
          { text: t('birth.futureDateCancel'), style: 'cancel' },
          {
            text: t('birth.futureDateContinue'),
            onPress: () => {
              setBirthDate(trimmed);
              setShowDateModal(false);
              setErrorMsg(null);
            },
          },
        ],
      );
      return;
    }
    setBirthDate(trimmed);
    setShowDateModal(false);
    setErrorMsg(null);
  }

  function handleDeliveryTypeSelect(value: DeliveryType): void {
    // Toggle: tapping the same chip again deselects it (field is optional — §4.2.2).
    setDeliveryType((prev) => (prev === value ? null : value));
  }

  // ─── Hospital-stay handlers ────────────────────────────────────────────────

  function validateAndSetAdmission(trimmed: string): void {
    const today = localCivilToday();
    const validation = validateHospitalDates(
      trimmed || null,
      dischargeDate || null,
      today,
    );
    if (!validation.valid) {
      if (validation.error === 'date-in-future') {
        setHospitalErrorMsg(t('birth.errorHospitalDateFuture'));
        return;
      }
    }
    setAdmissionDate(trimmed);
    setHospitalErrorMsg(null);
    // OQ-PS4: warn (not block) if admission is far from birthDate
    if (birthDate && shouldWarnAdmissionFarFromBirth(trimmed, birthDate)) {
      Alert.alert(
        t('birth.warnAdmissionFarFromBirthTitle'),
        t('birth.warnAdmissionFarFromBirthMsg'),
        [
          { text: t('birth.warnFarCancel'), style: 'cancel', onPress: () => setAdmissionDate('') },
          { text: t('birth.warnFarContinue') },
        ],
      );
    }
  }

  function handleAdmissionConfirm(): void {
    const trimmed = admissionInputText.trim();
    if (!trimmed) {
      setAdmissionDate('');
      setHospitalErrorMsg(null);
      setShowAdmissionModal(false);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      Alert.alert(t('birth.dateFormatAlertTitle'), t('birth.dateFormatAlertMsg'));
      return;
    }
    validateAndSetAdmission(trimmed);
    setShowAdmissionModal(false);
  }

  function handleDischargeConfirm(): void {
    const trimmed = dischargeInputText.trim();
    if (!trimmed) {
      setDischargeDate('');
      setHospitalErrorMsg(null);
      setShowDischargeModal(false);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      Alert.alert(t('birth.dateFormatAlertTitle'), t('birth.dateFormatAlertMsg'));
      return;
    }
    const today = localCivilToday();
    const validation = validateHospitalDates(
      admissionDate || null,
      trimmed,
      today,
    );
    if (!validation.valid) {
      if (validation.error === 'date-in-future') {
        setHospitalErrorMsg(t('birth.errorHospitalDateFuture'));
      } else if (validation.error === 'discharge-before-admission') {
        setHospitalErrorMsg(t('birth.errorDischargeBeforeAdmission'));
      }
      setShowDischargeModal(false);
      return;
    }
    setDischargeDate(trimmed);
    setHospitalErrorMsg(null);
    setShowDischargeModal(false);
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setErrorMsg(null);

    try {
      const tokens = await tokenStorage.load();
      const accessToken = tokens?.accessToken;
      if (!accessToken) {
        setErrorMsg(t('birth.errorLogin'));
        setSaving(false);
        return;
      }

      const clientDate = localCivilToday();
      const client = createPregnancyClient(apiBaseUrl);

      // Hospital-stay cipher fields (§1.4 PIN: presence of key = real mutation).
      // buildHospitalStayFields applies Base64 no-op cipher and null-vs-absent semantics.
      // NEVER log these values (health-adjacent PII).
      const hospitalFields = buildHospitalStayFields(
        admissionDate || undefined,
        dischargeDate || undefined,
      );

      // Build the birth-event input.
      // TODO (security): deliveryType and birthNote MUST be AES-GCM encrypted
      // before transmission per data-model §3.1 (ruling 4).  Coordinate with
      // appsec-engineer before production.  NEVER log these values.
      const input = {
        birthDate,
        ...(deliveryType != null ? { deliveryType } : {}),
        ...(birthNote.trim() ? { birthNote: birthNote.trim() } : {}),
        ...hospitalFields,
      };

      const result = await client.recordBirthEvent(
        input,
        accessToken,
        String(profileVersion),
        clientDate,
      );

      if (result.ok) {
        // Birth event recorded — navigate back to Home.
        // HomeScreen reloads on foreground and switches to postpartum mode.
        onBirthRecorded();
      } else {
        // Map server error codes to calm copy via catalog (pregnancy-profile-ui §4.4).
        if (result.status === 403 && result.code === 'consent_required') {
          setErrorMsg(t('birth.errorConsentRequired'));
        } else if (result.status === 409) {
          // Another device already recorded the birth — intent may be satisfied.
          setErrorMsg(t('birth.errorConflict'));
        } else if (result.status === 422) {
          setErrorMsg(t('birth.errorDateInvalid'));
        } else if (result.status === 428) {
          setErrorMsg(t('birth.errorPreconditionFailed'));
        } else if (result.status === 404) {
          setErrorMsg(t('birth.errorNotFound'));
        } else {
          setErrorMsg(t('birth.errorGeneric'));
        }
      }
    } catch {
      // Network error — offline or unreachable server (§4.4.3 / §4.4.4)
      setErrorMsg(t('birth.errorOffline'));
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* mobile-reviewer 🟡 fix (cluster 6 review): onCancel was received as a
       * prop but never rendered anywhere — a dead affordance with no way back
       * without saving. Explicit in-screen cancel/back, top-left, ≥48dp. */}
      <View style={styles.cancelRow}>
        <TouchableOpacity
          testID="birth-cancel-btn"
          style={styles.cancelBtn}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('general.back')}
        >
          <Text style={styles.cancelBtnText}>{'‹ '}{t('general.back')}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header — celebratory, warm, brief (§4.2 / task: "ยินดีด้วย") */}
        <View style={styles.headerRow}>
          <Text style={styles.glyphBig} accessibilityElementsHidden={true}>
            {'🍃'}
          </Text>
          <Text style={styles.headline} accessibilityRole="header">
            {t('birth.headline')}
          </Text>
          <Text style={styles.subline}>
            {t('birth.subline')}
          </Text>
        </View>

        {/* ── Birth date (required) ──────────────────────────────────────── */}
        <Text style={styles.fieldLabel}>
          {t('birth.fieldBirthDate')}
          <Text style={styles.required}>{' *'}</Text>
        </Text>
        <TouchableOpacity
          testID="birth-date"
          style={styles.dateField}
          onPress={() => {
            setDateInputText(birthDate);
            setShowDateModal(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            birthDate
              ? `${t('birth.fieldBirthDate')}, ${formatCivilDate(birthDate, locale)}`
              : `${t('birth.fieldBirthDate')}, ${t('birth.datePlaceholder')}`
          }
        >
          <Text
            style={[
              styles.dateFieldText,
              !birthDate && styles.dateFieldPlaceholder,
            ]}
          >
            {birthDate ? formatCivilDate(birthDate, locale) : t('birth.datePlaceholder')}
          </Text>
          <Text style={styles.chevron} accessibilityElementsHidden={true}>
            {' ›'}
          </Text>
        </TouchableOpacity>

        {/* ── Delivery type — optional, 4 chips (§4.2.2) ─────────────────── */}
        <Text style={styles.fieldLabel}>
          {t('birth.fieldDeliveryType')}
        </Text>
        <View
          style={styles.chipsRow}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('birth.fieldDeliveryType')}
        >
          {DELIVERY_TYPES.map((value) => {
            const isSelected = deliveryType === value;
            const label = t(DELIVERY_LABEL_KEYS[value]);
            return (
              <TouchableOpacity
                key={value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => handleDeliveryTypeSelect(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={label}
              >
                {/* Checkmark — non-color shape-based selected-state cue (§4.2.2) */}
                {isSelected && (
                  <Text style={styles.chipCheck} accessibilityElementsHidden={true}>
                    {'✓ '}
                  </Text>
                )}
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Note — optional free text (§4.2) ──────────────────────────── */}
        <Text style={styles.fieldLabel}>
          {t('birth.fieldNote')}
        </Text>
        <TextInput
          style={styles.noteInput}
          value={birthNote}
          onChangeText={setBirthNote}
          placeholder={t('birth.notePlaceholder')}
          placeholderTextColor={T.input.placeholder}
          multiline
          numberOfLines={3}
          accessibilityLabel={t('birth.fieldNote')}
          textAlignVertical="top"
        />
        {/* mobile-reviewer 🟡 fix (cluster 6 review): this line is the PDPA
         * trust marker ("stored encrypted on device and cloud") — hiding it
         * from screen readers denied that reassurance to blind/low-vision
         * mothers specifically. Unhidden; the 🔒 glyph prefix stays decorative
         * (no separate accessibilityElementsHidden needed since it's inline
         * text, not a standalone icon). */}
        <Text style={styles.encryptionNote}>
          {t('birth.encryptionNote')}
        </Text>

        {/* ── Hospital stay — both optional (pregnancy-summary-design.md §1.3) ── */}
        <Text style={styles.sectionDividerLabel}>
          {t('birth.fieldHospitalStaySection')}
        </Text>

        {/* Admission date */}
        <Text style={styles.fieldLabel}>
          {t('birth.fieldHospitalAdmission')}
        </Text>
        <TouchableOpacity
          testID="birth-hospital-admission"
          style={styles.dateField}
          onPress={() => {
            setAdmissionInputText(admissionDate);
            setShowAdmissionModal(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            admissionDate
              ? `${t('birth.fieldHospitalAdmission')}, ${formatCivilDate(admissionDate, locale)}`
              : `${t('birth.fieldHospitalAdmission')}, ${t('birth.hospitalAdmissionPlaceholder')}`
          }
        >
          <Text style={[styles.dateFieldText, !admissionDate && styles.dateFieldPlaceholder]}>
            {admissionDate ? formatCivilDate(admissionDate, locale) : t('birth.hospitalAdmissionPlaceholder')}
          </Text>
          <Text style={styles.chevron} accessibilityElementsHidden={true}>{' ›'}</Text>
        </TouchableOpacity>

        {/* Discharge date */}
        <Text style={styles.fieldLabel}>
          {t('birth.fieldHospitalDischarge')}
        </Text>
        <TouchableOpacity
          testID="birth-hospital-discharge"
          style={styles.dateField}
          onPress={() => {
            setDischargeInputText(dischargeDate);
            setShowDischargeModal(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            dischargeDate
              ? `${t('birth.fieldHospitalDischarge')}, ${formatCivilDate(dischargeDate, locale)}`
              : `${t('birth.fieldHospitalDischarge')}, ${t('birth.hospitalDischargePlaceholder')}`
          }
        >
          <Text style={[styles.dateFieldText, !dischargeDate && styles.dateFieldPlaceholder]}>
            {dischargeDate ? formatCivilDate(dischargeDate, locale) : t('birth.hospitalDischargePlaceholder')}
          </Text>
          <Text style={styles.chevron} accessibilityElementsHidden={true}>{' ›'}</Text>
        </TouchableOpacity>

        {/* Hospital validation error (inline) */}
        {hospitalErrorMsg != null && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{hospitalErrorMsg}</Text>
          </View>
        )}

        {/* ── Consequence line (§4.2 — calm, not scary) ─────────────────── */}
        <View style={styles.consequenceBox}>
          <Text style={styles.consequenceText}>
            {t('birth.consequence')}
          </Text>
        </View>

        {/* ── Error panel (§4.4.2 / §4.4.3 — inline, non-blocking) ──────── */}
        {errorMsg != null && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.retryLink}
              onPress={() => {
                setErrorMsg(null);
                void handleSave();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('general.retry')}
            >
              <Text style={styles.retryLinkText}>{t('general.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty-state hint when date not yet selected */}
        {!birthDate && (
          <Text style={styles.emptyHint}>
            {t('birth.emptyHint')}
          </Text>
        )}

        {/* ── Save button (§4.2 — explicit confirm, If-Match guarded) ────── */}
        <TouchableOpacity
          testID="birth-save"
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={t('birth.save')}
          accessibilityHint={!birthDate ? t('birth.emptyHint') : undefined}
          accessibilityState={{ disabled: !canSave }}
        >
          {saving ? (
            <ActivityIndicator color={T.color.text.onDark} size="small" />
          ) : (
            <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>
              {t('birth.save')}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Date input modal ──────────────────────────────────────────────── */}
      <Modal
        visible={showDateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t('birth.dateModalTitle')}
            </Text>
            <Text style={styles.modalHint}>
              {t('birth.dateModalHint')}
            </Text>
            <TextInput
              testID="birth-date-modal-input"
              style={styles.modalInput}
              value={dateInputText}
              onChangeText={(v) => {
                setDateInputText(v);
                setDateModalGuardMsg(null);
              }}
              // Fixed (task #40 tail): now sourced from the catalog
              // ('birth.dateModalPlaceholder') instead of a hardcoded
              // literal. Same neutral 'YYYY-MM-DD' format token in both
              // locales — it's a format token, not translatable prose, so
              // no stale year example and no locale-digit gap.
              placeholder={t('birth.dateModalPlaceholder')}
              placeholderTextColor={T.input.placeholder}
              keyboardType="numeric"
              autoFocus
              accessibilityLabel={t('birth.fieldBirthDate')}
              maxLength={10}
            />
            {/* mobile-reviewer fix (พ.ศ. round-trip trap): inline guard shown
             * when the typed year looks like a Buddhist-Era year (>2100) —
             * no silent +543-year data corruption, no Continue-anyway path. */}
            {dateModalGuardMsg != null && (
              <Text
                testID="birth-date-modal-guard-msg"
                style={styles.modalGuardText}
                accessibilityLiveRegion="polite"
              >
                {dateModalGuardMsg}
              </Text>
            )}
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setDateModalGuardMsg(null);
                  setShowDateModal(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('birth.dateModalCancel')}
              >
                <Text style={styles.modalCancelText}>{t('birth.dateModalCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleDateConfirm}
                accessibilityRole="button"
                accessibilityLabel={t('birth.dateModalConfirm')}
              >
                <Text style={styles.modalConfirmText}>{t('birth.dateModalConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Hospital admission date modal ─────────────────────────────────── */}
      <Modal
        visible={showAdmissionModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAdmissionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t('birth.hospitalAdmissionModalTitle')}
            </Text>
            <Text style={styles.modalHint}>
              {t('birth.hospitalAdmissionModalHint')}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={admissionInputText}
              onChangeText={setAdmissionInputText}
              placeholder={'2026-06-29'}
              placeholderTextColor={T.input.placeholder}
              keyboardType="numeric"
              autoFocus
              accessibilityLabel={t('birth.fieldHospitalAdmission')}
              maxLength={10}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAdmissionModal(false)}
                accessibilityRole="button"
                accessibilityLabel={t('birth.dateModalCancel')}
              >
                <Text style={styles.modalCancelText}>{t('birth.dateModalCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleAdmissionConfirm}
                accessibilityRole="button"
                accessibilityLabel={t('birth.dateModalConfirm')}
              >
                <Text style={styles.modalConfirmText}>{t('birth.dateModalConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Hospital discharge date modal ─────────────────────────────────── */}
      <Modal
        visible={showDischargeModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDischargeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t('birth.hospitalDischargeModalTitle')}
            </Text>
            <Text style={styles.modalHint}>
              {t('birth.hospitalDischargeModalHint')}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={dischargeInputText}
              onChangeText={setDischargeInputText}
              placeholder={'2026-06-29'}
              placeholderTextColor={T.input.placeholder}
              keyboardType="numeric"
              autoFocus
              accessibilityLabel={t('birth.fieldHospitalDischarge')}
              maxLength={10}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDischargeModal(false)}
                accessibilityRole="button"
                accessibilityLabel={t('birth.dateModalCancel')}
              >
                <Text style={styles.modalCancelText}>{t('birth.dateModalCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleDischargeConfirm}
                accessibilityRole="button"
                accessibilityLabel={t('birth.dateModalConfirm')}
              >
                <Text style={styles.modalConfirmText}>{t('birth.dateModalConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// ห้องแม่ Phase 2 B4: all token references migrated to semantic T.* namespace.

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    gap: 16,
  },

  // Cancel / back row (mobile-reviewer 🟡 fix — onCancel now rendered)
  cancelRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  cancelBtn: {
    minHeight: 48,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
  },
  cancelBtnText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },

  // Header
  headerRow: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  glyphBig: {
    fontSize: 48,
    lineHeight: 56,
  },
  headline: {
    fontFamily: T.type.heading1.fontFamily,
    fontSize: T.type.heading1.size,
    lineHeight: T.type.heading1.lineHeight,
    color: T.color.text.heading,
    textAlign: 'center',
  },
  subline: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
  },

  // Field labels
  fieldLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color: T.color.text.primary,
    marginTop: 4,
  },
  sectionDividerLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    marginTop: 8,
    marginBottom: 2,
  },
  // mobile-reviewer fix (cluster 6 review): was T.color.accent.identity
  // (roselle-500, 4.06:1 — borderline at this 15sp label size). Retoned to
  // T.color.text.primary (roselle-700, 7.70:1 AAA) per fix note.
  required: {
    color: T.color.text.primary,
  },

  // Date field — ≥56dp height per a11y
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.input.bg,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  dateFieldText: {
    flex: 1,
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.input.text,
    paddingVertical: 14,
  },
  dateFieldPlaceholder: {
    color: T.input.placeholder,
    fontFamily: T.type.body.fontFamily,
  },
  chevron: {
    fontFamily: T.type.body.fontFamily,
    fontSize: 18,
    color: T.color.text.primary,
  },

  // Chips — ≥48dp height; amber-100 selected wash + roselle-500 border (shape cue)
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.pill,
    borderWidth: 1.5,
    borderColor: T.color.surface.divider,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  chipSelected: {
    backgroundColor: T.color.surface.wash.roselle,
    borderColor: T.color.accent.identity,
    borderWidth: 2,
  },
  chipCheck: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.heading,
  },
  chipLabel: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.heading,
  },
  chipLabelSelected: {
    fontFamily: T.type.label.fontFamily,
    color: T.color.text.heading,
  },

  // Note input
  noteInput: {
    backgroundColor: T.input.bg,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.input.text,
    minHeight: 80,
  },
  encryptionNote: {
    fontFamily: T.type.micro.fontFamily,
    fontSize: T.type.micro.size,
    lineHeight: T.type.micro.lineHeight,
    color: T.color.text.primary,
    marginTop: -8,
  },

  // Consequence box
  consequenceBox: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    padding: 16,
  },
  consequenceText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
  },

  // Error panel (inline, non-blocking)
  errorBox: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    flex: 1,
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  retryLink: {
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLinkText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    textDecorationLine: 'underline',
  },

  // Empty hint
  emptyHint: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    textAlign: 'center',
  },

  // Save button — ≥52dp height, amber-700 CTA
  saveBtn: {
    height: T.button.primary.height,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: {
    backgroundColor: T.scrim.amber,
  },
  saveBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
  },
  saveBtnTextDisabled: {
    color: T.color.text.onDark,
    opacity: 0.7,
  },

  // Date modal
  modalOverlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: T.color.surface.subtle,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
    textAlign: 'center',
  },
  modalHint: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: T.color.surface.base,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: T.type.body.fontFamily,
    fontSize: 18,
    color: T.input.text,
    textAlign: 'center',
    letterSpacing: 2,
  },
  // พ.ศ. round-trip guard message (mobile-reviewer fix, cluster 6 review)
  modalGuardText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.input.errorText,
    textAlign: 'center',
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },
  modalConfirmBtn: {
    flex: 1,
    height: 48,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
  },
});
