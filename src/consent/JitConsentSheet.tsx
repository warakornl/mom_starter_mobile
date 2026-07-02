/**
 * JitConsentSheet — reusable JIT (just-in-time) consent bottom sheet.
 *
 * Design ref: first-run-consent.md §3.2 (v2)
 * Copy ref:   consent-copy.md §6
 *
 * Supports 4 JIT consent types (§3.2):
 *   pdf_egress           — §3.2a: Grant / Not now
 *   sensitive_lab_results — §3.2b: Grant & include / Hide notes (no 'decline' verb)
 *   infant_feeding        — §3.2c: parental attestation checkbox + Grant / Not now
 *   child_health          — §3.2d: parental attestation checkbox + Grant / Not now
 *
 * PDPA rules enforced:
 *   ม.20 — infant_feeding + child_health require parental attestation checkbox
 *           ticked BEFORE Grant is enabled. Checkbox is NEVER pre-ticked.
 *   ม.19 — Decline/hide is never presented as an error. No red color.
 *
 * States:
 *   default — copy + buttons visible
 *   loading — Grant button shows spinner, both buttons disabled
 *   error   — error panel (testID: consent-jit-error-panel-{type}) + retry
 *   offline — same as error but different copy
 *
 * Swipe-to-dismiss: DISABLED. User must explicitly tap Grant or Decline.
 *
 * SECURITY: never logs accessToken; no health data in this component.
 * testIDs: first-run-consent.md §5 (consent-jit-* prefix).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';

import { useT } from '../i18n/LanguageContext';
import {
  requiresParentalAttestation,
  isGrantEnabled,
} from './jitConsentLogic';
import {
  JIT_SHEET_TESTID,
  JIT_GRANT_BTN_TESTID,
  JIT_DECLINE_BTN_TESTID,
  JIT_ERROR_PANEL_TESTID,
  JIT_RETRY_BTN_TESTID,
  JIT_PARENTAL_ATTEST_TESTID,
  type JitConsentType,
} from './jitConsentSheetLogic';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface JitConsentSheetProps {
  /** The consent type to present — must be one of the 4 JIT types (§3.2) */
  type: JitConsentType;
  /** Called when user taps Grant (or "Grant & include" for sensitive_lab) */
  onGrant: () => void;
  /** Called when user taps Decline / "Not now" / "Hide notes" */
  onDecline: () => void;
  /** True while the POST is in flight — disables buttons, shows spinner */
  isLoading: boolean;
  /**
   * Non-null when the last POST attempt failed.
   * Shown as an error panel with a Retry button.
   */
  error: string | null;
  /** Called when user taps Retry in the error panel */
  onRetry: () => void;
  /** Whether the sheet is visible (allows caller to animate out cleanly) */
  visible: boolean;
}

// ─── i18n key maps ────────────────────────────────────────────────────────────

const TITLE_KEY: Record<JitConsentType, string> = {
  pdf_egress:            'consent.pdf_egress.title',
  sensitive_lab_results: 'consent.sensitive_lab.title',
  infant_feeding:        'consent.infant_feeding.title',
  child_health:          'consent.child_health.title',
};

const BODY_COPY_KEY: Record<JitConsentType, string> = {
  pdf_egress:            'consent.pdf_egress.body_copy',
  sensitive_lab_results: 'consent.sensitive_lab.body_copy',
  infant_feeding:        'consent.infant_feeding.body_copy',
  child_health:          'consent.child_health.body_copy',
};

const GRANT_BTN_KEY: Record<JitConsentType, string> = {
  pdf_egress:            'consent.pdf_egress.grant_btn',
  sensitive_lab_results: 'consent.sensitive_lab.grant_btn',
  infant_feeding:        'consent.infant_feeding.grant_btn',
  child_health:          'consent.child_health.grant_btn',
};

