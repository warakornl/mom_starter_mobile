/**
 * RegisterScreen — Sign-up screen (S2)
 *
 * All strings from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * Non-enumeration contract (§E/C7 — DO NOT BREAK):
 *   On success (202), the screen ALWAYS navigates to VerifyEmailScreen
 *   with the same "check your inbox" message regardless of whether the email
 *   was new or colliding. There is NEVER any "email already taken" feedback.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1
 *   ink           #3A2A30
 *   ink/soft      #5F4A52
 *   ink/faint     #94818A
 *   rose/600      #A8505A
 *   rose/300      #DDA0A6
 *   hairline      #EBE1D9
 *   attention     #C0762B
 *   surface/sunk  #FBF3EE
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
          style={[styles.input, emailError ? styles.inputError : null]}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (emailError) setEmailError(null);
            if (outcome) setOutcome(null);
          }}
          onBlur={handleEmailBlur}
          placeholder={t('register.emailPlaceholder')}
          placeholderTextColor="#94818A"
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
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            accessibilityLabel={showPassword ? t('register.hidePassword') : t('register.showPassword')}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
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
          style={[styles.primaryButton, (!canSubmit || loading) && styles.primaryButtonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit || loading}
          accessibilityRole="button"
          accessibilityLabel={t('register.submit')}
          accessibilityState={{ disabled: !canSubmit || loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FBF6F1' },
  scroll: { flexGrow: 1, padding: 24 },

  title: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 28,
    lineHeight: 38,
    color: '#3A2A30',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#5F4A52',
    marginBottom: 28,
  },

  label: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
    marginBottom: 6,
    marginTop: 16,
  },

  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#3A2A30',
    fontFamily: 'IBMPlexSans-Regular',
  },
  inputError: {
    borderColor: '#C0762B',
  },

  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  eyeButton: {
    position: 'absolute',
    right: 0,
    height: 52,
    width: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIcon: { fontSize: 18 },

  fieldError: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
    marginTop: 4,
  },
  passwordHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#94818A',
    marginTop: 4,
  },

  primaryButton: {
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  primaryButtonDisabled: {
    backgroundColor: '#DDA0A6',
  },
  primaryButtonText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },

  quietLink: { marginTop: 20, alignItems: 'center' },
  quietLinkText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
  },

  disclaimer: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 8,
    lineHeight: 18,
  },

  offlineStrip: {
    backgroundColor: '#FBF3EE',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  offlineText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
  },
  serverCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EBE1D9',
  },
  serverCardText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#3A2A30',
    textAlign: 'center',
  },
});
