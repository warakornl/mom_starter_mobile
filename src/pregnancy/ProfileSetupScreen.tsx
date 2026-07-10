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
 * ห้องแม่ Phase 2 B1 reskin (mother-room-phase2-rollout.md §4.1 ProfileSetupScreen).
 * All tokens from T.* — NO inline hex outside tokens.ts.
 *
 * Loss-state gate: when pregnancyStatus === 'LOSS' the forward-looking
 * confirmation preview card (week count / stage name) is suppressed. The
 * form itself remains so the user can still update dates.
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
import { T } from '../theme/tokens';

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
  /**
   * Loss-state gate (Phase 2 B1):
   * When `pregnancyStatus === 'LOSS'`, the forward-looking confirmation preview
   * card (trimester stage + gestational week countdown) is suppressed.
   * The EDD form itself remains so the user can still update dates.
   * Caller reads this from PregnancyProfileContext.pregnancyStatus.
   * Undefined / absent → treated as non-loss (no suppression).
   */
  pregnancyStatus?: string;
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
  pregnancyStatus,
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
    // Loss-state gate: suppress forward-looking pregnancy preview in loss state.
    // The form itself (EDD entry) remains available.
    if (pregnancyStatus === 'LOSS') return null;

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
      <View testID="profile-preview-card" style={styles.previewCard} accessibilityRole="text">
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
            <ActivityIndicator color={T.button.primary.text} size="small" />
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
              placeholderTextColor={T.input.placeholder}
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
              placeholderTextColor={T.input.placeholder}
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

