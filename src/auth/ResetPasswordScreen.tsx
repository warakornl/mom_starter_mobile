/**
 * ResetPasswordScreen — Set a new password via deep-link token.
 *
 * Maps to: POST /v1/auth/reset-password { token, newPassword } → 204
 *
 * All strings from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * States (spec §3.2):
 *   idle          — both fields empty; submit disabled until client gate passes
 *   missing_token — token absent/empty; show linkMissing + button → ForgotPassword
 *   submitting    — spinner; fields + button disabled
 *   success       — briefly confirm; teardown if session; navigate to Login + toast
 *   token_invalid — 410 generic message + primary button → ForgotPassword (SEC-INV-2)
 *   validation    — 422 inline error; stay; same token (SEC-INV-6)
 *   rate_limited  — 429 calm card; stay; same token (SEC-INV-6)
 *   error_network — offline strip; stay; same token (SEC-INV-6)
 *   error_server  — calm card; stay; same token (SEC-INV-6)
 *
 * Token security (MI-1…MI-5):
 *   MI-1: token received via `token` prop (injected by the navigator from a useRef
 *         — NOT a route param). Never in nav-state or AsyncStorage.
 *   MI-2: NEVER log the token or the deep-link URL.
 *   MI-3: no analytics/Sentry param carries the token.
 *   MI-4: no AsyncStorage/SecureStore/MMKV write for the token.
 *   MI-5: token is consumed once; caller clears the ref after success/410/unmount.
 *
 * MI-7 / SEC-INV-4 post-success teardown:
 *   On 204, if a local session exists, handleResetPassword already clears the
 *   auth tokens (tokenStorage.clear()). The caller (RootNavigator) must then run
 *   the full performLogout SD-5 teardown (all health stores) via onSuccess.
 *   `reset.revokeNotice` is shown pre-submit so the all-device logout is expected.
 *
 * Design tokens: same as Login/Register (bg #FBF6F1, rose #A8505A, ink #3A2A30).
 */

