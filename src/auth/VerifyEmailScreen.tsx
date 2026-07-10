/**
 * VerifyEmailScreen — Check-inbox screen (Screen C in journey-screens.html)
 *
 * ห้องแม่ Phase 2 B1 reskin (mother-room-phase2-rollout.md §4.1 VerifyEmailScreen).
 * Shown immediately after POST /v1/auth/register → 202 (verification_pending).
 *
 * Maps to:
 *   POST /v1/auth/resend-verification → always 202 (non-enumerating)
 *   POST /v1/auth/verify-email        → 200 AuthTokens (via deep-link, carry-forward)
 *
 * All strings sourced from useT() / catalog (src/i18n/messages.ts).
 * Locale is read from LanguageContext — not a prop.
 *
 * State matrix:
 *   Waiting     — Informational text; "ส่งอีกครั้ง" quiet link
 *   Verified    — jade-100 wash success indicator + navigate
 *   Expired/err — blameless error + resend CTA
 *   Offline     — offlinePill
 *
 * Reskin changes (all tokens — NO inline hex outside tokens.ts):
 *   - All fonts: Sarabun (no IBMPlex)
 *   - Progress dots: amber-700 active, jade-800 done, surface.divider inactive
 *   - resentConfirm bg: jade-100 wash; text: jade-800
 *   - errorCard bg: surface.subtle; border: surface.divider
 *   - resendButton text: text.primary (no old rose #8E3A44)
 *   - spamTip bg: surface.subtle
 *   - Screen bg: surface.base
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
import { T } from '../theme/tokens';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VerifyEmailScreenProps {
  /** Base URL for the auth API. */
  apiBaseUrl: string;
  /**
   * @deprecated — locale is now read from LanguageContext via useT().
   * This prop is kept for backward compatibility but is ignored.
   */
  locale?: string;
  /** The email the user registered with. */
  email: string;
  /** Stable per-install device id (bound to the first session on verify). */
  deviceId?: string;
  /** Called after successful email verification. */
  onVerified: () => void;
  /** Navigate back to RegisterScreen so the user can correct their email. */
  onChangeEmail: () => void;
  /**
   * Deep-link verification token from the email link.
   * Carry-forward: this prop is wired up in the Expo scaffold slice.
   */
  pendingToken?: string;
  /**
   * Token storage implementation.
   * Defaults to InMemoryTokenStorage; production binding is expo-secure-store.
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

      {/* Progress pip row — done (jade-800) · active (amber-700) · waiting (divider) */}
      <View style={styles.stepDots} accessibilityLabel={t('verify.stepLabel')}>
        <View style={[styles.dot, styles.dotDone]} />
        <View style={[styles.dot, styles.dotActive]} />
        <View style={[styles.dot, styles.dotWaiting]} />
      </View>

      {/* Envelope illustration area */}
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
          <ActivityIndicator color={T.button.primary.bg} size="small" />
        </View>
      )}

      {/* Deep-link token error */}
      {showTokenError && !verifyLoading && (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Text style={styles.errorCardText}>{tokenErrorText()}</Text>
        </View>
      )}

      {/* Resent confirmation — jade-100 wash, calm */}
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

      {/* Resend button — ≥48dp, disabled during cooldown or loading */}
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
          <ActivityIndicator color={T.button.primary.bg} size="small" />
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

  topbar: {
    alignItems: 'center',
    marginBottom: T.spacing[3],                       // 12dp
  },
  stepLabel: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    letterSpacing: 0,
  },

  // Progress pips — jade-800 done · amber-700 active · surface.divider waiting
  stepDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: T.spacing[1],                                // 4dp (was 6 — closest token is spacing[1]=4)
    marginBottom: 22,
  },
  dot: { width: 28, height: 6, borderRadius: 3 },
  dotDone: { backgroundColor: T.color.text.botanical },    // #2F5042 jade-800
  dotActive: { backgroundColor: T.color.accent.interactive }, // #9A5F0A amber-700
  dotWaiting: { backgroundColor: T.color.surface.divider }, // #E8DDD5

  illustration: {
    alignItems: 'center',
    paddingVertical: T.spacing[4],                    // 16dp
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
    fontFamily: T.type.heading2.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.heading2.size,                   // 20sp (was 22 — use heading2)
    lineHeight: T.type.heading2.lineHeight,           // 33
    color: T.color.text.heading,                      // #4A2230
    marginBottom: T.spacing[2],                       // 8dp
    textAlign: 'center',
    letterSpacing: 0,
  },
  sentToPrefix: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    textAlign: 'center',
    letterSpacing: 0,
  },
  emailDisplay: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular (was IBMPlexMono)
    fontSize: T.type.body.size,                       // 15sp
    fontWeight: '600',
    color: T.color.text.heading,                      // #4A2230
    marginVertical: T.spacing[1],                     // 4dp
    textAlign: 'center',
    letterSpacing: 0,
  },
  openLinkHint: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    textAlign: 'center',
    letterSpacing: 0,
  },

  spamTip: {
    padding: T.spacing[3],                            // 12dp
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (NOT #FBF3EE)
    borderRadius: T.radius.sm,                        // 6dp (was 10)
    marginBottom: 14,
  },
  spamTipText: {
    fontFamily: T.type.caption.fontFamily,            // Sarabun-Regular
    fontSize: T.type.caption.size,                    // 13sp
    lineHeight: T.type.caption.lineHeight,            // 21
    color: T.color.text.primary,                      // #7A3A52
    letterSpacing: 0,
  },

  verifySpinner: {
    alignItems: 'center',
    paddingVertical: T.spacing[2],                    // 8dp
  },

  // Resent confirmation — jade-100 wash (success context)
  resentConfirm: {
    padding: T.spacing[3],                            // 12dp
    backgroundColor: T.color.surface.wash.jade,       // #E4EDE7 jade-100
    borderRadius: T.radius.sm,                        // 6dp
    marginBottom: T.spacing[2],                       // 8dp
  },
  resentConfirmText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.botanical,                    // #2F5042 jade-800 (7.18:1 on jade-100 AAA)
    textAlign: 'center',
    letterSpacing: 0,
  },

  errorCard: {
    backgroundColor: T.color.surface.subtle,          // #F5EDE6 (NOT white)
    borderRadius: T.radius.md,                        // 12dp
    padding: 14,
    marginBottom: T.spacing[2],                       // 8dp (was 10)
    borderWidth: 1,
    borderColor: T.color.surface.divider,             // #E8DDD5
  },
  errorCardText: {
    fontFamily: T.type.body.fontFamily,               // Sarabun-Regular
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52
    textAlign: 'center',
    letterSpacing: 0,
  },

  // Resend button — text-only style, ≥48dp touch target
  resendButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: T.spacing[4],                  // 16dp
    paddingVertical: T.spacing[2],                    // 8dp
    marginTop: T.spacing[1],                          // 4dp
  },
  resendButtonDisabled: { opacity: 0.45 },
  resendButtonText: {
    fontFamily: T.type.label.fontFamily,              // Sarabun-SemiBold
    fontSize: T.type.body.size,                       // 15sp
    lineHeight: T.type.body.lineHeight,               // 25
    color: T.color.text.primary,                      // #7A3A52 (NOT old rose/700 #8E3A44)
    letterSpacing: 0,
  },
  resendButtonTextDisabled: {
    color: T.color.text.primary,                      // still roselle-700 (disabled via parent opacity)
  },

  changeEmailButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: T.spacing[4],                  // 16dp
    paddingVertical: T.spacing[1],                    // 4dp
  },
  changeEmailText: {
    fontFamily: T.type.caption.fontFamily,            // Sarabun-Regular
    fontSize: T.type.caption.size,                    // 13sp
    lineHeight: T.type.caption.lineHeight,            // 21
    color: T.color.text.primary,                      // #7A3A52
    letterSpacing: 0,
  },
});
