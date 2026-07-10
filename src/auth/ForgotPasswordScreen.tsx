/**
 * ForgotPasswordScreen (S5) — Forgot / Reset Password entry screen.
 *
 * ห้องแม่ Phase 2 B1 reskin (mother-room-phase2-rollout.md §4.1 ForgotPasswordScreen).
 * Maps to: POST /v1/auth/forgot-password → always 202 (non-enumerating)
 *
 * All strings from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * States (spec §2.2):
 *   idle          — email field; submit disabled until validateEmailField passes
 *   submitting    — spinner; field + button disabled; double-submit guard
 *   confirmation  — jade-100 wash confirmation block + back-to-login + resend
 *   rate_limited  — calm inline card; form stays; submit re-enabled
 *   error_network — warm-neutral offline strip; form stays
 *   error_server  — calm centered card; form stays
 *
 * SEC-INV-1 (non-enumeration): ONE neutral confirmation regardless of input.
 *
 * Reskin changes (all tokens — NO inline hex outside tokens.ts):
 *   - Input: T.input.* (ivory-200 bg, 52dp height, roselle-500 error border)
 *   - Submit button: T.button.primary.* amber-700, 52dp height
 *   - confirmationBlock bg: T.color.surface.wash.jade jade-100
 *   - confirmTitle color: T.color.text.botanical jade-800
 *   - offlineStrip: T.color.surface.subtle
 *   - serverCard: T.color.surface.subtle + T.color.surface.divider border
 *   - All fonts: Sarabun; no IBMPlex; no banned hex
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
import { T } from '../theme/tokens';

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
                <ActivityIndicator color={T.button.primary.bg} size="small" />
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
            {/* Offline strip */}
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
              placeholderTextColor={T.input.placeholder}    // #7A3A52 (NOT #94818A)
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
              accessibilityState={{ disabled: !canSubmit, busy: loading }}
            >
              {loading ? (
                <ActivityIndicator color={T.color.text.onDark} size="small" />
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

// ─── Styles — ALL values from T.* tokens; NO inline hex ──────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: T.color.surface.base,           // #FBF6F1
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: T.spacing[6],                  // 24dp
    paddingTop: T.spacing[8],                         // 32dp
    paddingBottom: T.spacing[10],                     // 40dp
  },

  // ── Confirmation block (jade-100 wash) ──
  confirmationBlock: {
    flex: 1,
    alignItems: 'center',
    paddingTop: T.spacing[8],                         // 32dp
  },
  confirmTitle: {
    fontFamily: T.type.heading2.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.heading2.size,                   // 20sp
    lineHeight: T.type.heading2.lineHeight,           // 33
    color: T.color.text.botanical,                    // #2F5042 jade-800 (success context)
    marginBottom: T.spacing[3],                       // 12dp
    textAlign: 'center',
    letterSpacing: 0,
  },
  confirmBody: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: T.spacing[2],                  // 8dp
    letterSpacing: 0,
  },

  // ── Resend ──
  resendButton: {
    paddingVertical: T.spacing[2],                    // 8dp
    paddingHorizontal: T.spacing[6],                  // 24dp
    marginBottom: T.spacing[2],                       // 8dp
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resendText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52 (NOT old rose/700 #8E3A44)
    textDecorationLine: 'underline' as const,
    letterSpacing: 0,
  },
  resendTextDisabled: {
    color: T.color.text.primary,                      // still roselle-700, just opacity-ed via parent
    textDecorationLine: 'none' as const,
  },

  // ── Feedback strips / cards ──
  offlineStrip: {
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (NOT #FBF3EE)
    borderRadius: T.radius.sm,                        // 6dp
    paddingVertical: T.spacing[2],                    // 8dp (approx)
    paddingHorizontal: T.spacing[3],                  // 12dp (approx, was 14)
    marginBottom: T.spacing[3],                       // 12dp
  },
  offlineText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    letterSpacing: 0,
  },
  serverCard: {
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (NOT #FBF3EE / white)
    borderRadius: T.radius.sm,                        // 6dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,             // #E8DDD5
    paddingVertical: T.spacing[3],                    // 12dp
    paddingHorizontal: T.spacing[3],                  // 12dp (approx)
    marginBottom: T.spacing[3],                       // 12dp
  },
  serverCardText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    textAlign: 'center',
    letterSpacing: 0,
  },

  // ── Form ──
  title: {
    fontFamily: T.type.heading1.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.heading1.size,                   // 24sp
    lineHeight: T.type.heading1.lineHeight,           // 39
    color: T.color.text.heading,                      // #4A2230
    marginBottom: T.spacing[2],                       // 8dp
    letterSpacing: 0,
  },
  subtitle: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    marginBottom: T.spacing[6],                       // 24dp
    letterSpacing: 0,
  },
  label: {
    fontFamily: T.type.label.fontFamily,              // Sarabun-SemiBold
    fontSize: T.type.label.size,                      // 15sp
    lineHeight: T.type.label.lineHeight,              // 24
    color: T.color.text.botanical,                    // #2F5042 jade-800
    marginBottom: T.spacing[1],                       // 4dp
    letterSpacing: 0,
  },
  input: {
    height: T.input.height,                           // 52dp
    borderWidth: 1,
    borderColor: T.input.border.default,              // #E8DDD5
    borderRadius: T.radius.md,                        // 12dp
    paddingHorizontal: T.spacing[3],                  // 12dp
    fontFamily: T.type.bodyLarge.fontFamily,          // Sarabun-Regular
    fontSize: T.type.bodyLarge.size,                  // 17sp
    lineHeight: T.type.bodyLarge.lineHeight,          // 28
    color: T.input.text,                              // #4A2230
    backgroundColor: T.input.bg,                      // #F5EDE6 (NOT white)
    marginBottom: T.spacing[1],                       // 4dp
    letterSpacing: 0,
  },
  inputError: {
    borderColor: T.input.border.error,                // #B85C78 roselle-500
  },
  fieldError: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.input.errorText,                         // #7A3A52
    marginBottom: T.spacing[2],                       // 8dp
    letterSpacing: 0,
  },

  // ── Submit button ──
  submitButton: {
    height: T.button.primary.height,                  // 52dp
    backgroundColor: T.button.primary.bg,             // #9A5F0A amber-700
    borderRadius: T.button.primary.radius,            // 12dp
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.spacing[4],                          // 16dp
    marginBottom: T.spacing[4],                       // 16dp
  },
  submitText: {
    fontFamily: T.type.label.fontFamily,              // Sarabun-SemiBold
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.onDark,                       // #FFFFFF
    letterSpacing: 0,
  },
  buttonDisabled: {
    opacity: 0.45,
  },

  // ── Back link ──
  backLink: {
    alignItems: 'center',
    paddingVertical: T.spacing[2],                    // 8dp (≥48dp via minHeight)
    marginTop: T.spacing[1],                          // 4dp
    minHeight: 48,
    justifyContent: 'center',
  },
  backLinkText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52 (NOT old rose #8E3A44)
    letterSpacing: 0,
  },
});

// Suppress unused import warning for RESEND_COOLDOWN_MS (kept for future use)
void RESEND_COOLDOWN_MS;
