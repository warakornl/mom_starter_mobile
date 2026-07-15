/**
 * ReopenConfirmScreen — Screen C confirmation: reopen (correction).
 *
 * Implements pregnancy-loss-recording-ui.md §4.2 + functional-spec §15.
 * Symmetric with LossConfirmScreen (§3): "Go back" is the PROMINENT primary
 * action; quiet Confirm is a plain-text link. No date field — reopen takes
 * no input (functional-spec §7.4, "Body: none"). Always available, no
 * expiry/countdown (AC-4.3 — a timed undo would add time pressure).
 *
 * Neutral, dignified framing — a correction, not a second "are you sure"
 * about grief (no blame, no "are you sure you gave up?" phrasing).
 *
 * mobile-reviewer BLOCKER-1 fix (reachability): this screen does its OWN
 * GET-on-mount (runReopenEntryGet, mirrors ProfileInfoEditScreen's
 * lifecycle-agnostic pattern) instead of requiring a route-param
 * `profileVersion`. The previous design required a caller to already know
 * the current version, but the only host that rendered a reopen entry link
 * (ProfileEditScreen) is gated pregnant-only (AC-2) and can NEVER show a
 * lifecycle==='ended' profile — the entry link could never be tapped in
 * production. The real entry point is now ProfileHubScreen (reads the raw
 * snapshot directly, renders regardless of lifecycle) navigating here with
 * NO params (SD-9); this screen fetches the authoritative profile + version
 * itself via runReopenEntryGet.
 *
 * mobile-reviewer BLOCKER-2 fix (no false-success): a network/5xx failure on
 * confirm is NEVER treated as success (runReopenConfirm's onError path).
 * There is no "assume success" path — the screen shows a calm inline error +
 * Retry and stays on screen so the mother is never told "recorded" when
 * nothing was recorded server-side. Full optimistic-apply + offline queue
 * (functional-spec §10.3) is an explicit follow-up (to be done together with
 * BirthEvent for consistency), NOT implemented in this pass.
 *
 * Writes via POST /pregnancy-profile/reopen (LOSS-INV-1). Calling this is
 * the ONLY production caller of reopenPregnancy in the app.
 *
 * Security: NEVER log accessToken.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { runReopenEntryGet, runReopenConfirm } from './reopenEntryRuntimeWiring';
import type { ReopenEntryGetOutcome } from './lossEventLogic';
import type { PregnancyProfile } from './types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReopenConfirmScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /**
   * Called on success (200 pregnant, loss_date cleared — S4), and on
   * 409-already-pregnant (intent satisfied, §10.4). NEVER called on
   * network/5xx failure (BLOCKER-2 — no false-success).
   */
  onReopened: (profile: PregnancyProfile) => void;
  /**
   * Called on "Go back" (dismiss, nothing changed) AND on the benign
   * 409-postpartum terminal.
   */
  onGoBack: () => void;
  /** SD-5: called on GET 401 or confirm-time 401 (no token / server-expired). */
  onSessionExpired: () => void;
}

