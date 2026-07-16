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
 * ห้องแม่ Phase 2 B1 reskin (mother-room-phase2-rollout.md §4.1 ResetPasswordScreen).
 * All tokens from T.* — NO inline hex outside tokens.ts.
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
import { clearResetToken } from '../deepLink/resetDeepLink';
import { T } from '../theme/tokens';
import { EyeIcon } from '../icons/EyeIcon';
import { EyeOffIcon } from '../icons/EyeOffIcon';

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

  // ── MI-5 unmount cleanup: clear the reset token when the screen goes away ─────
  // Ensures Android hardware-back (or any navigation pop/replace/reset) cannot
  // leave a live token in the module store.  The success and 410 paths already
  // call clearResetToken() before this fires; the cleanup is idempotent (safe).
  useEffect(() => () => clearResetToken(), []);

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
          testID="reset-submit"
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
          testID="reset-submit"
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
            placeholderTextColor={T.input.placeholder}
            accessibilityLabel={t('reset.newPasswordLabel')}
            editable={!loading}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowNewPassword((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showNewPassword ? t('login.hidePassword') : t('login.showPassword')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View accessibilityElementsHidden={true}>
              {showNewPassword ? (
                <EyeOffIcon color={T.color.text.primary} size={18} />
              ) : (
                <EyeIcon color={T.color.text.primary} size={18} />
              )}
            </View>
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
            placeholderTextColor={T.input.placeholder}
            accessibilityLabel={t('reset.confirmLabel')}
            editable={!loading}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowConfirm((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showConfirm ? t('login.hidePassword') : t('login.showPassword')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View accessibilityElementsHidden={true}>
              {showConfirm ? (
                <EyeOffIcon color={T.color.text.primary} size={18} />
              ) : (
                <EyeIcon color={T.color.text.primary} size={18} />
              )}
            </View>
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
            <ActivityIndicator color={T.button.primary.text} size="small" />
          ) : (
            <Text style={styles.submitText}>{t('reset.submit')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles — ALL values from T.* tokens; NO inline hex ──────────────────────

// Expose resetStrings for use by RootNavigator's successToast
export { resetStrings };

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: T.color.surface.base,           // #FBF6F1
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: T.spacing[6],                  // 24dp
    paddingTop: T.spacing[8],                         // 32dp (token, was raw 32)
    paddingBottom: T.spacing[10],                     // 40dp (token, was raw 40)
  },

  // ── Centered states (token_invalid, missing_token) ──
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.spacing[8],                  // 32dp (token, was raw 32)
    backgroundColor: T.color.surface.base,            // #FBF6F1
  },
  stateTitle: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    color: T.color.text.heading,                      // #4A2230 roselle-900
    textAlign: 'center',
    lineHeight: T.type.body.lineHeight,               // 25
    marginBottom: T.spacing[6],                       // 24dp
    letterSpacing: 0,
  },

  // ── Feedback strips / cards ──
  offlineStrip: {
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (not #FBF3EE)
    borderRadius: T.radius.sm,                        // 6dp
    paddingVertical: T.spacing[3],                    // 12dp (token, was raw 10 — matches serverCard)
    paddingHorizontal: T.spacing[4],                  // 16dp (token, was raw 14)
    marginBottom: T.spacing[3],                       // 12dp
  },
  offlineText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    color: T.color.text.primary,                      // #7A3A52 roselle-700
    letterSpacing: 0,
  },
  serverCard: {
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (not #FBF3EE)
    borderRadius: T.radius.sm,                        // 6dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,             // #E8DDD5 (not #EBE1D9)
    paddingVertical: T.spacing[3],                    // 12dp (token, was raw 12)
    paddingHorizontal: T.spacing[4],                  // 16dp (token, was raw 14)
    marginBottom: T.spacing[3],                       // 12dp
  },
  serverCardText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    color: T.color.text.primary,                      // #7A3A52
    textAlign: 'center',
    letterSpacing: 0,
  },

  // ── Form ──
  title: {
    // 🔴 was fontSize 24 / lineHeight 38 = 1.583× — FAILS Thai ≥1.6× rule.
    // Use T.type.heading1 verbatim (24/39 = 1.625×, the token pair for this size).
    fontFamily: T.type.heading1.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.heading1.size,                   // 24sp
    lineHeight: T.type.heading1.lineHeight,           // 39 (1.625× — Thai rule)
    color: T.color.text.heading,                      // #4A2230 roselle-900
    marginBottom: T.spacing[5],                       // 20dp (token, was raw 20)
    letterSpacing: 0,
  },
  label: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.heading,                      // #4A2230
    marginBottom: T.spacing[1],                       // 4dp (was 6)
    letterSpacing: 0,
  },
  labelSpacing: {
    marginTop: T.spacing[3],                          // 12dp
  },
  input: {
    height: T.input.height,                           // 52dp
    borderWidth: 1,
    borderColor: T.input.border.default,              // #E8DDD5
    borderRadius: T.radius.md,                        // 12dp
    paddingHorizontal: T.spacing[3],                  // 12dp
    fontFamily: T.type.bodyLarge.fontFamily,          // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    color: T.input.text,                              // #4A2230 roselle-900
    backgroundColor: T.input.bg,                      // #F5EDE6 ivory-200 (NOT white)
    flex: 1,
    letterSpacing: 0,
  },
  inputError: {
    borderColor: T.input.border.error,                // #B85C78 roselle-500 (NOT #A8505A)
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: T.spacing[1],                       // 4dp
  },
  passwordInput: {
    marginBottom: 0,
  },
  eyeButton: {
    // 🟡 was <48dp (paddingHorizontal 10 around an 18sp icon, no hitSlop) —
    // now width:48 + height:52 (matches input) + hitSlop on the touchable
    // (added at both call sites) reaches ≥48dp in both dimensions.
    width: 48,
    height: T.input.height,                           // 52dp (match input)
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordHint: {
    fontFamily: T.type.caption.fontFamily,            // Sarabun-Regular
    fontSize: T.type.caption.size,                    // 13sp
    lineHeight: T.type.caption.lineHeight,            // 21
    color: T.color.text.primary,                      // #7A3A52 (NOT banned #94818A)
    marginBottom: T.spacing[1],                       // 4dp
    letterSpacing: 0,
  },
  fieldError: {
    fontFamily: T.type.caption.fontFamily,            // Sarabun-Regular
    fontSize: T.type.caption.size,                    // 13sp
    lineHeight: T.type.caption.lineHeight,            // 21
    color: T.input.errorText,                         // #7A3A52 roselle-700 (NOT #A8505A)
    marginBottom: T.spacing[1],                       // 4dp (was 6)
    letterSpacing: 0,
  },

  // ── Revoke notice (SEC-INV-4) ──
  revokeNotice: {
    fontFamily: T.type.caption.fontFamily,            // Sarabun-Regular
    fontSize: T.type.caption.size,                    // 13sp
    lineHeight: T.type.caption.lineHeight,            // 21
    color: T.color.text.primary,                      // #7A3A52 (NOT raw #5F4A52)
    marginTop: T.spacing[3],                          // 12dp
    marginBottom: T.spacing[1],                       // 4dp
    letterSpacing: 0,
  },

  // ── Submit button — amber-700 CTA, 52dp height ──
  submitButton: {
    height: T.button.primary.height,                  // 52dp
    backgroundColor: T.button.primary.bg,             // #9A5F0A amber-700 (NOT #A8505A)
    borderRadius: T.button.primary.radius,            // 14dp
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.spacing[4],                          // 16dp
  },
  submitText: {
    fontFamily: T.type.label.fontFamily,              // Sarabun-SemiBold
    fontSize: T.type.label.size,                      // 15sp
    lineHeight: T.type.label.lineHeight,              // 25
    color: T.button.primary.text,                     // #FBF6F1
    letterSpacing: 0,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
