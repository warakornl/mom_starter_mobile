/**
 * ProfileSetupScreen — "มาเริ่มจากกำหนดคลอดของคุณ"
 *
 * Implements pregnancy-profile-ui.md §2 (Setup) + §6 (States) + §8 (A11y).
 * All strings sourced from useT() / catalog (src/i18n/messages.ts).
 * Dates formatted via formatCivilDate (locale-aware, no "วันที่" prefix).
 *
 * Two input methods (segmented control):
 *   1. วันกำหนดคลอด / Due date (eddBasis = due_date)   ← default
 *   2. อายุครรภ์ตอนนี้ / Current week (eddBasis = current_week, stepper 1–42)
 *
 * LMP helper link is present as a quiet affordance (§2.4) — a minimal modal
 * that derives an estimated EDD (LMP + 280d) and fills the date field.
 *
 * States: empty · editing · saving · error (§6)
 * Offline: not blocking (profile queues and syncs later).
 *
 * Navigation: `onSetupComplete` → Home.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1
 *   surface/page  #FFFFFF
 *   ink           #3A2A30
 *   ink/soft      #5F4A52
 *   ink/faint     #94818A
 *   rose/300      #DDA0A6   (disabled button fill)
 *   rose/600      #A8505A   (primary button fill)
 *   rose/700      #8E3A44   (pressed / quiet link)
 *   hairline      #EBE1D9
 *
 * Security: NEVER log the accessToken.  The EDD civil date is minimized
 * (logged nowhere; not a sensitive field by itself but we keep it out of logs
 * as a general hygiene rule).
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
  Platform,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';
import { runSave } from './profileEditRuntimeWiring';
import { localCivilToday, computeGestationalAge } from './gestationalAge';
import type { Stage } from './gestationalAge';
import type { PregnancyProfile } from './types';
import { useT } from '../i18n/LanguageContext';
import { formatCivilDate, type MessageKey } from '../i18n/messages';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ProfileSetupScreenProps {
  /** Shared secure token storage — used to read accessToken. */
  tokenStorage: TokenStorage;
  /** API base URL from src/config.ts. */
  apiBaseUrl: string;
  /** Navigate to Home after successful profile save. */
  onSetupComplete: (profile: PregnancyProfile) => void;
  /** Optional existing profile (for Edit mode — pre-fills fields). */
  existingProfile?: PregnancyProfile;
  /**
   * AC-13 (BLOCKING, SD-5): Called on BOTH no-token AND server-returned 401 from PUT.
   * The caller (ProfileEditScreen, wired by RootNavigator) must run the full
   * performLogout teardown (clearTokens + ALL health stores) THEN navigate to Welcome.
   * Never leaving the user on the edit screen with health stores populated prevents
   * cross-account PHI leak (SD-5).
   * Optional — when absent (create flow) the legacy errorLogin message is shown instead
   * so existing create-flow behaviour is unchanged.
   */
  onSessionExpired?: () => void;
  /**
   * AC-10 (R-3): Called when PUT returns 409 with the current authoritative profile.
   * The edit host reloads the form to the latest server state and shows the conflict
   * message. When absent (create flow), falls back to showing profile.errorConflict.
   */
  onConflict?: (currentProfile: PregnancyProfile) => void;
  /**
   * AC-15: Called whenever the user makes a field change (method toggle, week
   * stepper, date confirm, LMP confirm).  NOT fired on the initial pre-fill
   * from existingProfile — only on genuine user-driven interactions.
   * ProfileEditScreen passes handleDirty here to set isDirtyRef.current = true,
   * enabling the beforeRemove navigation guard.
   * Optional — when absent (create flow) the callback is a no-op.
   */
  onDirty?: () => void;
}

// ─── Input method ─────────────────────────────────────────────────────────────

type InputMethod = 'due_date' | 'current_week';

// ─── Stage helpers ────────────────────────────────────────────────────────────

