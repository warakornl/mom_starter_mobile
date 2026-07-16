/**
 * LoginScreen — Sign-in screen (S4)
 *
 * ห้องแม่ Phase 2 B1 reskin (mother-room-phase2-rollout.md §4.1 LoginScreen).
 * All strings from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * Reskin changes (all tokens — NO inline hex outside tokens.ts):
 *   - Input bg: T.input.bg ivory-200 (#F5EDE6, NOT white)
 *   - placeholderTextColor: T.input.placeholder roselle-700 (NOT #94818A — BANNED)
 *   - inputError border: T.input.border.error roselle-500 (NOT old #C0762B)
 *   - fieldError/wrongCreds: T.input.errorText roselle-700
 *   - Primary CTA: T.button.primary.* amber-700
 *   - primaryButtonDisabled: rgba(154,95,10,0.45) (NOT old rose #DDA0A6)
 *   - dividerLine: T.color.surface.divider; dividerText: T.color.text.primary
 *   - Google button: T.color.surface.subtle bg (NOT white)
 *   - comingSoonBadge: T.color.surface.divider bg; T.color.text.primary text
 *   - successBanner bg: T.color.surface.wash.jade jade-100; text: T.color.text.botanical jade-800
 *   - offlineStrip bg: T.color.surface.subtle
 *   - serverCard bg: T.color.surface.subtle; border: T.color.surface.divider
 *   - Fonts: Sarabun throughout (no IBMPlexSans)
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
import { T } from '../theme/tokens';
import { EyeIcon } from '../icons/EyeIcon';
import { EyeOffIcon } from '../icons/EyeOffIcon';

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
  // LoginScreen mounts after a successful password reset.
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
        {/* §3.3 reset-success banner — jade-100 wash (7.18:1 AAA on jade-800 text) */}
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
          placeholderTextColor={T.input.placeholder}        // #7A3A52 — NOT #94818A
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
            placeholderTextColor={T.input.placeholder}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View accessibilityElementsHidden={true}>
              {showPassword ? (
                <EyeOffIcon color={T.color.text.primary} size={20} />
              ) : (
                <EyeIcon color={T.color.text.primary} size={20} />
              )}
            </View>
          </TouchableOpacity>
        </View>

        {/* 🟡 UX standardization: Register shows a short password hint under the
            field; Login had none. Reusing 'register.passwordHint' (generic copy,
            no Login-specific key exists yet) rather than inventing an untyped string. */}
        {!showWrongCreds && (
          <Text style={styles.passwordHint}>{t('register.passwordHint')}</Text>
        )}

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
            <ActivityIndicator color={T.color.text.onDark} size="small" />
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
            <Text style={styles.googleButtonText}>
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

