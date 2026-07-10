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

import React, { useState, useEffect, useRef } from 'react';
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
  AccessibilityInfo,
} from 'react-native';
import { matchesConfirmWord, CONFIRM_WORDS } from './confirmWordMatch';
import type { SupportedLocale } from './confirmWordMatch';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';

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

  // M-3: track input focus for the honey/700 2px focus ring (§3.5).
  const [confirmInputFocused, setConfirmInputFocused] = useState(false);

  // Compute floor satisfaction live on every render (§3.7):
  //   trimmed + case-insensitive equal to active-locale confirm word.
  const floorSatisfied = matchesConfirmWord(confirmInput, locale);

  // Confirm button is fully enabled only when floor satisfied AND not in-flight.
  const confirmEnabled = floorSatisfied && !deleteInFlight;

  // In DELETE_IN_FLIGHT the cancel button is also disabled (state would be ambiguous).
  const cancelEnabled = !deleteInFlight;

  // M-2: announce politely when the confirm button transitions disabled → enabled.
  // Fires on the first render where floorSatisfied becomes true (§5.3).
  const prevConfirmEnabledRef = useRef(false);
  useEffect(() => {
    if (confirmEnabled && !prevConfirmEnabledRef.current) {
      const announcement =
        locale === 'th'
          ? 'พร้อมยืนยัน — แตะ ยืนยันลบบัญชี เพื่อดำเนินการต่อ'
          : 'Ready — tap Delete my account to confirm';
      AccessibilityInfo.announceForAccessibility(announcement);
    }
    prevConfirmEnabledRef.current = confirmEnabled;
  }, [confirmEnabled, locale]);

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
                // M-3: honey/700 2px focus ring when input has focus (§3.5)
                confirmInputFocused && styles.confirmInputFocused,
                floorSatisfied && styles.confirmInputMatched,
                deleteInFlight && styles.confirmInputDisabled,
              ]}
              value={confirmInput}
              onChangeText={onConfirmInputChange}
              onFocus={() => setConfirmInputFocused(true)}
              onBlur={() => setConfirmInputFocused(false)}
              // #9: single source — CONFIRM_WORDS[locale] is the only truth for the
              // confirm word. Removing the dead confirmPlaceholder i18n key prevents
              // matcher and UI from ever drifting out of sync.
              placeholder={CONFIRM_WORDS[locale]}
              placeholderTextColor={T.input.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!deleteInFlight}
              // #9: accessibilityLabel also derived from CONFIRM_WORDS[locale].
              accessibilityLabel={
                locale === 'th'
                  ? `พิมพ์คำว่า ${CONFIRM_WORDS[locale]} เพื่อยืนยัน`
                  : `Type the word ${CONFIRM_WORDS[locale]} to confirm`
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
                color={T.color.text.onDark}
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

// ─── Styles — ห้องแม่ Phase 2 B4: full semantic T.* migration ────────────────
// CTA (confirmBtn): amber-700 (T.button.primary.bg) per B4 spec — NOT clinical red.
// Error/degrade notices: T.color.surface.wash.amber — warm, non-alarming.
// PDPA trust: title/cancel use T.color.text.heading (roselle-900, legible).

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.color.surface.subtle,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    maxHeight: '92%',
    ...(Platform.OS === 'android'
      ? { elevation: 8 }
      : {
          ...T.elev[2],
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
    backgroundColor: T.color.surface.divider,
    alignSelf: 'center',
    marginBottom: 20,
  },

  // Title — roselle-900, legible (PDPA trust marker)
  sheetTitle: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
    marginBottom: 16,
  },

  // Disclosure
  disclosureBlock: {
    backgroundColor: T.color.surface.base,
    borderRadius: T.radius.md,
    padding: 14,
    marginBottom: 16,
  },
  disclosureItem: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    marginBottom: 8,
  },

  // Nudge
  nudgeBlock: {
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 14,
    marginBottom: 16,
    backgroundColor: T.color.surface.subtle,
  },
  nudgeTitle: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.heading,
    marginBottom: 6,
  },
  nudgeBody: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    marginBottom: 12,
  },
  nudgeDownloadBtn: {
    minHeight: 48,
    borderRadius: T.radius.md,
    borderWidth: 1.5,
    borderColor: T.color.accent.identity,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  nudgeDownloadBtnLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },
  nudgeSkipBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeSkipBtnLabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    textDecorationLine: 'underline',
  },

  // Type-to-confirm floor
  confirmFloor: {
    marginBottom: 12,
  },
  confirmLabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.heading,
    marginBottom: 8,
  },
  confirmInput: {
    minHeight: T.input.height,
    backgroundColor: T.input.bg,
    borderWidth: 1.5,
    borderColor: T.input.border.default,
    borderRadius: T.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.input.text,
  },
  confirmInputFocused: {
    // M-3: amber-600 2px focus ring — warm, non-destructive focus signal (§3.5)
    borderColor: T.input.border.focused,
    borderWidth: 2,
  },
  confirmInputMatched: {
    // Subtle positive signal when floor is satisfied (§3.5)
    borderColor: T.color.state.success,
    borderWidth: 1.5,
  },
  confirmInputDisabled: {
    backgroundColor: T.color.surface.base,
    color: T.color.text.primary,
  },

  // stepUpDegraded notice (§3.6 — warm amber wash, NOT red)
  degradeNotice: {
    flexDirection: 'row',
    backgroundColor: T.color.surface.wash.amber,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  degradeNoticeText: {
    flex: 1,
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },

  // DELETE_ERROR card (§3.7 — same warm amber wash as degrade notice)
  deleteErrorCard: {
    backgroundColor: T.color.surface.wash.amber,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 12,
    marginBottom: 12,
  },
  deleteErrorTitle: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.heading,
    marginBottom: 4,
  },
  deleteErrorBody: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: T.color.surface.divider,
    marginVertical: 16,
  },

  // Confirm button (§3.3) — amber-700 per B4 spec (NOT clinical red)
  confirmBtn: {
    minHeight: T.button.primary.height,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmBtnLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
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
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.heading,
  },
  cancelBtnLabelDisabled: {
    color: T.color.text.primary,
  },

  bottomSpacer: {
    height: 16,
  },
});
