/**
 * ForgotPasswordScreen (S5) — Forgot / Reset Password entry screen.
 *
 * Maps to: POST /v1/auth/forgot-password → always 202 (non-enumerating)
 *
 * All strings from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * States (spec §2.2):
 *   idle          — email field; submit disabled until validateEmailField passes
 *   submitting    — spinner; field + button disabled; double-submit guard
 *   confirmation  — non-enumerating confirmation block + back-to-login + resend
 *   rate_limited  — calm inline card; form stays; submit re-enabled
 *   error_network — warm-neutral offline strip; form stays
 *   error_server  — calm centered card; form stays
 *
 * SEC-INV-1 (non-enumeration): ONE neutral confirmation regardless of input.
 *   The confirmation copy MUST NOT hint at email existence. Tested in
 *   messages.test.ts and forgotPasswordScreenLogic.test.ts.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1   App background
 *   ink           #3A2A30   Primary text
 *   ink/soft      #5F4A52   Secondary copy
 *   ink/faint     #94818A   Hint copy
 *   rose/600      #A8505A   Primary button fill
 *   sage/500      #6E9079   Confirmation title
 *   sage/100      #E4EBE4   Confirmation background
 *   hairline      #EBE1D9   Dividers
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import {
  handleForgotPassword,
  type ForgotPasswordOutcome,
  RESEND_COOLDOWN_MS,
} from './forgotPasswordScreenLogic';
import { validateEmailField } from './loginScreenLogic';
import { createAuthClient } from './authApiClient';
import { useT } from '../i18n/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ForgotPasswordScreenProps {
  /** Base URL for the auth API. */
  apiBaseUrl: string;
  /**
   * Optional email to pre-fill the field (passed from LoginScreen when the
   * mother already typed her email — convenience, no security impact).
   */
  prefillEmail?: string;
  /**
   * Called when the user taps "Back to sign in" from the confirmation state
   * or when the form's back affordance is used. Caller navigates to Login.
   */
  onDone: () => void;
  /** Hardware/swipe-back from idle or confirmation → Login. */
  onBackToLogin: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ForgotPasswordScreen({
  apiBaseUrl,
  prefillEmail,
  onDone,
  onBackToLogin,
}: ForgotPasswordScreenProps): React.JSX.Element {
  const { t } = useT();

  // Form state
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);

  // Async/UI state
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<ForgotPasswordOutcome | null>(null);

  // Resend cooldown — driven by outcome.resendAt (spec §2.5)
  const [resendCooldownUntil, setResendCooldownUntil] = useState<number>(0);
  const resendCoolingDown = Date.now() < resendCooldownUntil;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authClient = useMemo(() => createAuthClient(apiBaseUrl), [apiBaseUrl]);

  const canSubmit =
    !loading &&
    validateEmailField(email) === null;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleEmailBlur() {
    if (email.length > 0) {
      const err = validateEmailField(email);
      setEmailError(err !== null ? t('forgot.emailHint') : null);
    }
  }

  async function onSubmit() {
    const emailErr = validateEmailField(email);
    if (emailErr) {
      setEmailError(t('forgot.emailHint'));
      return;
    }
    if (loading) return; // Double-submit guard (spec §2.5)

    setLoading(true);
    setOutcome(null);

    const result = await handleForgotPassword({
      email,
      client: authClient,
    });

    setLoading(false);

    if (result.kind === 'success') {
      setResendCooldownUntil(result.resendAt);
    }
    // Always update outcome — confirmation is shown regardless (SEC-INV-1)
    setOutcome(result);
  }

  async function onResend() {
    if (loading || resendCoolingDown) return;

    setLoading(true);

    const result = await handleForgotPassword({
      email,
      client: authClient,
    });

    setLoading(false);

    if (result.kind === 'success') {
      setResendCooldownUntil(result.resendAt);
    }
    setOutcome(result);
  }

  // ─── State helpers ──────────────────────────────────────────────────────────

  const showConfirmation = outcome?.kind === 'success';
  const showOffline = outcome?.kind === 'network_error';
  const showRateLimited = outcome?.kind === 'rate_limited';
  const showServerError = outcome?.kind === 'server_error';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Confirmation state (spec §2.2, SEC-INV-1) ── */}
        {showConfirmation ? (
          <View style={styles.confirmationBlock}>
            <Text style={styles.confirmTitle}>{t('forgot.confirmTitle')}</Text>
            <Text style={styles.confirmBody}>{t('forgot.confirmBody')}</Text>

            {/* Resend affordance — 60 s client cooldown (spec §2.5) */}
            <TouchableOpacity
              style={[styles.resendButton, (resendCoolingDown || loading) && styles.buttonDisabled]}
              onPress={onResend}
              disabled={resendCoolingDown || loading}
              accessibilityRole="button"
              accessibilityLabel={t('forgot.resend')}
            >
              {loading ? (
                <ActivityIndicator color="#A8505A" size="small" />
              ) : (
                <Text style={[styles.resendText, (resendCoolingDown || loading) && styles.resendTextDisabled]}>
                  {t('forgot.resend')}
                </Text>
              )}
            </TouchableOpacity>

            {/* Rate limited inside confirmation — show below resend */}
            {showRateLimited && (
              <View style={styles.serverCard} accessibilityRole="alert">
                <Text style={styles.serverCardText}>{t('forgot.rateLimited')}</Text>
              </View>
            )}

            {/* Back to Login */}
            <TouchableOpacity
              style={styles.backLink}
              onPress={onDone}
              accessibilityRole="button"
              accessibilityLabel={t('forgot.backToLogin')}
            >
              <Text style={styles.backLinkText}>{t('forgot.backToLogin')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ── Form state (idle / submitting / error) ── */
          <>
            {/* Offline strip — warm-neutral, not red, not a modal (spec §2.2) */}
            {showOffline && (
              <View style={styles.offlineStrip} accessibilityLiveRegion="polite">
                <Text style={styles.offlineText}>{t('forgot.offline')}</Text>
              </View>
            )}

            {/* Rate-limited card */}
            {showRateLimited && (
              <View style={styles.serverCard} accessibilityRole="alert">
                <Text style={styles.serverCardText}>{t('forgot.rateLimited')}</Text>
              </View>
            )}

            {/* Server error card */}
            {showServerError && (
              <View style={styles.serverCard} accessibilityRole="alert">
                <Text style={styles.serverCardText}>{t('forgot.serverError')}</Text>
              </View>
            )}

            <Text style={styles.title}>{t('forgot.title')}</Text>
            <Text style={styles.subtitle}>{t('forgot.subtitle')}</Text>

            {/* Email field */}
            <Text style={styles.label}>{t('forgot.emailLabel')}</Text>
            <TextInput
              testID="forgot-email"
              style={[styles.input, emailError ? styles.inputError : null]}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailError) setEmailError(null);
              }}
              onBlur={handleEmailBlur}
              placeholder={t('forgot.emailPlaceholder')}
              placeholderTextColor="#94818A"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel={t('forgot.emailLabel')}
              editable={!loading}
            />
            {emailError && (
              <Text style={styles.fieldError} accessibilityRole="alert">
                {emailError}
              </Text>
            )}

            {/* Submit button */}
            <TouchableOpacity
              testID="forgot-submit"
              style={[styles.submitButton, !canSubmit && styles.buttonDisabled]}
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel={t('forgot.submit')}
            >
              {loading ? (
                <ActivityIndicator color="#FBF6F1" size="small" />
              ) : (
                <Text style={styles.submitText}>{t('forgot.submit')}</Text>
              )}
            </TouchableOpacity>

            {/* Back to Login link */}
            <TouchableOpacity
              style={styles.backLink}
              onPress={onBackToLogin}
              accessibilityRole="button"
              accessibilityLabel={t('forgot.backToLogin')}
            >
              <Text style={styles.backLinkText}>{t('forgot.backToLogin')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FBF6F1' },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },

  // ── Confirmation block ──
  confirmationBlock: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 32,
  },
  confirmTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 22,
    color: '#6E9079',
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmBody: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#3A2A30',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    paddingHorizontal: 8,
  },

  // ── Resend ──
  resendButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  resendText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#8E3A44',
    textDecorationLine: 'underline',
  },
  resendTextDisabled: {
    color: '#94818A',
    textDecorationLine: 'none',
  },

  // ── Feedback strips / cards ──
  offlineStrip: {
    backgroundColor: '#FBF3EE',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  offlineText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
  },
  serverCard: {
    backgroundColor: '#FBF3EE',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  serverCardText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
    textAlign: 'center',
  },

  // ── Form ──
  title: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 24,
    color: '#3A2A30',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#5F4A52',
    marginBottom: 24,
    lineHeight: 22,
  },
  label: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#3A2A30',
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#3A2A30',
    backgroundColor: '#FFFFFF',
    marginBottom: 4,
  },
  inputError: {
    borderColor: '#A8505A',
  },
  fieldError: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#A8505A',
    marginBottom: 8,
  },

  // ── Submit button ──
  submitButton: {
    height: 48,
    backgroundColor: '#A8505A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 16,
  },
  submitText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.45,
  },

  // ── Back link ──
  backLink: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  backLinkText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#8E3A44',
  },
});