// ─── Styles — ALL values from T.* tokens; NO inline hex ──────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,              // #FBF6F1
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: T.spacing[6],                              // 24dp
    gap: T.spacing[4],                                  // 16dp
  },

  // Headline
  headline: {
    fontFamily: T.type.heading1.fontFamily,             // Sarabun-SemiBold
    fontSize: T.type.heading1.size,                     // 24sp
    lineHeight: T.type.heading1.lineHeight,             // 39
    color: T.color.text.heading,                        // #4A2230
    marginBottom: T.spacing[1],                         // 4dp
    letterSpacing: 0,
  },
  subline: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    marginBottom: T.spacing[2],                         // 8dp
    letterSpacing: 0,
  },

  // Segmented control
  sectionLabel: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    marginBottom: T.spacing[2],                         // 8dp
    letterSpacing: 0,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: T.spacing[2],                                  // 8dp
    marginBottom: T.spacing[4],                         // 16dp
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: T.radius.pill,                        // 999
    borderWidth: 1.5,
    borderColor: T.color.surface.divider,               // #E8DDD5 (NOT #EBE1D9)
    backgroundColor: T.color.surface.base,              // #FBF6F1 ivory-100 (NOT white)
    paddingHorizontal: T.spacing[3],                    // 12dp
  },
  segmentBtnSelected: {
    backgroundColor: T.color.surface.wash.roselle,      // roselle-200 (NOT #A8505A)
    borderColor: T.color.surface.wash.roselle,          // roselle-200
  },
  segmentCheckMark: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    color: T.color.text.heading,                        // #4A2230 roselle-900 (NOT white — no contrast issue)
    letterSpacing: 0,
  },
  segmentLabel: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #3A2A30)
    textAlign: 'center',
    letterSpacing: 0,
  },
  segmentLabelSelected: {
    color: T.color.text.heading,                        // #4A2230 roselle-900 (9.50:1 on roselle-200 AAA ✓)
  },

  // Field label
  fieldLabel: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.color.text.heading,                        // #4A2230
    marginBottom: T.spacing[2],                         // 8dp
    letterSpacing: 0,
  },

  // Date field (§2.2)
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: T.input.height,                          // 52dp
    backgroundColor: T.input.bg,                        // #F5EDE6 ivory-200 (NOT white)
    borderRadius: T.radius.md,                          // 12dp
    borderWidth: 1,
    borderColor: T.input.border.default,                // #E8DDD5 (NOT #EBE1D9)
    paddingHorizontal: T.spacing[4],                    // 16dp
  },
  dateFieldText: {
    flex: 1,
    fontFamily: T.type.bodyLarge.fontFamily,            // Sarabun-Regular (NOT IBMPlexMono)
    fontSize: T.type.bodyLarge.size,                    // 17sp
    lineHeight: T.type.bodyLarge.lineHeight,            // 28
    color: T.input.text,                                // #4A2230 roselle-900
    letterSpacing: 0,
  },
  dateFieldPlaceholder: {
    color: T.input.placeholder,                         // #7A3A52 (NOT banned #94818A)
  },
  dateFieldChevron: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: 20,
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
  },

  // LMP quiet link (§2.4)
  quietLink: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: T.spacing[2],                            // 8dp
  },
  quietLinkText: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT old rose/700 #8E3A44)
    letterSpacing: 0,
  },

  // Week stepper (§2.3)
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.color.surface.subtle,            // #F5EDE6 ivory-200 (NOT white)
    borderRadius: T.radius.md,                          // 12dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,               // #E8DDD5 (NOT #EBE1D9)
    minHeight: T.input.height,                          // 52dp
    paddingHorizontal: T.spacing[2],                    // 8dp
  },
  stepperBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold (NOT IBMPlexMono)
    fontSize: 24,
    color: T.color.accent.interactive,                  // #9A5F0A amber-700 (NOT #A8505A)
    letterSpacing: 0,
  },
  stepperBtnDisabled: {
    color: T.color.surface.divider,                     // #E8DDD5 (NOT banned #DDA0A6)
  },
  stepperValue: {
    fontFamily: T.type.bodyLarge.fontFamily,            // Sarabun-Regular (NOT IBMPlexMono)
    fontSize: T.type.bodyLarge.size,                    // 17sp
    lineHeight: T.type.bodyLarge.lineHeight,            // 28
    color: T.color.text.heading,                        // #4A2230 (NOT #3A2A30)
    textAlign: 'center',
    letterSpacing: 0,
  },

  // Stage echo (live, updates on step)
  stageEcho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.spacing[2],                                  // 8dp
    marginTop: T.spacing[3],                            // 12dp
    paddingHorizontal: T.spacing[1],                    // 4dp
  },
  stageEchoGlyph: {
    fontSize: 20,
  },
  stageEchoText: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    letterSpacing: 0,
  },

  // Confirmation preview (§2.5 mini — full confirmation is on navigate)
  previewCard: {
    backgroundColor: T.color.surface.subtle,            // #F5EDE6 ivory-200 (NOT white)
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.color.surface.divider,               // #E8DDD5 (NOT #EBE1D9)
    padding: 20,
    alignItems: 'center',
    gap: T.spacing[2],                                  // 8dp
    marginVertical: T.spacing[2],                       // 8dp
  },
  previewGlyph: {
    fontSize: 36,
    lineHeight: 48,
  },
  previewStage: {
    fontFamily: T.type.heading2.fontFamily,             // Sarabun-SemiBold (NOT IBMPlex)
    fontSize: T.type.heading2.size,                     // 20sp
    lineHeight: T.type.heading2.lineHeight,             // 33
    color: T.color.text.heading,                        // #4A2230 (NOT #3A2A30)
    textAlign: 'center',
    letterSpacing: 0,
  },
  previewEdd: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular (NOT IBMPlexMono)
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    textAlign: 'center',
    letterSpacing: 0,
  },
  deliveryChip: {
    backgroundColor: T.color.surface.wash.roselle,      // roselle-200 wash (NOT #F4D9DC raw)
    borderRadius: T.radius.pill,                        // 999
    paddingHorizontal: T.spacing[3],                    // 12dp
    paddingVertical: T.spacing[1],                      // 4dp
  },
  deliveryChipText: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular (NOT IBMPlex)
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.text.heading,                        // #4A2230 (NOT old rose/700 #8E3A44)
    letterSpacing: 0,
  },

  // Error
  errorText: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT old rose/700 #8E3A44)
    textAlign: 'center',
    letterSpacing: 0,
  },

  // Primary button — amber-700
  primaryBtn: {
    height: T.button.primary.height,                    // 52dp
    backgroundColor: T.button.primary.bg,               // #9A5F0A amber-700 (NOT #A8505A)
    borderRadius: T.button.primary.radius,              // 14dp
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.spacing[2],                            // 8dp
  },
  primaryBtnDisabled: {
    backgroundColor: 'rgba(154, 95, 10, 0.45)',         // amber-700 45% disabled (NOT #DDA0A6)
  },
  primaryBtnText: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.button.primary.text,                       // #FBF6F1
    letterSpacing: 0,
  },

  // Empty-state visible hint (§6.1)
  emptyHint: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    textAlign: 'center',
    letterSpacing: 0,
  },

  // Footnote
  footnote: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.text.primary,                        // #7A3A52 (NOT banned #94818A)
    textAlign: 'center',
    marginTop: T.spacing[1],                            // 4dp
    letterSpacing: 0,
  },

  // Modal (LMP helper + date picker) — surface.subtle bg, radius.lg top corners
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(58,42,48,0.5)',              // overlay — not a color token
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: T.color.surface.subtle,            // #F5EDE6 ivory-200 (NOT white)
    borderTopLeftRadius: T.radius.lg,                   // 20dp
    borderTopRightRadius: T.radius.lg,                  // 20dp
    padding: T.spacing[6],                              // 24dp
    gap: T.spacing[4],                                  // 16dp
  },
  modalTitle: {
    fontFamily: T.type.heading2.fontFamily,             // Sarabun-SemiBold
    fontSize: T.type.heading2.size,                     // 20sp
    lineHeight: T.type.heading2.lineHeight,             // 33
    color: T.color.text.heading,                        // #4A2230 (NOT #3A2A30)
    letterSpacing: 0,
  },
  modalHint: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    letterSpacing: 0,
  },
  modalInput: {
    height: T.input.height,                             // 52dp
    borderWidth: 1,
    borderColor: T.input.border.default,                // #E8DDD5 (NOT #EBE1D9)
    borderRadius: T.radius.md,                          // 12dp
    paddingHorizontal: T.spacing[4],                    // 16dp
    fontFamily: T.type.bodyLarge.fontFamily,            // Sarabun-Regular (NOT IBMPlexMono)
    fontSize: T.type.bodyLarge.size,                    // 17sp
    color: T.input.text,                                // #4A2230
    backgroundColor: T.input.bg,                        // #F5EDE6 ivory-200 (NOT surface.base)
    letterSpacing: 0,
  },
  lmpEstimate: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    backgroundColor: T.color.surface.base,              // #FBF6F1 ivory-100
    borderRadius: T.radius.sm,                          // 6dp
    padding: T.spacing[3],                              // 12dp
    letterSpacing: 0,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: T.spacing[3],                                  // 12dp
    marginTop: T.spacing[1],                            // 4dp
  },
  modalBtnSecondary: {
    flex: 1,
    height: T.button.primary.height,                    // 52dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,               // #E8DDD5 (NOT #EBE1D9)
    borderRadius: T.radius.pill,                        // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondaryText: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    letterSpacing: 0,
  },
  modalBtnPrimary: {
    flex: 1,
    height: T.button.primary.height,                    // 52dp
    backgroundColor: T.button.primary.bg,               // #9A5F0A amber-700 (NOT #A8505A)
    borderRadius: T.radius.pill,                        // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimaryText: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.button.primary.text,                       // #FBF6F1
    letterSpacing: 0,
  },
});