import React, { useState, useEffect, useMemo } from 'react';
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
  validateNewPassword,
  handleResetPassword,
  resetStrings,
  type ResetPasswordOutcome,
} from './resetPasswordScreenLogic';
import { createAuthClient } from './authApiClient';
import type { TokenStorage } from './tokenStorage';
import { InMemoryTokenStorage } from './tokenStorage';
import { useT } from '../i18n/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ResetPasswordScreenProps {
  /** Base URL for the auth API. */
  apiBaseUrl: string;
  /**
   * The reset token from the email deep-link.
   *
   * MI-1: This value is injected by the navigator from a module-level useRef
   * (SD-9 pattern). It is NEVER a route param, never in nav-state, never logged.
   * An undefined/empty token renders the `missing_token` state immediately
   * without calling the API (MI-6).
   */
  token: string | undefined;
  /**
   * Token storage — needed by handleResetPassword to detect/clear an existing
   * session on success (MI-7 / SEC-INV-4).
   * Defaults to InMemoryTokenStorage for tests; production binding is SecureTokenStorage.
   */
  tokenStorage?: TokenStorage;
  /**
   * Called after successful reset.
   * Caller MUST run the full SD-5 teardown (performLogout — wipes DEK/SecureStore
   * and all health stores) before navigating away, per MI-7.
   * After teardown: navigate.reset to Login + show reset.successToast.
   */
  onSuccess: () => void;
  /** Called when the user taps "Request a new link" from token_invalid or missing_token. */
  onRequestNewLink: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ResetPasswordScreen({
  apiBaseUrl,
  token,
  tokenStorage,
  onSuccess,
  onRequestNewLink,
}: ResetPasswordScreenProps): React.JSX.Element {
  const { t } = useT();

  // Form state
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Async/UI state
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<ResetPasswordOutcome | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authClient = useMemo(() => createAuthClient(apiBaseUrl), [apiBaseUrl]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storage = useMemo(() => tokenStorage ?? new InMemoryTokenStorage(), [tokenStorage]);

  // ── missing_token immediate detection (MI-6) ─────────────────────────────────
  const tokenMissing = !token || token.trim() === '';

  // Client gate (spec §3.4)
  const clientValidation = validateNewPassword({ newPassword, confirm });
  const canSubmit = !loading && !tokenMissing && clientValidation === null;

  // ── On mount: if token missing → set missing_token state immediately ──────────
  useEffect(() => {
    if (tokenMissing) {
      setOutcome({ kind: 'missing_token' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handlers ──────────────────────────────────────────────────────────────

  async function onSubmit() {
    if (!canSubmit || loading) return; // Double-submit guard (spec §3.2, E7)

    setLoading(true);
    setOutcome(null);

    const result = await handleResetPassword({
      token: token ?? '',
      newPassword,
      client: authClient,
      tokenStorage: storage,
    });

    setLoading(false);

    if (result.kind === 'success') {
      // MI-7: handleResetPassword already cleared auth tokens (tokenStorage.clear()).
      // Caller must run the full SD-5 teardown (performLogout — wipes DEK/SecureStore
      // and resets all health stores) then navigate to Login + toast.
      onSuccess();
      return;
    }

    setOutcome(result);
  }

  // ─── Computed display ───────────────────────────────────────────────────────

  // Inline field errors (from client gate OR from server 422)
  const showMismatch =
    outcome?.kind !== 'validation' &&
    confirm.length > 0 &&
    newPassword !== confirm;

  const showValidationTooShort =
    outcome?.kind === 'validation' && outcome.code === 'password_too_short';
  const showValidationBreached =
    outcome?.kind === 'validation' && outcome.code === 'password_breached';

  const showTokenInvalid = outcome?.kind === 'token_invalid';
  const showMissingToken = outcome?.kind === 'missing_token' || tokenMissing;
  const showOffline = outcome?.kind === 'network_error';
  const showRateLimited = outcome?.kind === 'rate_limited';
  const showServerError = outcome?.kind === 'server_error';

  // ─── Token-invalid state ───────────────────────────────────────────────────

  if (showTokenInvalid) {
    return (
      <View style={styles.centeredState}>
        <Text style={styles.stateTitle}>{t('reset.tokenInvalid')}</Text>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={onRequestNewLink}
          accessibilityRole="button"
          accessibilityLabel={t('reset.requestNewLink')}
        >
          <Text style={styles.submitText}>{t('reset.requestNewLink')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Missing token state ───────────────────────────────────────────────────

  if (showMissingToken && !showTokenInvalid) {
    return (
      <View style={styles.centeredState}>
        <Text style={styles.stateTitle}>{t('reset.linkMissing')}</Text>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={onRequestNewLink}
          accessibilityRole="button"
          accessibilityLabel={t('reset.requestNewLink')}
        >
          <Text style={styles.submitText}>{t('reset.requestNewLink')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Form state (idle / submitting / validation / rate_limited / error) ────

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Offline strip */}
        {showOffline && (
          <View style={styles.offlineStrip} accessibilityLiveRegion="polite">
            <Text style={styles.offlineText}>{t('reset.offline')}</Text>
          </View>
        )}

        {/* Rate-limited card */}
        {showRateLimited && (
          <View style={styles.serverCard} accessibilityRole="alert">
            <Text style={styles.serverCardText}>{t('reset.rateLimited')}</Text>
          </View>
        )}

        {/* Server error card */}
        {showServerError && (
          <View style={styles.serverCard} accessibilityRole="alert">
            <Text style={styles.serverCardText}>{t('reset.serverError')}</Text>
          </View>
        )}

        <Text style={styles.title}>{t('reset.title')}</Text>

        {/* New password field */}
        <Text style={styles.label}>{t('reset.newPasswordLabel')}</Text>
        <View style={styles.passwordRow}>
          <TextInput
            testID="reset-new-password"
            style={[styles.input, styles.passwordInput,
              (showValidationTooShort || showValidationBreached) && styles.inputError]}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showNewPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel={t('reset.newPasswordLabel')}
            editable={!loading}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowNewPassword((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showNewPassword ? t('login.hidePassword') : t('login.showPassword')}
          >
            <Text style={styles.eyeIcon}>{showNewPassword ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.passwordHint}>{t('reset.passwordHint')}</Text>

        {/* 422 validation errors */}
        {showValidationTooShort && (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {t('reset.passwordTooShort')}
          </Text>
        )}
        {showValidationBreached && (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {t('reset.passwordBreached')}
          </Text>
        )}

        {/* Confirm password field */}
        <Text style={[styles.label, styles.labelSpacing]}>{t('reset.confirmLabel')}</Text>
        <View style={styles.passwordRow}>
          <TextInput
            testID="reset-confirm-password"
            style={[styles.input, styles.passwordInput, showMismatch && styles.inputError]}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!showConfirm}
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel={t('reset.confirmLabel')}
            editable={!loading}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowConfirm((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showConfirm ? t('login.hidePassword') : t('login.showPassword')}
          >
            <Text style={styles.eyeIcon}>{showConfirm ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>
        {showMismatch && (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {t('reset.mismatch')}
          </Text>
        )}

        {/* SEC-INV-4: revoke-notice — shown pre-submit so logout is not a surprise */}
        <Text style={styles.revokeNotice}>{t('reset.revokeNotice')}</Text>

        {/* Submit button */}
        <TouchableOpacity
          testID="reset-submit"
          style={[styles.submitButton, !canSubmit && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={t('reset.submit')}
        >
          {loading ? (
            <ActivityIndicator color="#FBF6F1" size="small" />
          ) : (
            <Text style={styles.submitText}>{t('reset.submit')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// Expose resetStrings for use by RootNavigator's successToast
export { resetStrings };

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FBF6F1' },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },

  // ── Centered states (token_invalid, missing_token) ──
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#FBF6F1',
  },
  stateTitle: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#3A2A30',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
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
    marginBottom: 20,
  },
  label: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#3A2A30',
    marginBottom: 6,
  },
  labelSpacing: {
    marginTop: 12,
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
    flex: 1,
  },
  inputError: {
    borderColor: '#A8505A',
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  passwordInput: {
    marginBottom: 0,
  },
  eyeButton: {
    paddingHorizontal: 10,
    height: 44,
    justifyContent: 'center',
  },
  eyeIcon: {
    fontSize: 18,
  },
  passwordHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#94818A',
    marginBottom: 4,
  },
  fieldError: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#A8505A',
    marginBottom: 6,
  },

  // ── Revoke notice (SEC-INV-4) ──
  revokeNotice: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#5F4A52',
    marginTop: 12,
    marginBottom: 4,
    lineHeight: 20,
  },

  // ── Submit button ──
  submitButton: {
    height: 48,
    backgroundColor: '#A8505A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  submitText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
