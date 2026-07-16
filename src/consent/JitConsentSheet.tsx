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

import React from 'react';
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
import { T } from '../theme/tokens';
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
  /**
   * Parental attestation checkbox state (ม.20).
   * Owned by the caller (useJitConsent.parentalAttested) — single source of truth.
   * NEVER pre-set to true; the caller's hook initialises it to false.
   * Only relevant for infant_feeding + child_health.
   */
  parentalAttested: boolean;
  /**
   * Callback to toggle the parental attestation checkbox.
   * Delegates to useJitConsent.setParentalAttested so hook and sheet stay in sync.
   */
  onParentalAttest: (v: boolean) => void;
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
  parentalAttested,
  onParentalAttest,
}: JitConsentSheetProps): React.JSX.Element {
  const { t } = useT();

  // parentalAttested is now owned by the caller (useJitConsent) — single source of truth.
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
                  accessibilityLabel={t('consent.jit.retry_btn')}
                >
                  <Text style={styles.retryBtnLabel} accessibilityElementsHidden>
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
                onPress={() => onParentalAttest(!parentalAttested)}
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
                <ActivityIndicator color={T.color.text.onDark} />
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

// ─── Styles — ห้องแม่ Phase 2 B4: full semantic T.* migration ────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    maxHeight: '85%',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },

  title: {
    fontFamily: T.type.label.fontFamily,  // Sarabun-SemiBold (was Looped-SemiBold — B4 fix)
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
    marginBottom: 12,
  },
  body: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    marginBottom: 12,
  },
  noteCaption: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    marginBottom: 8,
  },
  versionCaption: {
    fontFamily: T.type.micro.fontFamily,
    fontSize: T.type.micro.size,
    color: T.color.text.primary,
    marginBottom: 16,
  },

  // Error panel
  errorPanel: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.sm,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    flex: 1,
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
  },
  // >=48dp tap target (a11y essentials — touch targets must be >=48dp).
  retryBtn: { marginLeft: 8, minHeight: 48, justifyContent: 'center' },
  retryBtnLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
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
    borderRadius: T.radius.sm,
    borderWidth: 2,
    borderColor: T.color.accent.identity,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
    backgroundColor: T.color.surface.subtle,
  },
  checkboxOuterChecked: {
    backgroundColor: T.color.surface.wash.roselle,
    borderColor: T.color.accent.identity,
  },
  checkmark: {
    fontFamily: T.type.label.fontFamily,
    fontSize: 14,
    color: T.color.text.heading,
    lineHeight: 18,
  },
  attestLabel: {
    flex: 1,
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.heading,
  },

  // Grant button (amber-700 — B4 spec)
  grantBtn: {
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.md,
    minHeight: T.button.primary.height,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  grantBtnDisabled: {
    backgroundColor: T.scrim.amber,
  },
  grantBtnLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
  },
  grantBtnLabelDisabled: {
    color: T.color.text.onDark,
    opacity: 0.7,
  },

  // Decline / Hide notes button (quiet text-only)
  declineBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginBottom: 8,
  },
  declineBtnLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    // Quiet/decline/"hide notes" action ink — matches ManageConsentsScreen's
    // sheetQuietBtnLabel fix (cluster 6 review): calm confirmed-choice heading
    // ink, not body-copy primary ink and never the reserved error/alarm color.
    color: T.color.text.heading,
  },
  declineBtnDisabled: {
    opacity: 0.5,
  },

  // Change-later note
  changeLaterNote: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    textAlign: 'center',
    marginTop: 4,
  },
});