const STAGE_GLYPHS: Record<Stage, string> = {
  T1: '🌱', // icon/stage-t1 (seedling)
  T2: '🌿', // icon/stage-t2 (leaf/branch)
  T3: '🌳', // icon/stage-t3 (tree)
};

/** Type-safe map from Stage → catalog key, avoiding template-string casts. */
const STAGE_KEY_MAP: Record<Stage, MessageKey> = {
  T1: 'stage.T1',
  T2: 'stage.T2',
  T3: 'stage.T3',
};

/** Derive the live stage for the current-week stepper echo. */
function stageFromWeek(week: number): Stage {
  if (week <= 13) return 'T1';
  if (week <= 27) return 'T2';
  return 'T3';
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Add `n` calendar days to a YYYY-MM-DD string. */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const result = new Date(base + n * 86_400_000);
  const ry = result.getUTCFullYear();
  const rm = String(result.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(result.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

/** Derive EDD from LMP (LMP + 280 days). */
function eddFromLmp(lmp: string): string {
  return addDays(lmp, 280);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfileSetupScreen({
  tokenStorage,
  apiBaseUrl,
  onSetupComplete,
  existingProfile,
  onSessionExpired,
  onConflict,
  onDirty,
}: ProfileSetupScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  // ── Input method ────────────────────────────────────────────────────────────
  const [inputMethod, setInputMethod] = useState<InputMethod>(
    existingProfile?.eddBasis === 'current_week' ? 'current_week' : 'due_date',
  );

  // ── Due-date path ────────────────────────────────────────────────────────────
  // The raw edd string (YYYY-MM-DD); empty string = not set
  const [edd, setEdd] = useState<string>(existingProfile?.edd ?? '');
  // Simple date input modal (carry-forward: replace with full BE calendar picker)
  const [showDateModal, setShowDateModal] = useState(false);
  const [dateInputText, setDateInputText] = useState<string>(existingProfile?.edd ?? '');

  // ── Current-week path ────────────────────────────────────────────────────────
  // gestationalWeek is number | null (null when postpartum) — check explicitly.
  const initWeek = (existingProfile?.gestationalWeek != null)
    ? Math.max(1, Math.min(42, existingProfile.gestationalWeek))
    : 20;
  const [currentWeek, setCurrentWeek] = useState<number>(initWeek);

  // ── LMP helper modal ─────────────────────────────────────────────────────────
  const [showLmpModal, setShowLmpModal] = useState(false);
  const [lmpInputText, setLmpInputText] = useState('');

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Derived live echo for current-week method ─────────────────────────────────
  const liveStage = stageFromWeek(currentWeek);

  // ── Validation ────────────────────────────────────────────────────────────────
  const isValid =
    inputMethod === 'due_date' ? edd.length === 10 : currentWeek >= 1 && currentWeek <= 42;

  // ─── Handlers ────────────────────────────────────────────────────────────────

  function handleMethodChange(method: InputMethod): void {
    setInputMethod(method);
    setErrorMsg(null);
    // AC-15: user toggled the input method — mark form dirty.
    // NOT fired on initial pre-fill (useState initialiser, not a handler call).
    onDirty?.();
  }

  function handleStepperDecrement(): void {
    setCurrentWeek((w) => Math.max(1, w - 1));
    // AC-15: user pressed stepper — mark form dirty.
    onDirty?.();
  }

  function handleStepperIncrement(): void {
    setCurrentWeek((w) => Math.min(42, w + 1));
    // AC-15: user pressed stepper — mark form dirty.
    onDirty?.();
  }

  function handleDateConfirm(): void {
    const trimmed = dateInputText.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      setEdd(trimmed);
      setShowDateModal(false);
      setErrorMsg(null);
      // AC-15: user confirmed a date — mark form dirty.
      onDirty?.();
    } else {
      Alert.alert(t('profile.dateFormatAlertTitle'), t('profile.dateFormatAlertMsg'));
    }
  }

  function handleLmpConfirm(): void {
    const trimmed = lmpInputText.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const derivedEdd = eddFromLmp(trimmed);
      setEdd(derivedEdd);
      setDateInputText(derivedEdd);
      setInputMethod('due_date');
      setShowLmpModal(false);
      setErrorMsg(null);
      // AC-15: user derived EDD from LMP — mark form dirty.
      onDirty?.();
    } else {
      Alert.alert(t('profile.dateFormatAlertTitle'), t('profile.dateFormatAlertMsg'));
    }
  }

  async function handleSave(): Promise<void> {
    if (!isValid || saving) return;
    setErrorMsg(null);

    const body =
      inputMethod === 'due_date'
        ? { edd }
        : { currentWeek };

    const ifMatch =
      existingProfile?.version !== undefined
        ? String(existingProfile.version)
        : undefined;

    await runSave({
      tokenStorage,
      apiBaseUrl,
      body,
      ifMatch,
      // AC-13 (BLOCKING, SD-5): session-expiry actions.
      // Edit flow (onSessionExpired provided):
      //   onNoTokenAction + onServerAuthAction both call onSessionExpired()
      //   → full performLogout teardown + navigate to Welcome.
      // Create flow (no onSessionExpired):
      //   legacy behaviour — show re-login / generic error string.
      onNoTokenAction: onSessionExpired
        ? onSessionExpired
        : () => setErrorMsg(t('profile.errorLogin')),
      onServerAuthAction: onSessionExpired
        ? onSessionExpired
        : () => setErrorMsg(t('profile.errorGeneric')),
      onSuccess: (profile) => onSetupComplete(profile),
      onConflict: (conflictProfile) => {
        if (onConflict && conflictProfile) {
          // AC-10 (R-3): edit flow — reload form to latest server state.
          onConflict(conflictProfile);
        } else {
          // Create flow or body-less 409: show the conflict message.
          setErrorMsg(t('profile.errorConflict'));
        }
      },
      onValidationError: () => setErrorMsg(t('profile.errorDateInvalid')),
      onConsentRequired: () => setErrorMsg(t('profile.errorConsentRequired')),
      onPreconditionFailed: () => setErrorMsg(t('profile.errorPreconditionFailed')),
      onGenericError: () => setErrorMsg(t('profile.errorGeneric')),
      onOfflineError: () => setErrorMsg(t('profile.errorOffline')),
      setSaving,
    });
  }

  // ─── Live confirmation preview (client-side derived, no network) ──────────
  function renderConfirmationPreview(): React.JSX.Element | null {
    if (!isValid) return null;

    const today = localCivilToday();
    let previewEdd: string;

    if (inputMethod === 'due_date') {
      previewEdd = edd;
    } else {
      previewEdd = addDays(today, 280 - currentWeek * 7);
    }

    if (!previewEdd) return null;

    let ga;
    try {
      ga = computeGestationalAge(previewEdd, today);
    } catch {
      return null;
    }

    const stageName = t(STAGE_KEY_MAP[ga.currentStage]);
    const stageGlyph = STAGE_GLYPHS[ga.currentStage];
    const weekDisplay = t('profile.weekDisplay', { n: ga.displayedWeek });
    const weekStr = ga.suppressDayDisplay
      ? weekDisplay
      : ga.gestationalDay > 0
        ? t('home.weekDisplayDays', { n: ga.displayedWeek, d: ga.gestationalDay })
        : weekDisplay;
    const formattedEdd = formatCivilDate(previewEdd, locale);

    return (
      <View style={styles.previewCard} accessibilityRole="text">
        <Text
          style={styles.previewGlyph}
          accessibilityElementsHidden={true}
        >
          {stageGlyph}
        </Text>
        <Text
          style={styles.previewStage}
          accessibilityLabel={`${stageName} ${weekStr}`}
        >
          {stageName} · {weekStr}
        </Text>
        {ga.deliveryWindowActive && (
          <View
            style={styles.deliveryChip}
            accessibilityRole="text"
            accessibilityLabel={t('profile.deliveryWindow')}
          >
            <Text style={styles.deliveryChipText}>{t('profile.deliveryWindow')}</Text>
          </View>
        )}
        {previewEdd && (
          <Text style={styles.previewEdd}>
            {t('profile.eddPreviewPrefix', { date: formattedEdd })}
          </Text>
        )}
      </View>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Headline */}
        <Text style={styles.headline}>{t('profile.headline')}</Text>
        <Text style={styles.subline}>{t('profile.subline')}</Text>

        {/* Segmented control — method selection (§2.1) */}
        <Text style={styles.sectionLabel}>{t('profile.methodPrompt')}</Text>
        <View
          style={styles.segmentRow}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('profile.methodGroupA11y')}
        >
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              inputMethod === 'due_date' && styles.segmentBtnSelected,
            ]}
            onPress={() => handleMethodChange('due_date')}
            accessibilityRole="radio"
            accessibilityState={{ selected: inputMethod === 'due_date' }}
            accessibilityLabel={t('profile.methodDueDate')}
          >
            {inputMethod === 'due_date' && (
              <Text style={styles.segmentCheckMark} accessibilityElementsHidden={true}>
                {'✓ '}
              </Text>
            )}
            <Text
              style={[
                styles.segmentLabel,
                inputMethod === 'due_date' && styles.segmentLabelSelected,
              ]}
            >
              {t('profile.methodDueDate')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="profile-mode-week"
            style={[
              styles.segmentBtn,
              inputMethod === 'current_week' && styles.segmentBtnSelected,
            ]}
            onPress={() => handleMethodChange('current_week')}
            accessibilityRole="radio"
            accessibilityState={{ selected: inputMethod === 'current_week' }}
            accessibilityLabel={t('profile.methodCurrentWeek')}
          >
            {inputMethod === 'current_week' && (
              <Text style={styles.segmentCheckMark} accessibilityElementsHidden={true}>
                {'✓ '}
              </Text>
            )}
            <Text
              style={[
                styles.segmentLabel,
                inputMethod === 'current_week' && styles.segmentLabelSelected,
              ]}
            >
              {t('profile.methodCurrentWeek')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Due-date input (§2.2) ─────────────────────────────────────────── */}
        {inputMethod === 'due_date' && (
          <View>
            <Text style={styles.fieldLabel}>{t('profile.fieldDueDate')}</Text>
            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setShowDateModal(true)}
              accessibilityRole="button"
              accessibilityLabel={
                edd
                  ? `${t('profile.fieldDueDate')}, ${formatCivilDate(edd, locale)}`
                  : `${t('profile.fieldDueDate')}, ${t('profile.datePlaceholder')}`
              }
            >
              <Text
                style={[
                  styles.dateFieldText,
                  !edd && styles.dateFieldPlaceholder,
                ]}
              >
                {edd ? formatCivilDate(edd, locale) : t('profile.datePlaceholder')}
              </Text>
              <Text style={styles.dateFieldChevron} accessibilityElementsHidden={true}>
                {' ›'}
              </Text>
            </TouchableOpacity>

            {/* LMP quiet helper (§2.4) */}
            <TouchableOpacity
              style={styles.quietLink}
              onPress={() => setShowLmpModal(true)}
              accessibilityRole="button"
              accessibilityLabel={t('profile.lmpLink')}
            >
              <Text style={styles.quietLinkText}>{t('profile.lmpLink')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Current-week stepper (§2.3) ───────────────────────────────────── */}
        {inputMethod === 'current_week' && (
          <View>
            <Text style={styles.fieldLabel}>{t('profile.fieldCurrentWeek')}</Text>
            <View
              testID="profile-week-stepper"
              style={styles.stepperRow}
              accessibilityLabel={`${t('profile.fieldCurrentWeek')}, ${t('profile.weekDisplay', { n: currentWeek })}`}
              accessibilityRole="adjustable"
              accessibilityValue={{ min: 1, max: 42, now: currentWeek }}
            >
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={handleStepperDecrement}
                disabled={currentWeek <= 1}
                accessibilityRole="button"
                accessibilityLabel={t('profile.stepperDecrease')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    styles.stepperBtnText,
                    currentWeek <= 1 && styles.stepperBtnDisabled,
                  ]}
                >
                  {'‹'}
                </Text>
              </TouchableOpacity>

              <Text
                style={styles.stepperValue}
                accessibilityElementsHidden={true}
              >
                {t('profile.weekDisplay', { n: currentWeek })}
              </Text>

              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={handleStepperIncrement}
                disabled={currentWeek >= 42}
                accessibilityRole="button"
                accessibilityLabel={t('profile.stepperIncrease')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    styles.stepperBtnText,
                    currentWeek >= 42 && styles.stepperBtnDisabled,
                  ]}
                >
                  {'›'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Live stage echo (updates as she steps — §2.3) */}
            <View
              style={styles.stageEcho}
              accessibilityLiveRegion="polite"
              accessibilityLabel={t(STAGE_KEY_MAP[liveStage])}
            >
              <Text style={styles.stageEchoGlyph} accessibilityElementsHidden={true}>
                {STAGE_GLYPHS[liveStage]}
              </Text>
              <Text style={styles.stageEchoText}>
                {t('profile.stageEchoPrefix', { stage: t(STAGE_KEY_MAP[liveStage]) })}
              </Text>
            </View>
          </View>
        )}

        {/* Confirmation preview (client-derived, instant, no network) */}
        {renderConfirmationPreview()}

        {/* Error message */}
        {errorMsg !== null && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMsg}
          </Text>
        )}

        {/* Continue / Save button (§6.1 disabled state) */}
        <TouchableOpacity
          testID="profile-save"
          style={[styles.primaryBtn, !isValid && styles.primaryBtnDisabled]}
          onPress={handleSave}
          disabled={!isValid || saving}
          accessibilityRole="button"
          accessibilityLabel={existingProfile ? t('profile.save') : t('profile.next')}
          accessibilityState={{ disabled: !isValid || saving }}
          accessibilityHint={!isValid ? t('profile.emptyHint') : undefined}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {existingProfile ? t('profile.save') : t('profile.next')}
            </Text>
          )}
        </TouchableOpacity>

        {/* Visible empty-state hint (§6.1 — not SR-only) */}
        {!isValid && (
          <Text style={styles.emptyHint} accessibilityRole="text">
            {t('profile.emptyHint')}
          </Text>
        )}

        <Text style={styles.footnote}>{t('profile.footnote')}</Text>
      </ScrollView>

      {/* ── Date input modal (carry-forward: replace with full BE calendar §2.2) */}
      <Modal
        visible={showDateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('profile.dateModalTitle')}</Text>
            <Text style={styles.modalHint}>{t('profile.dateModalHint')}</Text>
            <TextInput
              style={styles.modalInput}
              value={dateInputText}
              onChangeText={setDateInputText}
              placeholder="2026-11-20"
              placeholderTextColor="#94818A"
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              maxLength={10}
              autoFocus
              accessibilityLabel={t('profile.fieldDueDate')}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => setShowDateModal(false)}
                accessibilityRole="button"
                accessibilityLabel={t('profile.dateModalCancel')}
              >
                <Text style={styles.modalBtnSecondaryText}>{t('profile.dateModalCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={handleDateConfirm}
                accessibilityRole="button"
                accessibilityLabel={t('profile.dateModalConfirm')}
              >
                <Text style={styles.modalBtnPrimaryText}>{t('profile.dateModalConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── LMP helper modal (§2.4) ──────────────────────────────────────────── */}
      <Modal
        visible={showLmpModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowLmpModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('profile.lmpModalTitle')}</Text>
            <Text style={styles.modalHint}>{t('profile.lmpModalHint')}</Text>
            <TextInput
              style={styles.modalInput}
              value={lmpInputText}
              onChangeText={setLmpInputText}
              placeholder="2026-02-13"
              placeholderTextColor="#94818A"
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              maxLength={10}
              autoFocus
              accessibilityLabel={t('profile.lmpModalTitle')}
            />
            {lmpInputText.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(lmpInputText) && (
              <Text style={styles.lmpEstimate} accessibilityRole="text">
                {t('profile.lmpEstimatePrefix', {
                  date: formatCivilDate(eddFromLmp(lmpInputText), locale),
                })}
                {'\n'}
                {t('profile.lmpEstimateSuffix')}
              </Text>
            )}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => setShowLmpModal(false)}
                accessibilityRole="button"
                accessibilityLabel={t('profile.dateModalCancel')}
              >
                <Text style={styles.modalBtnSecondaryText}>{t('profile.dateModalCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={handleLmpConfirm}
                accessibilityRole="button"
                accessibilityLabel={t('profile.lmpModalConfirm')}
              >
                <Text style={styles.modalBtnPrimaryText}>{t('profile.lmpModalConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    gap: 16,
  },

  // Headline
  headline: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 28,
    lineHeight: 38,
    color: '#3A2A30',
    marginBottom: 4,
  },
  subline: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    marginBottom: 8,
  },

  // Segmented control
  sectionLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F4A52',
    marginBottom: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#EBE1D9',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  segmentBtnSelected: {
    backgroundColor: '#A8505A',
    borderColor: '#A8505A',
  },
  segmentCheckMark: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#FFFFFF',
  },
  segmentLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A2A30',
    textAlign: 'center',
  },
  segmentLabelSelected: {
    color: '#FFFFFF',
  },

  // Field label
  fieldLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A2A30',
    marginBottom: 8,
  },

  // Date field (§2.2)
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    paddingHorizontal: 16,
  },
  dateFieldText: {
    flex: 1,
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 16,
    lineHeight: 24,
    color: '#3A2A30',
  },
  dateFieldPlaceholder: {
    color: '#94818A',
  },
  dateFieldChevron: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 20,
    color: '#5F4A52',
  },

  // LMP quiet link (§2.4)
  quietLink: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 8,
  },
  quietLinkText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#8E3A44',
  },

  // Week stepper (§2.3)
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    minHeight: 56,
    paddingHorizontal: 8,
  },
  stepperBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 24,
    color: '#A8505A',
  },
  stepperBtnDisabled: {
    color: '#DDA0A6',
  },
  stepperValue: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 18,
    lineHeight: 26,
    color: '#3A2A30',
    textAlign: 'center',
  },

  // Stage echo (live, updates on step)
  stageEcho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  stageEchoGlyph: {
    fontSize: 20,
  },
  stageEchoText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F4A52',
  },

  // Confirmation preview (§2.5 mini — full confirmation is on navigate)
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
  },
  previewGlyph: {
    fontSize: 36,
    lineHeight: 48,
  },
  previewStage: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
    textAlign: 'center',
  },
  previewEdd: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 14,
    lineHeight: 21,
    color: '#5F4A52',
    textAlign: 'center',
  },
  deliveryChip: {
    backgroundColor: '#F4D9DC',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  deliveryChipText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 13,
    color: '#8E3A44',
  },

  // Error
  errorText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#8E3A44',
    textAlign: 'center',
  },

  // Primary button
  primaryBtn: {
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnDisabled: {
    backgroundColor: '#DDA0A6',
  },
  primaryBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },

  // Empty-state visible hint (§6.1)
  emptyHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    textAlign: 'center',
  },

  // Footnote
  footnote: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#94818A',
    textAlign: 'center',
    marginTop: 4,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(58,42,48,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
  },
  modalHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#5F4A52',
  },
  modalInput: {
    height: 52,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 16,
    color: '#3A2A30',
    backgroundColor: '#FBF6F1',
  },
  lmpEstimate: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#5F4A52',
    backgroundColor: '#FBF6F1',
    borderRadius: 8,
    padding: 12,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  modalBtnSecondary: {
    flex: 1,
    height: 52,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondaryText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#5F4A52',
  },
  modalBtnPrimary: {
    flex: 1,
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimaryText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