const PARENTAL_ATTEST_KEY: Partial<Record<JitConsentType, string>> = {
  infant_feeding: 'consent.infant_feeding.parental_attest_label',
  child_health:   'consent.child_health.parental_attest_label',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function JitConsentSheet({
  type,
  onGrant,
  onDecline,
  isLoading,
  error,
  onRetry,
  visible,
}: JitConsentSheetProps): React.JSX.Element {
  const { t } = useT();

  /**
   * Parental attestation checkbox state (ม.20).
   * NEVER pre-set to true. Resets whenever the sheet is mounted fresh.
   */
  const [parentalAttested, setParentalAttested] = useState(false);

  const grantEnabled = isGrantEnabled(type, parentalAttested) && !isLoading;
  const declineEnabled = !isLoading;
  const needsAttestation = requiresParentalAttestation(type);
  const attestTestId = JIT_PARENTAL_ATTEST_TESTID[type];
  const attestKey = PARENTAL_ATTEST_KEY[type];

  // sensitive_lab_results "decline" is "Hide notes" — different label
  const isSensitiveLab = type === 'sensitive_lab_results';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Swipe-to-dismiss disabled: onRequestClose does nothing on Android back btn
      onRequestClose={() => { /* blocked per spec */ }}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View
          testID={JIT_SHEET_TESTID[type]}
          style={styles.sheet}
          accessibilityLabel={t(TITLE_KEY[type] as Parameters<typeof t>[0])}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Title */}
            <Text style={styles.title}>
              {t(TITLE_KEY[type] as Parameters<typeof t>[0])}
            </Text>

            {/* Body copy */}
            <Text style={styles.body}>
              {t(BODY_COPY_KEY[type] as Parameters<typeof t>[0])}
            </Text>

            {/* Additional note for sensitive_lab_results (hide note) */}
            {isSensitiveLab && (
              <Text style={styles.noteCaption}>
                {t('consent.sensitive_lab.hide_note')}
              </Text>
            )}

            {/* Additional note for child_health (browse note) */}
            {type === 'child_health' && (
              <Text style={styles.noteCaption}>
                {t('consent.child_health.browse_note')}
              </Text>
            )}

            {/* Consent text version caption */}
            <Text style={styles.versionCaption}>
              {t('consent.text_version.label')} v1.0
            </Text>

            {/* Error panel (§5: consent-jit-error-panel-{type}) */}
            {error !== null && (
              <View
                testID={JIT_ERROR_PANEL_TESTID[type]}
                style={styles.errorPanel}
              >
                <Text style={styles.errorText}>
                  {t('consent.jit.save_failed')}
                </Text>
                <TouchableOpacity
                  testID={JIT_RETRY_BTN_TESTID[type]}
                  onPress={onRetry}
                  style={styles.retryBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.retryBtnLabel}>
                    {t('consent.jit.retry_btn')} ›
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Parental attestation checkbox (ม.20) — infant_feeding + child_health */}
            {needsAttestation && attestTestId && attestKey && (
              <TouchableOpacity
                testID={attestTestId}
                style={styles.attestRow}
                onPress={() => setParentalAttested((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: parentalAttested }}
                accessibilityLabel={t(attestKey as Parameters<typeof t>[0])}
              >
                <View
                  style={[
                    styles.checkboxOuter,
                    parentalAttested && styles.checkboxOuterChecked,
                  ]}
                >
                  {parentalAttested && (
                    <Text style={styles.checkmark} accessibilityElementsHidden>
                      ✓
                    </Text>
                  )}
                </View>
                <Text style={styles.attestLabel}>
                  {t(attestKey as Parameters<typeof t>[0])}
                </Text>
              </TouchableOpacity>
            )}

            {/* Grant / Grant & include button (Primary rose/600) */}
            <TouchableOpacity
              testID={JIT_GRANT_BTN_TESTID[type]}
              style={[styles.grantBtn, !grantEnabled && styles.grantBtnDisabled]}
              onPress={grantEnabled ? onGrant : undefined}
              disabled={!grantEnabled}
              accessibilityRole="button"
              accessibilityLabel={t(GRANT_BTN_KEY[type] as Parameters<typeof t>[0])}
              accessibilityState={{ disabled: !grantEnabled }}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.grantBtnLabel, !grantEnabled && styles.grantBtnLabelDisabled]}>
                  {t(GRANT_BTN_KEY[type] as Parameters<typeof t>[0])}
                </Text>
              )}
            </TouchableOpacity>

            {/* Decline / Not now / Hide notes button (Quiet rose/700 text-only) */}
            <TouchableOpacity
              testID={JIT_DECLINE_BTN_TESTID[type]}
              style={styles.declineBtn}
              onPress={declineEnabled ? onDecline : undefined}
              disabled={!declineEnabled}
              accessibilityRole="button"
            >
              <Text style={[styles.declineBtnLabel, !declineEnabled && styles.declineBtnDisabled]}>
                {isSensitiveLab
                  ? t('consent.sensitive_lab.hide_btn')
                  : t('consent.jit.decline_btn')}
              </Text>
            </TouchableOpacity>

            {/* Change-later note */}
            <Text style={styles.changeLaterNote}>
              {t('consent.jit.change_later_note')}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(58, 42, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },

  title: {
    fontFamily: 'Looped-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30', // ink
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#5F4A52', // ink/soft
    marginBottom: 12,
  },
  noteCaption: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94818A', // ink/faint
    marginBottom: 8,
  },
  versionCaption: {
    fontSize: 12,
    color: '#94818A',
    marginBottom: 16,
  },

  // Error panel
  errorPanel: {
    backgroundColor: '#F5F0ED',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#5F4A52',
  },
  retryBtn: { marginLeft: 8 },
  retryBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#A8505A', // rose/600
  },

  // Parental attestation checkbox
  attestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingVertical: 4,
  },
  checkboxOuter: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#A8505A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
    backgroundColor: '#FFFFFF',
  },
  checkboxOuterChecked: {
    backgroundColor: '#A8505A',
    borderColor: '#A8505A',
  },
  checkmark: {
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 18,
  },
  attestLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: '#3A2A30', // ink
  },

  // Grant button (Primary rose/600)
  grantBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  grantBtnDisabled: {
    backgroundColor: '#D4B8BC', // rose/200 (dimmed)
  },
  grantBtnLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: '#FFFFFF',
  },
  grantBtnLabelDisabled: {
    color: '#FFFFFF',
    opacity: 0.7,
  },

  // Decline / Hide notes button (Quiet rose/700 text-only)
  declineBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginBottom: 8,
  },
  declineBtnLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: '#8E3A44', // rose/700
  },
  declineBtnDisabled: {
    opacity: 0.5,
  },

  // Change-later note
  changeLaterNote: {
    fontSize: 13,
    color: '#94818A', // ink/faint
    textAlign: 'center',
    marginTop: 4,
  },
});
