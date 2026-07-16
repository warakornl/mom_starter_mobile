/**
 * BuddhistDateField — task #40: ONE shared component for the พ.ศ.-aware
 * date-entry field used across the pregnancy date screens
 * (ProfileSetupScreen, BirthEventScreen, LossConfirmScreen).
 *
 * SAFE REFACTOR (not a redesign): this renders the SAME visible UX each
 * screen already had — a tappable field that opens a modal with a
 * `YYYY-MM-DD` text input (`variant="modal"`), OR a plain inline text input
 * with no modal (`variant="inline"`, matching LossConfirmScreen's existing
 * layout — no Confirm/Cancel buttons, validated by the host screen on
 * confirm). No new calendar/wheel widget. All strings are passed in as props
 * from each screen's own catalog keys — this component owns NO new catalog
 * keys of its own.
 *
 * The Buddhist-Era (พ.ศ.) year-trap guard itself lives in ONE place —
 * `buddhistDateGuard.ts` (`convertBuddhistEraYearIfNeeded` / `isBuddhistEraYear`
 * / `BE_YEAR_THRESHOLD`). This component's `variant="modal"` wires that guard
 * into its own Confirm flow (`guardMode`); `variant="inline"` does NOT run
 * the guard itself (LossConfirmScreen's confirm-time validation needs
 * `edd`/`today` context this field doesn't have — the screen calls the SAME
 * shared guard function directly before committing). Either way there is
 * only ONE guard implementation in the codebase.
 *
 * Security: pure UI + the shared pure guard function — no logging, no
 * network. NEVER logs the date value (K-8).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Platform,
} from 'react-native';
import { T } from '../theme/tokens';
import { convertBuddhistEraYearIfNeeded, isBuddhistEraYear } from './buddhistDateGuard';

// ─── Props ────────────────────────────────────────────────────────────────────

export type BuddhistDateFieldGuardMode = 'auto-convert' | 'reject' | 'none';

export interface BuddhistDateFieldModalProps {
  variant: 'modal';
  /** Guard behaviour run inside this field's own Confirm handler:
   *   - 'auto-convert' — detected BE year (year > 2100) is silently corrected
   *     (−543) + a calm inline notice is shown (ProfileSetupScreen).
   *   - 'reject'       — detected BE year is rejected inline, no correction,
   *     no Continue-anyway path (BirthEventScreen's birth-date field).
   *   - 'none'         — no BE guard (BirthEventScreen's hospital
   *     admission/discharge fields never had one — preserved as-is). */
  guardMode: BuddhistDateFieldGuardMode;

  /** Current committed value (YYYY-MM-DD or ''). */
  value: string;
  /** Called with the new committed value when the user confirms a valid date. */
  onChange: (value: string) => void;

  /** Accessibility label for the field itself (and the modal's TextInput). */
  a11yLabel: string;
  /** Placeholder shown on the closed field when value is empty. */
  placeholder: string;
  /** Already-formatted display text for a non-empty value (e.g.
   *  formatCivilDate output) — the field row shows this instead of the raw
   *  YYYY-MM-DD value when non-empty. */
  displayValue?: string;

  modalTitle: string;
  modalHint: string;
  modalPlaceholder?: string;
  modalCancelLabel: string;
  modalConfirmLabel: string;

  /** Format-error copy shown when the typed text isn't `\d{4}-\d{2}-\d{2}`. */
  formatErrorMessage: string;
  /** guardMode="auto-convert" only: calm notice shown after a silent BE→CE
   *  correction. */
  beAutoConvertedNotice?: string;
  /** guardMode="reject" only: message shown when a BE year is rejected inline. */
  beRejectedMessage?: string;

  /** When provided, format errors are surfaced via this (a blocking native
   *  Alert, matching BirthEventScreen's historical behaviour) INSTEAD OF the
   *  inline modal error text (ProfileSetupScreen's historical behaviour). */
  onFormatErrorAlert?: (title: string, message: string) => void;
  formatErrorAlertTitle?: string;

  /** Optional extra confirm-time validation (e.g. future-date soft warning)
   *  that runs AFTER the BE guard passes and BEFORE commit:
   *    - 'commit' — no further concern, BuddhistDateField commits `candidate`
   *      via onChange and closes its modal immediately.
   *    - 'defer'  — the host is showing its OWN UI (e.g. a Continue-anyway
   *      Alert) that will call onChange itself later. BuddhistDateField
   *      closes its modal now (so the Alert sits on top of the screen, not
   *      the date modal) but does NOT call onChange itself.
   *    - 'block'  — host already surfaced its own inline validation UI (e.g.
   *      a hospital-stay range error); the modal stays open, nothing commits. */
  onPreCommit?: (candidate: string) => 'commit' | 'defer' | 'block';

  testID?: string;
  modalInputTestID?: string;
}