// ─── Styles — ALL values from T.* tokens; NO inline hex ──────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: T.color.surface.base,        // #FBF6F1
  },
  scroll: {
    flexGrow: 1,
    padding: T.spacing[6],                         // 24dp
  },

  title: {
    fontFamily: T.type.heading1.fontFamily,        // Sarabun-SemiBold
    fontSize: T.type.heading1.size,                // 24sp
    lineHeight: T.type.heading1.lineHeight,        // 39
    color: T.color.text.heading,                   // #4A2230 roselle-900
    marginBottom: T.spacing[8],                    // 32dp
  },

  label: {
    fontFamily: T.type.label.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.label.size,                   // 15sp
    lineHeight: T.type.label.lineHeight,           // 24
    color: T.color.text.botanical,                 // #2F5042 jade-800 (8.36:1 AAA)
    marginBottom: T.spacing[1],                    // 4dp (was 6, using 4 to align to 4dp grid)
    marginTop: T.spacing[4],                       // 16dp
    letterSpacing: 0,
  },

  input: {
    height: T.input.height,                        // 52dp
    borderWidth: 1,
    borderColor: T.input.border.default,           // #E8DDD5
    borderRadius: T.radius.md,                     // 12dp
    backgroundColor: T.input.bg,                   // #F5EDE6 ivory-200 (NOT white)
    paddingHorizontal: T.spacing[4],               // 16dp
    fontSize: T.type.bodyLarge.size,               // 17sp
    lineHeight: T.type.bodyLarge.lineHeight,       // 28
    color: T.input.text,                           // #4A2230 roselle-900
    fontFamily: T.type.bodyLarge.fontFamily,       // Sarabun-Regular
    letterSpacing: 0,
  },
  inputError: {
    borderColor: T.input.border.error,             // #B85C78 roselle-500 (NOT old #C0762B)
  },

  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  eyeButton: {
    position: 'absolute',
    right: 0,
    height: T.input.height,                        // 52dp
    width: T.input.height,                         // 52dp (≥48dp tap target)
    justifyContent: 'center',
    alignItems: 'center',
  },

  fieldError: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.input.errorText,                      // #7A3A52 roselle-700
    marginTop: T.spacing[1],                       // 4dp
    letterSpacing: 0,
  },

  passwordHint: {
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular
    fontSize: T.type.caption.size,                 // 13sp
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 (NOT #94818A — BANNED)
    marginTop: T.spacing[1],                       // 4dp
    letterSpacing: 0,
  },

  wrongCreds: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52
    marginTop: T.spacing[2],                       // 8dp
    marginBottom: T.spacing[1],                    // 4dp
    letterSpacing: 0,
  },

  primaryButton: {
    height: T.button.primary.height,               // 52dp
    backgroundColor: T.button.primary.bg,          // #9A5F0A amber-700
    borderRadius: T.button.primary.radius,         // 12dp
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: T.spacing[6],                       // 24dp
  },
  primaryButtonDisabled: {
    // amber-700 at 45% opacity per spec §1.4 (NOT old rose #DDA0A6) — token, not inline rgba
    backgroundColor: T.scrim.amber,
  },
  primaryButtonText: {
    fontFamily: T.type.label.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.onDark,                    // #FFFFFF
    letterSpacing: 0,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: T.spacing[4],                  // 16dp
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: T.color.surface.divider,      // #E8DDD5
  },
  dividerText: {
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular
    fontSize: T.type.caption.size,                 // 13sp
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 (NOT #94818A — BANNED)
    marginHorizontal: T.spacing[3],                // 12dp
    letterSpacing: 0,
  },

  googleButton: {
    height: T.button.primary.height,               // 52dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,          // #E8DDD5
    borderRadius: T.radius.md,                     // 12dp
    backgroundColor: T.color.surface.subtle,       // #F5EDE6 (NOT white)
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: T.spacing[4],               // 16dp
  },
  googleButtonDisabled: {
    opacity: 0.55,
  },
  googleButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.spacing[2],                             // 8dp
  },
  googleButtonText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52 (disabled opacity via parent)
    letterSpacing: 0,
  },
  comingSoonBadge: {
    backgroundColor: T.color.surface.divider,      // #E8DDD5
    borderRadius: T.radius.sm,                     // 6dp
    paddingHorizontal: T.spacing[1],               // 4dp (approx)
    paddingVertical: 2,
  },
  comingSoonBadgeText: {
    fontFamily: T.type.micro.fontFamily,           // Sarabun-Regular
    fontSize: T.type.micro.size,                   // 11sp → type.micro
    lineHeight: T.type.micro.lineHeight,           // 18
    color: T.color.text.primary,                   // #7A3A52
    letterSpacing: 0,
  },

  quietLink: { marginTop: T.spacing[4], alignItems: 'center' },
  quietLinkText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52
    letterSpacing: 0,
  },

  // §3.3 success banner — jade-100 wash (#E4EDE7); jade-800 text (7.18:1 AAA)
  successBanner: {
    backgroundColor: T.color.surface.wash.jade,    // #E4EDE7
    borderRadius: T.radius.sm,                     // 6dp (was 8)
    borderWidth: 1,
    borderColor: T.color.surface.divider,          // #E8DDD5
    padding: T.spacing[3],                         // 12dp
    marginBottom: T.spacing[3],                    // 12dp
  },
  successBannerText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.botanical,                 // #2F5042 jade-800 (7.18:1 on jade-100 AAA)
    letterSpacing: 0,
  },

  offlineStrip: {
    backgroundColor: T.color.surface.subtle,       // #F5EDE6 (NOT #FBF3EE)
    borderRadius: T.radius.sm,                     // 6dp
    padding: T.spacing[3],                         // 12dp
    marginBottom: T.spacing[3],                    // 12dp
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52
    flex: 1,
    letterSpacing: 0,
  },
  serverCard: {
    backgroundColor: T.color.surface.subtle,       // #F5EDE6 (NOT white)
    borderRadius: T.radius.md,                     // 12dp
    padding: T.spacing[4],                         // 16dp
    marginBottom: T.spacing[4],                    // 16dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,          // #E8DDD5
  },
  serverCardText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52
    textAlign: 'center',
    letterSpacing: 0,
  },
});
