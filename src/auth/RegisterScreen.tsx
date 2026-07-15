/**
 * RegisterScreen — Sign-up screen (S2)
 *
 * ห้องแม่ Phase 2 B1 reskin (mother-room-phase2-rollout.md §4.1 RegisterScreen).
 * All strings from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * Non-enumeration contract (§E/C7 — DO NOT BREAK):
 *   On success (202), the screen ALWAYS navigates to VerifyEmailScreen
 *   with the same "check your inbox" message regardless of whether the email
 *   was new or colliding. There is NEVER any "email already taken" feedback.
 *
 * Reskin changes (all tokens — NO inline hex outside tokens.ts):
 *   - All inputs: T.input.* tokens (ivory-200 bg, roselle placeholder)
 *   - Primary CTA: T.button.primary.* amber-700
 *   - disabled bg: rgba(154,95,10,0.45) (NOT old rose #DDA0A6)
 *   - offlineStrip/serverCard: T.color.surface.subtle (NOT white/#FBF3EE)
 *   - All fonts: Sarabun (NO IBMPlexSans)
 *   - All colors via T.color.* tokens (no banned hex)
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
  validateEmailField,
  validatePasswordField,
  handleRegister,
  type RegisterOutcome,
} from './registerScreenLogic';
import { createAuthClient } from './authApiClient';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RegisterScreenProps {
  /** Base URL for the auth API. */
  apiBaseUrl: string;
  /** Stable per-install device id (client-generated, NOT a hardware id — §D/C5). */
  deviceId?: string;
  /** Called after 202 success — navigate to VerifyEmailScreen. */
  onSuccess: (email: string) => void;
  /** Navigate back to Sign-in screen (S4). */
  onSignIn: () => void;
  /**
   * @deprecated — locale is now read from LanguageContext via useT().
   * This prop is kept for backward compatibility but is ignored.
   */
  locale?: string;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function RegisterScreen({
  apiBaseUrl,
  deviceId,
  onSuccess,
  onSignIn,
}: RegisterScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authClient = useMemo(() => createAuthClient(apiBaseUrl), [apiBaseUrl]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<RegisterOutcome | null>(null);

  const canSubmit = validateEmailField(email) === null && validatePasswordField(password);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleEmailBlur() {
    setEmailError(
      submitAttempted || email.length > 0
        ? validateEmailField(email) !== null ? t('register.emailHint') : null
        : null,
    );
  }

  async function onSubmit() {
    setSubmitAttempted(true);

    const emailErr = validateEmailField(email);
    if (emailErr) {
      setEmailError(t('register.emailHint'));
      return;
    }
    if (!validatePasswordField(password)) return;

    setLoading(true);
    setOutcome(null);

    const result = await handleRegister({
      email,
      password,
      locale: locale,
      deviceId,
      client: authClient,
    });

    setLoading(false);

    if (result.kind === 'success') {
      onSuccess(email);
      return;
    }
    setOutcome(result);
  }

  // ─── Error rendering helpers ────────────────────────────────────────────────

  const showOffline = outcome?.kind === 'network_error';
  const showServerCard =
    outcome?.kind === 'server_error' || outcome?.kind === 'rate_limited';
  const showPasswordError = outcome?.kind === 'validation';

  function serverCardText(): string {
    if (outcome?.kind === 'rate_limited') return t('register.rateLimited');
    if (outcome?.kind === 'server_error') return t('register.serverError');
    return '';
  }

  function passwordErrorText(): string {
    if (outcome?.kind !== 'validation') return '';
    return outcome.code === 'password_too_short'
      ? t('register.passwordTooShort')
      : t('register.passwordBreached');
  }

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
        {showOffline && (
          <View style={styles.offlineStrip} accessibilityLiveRegion="polite">
            <Text style={styles.offlineText}>{t('register.offline')}</Text>
          </View>
        )}

        {showServerCard && (
          <View style={styles.serverCard} accessibilityRole="alert">
            <Text style={styles.serverCardText}>{serverCardText()}</Text>
          </View>
        )}

        <Text style={styles.title}>{t('register.title')}</Text>
        <Text style={styles.subtitle}>{t('register.subtitle')}</Text>

        <Text style={styles.label}>{t('register.emailLabel')}</Text>
        <TextInput
          testID="register-email"
          style={[styles.input, emailError ? styles.inputError : null]}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (emailError) setEmailError(null);
            if (outcome) setOutcome(null);
          }}
          onBlur={handleEmailBlur}
          placeholder={t('register.emailPlaceholder')}
          placeholderTextColor={T.input.placeholder}       // #7A3A52 (NOT #94818A — BANNED)
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel={t('register.emailLabel')}
        />
        {emailError && (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {emailError}
          </Text>
        )}

        <Text style={styles.label}>{t('register.passwordLabel')}</Text>
        <View style={styles.passwordRow}>
          <TextInput
            testID="register-password"
            style={[
              styles.input,
              styles.passwordInput,
              showPasswordError ? styles.inputError : null,
            ]}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (outcome?.kind === 'validation') setOutcome(null);
            }}
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel={t('register.passwordLabel')}
            placeholderTextColor={T.input.placeholder}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            accessibilityLabel={showPassword ? t('register.hidePassword') : t('register.showPassword')}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.eyeIcon} accessibilityElementsHidden={true}>
              {showPassword ? '🙈' : '👁'}
            </Text>
          </TouchableOpacity>
        </View>

        {showPasswordError ? (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {passwordErrorText()}
          </Text>
        ) : (
          <Text style={styles.passwordHint}>{t('register.passwordHint')}</Text>
        )}

        <TouchableOpacity
          testID="register-submit"
          style={[styles.primaryButton, (!canSubmit || loading) && styles.primaryButtonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit || loading}
          accessibilityRole="button"
          accessibilityLabel={t('register.submit')}
          accessibilityState={{ disabled: !canSubmit || loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={T.color.text.onDark} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>{t('register.submit')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quietLink}
          onPress={onSignIn}
          accessibilityRole="link"
        >
          <Text style={styles.quietLinkText}>{t('register.signIn')}</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>{t('register.disclaimer')}</Text>
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
    padding: T.spacing[6],                            // 24dp
  },

  title: {
    fontFamily: T.type.heading1.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.heading1.size,                   // 24sp
    lineHeight: T.type.heading1.lineHeight,           // 39
    color: T.color.text.heading,                      // #4A2230
    marginBottom: T.spacing[1],                       // 4dp
    letterSpacing: 0,
  },
  subtitle: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    marginBottom: 28,                                  // 28dp (between spacing[6]=24 and spacing[8]=32)
    letterSpacing: 0,
  },

  label: {
    fontFamily: T.type.label.fontFamily,              // Sarabun-SemiBold
    fontSize: T.type.label.size,                      // 15sp
    lineHeight: T.type.label.lineHeight,              // 24
    color: T.color.text.botanical,                    // #2F5042 jade-800 (8.36:1 AAA)
    marginBottom: T.spacing[1],                       // 4dp
    marginTop: T.spacing[4],                          // 16dp
    letterSpacing: 0,
  },

  input: {
    height: T.input.height,                           // 52dp
    borderWidth: 1,
    borderColor: T.input.border.default,              // #E8DDD5
    borderRadius: T.radius.md,                        // 12dp
    backgroundColor: T.input.bg,                      // #F5EDE6 (NOT white)
    paddingHorizontal: T.spacing[4],                  // 16dp
    fontSize: T.type.bodyLarge.size,                  // 17sp
    lineHeight: T.type.bodyLarge.lineHeight,          // 28
    color: T.input.text,                              // #4A2230
    fontFamily: T.type.bodyLarge.fontFamily,          // Sarabun-Regular
    letterSpacing: 0,
  },
  inputError: {
    borderColor: T.input.border.error,                // #B85C78 roselle-500
  },

  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  eyeButton: {
    position: 'absolute',
    right: 0,
    height: T.input.height,                           // 52dp
    width: T.input.height,                            // 52dp
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIcon: { fontSize: 18 },

  fieldError: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.input.errorText,                         // #7A3A52
    marginTop: T.spacing[1],                          // 4dp
    letterSpacing: 0,
  },
  passwordHint: {
    fontFamily: T.type.caption.fontFamily,            // Sarabun-Regular
    fontSize: T.type.caption.size,                    // 13sp
    lineHeight: T.type.caption.lineHeight,            // 21
    color: T.color.text.primary,                      // #7A3A52 (NOT #94818A — BANNED)
    marginTop: T.spacing[1],                          // 4dp
    letterSpacing: 0,
  },

  primaryButton: {
    height: T.button.primary.height,                  // 52dp
    backgroundColor: T.button.primary.bg,             // #9A5F0A
    borderRadius: T.button.primary.radius,            // 12dp
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: T.spacing[6],                          // 24dp
  },
  primaryButtonDisabled: {
    backgroundColor: T.scrim.amber,                   // amber-700 at 45% (token, NOT inline rgba, NOT #DDA0A6)
  },
  primaryButtonText: {
    fontFamily: T.type.label.fontFamily,              // Sarabun-SemiBold
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.onDark,                       // #FFFFFF
    letterSpacing: 0,
  },

  quietLink: { marginTop: T.spacing[5], alignItems: 'center' },
  quietLinkText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    letterSpacing: 0,
  },

  disclaimer: {
    fontFamily: T.type.micro.fontFamily,              // Sarabun-Regular
    fontSize: T.type.micro.size,                      // 11sp
    lineHeight: T.type.micro.lineHeight,              // 18
    color: T.color.text.primary,                      // #7A3A52 (NOT #94818A)
    textAlign: 'center',
    marginTop: T.spacing[5],                          // 20dp
    marginBottom: T.spacing[2],                       // 8dp
    letterSpacing: 0,
  },

  offlineStrip: {
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (NOT #FBF3EE)
    borderRadius: T.radius.sm,                        // 6dp
    padding: T.spacing[3],                            // 12dp
    marginBottom: T.spacing[3],                       // 12dp
  },
  offlineText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    letterSpacing: 0,
  },
  serverCard: {
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (NOT white)
    borderRadius: T.radius.md,                        // 12dp
    padding: T.spacing[4],                            // 16dp
    marginBottom: T.spacing[4],                       // 16dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,             // #E8DDD5
  },
  serverCardText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
    letterSpacing: 0,
  },
});
