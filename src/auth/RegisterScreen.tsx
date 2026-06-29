/**
 * RegisterScreen — Sign-up screen (S2)
 *
 * Maps to: POST /v1/auth/register → 202 (verification_pending)
 * On success: calls onSuccess(email) — navigator pushes VerifyEmailScreen.
 *
 * ── No render tests in this file ─────────────────────────────────────────────
 * The project has no React / React Native installed (package.json has no
 * "react" or "react-native" dependency) and Jest is configured for the 'node'
 * environment. This file is excluded from the current ts-jest test run via
 * tsconfig.json `"exclude": ["src/**\/*.tsx"]`. All testable logic lives in
 * registerScreenLogic.ts (9 tests).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── Dependencies (not yet installed — needed when Expo is scaffolded) ─────────
 *   npm install react react-native
 *   npx expo install expo-secure-store
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1   App background
 *   ink           #3A2A30   Primary text
 *   ink/soft      #5F4A52   Secondary / helper copy (never bright red)
 *   ink/faint     #94818A   Placeholder + hint copy
 *   rose/600      #A8505A   Primary button fill
 *   rose/300      #DDA0A6   Disabled button fill
 *   hairline      #EBE1D9   Input borders + dividers
 *   attention     #C0762B   Field error border (non-red per design-system §1.4)
 *   surface/sunk  #FBF3EE   Offline strip background
 *
 * Screen states (RegisterOutcome):
 *   idle → loading → success(→ VerifyEmailScreen) | validation | rate_limited | network_error | server_error
 *
 * Non-enumeration contract (§E/C7 — DO NOT BREAK):
 *   On success (202), the screen ALWAYS navigates to VerifyEmailScreen
 *   with the same "check your inbox" message regardless of whether the email
 *   was new or colliding. There is NEVER any "email already taken" feedback.
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
  registerStrings,
  type RegisterOutcome,
} from './registerScreenLogic';
import { createAuthClient } from './authApiClient';
import type { Locale } from './types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RegisterScreenProps {
  /** Base URL for the auth API (e.g. "https://api.example.com"). */
  apiBaseUrl: string;
  /** Current app locale — drives which `registerStrings` set is shown. */
  locale: Locale;
  /** Stable per-install device id (client-generated, NOT a hardware id — §D/C5). */
  deviceId?: string;
  /**
   * Called after 202 success — navigate to the Verify-email / Check-inbox screen.
   * `email` is forwarded so the next screen can display "we sent a link to <email>".
   */
  onSuccess: (email: string) => void;
  /** Navigate back to Sign-in screen (S4). */
  onSignIn: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function RegisterScreen({
  apiBaseUrl,
  locale,
  deviceId,
  onSuccess,
  onSignIn,
}: RegisterScreenProps): React.JSX.Element {
  const s = registerStrings[locale];
  // Stable reference — prevents a new HTTP client on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authClient = useMemo(() => createAuthClient(apiBaseUrl), [apiBaseUrl]);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Validation state (shown on blur or after a submit attempt)
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Async state
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<RegisterOutcome | null>(null);

  // Derived — submit is enabled only when the basic client-side sanity checks pass
  const canSubmit = validateEmailField(email) === null && validatePasswordField(password);

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

    const result = await handleRegister({
      email,
      password,
      locale,
      deviceId,
      client: authClient,
    });

    setLoading(false);

    if (result.kind === 'success') {
      // 202 — navigate to Verify-email (non-enumerating: always same screen)
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
    if (outcome?.kind === 'rate_limited') return s.rateLimited;
    if (outcome?.kind === 'server_error') return s.serverError;
    return '';
  }

  function passwordErrorText(): string {
    if (outcome?.kind !== 'validation') return '';
    return outcome.code === 'password_too_short' ? s.passwordTooShort : s.passwordBreached;
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
        {/* Offline strip — warm-neutral, not red, not a modal */}
        {showOffline && (
          <View style={styles.offlineStrip} accessibilityLiveRegion="polite">
            <Text style={styles.offlineText}>{s.offline}</Text>
          </View>
        )}

        {/* Server-error / rate-limited card — calm, centered */}
        {showServerCard && (
          <View style={styles.serverCard} accessibilityRole="alert">
            <Text style={styles.serverCardText}>{serverCardText()}</Text>
          </View>
        )}

        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.subtitle}>{s.subtitle}</Text>

        {/* Email field */}
        <Text style={styles.label}>{s.emailLabel}</Text>
        <TextInput
          style={[styles.input, emailError ? styles.inputError : null]}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (emailError) setEmailError(null);
            if (outcome) setOutcome(null);
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
            style={[
              styles.input,
              styles.passwordInput,
              showPasswordError ? styles.inputError : null,
            ]}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              // Clear a server-side password error on any change
              if (outcome?.kind === 'validation') setOutcome(null);
            }}
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            textContentType="newPassword"
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

        {/* Password error — 422 from server (appsec policy, §2/§F) — ink/soft, never red */}
        {showPasswordError ? (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {passwordErrorText()}
          </Text>
        ) : (
          /* Password hint — before any server error */
          <Text style={styles.passwordHint}>{s.passwordHint}</Text>
        )}

        {/* Primary action — ≥48 px, disabled while loading or form invalid */}
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

        {/* Quiet link → Sign-in */}
        <TouchableOpacity
          style={styles.quietLink}
          onPress={onSignIn}
          accessibilityRole="link"
        >
          <Text style={styles.quietLinkText}>{s.signIn}</Text>
        </TouchableOpacity>

        {/* Medical disclaimer */}
        <Text style={styles.disclaimer}>{s.disclaimer}</Text>
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
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#5F4A52', // ink/soft
    marginBottom: 28,
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
  passwordHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#94818A', // ink/faint
    marginTop: 4,
  },

  primaryButton: {
    height: 52, // ≥48 touch target §5.1
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

  quietLink: { marginTop: 20, alignItems: 'center' },
  quietLinkText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft
  },

  disclaimer: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A', // ink/faint
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 8,
    lineHeight: 18,
  },

  // Error states
  offlineStrip: {
    backgroundColor: '#FBF3EE', // surface/page-sunk
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  offlineText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft — warm, not red
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