const ERROR_KEY: Record<'consentRequired' | 'conflict' | 'offline', string> = {
  consentRequired: 'loss.error.consentRequired',
  conflict: 'loss.error.conflict',
  offline: 'loss.error.offlineQueued',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ReopenConfirmScreen({
  tokenStorage,
  apiBaseUrl,
  onReopened,
  onGoBack,
  onSessionExpired,
}: ReopenConfirmScreenProps): React.JSX.Element {
  const { t } = useT();

  const [outcome, setOutcome] = useState<ReopenEntryGetOutcome>({ type: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const doEntryGet = useCallback(async () => {
    await runReopenEntryGet({
      tokenStorage,
      apiBaseUrl,
      onSessionExpired,
      setOutcome,
    });
  }, [tokenStorage, apiBaseUrl, onSessionExpired]);

  useEffect(() => {
    void doEntryGet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm(profileVersion: number): Promise<void> {
    if (submitting) return; // single-flight guard

    setConfirmError(null);
    setSubmitting(true);

    await runReopenConfirm({
      tokenStorage,
      apiBaseUrl,
      profileVersion,
      onReopened,
      onGoBack,
      onSessionExpired,
      onError: (key) => setConfirmError(t(ERROR_KEY[key] as Parameters<typeof t>[0])),
    });

    setSubmitting(false);
  }

  // ─── Render — loading ───────────────────────────────────────────────────────

  if (outcome.type === 'loading') {
    return (
      <SafeAreaView style={styles.container} testID="reopen-confirm-loading">
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={T.color.accent.interactive} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Render — not-found / guard-not-editable / error (calm backstops) ──────

  // mobile-reviewer 🟡 fix (cluster 6 review): was text-only — a dead end
  // with no explicit way back besides the native header back button.
  if (outcome.type === 'not-found') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.noticeText}>{t('profile.editNotFound')}</Text>
          <TouchableOpacity
            testID="reopen-notfound-back"
            style={styles.goBackBtn}
            onPress={onGoBack}
            accessibilityRole="button"
            accessibilityLabel={t('general.back')}
          >
            <Text style={styles.goBackBtnText}>{t('general.back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // mobile-reviewer 🟡 fix (cluster 6 review): same text-only dead-end fix.
  if (outcome.type === 'guard-not-editable') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.noticeText}>{t('profile.editNotEditable')}</Text>
          <TouchableOpacity
            testID="reopen-guard-back"
            style={styles.goBackBtn}
            onPress={onGoBack}
            accessibilityRole="button"
            accessibilityLabel={t('general.back')}
          >
            <Text style={styles.goBackBtnText}>{t('general.back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (outcome.type === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.noticeText}>{t('profile.editLoadError')}</Text>
          <TouchableOpacity
            testID="reopen-entry-load-retry"
            style={styles.goBackBtn}
            onPress={() => void doEntryGet()}
            accessibilityRole="button"
            accessibilityLabel={t('profile.editLoadRetry')}
          >
            <Text style={styles.goBackBtnText}>{t('profile.editLoadRetry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Render — show-form (the real confirm screen) ──────────────────────────
  //
  // 'session-expired' is never actually set as state (runReopenEntryGet
  // intercepts it and calls onSessionExpired() directly — see
  // reopenEntryRuntimeWiring.ts); this defensive branch only exists to keep
  // TypeScript's narrowing sound end-to-end.
  if (outcome.type === 'session-expired') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={T.color.accent.interactive} />
        </View>
      </SafeAreaView>
    );
  }

  const { profile } = outcome;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title} accessibilityRole="header">
          {t('loss.reopen.confirm.title')}
        </Text>
        <Text style={styles.body}>{t('loss.reopen.confirm.body')}</Text>

        <View style={styles.divider} />

        {confirmError != null && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{confirmError}</Text>
            <TouchableOpacity
              testID="reopen-confirm-retry"
              style={styles.retryLink}
              onPress={() => void handleConfirm(profile.version)}
              accessibilityRole="button"
              accessibilityLabel={t('general.retry')}
            >
              <Text style={styles.retryLinkText}>{t('general.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* "Go back" — PROMINENT primary action (same treatment as Screen B). */}
        <TouchableOpacity
          testID="reopen-confirm-goback"
          style={[styles.goBackBtn, submitting && styles.goBackBtnDisabled]}
          onPress={onGoBack}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={t('loss.confirm.primaryBack')}
          accessibilityState={{ disabled: submitting }}
        >
          <Text style={styles.goBackBtnText}>{t('loss.confirm.primaryBack')}</Text>
        </TouchableOpacity>

        {/* Quiet Confirm link — deliberate, less prominent, single-flight guarded. */}
        <TouchableOpacity
          testID="reopen-confirm-quiet"
          style={styles.quietLink}
          onPress={() => handleConfirm(profile.version)}
          disabled={submitting}
          accessibilityRole="link"
          accessibilityLabel={
            submitting
              ? `${t('loss.reopen.confirm.quietConfirm')} ${t('loss.confirm.submitting')}`
              : t('loss.reopen.confirm.quietConfirm')
          }
          accessibilityState={{ disabled: submitting }}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={T.color.text.primary} />
          ) : (
            <Text style={styles.quietLinkText}>{t('loss.reopen.confirm.quietConfirm')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles — ห้องแม่ tokens ONLY ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.color.surface.base },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, gap: 16 },
  title: {
    fontFamily: T.type.heading1.fontFamily,
    fontSize: T.type.heading1.size,
    lineHeight: T.type.heading1.lineHeight,
    color: T.color.text.heading,
  },
  body: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
  },
  divider: {
    height: 1,
    backgroundColor: T.color.surface.divider,
    marginVertical: 8,
  },
  noticeText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    padding: 16,
    gap: 8,
  },
  errorText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  retryLink: {
    minHeight: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  retryLinkText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    textDecorationLine: 'underline',
  },
  goBackBtn: {
    height: T.button.primary.height,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  goBackBtnDisabled: {
    backgroundColor: T.scrim.amber,
  },
  goBackBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
  },
  quietLink: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  quietLinkText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
});
