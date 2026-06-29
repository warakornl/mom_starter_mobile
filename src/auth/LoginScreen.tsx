/**
 * LoginScreen — Sign-in screen (S4)
 *
 * Renders the email + masked-password form, the three distinct error states,
 * the "Forgot password?" and "Create account" quiet links, and a Google
 * placeholder button (per auth-login-ui.md §5.1–§5.4).
 *
 * ── No render tests in this file ─────────────────────────────────────────────
 * The project has no React / React Native installed (package.json has no
 * "react" or "react-native" dependency) and Jest is configured for the 'node'
 * environment. Adding @testing-library/react-native would require
 * react-test-renderer, Metro transforms, and babel-preset-expo — out of scope
 * for this auth slice. The decision is intentional and documented here.
 *
 * What IS tested (in loginScreenLogic.test.ts, 21 tests):
 *   • validateEmailField       (blur-time input sanity)
 *   • validatePasswordField    (submit-readiness gate)
 *   • loginStrings             (th/en i18n completeness + non-enumeration)
 *   • handleSignIn             (API call → storage → typed outcome)
 *
 * What is NOT tested (render / interaction):
 *   • The eye-icon show/hide toggle
 *   • Navigation callbacks (onForgotPassword, onCreateAccount, onSuccess)
 *   • Loading-spinner while async
 *   • Error state rendering (offline strip · server card · wrong-creds inline)
 *
 * These are validated by the UX spec + manual / visual QA, and would be added
 * when a RN testing framework is installed (e.g. @testing-library/react-native
 * with the Expo Jest preset).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── Dependencies (not yet installed — needed when Expo is scaffolded) ─────────
 *   npm install react react-native
 *   npx expo install expo-secure-store   (for real token storage binding)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1   App background
 *   ink           #3A2A30   Primary text
 *   ink/soft      #5F4A52   Secondary / error copy
 *   rose/600      #A8505A   Primary button fill
 *   hairline      #EBE1D9   Dividers
 */

