/**
 * LoginScreen — Sign-in screen (S4)
 *
 * All strings from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1   App background
 *   ink           #3A2A30   Primary text
 *   ink/soft      #5F4A52   Secondary / error copy
 *   rose/600      #A8505A   Primary button fill
 *   hairline      #EBE1D9   Dividers
 */

import React, { useState, useMemo, useEffect } from 'react';
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
  handleSignIn,
  type SignInOutcome,
} from './loginScreenLogic';
import { InMemoryTokenStorage, type TokenStorage } from './tokenStorage';
import { createAuthClient } from './authApiClient';
import { useT } from '../i18n/LanguageContext';
import { takePendingLoginSuccessToast } from './loginSuccessToast';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LoginScreenProps {
  /** Base URL for the auth API (e.g. "https://api.example.com"). */
  apiBaseUrl: string;
  /** Stable per-install device id (client-generated, not a hardware id — §D/C5). */
  deviceId?: string;
  /** Called after tokens are stored — navigate to Calendar Home or S3 consent. */
  onSuccess: () => void;
  /** Navigate to Forgot Password screen (S5). */
  onForgotPassword: () => void;
  /** Navigate to Sign-up screen (S2). */
  onCreateAccount: () => void;
  /**
   * Token storage implementation.
   * Defaults to InMemoryTokenStorage; production binding is SecureTokenStorage.
   */
  tokenStorage?: TokenStorage;
  /**
   * @deprecated — locale is now read from LanguageContext via useT().
   * This prop is kept for backward compatibility but is ignored.
   */
  locale?: string;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function LoginScreen({
  apiBaseUrl,
  deviceId,
  onSuccess,
  onForgotPassword,
  onCreateAccount,
  tokenStorage,
}: LoginScreenProps): React.JSX.Element {
  const { t } = useT();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Validation state (shown on blur / submit attempt)
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Async state
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<SignInOutcome | null>(null);

  // §3.3 success banner — seeded from the cleared-on-read pending store when
  // LoginScreen mounts after a successful password reset.  The store is written
  // by RootNavigator's performLogout onComplete just before navigation.reset,
  // so the message is always available by the time this effect runs.
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  useEffect(() => {
    const msg = takePendingLoginSuccessToast();
    if (msg) setSuccessBanner(msg);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authClient = useMemo(() => createAuthClient(apiBaseUrl), [apiBaseUrl]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storage = useMemo(() => tokenStorage ?? new InMemoryTokenStorage(), [tokenStorage]);
  const canSubmit = validatePasswordField(password) && validateEmailField(email) === null;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleEmailBlur() {
    setEmailError(
      submitAttempted || email.length > 0
        ? validateEmailField(email) !== null ? t('login.emailHint') : null
        : null,
    );
  }

  async function onSubmit() {
    setSubmitAttempted(true);
    const emailErr = validateEmailField(email);
    if (emailErr) {
      setEmailError(t('login.emailHint'));
      return;
    }
    if (!validatePasswordField(password)) return;

    setLoading(true);
    setOutcome(null);

    const result = await handleSignIn({
      email,
      password,
      deviceId,
      client: authClient,
      storage,
    });

    setLoading(false);

    if (result.kind === 'success') {
      onSuccess();
      return;
    }
    setOutcome(result);
  }

  // ─── Error rendering ────────────────────────────────────────────────────────

  const showWrongCreds = outcome?.kind === 'wrong_credentials';
  const showOffline = outcome?.kind === 'network_error';
  const showServerCard =
    outcome?.kind === 'server_error' || outcome?.kind === 'rate_limited';

  function serverCardText(): string {
    if (outcome?.kind === 'rate_limited') return t('login.rateLimited');
    if (outcome?.kind === 'server_error') return t('login.serverError');
    return '';
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
        {/* §3.3 reset-success banner — shown once on mount after password reset */}
        {successBanner !== null && (
          <View
            style={styles.successBanner}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="login-success-banner"
          >
            <Text style={styles.successBannerText}>{successBanner}</Text>
          </View>
        )}

        {showOffline && (
          <View style={styles.offlineStrip} accessibilityLiveRegion="polite">
            <Text style={styles.offlineText}>{t('login.offline')}</Text>
          </View>
        )}

        {showServerCard && (
          <View style={styles.serverCard} accessibilityRole="alert">
            <Text style={styles.serverCardText}>{serverCardText()}</Text>
          </View>
        )}

        <Text style={styles.title}>{t('login.title')}</Text>

        <Text style={styles.label}>{t('login.emailLabel')}</Text>
        <TextInput
          testID="login-email"
          style={[styles.input, emailError ? styles.inputError : null]}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (emailError) setEmailError(null);
          }}
          onBlur={handleEmailBlur}
          placeholder={t('login.emailPlaceholder')}
          placeholderTextColor="#94818A"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel={t('login.emailLabel')}
        />
        {emailError && (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {emailError}
          </Text>
        )}

        <Text style={styles.label}>{t('login.passwordLabel')}</Text>
        <View style={styles.passwordRow}>
          <TextInput
            testID="login-password"
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="current-password"
            textContentType="password"
            accessibilityLabel={t('login.passwordLabel')}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>

        {showWrongCreds && (
          <TouchableOpacity onPress={onForgotPassword} accessibilityRole="link">
            <Text style={styles.wrongCreds} accessibilityRole="alert">
              {t('login.wrongCredentials')}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          testID="login-submit"
          style={[styles.primaryButton, (!canSubmit || loading) && styles.primaryButtonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit || loading}
          accessibilityRole="button"
          accessibilityLabel={t('login.submit')}
          accessibilityState={{ disabled: !canSubmit || loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>{t('login.submit')}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('general.or')}</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.googleButton, styles.googleButtonDisabled]}
          disabled={true}
          accessibilityRole="button"
          accessibilityLabel={`${t('login.googleCta')} (${t('login.comingSoon')})`}
          accessibilityState={{ disabled: true }}
        >
          <View style={styles.googleButtonInner}>
            <Text style={[styles.googleButtonText, styles.googleButtonTextDisabled]}>
              {`G  ${t('login.googleCta')}`}
            </Text>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonBadgeText}>
                {t('login.comingSoon')}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quietLink}
          onPress={onForgotPassword}
          accessibilityRole="link"
        >
          <Text style={styles.quietLinkText}>{t('login.forgotPassword')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quietLink}
          onPress={onCreateAccount}
          accessibilityRole="link"
        >
          <Text style={styles.quietLinkText}>{t('login.createAccount')}</Text>
        </TouchableOpacity>
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
    marginBottom: 32,
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

  wrongCreds: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
    marginTop: 8,
    marginBottom: 4,
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

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#EBE1D9' },
  dividerText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A',
    marginHorizontal: 12,
  },

  googleButton: {
    height: 52,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  googleButtonDisabled: {
    opacity: 0.55,
  },
  googleButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  googleButtonText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#3A2A30',
  },
  googleButtonTextDisabled: {
    color: '#94818A',
  },
  comingSoonBadge: {
    backgroundColor: '#EBE1D9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comingSoonBadgeText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 11,
    color: '#5F4A52',
  },

  quietLink: { marginTop: 16, alignItems: 'center' },
  quietLinkText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
  },

  successBanner: {
    backgroundColor: '#EAF5EC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A8D5B0',
    padding: 12,
    marginBottom: 12,
  },
  successBannerText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#2D6A35',
  },

  offlineStrip: {
    backgroundColor: '#FBF3EE',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
    flex: 1,
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
