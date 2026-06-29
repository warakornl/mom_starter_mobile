/**
 * VerifyEmailScreen — Check-inbox screen (Screen C in journey-screens.html)
 *
 * Shown immediately after POST /v1/auth/register → 202 (verification_pending).
 * The user lands here and waits for the verification email.
 *
 * Maps to:
 *   POST /v1/auth/resend-verification → always 202 (non-enumerating)
 *   POST /v1/auth/verify-email        → 200 AuthTokens (via deep-link, carry-forward)
 *
 * All strings are sourced from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * ── No render tests in this file ─────────────────────────────────────────────
 * See registerScreenLogic.ts / verifyEmailScreenLogic.ts for full unit-tested logic.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Navigation map:
 *   RegisterScreen (S2) → (202) → VerifyEmailScreen
 *   VerifyEmailScreen + "Resend link" → stays on screen, shows resentConfirm
 *   VerifyEmailScreen + "Change email" → onChangeEmail() → back to RegisterScreen
 *   VerifyEmailScreen + deep-link token → handleVerifyToken → (200) → onVerified()
 *
 * Deep-link carry-forward:
 *   The `pendingToken` prop is the hook for the navigator to pass the token
 *   extracted from the verification URL (e.g. "momstarter://verify?token=...").
 *   Expo Linking integration — registering the URL scheme, intercepting the link,
 *   and extracting the `token` param — is a carry-forward for the Expo scaffold slice.
 *   When Expo is installed, the navigator calls:
 *     <VerifyEmailScreen pendingToken={extractedToken} ... />
 *   and this screen calls handleVerifyToken and navigates on success.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1   App background
 *   ink           #3A2A30   Primary text
 *   ink/soft      #5F4A52   Secondary copy
 *   ink/faint     #94818A   Hint copy
 *   rose/600      #A8505A   Active progress dot
 *   rose/700      #8E3A44   Resend button text
 *   sage/500      #6E9079   Completed progress dot
 *   sage/700      #4C6B57   Resent-confirmation text
 *   sage/100      #E4EBE4   Resent-confirmation background
 *   hairline      #EBE1D9   Inactive progress dot + card border
 *   surface/sunk  #FBF3EE   Spam-tip background
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';

import {
  handleResend,
  handleVerifyToken,
  type ResendOutcome,
  type VerifyTokenOutcome,
} from './verifyEmailScreenLogic';
import { InMemoryTokenStorage } from './tokenStorage';
import { createAuthClient } from './authApiClient';
import type { TokenStorage } from './tokenStorage';
import { useT } from '../i18n/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VerifyEmailScreenProps {
  /** Base URL for the auth API. */
  apiBaseUrl: string;
  /**
   * @deprecated — locale is now read from LanguageContext via useT().
   * This prop is kept for backward compatibility but is ignored.
   */
  locale?: string;
  /**
   * The email the user registered with.
   * Displayed as "we sent a link to <email>".
   */
  email: string;
  /** Stable per-install device id (bound to the first session on verify). */
  deviceId?: string;
  /**
   * Called after successful email verification (tokens stored in secure storage).
   * Navigate to the home / post-verify consent screen.
   */
  onVerified: () => void;
  /** Navigate back to RegisterScreen so the user can correct their email. */
  onChangeEmail: () => void;
  /**
   * Deep-link verification token from the email link.
   * The navigator extracts this from the URL scheme via Expo Linking and passes
   * it here. When present, the screen automatically calls handleVerifyToken.
   * Carry-forward: this prop is wired up in the Expo scaffold slice.
   */
  pendingToken?: string;
  /**
   * Token storage implementation.
   * Defaults to InMemoryTokenStorage; production binding is expo-secure-store
   * (SEC-HOOK §A/C4 — swap in when Expo is scaffolded).
   */
  tokenStorage?: TokenStorage;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function VerifyEmailScreen({
  apiBaseUrl,
  email,
  deviceId,
  onVerified,
  onChangeEmail,
  pendingToken,
  tokenStorage,
}: VerifyEmailScreenProps): React.JSX.Element {
  const { t } = useT();

  // Stable references — prevents a new client/storage instance on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authClient = useMemo(() => createAuthClient(apiBaseUrl), [apiBaseUrl]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storage = useMemo(() => tokenStorage ?? new InMemoryTokenStorage(), [tokenStorage]);

  // Resend state
  const [resendLoading, setResendLoading] = useState(false);
  const [resendOutcome, setResendOutcome] = useState<ResendOutcome | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);

  // Deep-link verify state
  const [verifyOutcome, setVerifyOutcome] = useState<VerifyTokenOutcome | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Cooldown: disable resend button while cooling down
  const isResendCoolingDown = resendAt !== null && Date.now() < resendAt;

  // ─── Deep-link verify effect ────────────────────────────────────────────────
  // When the navigator passes a pendingToken (Expo Linking carry-forward),
  // automatically attempt token verification.
  useEffect(() => {
    if (!pendingToken) return;

    let cancelled = false;
    setVerifyLoading(true);
    setVerifyOutcome(null);

    handleVerifyToken({ token: pendingToken, deviceId, client: authClient, storage })
      .then((result) => {
        if (cancelled) return;
        setVerifyLoading(false);
        setVerifyOutcome(result);
        if (result.kind === 'success') {
          onVerified();
        }
      })
      .catch(() => {
        if (cancelled) return;
        setVerifyLoading(false);
        setVerifyOutcome({ kind: 'server_error', code: 'unexpected' });
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToken]);

  // ─── Resend cooldown auto-expire ────────────────────────────────────────────
  // Sets a timer to clear `resendAt` when the 60-second cooldown expires,
  // so the "ส่งลิงก์อีกครั้ง" button re-enables automatically without a
  // manual refresh. The timer is cleaned up if the screen unmounts early.
  useEffect(() => {
    if (resendAt === null) return;
    const remaining = resendAt - Date.now();
    if (remaining <= 0) {
      setResendAt(null);
      return;
    }
    const timer = setTimeout(() => setResendAt(null), remaining);
    return () => clearTimeout(timer);
  }, [resendAt]);

  // ─── Resend handler ─────────────────────────────────────────────────────────

  async function onResend() {
    if (isResendCoolingDown || resendLoading) return;

    setResendLoading(true);
    setResendOutcome(null);

    const result = await handleResend({ email, client: authClient });

    setResendLoading(false);
    setResendOutcome(result);

    if (result.kind === 'success') {
      setResendAt(result.resendAt);
    }
  }

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const showResent = resendOutcome?.kind === 'success';
  const showResendError =
    resendOutcome?.kind === 'rate_limited' ||
    resendOutcome?.kind === 'network_error' ||
    resendOutcome?.kind === 'server_error';
  const showTokenError =
    verifyOutcome?.kind === 'token_invalid' || verifyOutcome?.kind === 'server_error';

  function resendErrorText(): string {
    if (resendOutcome?.kind === 'rate_limited') return t('verify.rateLimited');
    if (resendOutcome?.kind === 'network_error') return t('verify.offline');
    return t('verify.serverError');
  }

  function tokenErrorText(): string {
    if (verifyOutcome?.kind === 'token_invalid') return t('verify.tokenInvalid');
    // storage_error: token exchange succeeded but Keychain/Keystore failed.
    // Direct the user to resend so they can attempt verification again.
    if (verifyOutcome?.kind === 'server_error' && verifyOutcome.code === 'storage_error') {
      return t('verify.storageErrorHint');
    }
    return t('verify.serverError');
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
    >
      {/* Step label — "สร้างบัญชี · ขั้นที่ 2 จาก 3" */}
      <View style={styles.topbar}>
        <Text style={styles.stepLabel}>{t('verify.stepLabel')}</Text>
      </View>

      {/* Progress pip row — done (sage) · active (rose) · waiting (hairline) */}
      <View style={styles.stepDots} accessibilityLabel={t('verify.stepLabel')}>
        <View style={[styles.dot, styles.dotDone]} />
        <View style={[styles.dot, styles.dotActive]} />
        <View style={[styles.dot, styles.dotWaiting]} />
      </View>

      {/* Envelope illustration */}
      <View style={styles.illustration} accessibilityElementsHidden={true}>
        {/* Placeholder — swap for react-native-svg envelope when svg dep lands */}
        <Text style={styles.envelopeEmoji}>✉️</Text>
      </View>

      {/* Headline block */}
      <View style={styles.headlineBlock}>
        <Text style={styles.title}>{t('verify.title')}</Text>
        <Text style={styles.sentToPrefix}>{t('verify.sentToPrefix')}</Text>
        <Text style={styles.emailDisplay}>{email}</Text>
        <Text style={styles.openLinkHint}>{t('verify.openLinkHint')}</Text>
      </View>

      {/* Spam-folder tip */}
      <View style={styles.spamTip}>
        <Text style={styles.spamTipText}>{t('verify.spamTip')}</Text>
      </View>

      {/* Deep-link token loading spinner */}
      {verifyLoading && (
        <View style={styles.verifySpinner}>
          <ActivityIndicator color="#A8505A" size="small" />
        </View>
      )}

      {/* Deep-link token error (410 / storage failure / server error) */}
      {showTokenError && !verifyLoading && (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Text style={styles.errorCardText}>{tokenErrorText()}</Text>
        </View>
      )}

      {/* Resent confirmation — sage/100 background, calm */}
      {showResent && (
        <View style={styles.resentConfirm} accessibilityLiveRegion="polite">
          <Text style={styles.resentConfirmText}>{t('verify.resentConfirm')}</Text>
        </View>
      )}

      {/* Resend error */}
      {showResendError && (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Text style={styles.errorCardText}>{resendErrorText()}</Text>
        </View>
      )}

      {/* Resend button — ≥48 px, disabled during cooldown or loading */}
      <TouchableOpacity
        style={[
          styles.resendButton,
          (isResendCoolingDown || resendLoading) && styles.resendButtonDisabled,
        ]}
        onPress={onResend}
        disabled={isResendCoolingDown || resendLoading}
        accessibilityRole="button"
        accessibilityLabel={t('verify.resend')}
        accessibilityState={{
          disabled: isResendCoolingDown || resendLoading,
          busy: resendLoading,
        }}
      >
        {resendLoading ? (
          <ActivityIndicator color="#A8505A" size="small" />
        ) : (
          <Text style={[
            styles.resendButtonText,
            (isResendCoolingDown || resendLoading) && styles.resendButtonTextDisabled,
          ]}>
            {t('verify.resend')}
          </Text>
        )}
      </TouchableOpacity>

      {/* Change email — quiet link */}
      <TouchableOpacity
        style={styles.changeEmailButton}
        onPress={onChangeEmail}
        accessibilityRole="link"
      >
        <Text style={styles.changeEmailText}>{t('verify.changeEmail')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles (design-system.md tokens) ────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FBF6F1' /* bg/warm-milk */ },
  scroll: { flexGrow: 1, padding: 24 },

  topbar: {
    alignItems: 'center',
    marginBottom: 12,
  },
  stepLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft
  },

  // Progress pips — mirrors journey-screens.html Screen C
  stepDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 22,
  },
  dot: { width: 28, height: 6, borderRadius: 3 },
  dotDone: { backgroundColor: '#6E9079' /* sage/500 */ },
  dotActive: { backgroundColor: '#A8505A' /* rose/600 */ },
  dotWaiting: { backgroundColor: '#EBE1D9' /* hairline */ },

  illustration: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  envelopeEmoji: {
    fontSize: 64,
    lineHeight: 80,
  },

  headlineBlock: {
    alignItems: 'center',
    paddingHorizontal: 22,
    marginBottom: 14,
  },
  title: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 22,
    lineHeight: 30,
    color: '#3A2A30', // ink
    marginBottom: 8,
    textAlign: 'center',
  },
  sentToPrefix: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft
    textAlign: 'center',
  },
  emailDisplay: {
    fontFamily: 'IBMPlexMono-Regular', // IBM Plex Mono for email readability (matches mockup)
    fontSize: 14,
    fontWeight: '600',
    color: '#3A2A30', // ink
    marginVertical: 4,
    textAlign: 'center',
  },
  openLinkHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52', // ink/soft
    textAlign: 'center',
    lineHeight: 21,
  },

  spamTip: {
    padding: 12,
    backgroundColor: '#FBF3EE', // surface/sunk
    borderRadius: 10,
    marginBottom: 14,
  },
  spamTipText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#5F4A52', // ink/soft
  },

  verifySpinner: {
    alignItems: 'center',
    paddingVertical: 8,
  },

  resentConfirm: {
    padding: 12,
    backgroundColor: '#E4EBE4', // sage/100 — calm, success feel
    borderRadius: 10,
    marginBottom: 8,
  },
  resentConfirmText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#4C6B57', // sage/700
    textAlign: 'center',
  },

  errorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EBE1D9', // hairline
  },
  errorCardText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#3A2A30', // ink — calm, no red
    textAlign: 'center',
  },

  // Resend button — text-only style, ≥48 px touch target
  resendButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 4,
  },
  resendButtonDisabled: { opacity: 0.45 },
  resendButtonText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#8E3A44', // rose/700 — prominent but not primary button level
  },
  resendButtonTextDisabled: {
    color: '#94818A', // ink/faint
  },

  changeEmailButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  changeEmailText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#5F4A52', // ink/soft — quiet link
  },
});