// React and React Native are listed as peer deps — not installed yet.
// This file is excluded from the current ts-jest test run because no test
// file imports it. Add to tsconfig.json "jsx": "react-native" when RN lands.
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
  handleSignIn,
  loginStrings,
  type SignInOutcome,
} from './loginScreenLogic';
import { InMemoryTokenStorage, type TokenStorage } from './tokenStorage';
import { createAuthClient } from './authApiClient';
import type { Locale } from './types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LoginScreenProps {
  /** Base URL for the auth API (e.g. "https://api.example.com"). */
  apiBaseUrl: string;
  /** Current app locale — drives which `loginStrings` set is shown. */
  locale: Locale;
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
   * Defaults to InMemoryTokenStorage; production binding is SecureTokenStorage
   * (expo-secure-store, SEC-HOOK §A/C4). App.tsx injects SecureTokenStorage.
   */
  tokenStorage?: TokenStorage;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function LoginScreen({
  apiBaseUrl,
  locale,
  deviceId,
  onSuccess,
  onForgotPassword,
  onCreateAccount,
  tokenStorage,
}: LoginScreenProps): React.JSX.Element {
  const s = loginStrings[locale];

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

  // Stable references — recreating these on every render would cause unnecessary
  // HTTP client instances and could break the storage reference identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authClient = useMemo(() => createAuthClient(apiBaseUrl), [apiBaseUrl]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storage = useMemo(() => tokenStorage ?? new InMemoryTokenStorage(), [tokenStorage]);
  const canSubmit = validatePasswordField(password) && validateEmailField(email) === null;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleEmailBlur() {
    setEmailError(
      submitAttempted || email.length > 0
        ? validateEmailField(email) !== null ? s.emailHint : null
        : null,
    );
  }

  async function onSubmit() {
    setSubmitAttempted(true);
    const emailErr = validateEmailField(email);
    if (emailErr) {
      setEmailError(s.emailHint);
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

  /** inline below the password field — wrong-credentials */
  const showWrongCreds = outcome?.kind === 'wrong_credentials';

  /** warm-neutral inline strip — offline */
  const showOffline = outcome?.kind === 'network_error';

  /** calm centered card — server error or rate-limited */
  const showServerCard =
    outcome?.kind === 'server_error' || outcome?.kind === 'rate_limited';

  function serverCardText(): string {
    if (outcome?.kind === 'rate_limited') return s.rateLimited;
    if (outcome?.kind === 'server_error') return s.serverError;
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
        {/* Offline strip (§7.2) — warm-neutral, not red, not a modal */}
        {showOffline && (
          <View style={styles.offlineStrip} accessibilityLiveRegion="polite">
            <Text style={styles.offlineText}>{s.offline}</Text>
          </View>
        )}

        {/* Server-error / rate-limited card (§7.2) — calm centered */}
        {showServerCard && (
          <View style={styles.serverCard} accessibilityRole="alert">
            <Text style={styles.serverCardText}>{serverCardText()}</Text>
          </View>
        )}

        <Text style={styles.title}>{s.title}</Text>

        {/* Email field */}
        <Text style={styles.label}>{s.emailLabel}</Text>
        <TextInput
          style={[styles.input, emailError ? styles.inputError : null]}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (emailError) setEmailError(null);
          }}
          onBlur={handleEmailBlur}
          placeholder={s.emailPlaceholder}
          placeholderTextColor="#94818A"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel={s.emailLabel}
        />
        {emailError && (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {emailError}
          </Text>
        )}

        {/* Password field + show/hide eye */}
        <Text style={styles.label}>{s.passwordLabel}</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="current-password"
            textContentType="password"
            accessibilityLabel={s.passwordLabel}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            accessibilityLabel={showPassword ? s.hidePassword : s.showPassword}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {/* Icon placeholder — swap for a real eye icon when assets land */}
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>

        {/* Wrong-credentials inline — under password, non-enumerating (§E/C7/§7.2) */}
        {showWrongCreds && (
          <TouchableOpacity onPress={onForgotPassword} accessibilityRole="link">
            <Text style={styles.wrongCreds} accessibilityRole="alert">
              {s.wrongCredentials}
            </Text>
          </TouchableOpacity>
        )}

        {/* Primary action */}
        <TouchableOpacity
          style={[styles.primaryButton, (!canSubmit || loading) && styles.primaryButtonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit || loading}
          accessibilityRole="button"
          accessibilityLabel={s.submit}
          accessibilityState={{ disabled: !canSubmit || loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>{s.submit}</Text>
          )}
        </TouchableOpacity>

        {/* "or" divider (§5.4) */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{locale === 'th' ? 'หรือ' : 'or'}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google button placeholder (§5.4 — disabled until official SDK is integrated) */}
        <TouchableOpacity
          style={[styles.googleButton, styles.googleButtonDisabled]}
          disabled={true}
          accessibilityRole="button"
          accessibilityLabel={
            locale === 'th'
              ? 'ดำเนินการต่อด้วย Google (เร็วๆ นี้)'
              : 'Continue with Google (coming soon)'
          }
          accessibilityState={{ disabled: true }}
        >
          <View style={styles.googleButtonInner}>
            <Text style={[styles.googleButtonText, styles.googleButtonTextDisabled]}>
              {locale === 'th'
                ? 'G  ดำเนินการต่อด้วย Google'
                : 'G  Continue with Google'}
            </Text>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonBadgeText}>
                {locale === 'th' ? 'เร็วๆ นี้' : 'Coming soon'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Quiet links */}
        <TouchableOpacity
          style={styles.quietLink}
          onPress={onForgotPassword}
          accessibilityRole="link"
        >
          <Text style={styles.quietLinkText}>{s.forgotPassword}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quietLink}
          onPress={onCreateAccount}
          accessibilityRole="link"
        >
          <Text style={styles.quietLinkText}>{s.createAccount}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles (design-system.md tokens) ────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FBF6F1' /* bg/warm-milk */ },
  scroll: { flexGrow: 1, padding: 24 },

  title: {
    fontFamily: 'IBMPlexSans-SemiBold', // design-system §2 — headline
    fontSize: 28,
    lineHeight: 38,
    color: '#3A2A30', // ink
    marginBottom: 32,
  },

  label: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft
    marginBottom: 6,
    marginTop: 16,
  },

  input: {
    height: 52, // min-height per design-system §5.1
    borderWidth: 1,
    borderColor: '#EBE1D9', // hairline
    borderRadius: 12, // design-system §5.1 pill
    backgroundColor: '#FFFFFF', // surface/page
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#3A2A30', // ink
    fontFamily: 'IBMPlexSans-Regular',
  },
  inputError: {
    borderColor: '#C0762B', // status/attention — non-red per design-system §1.4
  },

  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  eyeButton: {
    position: 'absolute',
    right: 0,
    height: 52,
    width: 52, // ≥48 touch target §5.1
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIcon: { fontSize: 18 },

  fieldError: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft — non-blaming, never red
    marginTop: 4,
  },

  wrongCreds: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft — §7.2: never red
    marginTop: 8,
    marginBottom: 4,
  },

  primaryButton: {
    height: 52,
    backgroundColor: '#A8505A', // rose/600
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  primaryButtonDisabled: {
    backgroundColor: '#DDA0A6', // rose/300
  },
  primaryButtonText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16, // space/4 per §5.4
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#EBE1D9' /* hairline */ },
  dividerText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A', // ink/faint
    marginHorizontal: 12,
  },

  googleButton: {
    height: 52, // min-height matches Primary (§5.4)
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
    color: '#5F4A52', // ink/soft
  },

  // Error states — § 7.2
  offlineStrip: {
    backgroundColor: '#FBF3EE', // surface/page-sunk
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft — warm, not red
    flex: 1,
  },
  serverCard: {
    backgroundColor: '#FFFFFF', // surface/page
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EBE1D9', // hairline
  },
  serverCardText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#3A2A30', // ink — calm, no red
    textAlign: 'center',
  },
});