export interface BuddhistDateFieldInlineProps {
  variant: 'inline';
  /** Raw (uncommitted-per-keystroke) text value — LossConfirmScreen commits
   *  on its own Confirm action, not per keystroke, so this field has no
   *  separate "committed" vs "draft" state; value IS the draft text. */
  value: string;
  onChangeText: (text: string) => void;
  a11yLabel: string;
  placeholder: string;
  editable?: boolean;
  /** Externally-owned error/hint text (the host screen validates on its own
   *  Confirm action using the SAME shared guard functions — see file header). */
  errorText?: string | null;
  testID?: string;
}

export type BuddhistDateFieldProps = BuddhistDateFieldModalProps | BuddhistDateFieldInlineProps;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Component ────────────────────────────────────────────────────────────────

export function BuddhistDateField(props: BuddhistDateFieldProps): React.JSX.Element {
  // ── Inline variant (LossConfirmScreen) — pure controlled field, no modal,
  // no internal validation. The host screen owns validation timing/copy. ──
  if (props.variant === 'inline') {
    const { value, onChangeText, a11yLabel, placeholder, editable, errorText, testID } = props;
    return (
      <View>
        <TextInput
          testID={testID}
          style={styles.inlineField}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={T.input.placeholder}
          accessibilityLabel={a11yLabel}
          editable={editable}
        />
        {errorText != null && (
          <Text style={styles.inlineErrorText} accessibilityLiveRegion="polite">
            {errorText}
          </Text>
        )}
      </View>
    );
  }

  // ── Modal variant (ProfileSetupScreen, BirthEventScreen) ───────────────────
  const {
    guardMode,
    value,
    onChange,
    a11yLabel,
    placeholder,
    displayValue,
    modalTitle,
    modalHint,
    modalPlaceholder,
    modalCancelLabel,
    modalConfirmLabel,
    formatErrorMessage,
    beAutoConvertedNotice,
    beRejectedMessage,
    onFormatErrorAlert,
    formatErrorAlertTitle,
    onPreCommit,
    testID,
    modalInputTestID,
  } = props;

  const [showModal, setShowModal] = useState(false);
  const [inputText, setInputText] = useState(value);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  function commit(candidate: string): void {
    onChange(candidate);
    setInputText(candidate);
    setShowModal(false);
    setErrorMsg(null);
  }

  function handleConfirm(): void {
    const trimmed = inputText.trim();
    if (!DATE_ONLY_RE.test(trimmed)) {
      if (onFormatErrorAlert) {
        onFormatErrorAlert(formatErrorAlertTitle ?? '', formatErrorMessage);
      } else {
        setErrorMsg(formatErrorMessage);
      }
      return;
    }

    let candidate = trimmed;

    if (guardMode === 'auto-convert') {
      const { corrected, wasBe } = convertBuddhistEraYearIfNeeded(trimmed);
      candidate = corrected;
      setNoticeMsg(wasBe ? (beAutoConvertedNotice ?? null) : null);
    } else if (guardMode === 'reject') {
      if (isBuddhistEraYear(trimmed)) {
        setErrorMsg(beRejectedMessage ?? formatErrorMessage);
        return;
      }
    }

    if (onPreCommit) {
      // 'commit'  — no further concern, commit immediately (value + modal close).
      // 'defer'   — the host is showing its OWN UI (e.g. a Continue-anyway
      //             Alert) that will call onChange itself later; this field
      //             closes its modal now (the Alert sits on top) but does
      //             NOT call onChange (host owns that).
      // 'block'   — host already surfaced its own inline validation UI;
      //             keep the modal open, do not commit.
      const outcome = onPreCommit(candidate);
      if (outcome === 'block') return;
      if (outcome === 'defer') {
        setShowModal(false);
        setErrorMsg(null);
        return;
      }
    }

    commit(candidate);
  }

  return (
    <>
      <TouchableOpacity
        testID={testID}
        style={styles.dateField}
        onPress={() => {
          setInputText(value);
          setErrorMsg(null);
          setNoticeMsg(null);
          setShowModal(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          value ? `${a11yLabel}, ${displayValue ?? value}` : `${a11yLabel}, ${placeholder}`
        }
      >
        <Text style={[styles.dateFieldText, !value && styles.dateFieldPlaceholder]}>
          {value ? (displayValue ?? value) : placeholder}
        </Text>
        <Text style={styles.chevron} accessibilityElementsHidden={true}>
          {' ›'}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setErrorMsg(null);
          setNoticeMsg(null);
          setShowModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{modalTitle}</Text>
            <Text style={styles.modalHint}>{modalHint}</Text>
            <TextInput
              testID={modalInputTestID}
              style={styles.modalInput}
              value={inputText}
              onChangeText={(v) => {
                setInputText(v);
                setErrorMsg(null);
              }}
              placeholder={modalPlaceholder}
              placeholderTextColor={T.input.placeholder}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              maxLength={10}
              autoFocus
              accessibilityLabel={a11yLabel}
            />
            {errorMsg != null && (
              <Text style={styles.modalErrorText} accessibilityRole="alert">
                {errorMsg}
              </Text>
            )}
            {noticeMsg != null && (
              <Text style={styles.modalNoticeText} accessibilityRole="text">
                {noticeMsg}
              </Text>
            )}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => {
                  setErrorMsg(null);
                  setNoticeMsg(null);
                  setShowModal(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={modalCancelLabel}
              >
                <Text style={styles.modalBtnSecondaryText}>{modalCancelLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={handleConfirm}
                accessibilityRole="button"
                accessibilityLabel={modalConfirmLabel}
              >
                <Text style={styles.modalBtnPrimaryText}>{modalConfirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Styles — ห้องแม่ tokens ONLY, no inline hex/px outside tokens.ts ─────────

const styles = StyleSheet.create({
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: T.input.height,
    backgroundColor: T.input.bg,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.input.border.default,
    paddingHorizontal: T.spacing[4],
  },
  dateFieldText: {
    flex: 1,
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    color: T.input.text,
    letterSpacing: 0,
  },
  dateFieldPlaceholder: {
    color: T.input.placeholder,
  },
  chevron: {
    fontFamily: T.type.body.fontFamily,
    fontSize: 20,
    color: T.color.text.primary,
  },

  inlineField: {
    backgroundColor: T.input.bg,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    paddingHorizontal: T.spacing[4],
    minHeight: 56,
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.input.text,
  },
  inlineErrorText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: T.color.surface.subtle,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    padding: T.spacing[6],
    gap: T.spacing[4],
  },
  modalTitle: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
    letterSpacing: 0,
  },
  modalHint: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    letterSpacing: 0,
  },
  modalInput: {
    height: T.input.height,
    borderWidth: 1,
    borderColor: T.input.border.default,
    borderRadius: T.radius.md,
    paddingHorizontal: T.spacing[4],
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: T.type.bodyLarge.size,
    color: T.input.text,
    backgroundColor: T.input.bg,
    letterSpacing: 0,
  },
  modalErrorText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.input.errorText,
    letterSpacing: 0,
  },
  modalNoticeText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.botanical,
    letterSpacing: 0,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: T.spacing[3],
    marginTop: T.spacing[1],
  },
  modalBtnSecondary: {
    flex: 1,
    height: T.button.primary.height,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondaryText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color: T.color.text.primary,
    letterSpacing: 0,
  },
  modalBtnPrimary: {
    flex: 1,
    height: T.button.primary.height,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimaryText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color: T.button.primary.text,
    letterSpacing: 0,
  },
});
