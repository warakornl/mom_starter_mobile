/**
 * DeleteAccountSheet — destructive confirm bottom-sheet for "Delete my account".
 *
 * Extends the ManageConsents confirm PATTERN (same Modal + sheetOverlay + sheet +
 * handle structure) with the rose/destructive variant (0c D5, UI spec §3.1).
 * This is NOT the logout Alert.alert — it is a NEW surface.
 *
 * Content order (fixed, per UI spec §3.2):
 *   Handle
 *   Title ("ลบบัญชีของคุณ")
 *   Consequences disclosure (3 bullets — VERBATIM, identical across all states)
 *   Export-before-delete nudge (non-blocking prompt, US-26)
 *   Type-to-confirm input (§3.5)
 *   [stepUpDegraded notice — only when stepUpDegraded=true] (§3.6)
 *   [DELETE_ERROR notice — only when deleteError is set] (§3.7)
 *   Divider
 *   Confirm button (disabled until floor satisfied + not in-flight, §3.3)
 *   Cancel button (§3.4)
 *
 * Accessibility:
 *   - All touch targets ≥ 48dp / ≥ 52dp for destructive confirm (UI spec §5.1)
 *   - Confirm button: accessibilityState={{ disabled }} — kept in SR navigation
 *     (tabindex=-1 semantics via pointer-events:none; SR virtual cursor still reaches
 *     it to read the explanatory label) — UI spec §5.3 I-2.
 *   - Live regions: polite for degrade notice, assertive for DELETE_ERROR (§5.4 M-3).
 *   - Color + text dual destructive signals (§5.2).
 *
 * SECURITY: no health data, no tokens in this component. All sensitive I/O is in
 * the parent (useAccountRights hook / SettingsScreen).
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { matchesConfirmWord } from './confirmWordMatch';
import type { SupportedLocale } from './confirmWordMatch';
import { useT } from '../i18n/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DeleteAccountSheetProps {
  /** Whether the sheet is visible. Controlled by the parent. */
  visible: boolean;

  /** Active locale — determines confirm word and copy language. */
  locale: SupportedLocale;

  /**
   * The type-to-confirm input value, controlled by the parent.
   * The parent PRESERVES this across nudge export and step-up returns (M-4,
   * AR-AC-28 — floor stays satisfied without re-typing).
   */
  confirmInput: string;

  /**
   * Called on every text change in the type-to-confirm input.
   * Parent stores the value to survive sheet temporary-dismiss/re-open (nudge).
   */
  onConfirmInputChange: (text: string) => void;

  /** True while DELETE /v1/account is in-flight. Spinner replaces button label. */
  deleteInFlight: boolean;

  /**
   * Non-null when DELETE_ERROR: shows the error card above the divider.
   * The error string is an internal code (e.g. 'network_error', 'session_expired')
   * — the sheet renders fixed user-facing copy regardless of the code value.
   */
  deleteError: string | null;

  /**
   * True when C-2 throw-degrade occurred: step-up is skipped on next confirm.
   * Shows the non-alarming biometric-unavailable amber notice (§3.6).
   */
  stepUpDegraded: boolean;

  /**
   * Called when the user taps "Delete my account" / "Retry" confirm button.
   * CRITICAL (E-13): the parent must implement synchronous double-tap suppression
   * using acquireDeleteLock/releaseDeleteLock before calling runDeleteGate.
   */
  onConfirmTap: () => void;

  /** Called on cancel / sheet back-swipe. No delete, no sign-out (§3.4, AR-AC-14). */
  onCancelTap: () => void;

  /**
   * Called when user taps "Download my data first" in the nudge section.
   * The parent dismisses the sheet temporarily, runs export, then re-opens it.
   */
  onNudgeDownloadTap: () => void;

  /** Called when user taps "Skip and continue" in the nudge section. No action. */
  onNudgeSkipTap: () => void;

  /**
   * Called when user taps "Retry" after DELETE_ERROR (replaces the confirm button).
   * The parent re-runs the full step-up→DELETE gate (0f rule 4, §3.2).
   */
  onRetryTap: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeleteAccountSheet({
  visible,
  locale,
  confirmInput,
  onConfirmInputChange,
  deleteInFlight,
  deleteError,
  stepUpDegraded,
  onConfirmTap,
  onCancelTap,
  onNudgeDownloadTap,
  onNudgeSkipTap,
  onRetryTap,
}: DeleteAccountSheetProps): React.JSX.Element | null {
  const { t } = useT();

  // Compute floor satisfaction live on every render (M-1, §3.7):
  //   trimmed + case-insensitive equal to active-locale confirm word.
  const floorSatisfied = matchesConfirmWord(confirmInput, locale);

  // Confirm button is fully enabled only when floor satisfied AND not in-flight.
  const confirmEnabled = floorSatisfied && !deleteInFlight;

  // In DELETE_IN_FLIGHT the cancel button is also disabled (state would be ambiguous).
  const cancelEnabled = !deleteInFlight;

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancelTap}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          // Allow sheet to scroll when disclosure + nudge + input exceed visible area (§5.5)
          bounces={false}
        >
          {/* Handle */}
          <View style={styles.handle} accessibilityElementsHidden />

          {/* Title (destructive rose/700 — §3.2) */}
          <Text
            style={styles.sheetTitle}
            accessibilityRole="header"
            testID="delete-sheet-title"
          >
            {t('accountRights.delete.sheetTitle')}
          </Text>

          {/* ── Consequences disclosure (CANONICAL — verbatim, identical all states) ── */}
          {/* UI spec §4.3 note M-1: do NOT use condensed gallery copy. */}
          {/* NO retention number — copy legally cleared, no day count per D7/FLAG-D2. */}
          <View
            style={styles.disclosureBlock}
            accessibilityRole="text"
            testID="delete-sheet-disclosure"
          >
            <Text style={styles.disclosureItem}>
              {'• '}{t('accountRights.delete.disclosure1')}
            </Text>
            <Text style={styles.disclosureItem}>
              {'• '}{t('accountRights.delete.disclosure2')}
            </Text>
            <Text style={styles.disclosureItem}>
              {'• '}{t('accountRights.delete.disclosure3')}
            </Text>
          </View>

          {/* ── Export-before-delete nudge (non-blocking, US-26) ── */}
          <View style={styles.nudgeBlock} testID="delete-sheet-nudge">
            <Text style={styles.nudgeTitle}>
              {t('accountRights.delete.nudgeTitle')}
            </Text>
            <Text style={styles.nudgeBody}>
              {t('accountRights.delete.nudgeBody')}
            </Text>

            {/* "Download my data first" — secondary btn (≥ 48dp, non-blocking) */}
            <TouchableOpacity
              testID="delete-sheet-nudge-download-btn"
              style={styles.nudgeDownloadBtn}
              onPress={onNudgeDownloadTap}
              accessibilityRole="button"
              accessibilityLabel={t('accountRights.delete.nudgeDownloadBtn')}
            >
              <Text style={styles.nudgeDownloadBtnLabel}>
                {t('accountRights.delete.nudgeDownloadBtn')}
              </Text>
            </TouchableOpacity>

            {/* "Skip and continue" — quiet link (≥ 44dp) */}
            <TouchableOpacity
              testID="delete-sheet-nudge-skip-btn"
              style={styles.nudgeSkipBtn}
              onPress={onNudgeSkipTap}
              accessibilityRole="button"
              accessibilityLabel={t('accountRights.delete.nudgeSkipBtn')}
            >
              <Text style={styles.nudgeSkipBtnLabel}>
                {t('accountRights.delete.nudgeSkipBtn')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Type-to-confirm floor (§3.5) ── */}
          <View style={styles.confirmFloor} testID="delete-sheet-confirm-floor">
            <Text style={styles.confirmLabel}>
              {t('accountRights.delete.confirmLabel')}
            </Text>
            <TextInput
              testID="delete-sheet-confirm-input"
              style={[
                styles.confirmInput,
                floorSatisfied && styles.confirmInputMatched,
                deleteInFlight && styles.confirmInputDisabled,
              ]}
              value={confirmInput}
              onChangeText={onConfirmInputChange}
              placeholder={t('accountRights.delete.confirmPlaceholder')}
              placeholderTextColor="#94818A"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!deleteInFlight}
              accessibilityLabel={
                locale === 'th'
                  ? 'พิมพ์คำว่า ลบ เพื่อยืนยัน'
                  : 'Type the word DELETE to confirm'
              }
              // Hint for SR (supplemental; the label above is primary):
              accessibilityHint={t('accountRights.delete.confirmLabel')}
            />
          </View>

          {/* ── stepUpDegraded notice (§3.6 — only when C-2 degrade) ── */}
          {/* aria-live="polite" — non-alarming amber notice (not red) */}
          {stepUpDegraded && (
            <View
              style={styles.degradeNotice}
              testID="delete-sheet-degrade-notice"
              // polite live region — appears non-alarmingly when stepUpDegraded is set
              accessibilityLiveRegion="polite"
              accessibilityRole="none"
            >
              <Text style={styles.degradeNoticeText} accessibilityElementsHidden>
                {'ℹ '}
              </Text>
              <Text style={styles.degradeNoticeText}>
                {t('accountRights.delete.degradeNotice')}
              </Text>
            </View>
          )}

          {/* ── DELETE_ERROR notice (§3.7) ── */}
          {/* aria-live="assertive" — intentional exception (M-3, §5.4): */}
          {/*   "your account is still intact" reassurance must interrupt SR */}
          {deleteError !== null && (
            <View
              style={styles.deleteErrorCard}
              testID="delete-sheet-error-card"
              // assertive: single intentional exception per UI spec §5.4 M-3
              accessibilityLiveRegion="assertive"
              accessibilityRole="none"
            >
              <Text style={styles.deleteErrorTitle}>
                {t('accountRights.delete.errorTitle')}
              </Text>
              <Text style={styles.deleteErrorBody}>
                {t('accountRights.delete.errorBody')}
              </Text>
            </View>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* ── Confirm / Retry button (§3.3) ── */}
          {/* When DELETE_ERROR: "Retry"; otherwise: "Delete my account" */}
          <TouchableOpacity
            testID="delete-sheet-confirm-btn"
            style={[
              styles.confirmBtn,
              !confirmEnabled && styles.confirmBtnDisabled,
            ]}
            onPress={() => {
              // Guard: suppress tap when button is disabled (floor not satisfied or in-flight).
              // E-13 synchronous double-tap prevention is also handled in the parent via
              // acquireDeleteLock(ref) before runDeleteGate is called.
              if (!confirmEnabled) return;
              if (deleteError !== null) { onRetryTap(); } else { onConfirmTap(); }
            }}
            // E-13 / I-2: aria-disabled (not native disabled) — kept in SR navigation
            // to announce the label. Only pointer-events:none suppresses physical taps.
            accessibilityState={{ disabled: !confirmEnabled }}
            accessibilityRole="button"
            accessibilityLabel={
              locale === 'th'
                ? 'ยืนยันลบบัญชี — การลบเป็นการถาวร'
                : 'Delete my account — deletion is permanent'
            }
            // pointer-events are suppressed via onPress guard (not native disabled prop)
            // so the button stays in SR virtual-cursor navigation with its label
            // (UI spec §5.3 I-2 — accessibilityState.disabled, not the disabled attr).
          >
            {deleteInFlight ? (
              <ActivityIndicator
                size="small"
                color="#FFFFFF"
                testID="delete-sheet-confirm-spinner"
              />
            ) : (
              <Text style={styles.confirmBtnLabel}>
                {deleteError !== null
                  ? t('accountRights.delete.retryBtn')
                  : t('accountRights.delete.confirmBtn')}
              </Text>
            )}
          </TouchableOpacity>

          {/* ── Cancel button (§3.4) ── */}
          <TouchableOpacity
            testID="delete-sheet-cancel-btn"
            style={[
              styles.cancelBtn,
              !cancelEnabled && styles.cancelBtnDisabled,
            ]}
            onPress={() => { if (cancelEnabled) onCancelTap(); }}
            accessibilityRole="button"
            accessibilityLabel={
              locale === 'th'
                ? 'ยกเลิกการลบบัญชี'
                : 'Cancel account deletion'
            }
            accessibilityState={{ disabled: !cancelEnabled }}
          >
            <Text style={[
              styles.cancelBtnLabel,
              !cancelEnabled && styles.cancelBtnLabelDisabled,
            ]}>
              {t('accountRights.delete.cancelBtn')}
            </Text>
          </TouchableOpacity>

          {/* Extra bottom padding for home-bar safe area */}
          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Tokens match the ManageConsents sheet pattern (same overlay + sheet + handle).
// Destructive variant: rose/700 (#9B1C35) for title + confirm button.
// Error/degrade notices: honey/100 (#FBE9D2) warm amber — NOT alarming red.

const ROSE_700 = '#9B1C35';   // destructive rose (design-system §5.1)
const HONEY_100 = '#FBE9D2';  // amber background — non-alarming (§3.6, §2.3)
const HONEY_BORDER = '#E9C097'; // amber border
const HONEY_700 = '#92400E';  // amber text
const INK = '#3A2A30';
const INK_SOFT = '#5F4A52';
const INK_FAINT = '#94818A';
const SURFACE_PAGE = '#FFFFFF';
const SURFACE_PAGE_SUNK = '#F5F0ED';
const HAIRLINE = '#EBE1D9';
const SAGE_500 = '#4A7A56';   // matched state border

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(58, 42, 48, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: SURFACE_PAGE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    // elevation/shadow matching ManageConsents sheet (elev/2)
    ...(Platform.OS === 'android'
      ? { elevation: 8 }
      : {
          shadowColor: INK,
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
        }),
  },
  sheetContent: {
    padding: 24,
  },

  // Handle
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: HAIRLINE,
    alignSelf: 'center',
    marginBottom: 20,
  },

  // Title
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: ROSE_700,
    marginBottom: 16,
    lineHeight: 28,
  },

  // Disclosure
  disclosureBlock: {
    backgroundColor: SURFACE_PAGE_SUNK,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  disclosureItem: {
    fontSize: 14,
    lineHeight: 22,
    color: INK_SOFT,
    marginBottom: 8,
  },

  // Nudge
  nudgeBlock: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    backgroundColor: SURFACE_PAGE,
  },
  nudgeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: INK,
    marginBottom: 6,
  },
  nudgeBody: {
    fontSize: 13,
    lineHeight: 20,
    color: INK_SOFT,
    marginBottom: 12,
  },
  nudgeDownloadBtn: {
    // ≥ 48dp touch target (UI spec §5.1)
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ROSE_700,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  nudgeDownloadBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: ROSE_700,
  },
  nudgeSkipBtn: {
    // ≥ 44dp touch target for quiet link (UI spec §5.1)
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeSkipBtnLabel: {
    fontSize: 14,
    color: INK_FAINT,
    textDecorationLine: 'underline',
  },

  // Type-to-confirm floor
  confirmFloor: {
    marginBottom: 12,
  },
  confirmLabel: {
    fontSize: 14,
    color: INK,
    marginBottom: 8,
    fontWeight: '500',
  },
  confirmInput: {
    // ≥ 48dp touch target (UI spec §5.1)
    minHeight: 48,
    backgroundColor: SURFACE_PAGE,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: INK,
  },
  confirmInputMatched: {
    // Subtle positive signal when floor is satisfied (§3.5)
    borderColor: SAGE_500,
    borderWidth: 1.5,
  },
  confirmInputDisabled: {
    backgroundColor: SURFACE_PAGE_SUNK,
    color: INK_FAINT,
  },

  // stepUpDegraded notice (§3.6 — warm amber, NOT red)
  degradeNotice: {
    flexDirection: 'row',
    backgroundColor: HONEY_100,
    borderWidth: 1,
    borderColor: HONEY_BORDER,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  degradeNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: HONEY_700,
  },

  // DELETE_ERROR card (§3.7 — same warm amber style as EXPORT_ERROR)
  deleteErrorCard: {
    backgroundColor: HONEY_100,
    borderWidth: 1,
    borderColor: HONEY_BORDER,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  deleteErrorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: INK,
    marginBottom: 4,
  },
  deleteErrorBody: {
    fontSize: 13,
    lineHeight: 20,
    color: INK_SOFT,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: HAIRLINE,
    marginVertical: 16,
  },

  // Confirm button (§3.3)
  confirmBtn: {
    // ≥ 52dp for destructive confirm (UI spec §5.1)
    minHeight: 52,
    backgroundColor: ROSE_700,
    borderRadius: 26, // radius/pill
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
    // pointer-events handled via pointerEvents prop — not here
  },
  confirmBtnLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  // Cancel button (§3.4 — quiet, ≥ 44dp)
  cancelBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  cancelBtnDisabled: {
    opacity: 0.4,
  },
  cancelBtnLabel: {
    color: ROSE_700,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelBtnLabelDisabled: {
    color: INK_FAINT,
  },

  bottomSpacer: {
    height: 16,
  },
});
