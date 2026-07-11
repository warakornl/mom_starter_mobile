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
 * Writes via POST /pregnancy-profile/reopen (LOSS-INV-1). Calling this is
 * the ONLY production caller of reopenPregnancy in the app.
 *
 * Security: NEVER log accessToken.
 */

import React, { useState } from 'react';
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
import { createPregnancyClient } from './pregnancyApiClient';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import type { PregnancyProfile } from './types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReopenConfirmScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Current profile version (for If-Match: "<version>" header). */
  profileVersion: number;
  /**
   * Called on success (200 pregnant, loss_date cleared — S4), and on
   * 409-already-pregnant (intent satisfied, §10.4), and on network/offline
   * failure (optimistic apply, §15.3).
   */
  onReopened: (profile: PregnancyProfile | null) => void;
  /**
   * Called on "Go back" (dismiss, nothing changed) AND on the benign
   * 409-postpartum terminal.
   */
  onGoBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReopenConfirmScreen({
  tokenStorage,
  apiBaseUrl,
  profileVersion,
  onReopened,
  onGoBack,
}: ReopenConfirmScreenProps): React.JSX.Element {
  const { t } = useT();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    if (submitting) return; // single-flight guard

    setErrorMsg(null);
    setSubmitting(true);

    try {
      const tokens = await tokenStorage.load();
      const accessToken = tokens?.accessToken;
      if (!accessToken) {
        setSubmitting(false);
        setErrorMsg(t('loss.error.consentRequired'));
        return;
      }

      const client = createPregnancyClient(apiBaseUrl);
      const result = await client.reopenPregnancy(accessToken, String(profileVersion));

      if (result.ok) {
        onReopened(result.profile);
        return;
      }

      if (result.status === 403 && result.code === 'consent_required') {
        setErrorMsg(t('loss.error.consentRequired'));
        return;
      }

      if (result.status === 409) {
        const current = 'currentProfile' in result ? result.currentProfile : null;
        if (current?.lifecycle === 'pregnant') {
          // Intent already satisfied (another device reopened first, §10.4).
          onReopened(current);
          return;
        }
        if (current?.lifecycle === 'postpartum') {
          // Benign terminal — profile moved to postpartum elsewhere.
          onGoBack();
          return;
        }
        setErrorMsg(t('loss.error.conflict'));
        return;
      }

      setErrorMsg(t('loss.error.conflict'));
    } catch {
      // Network/offline (§15.3): honor the mother's action immediately.
      onReopened(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title} accessibilityRole="header">
          {t('loss.reopen.confirm.title')}
        </Text>
        <Text style={styles.body}>{t('loss.reopen.confirm.body')}</Text>

        <View style={styles.divider} />

        {errorMsg != null && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMsg}</Text>
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
          onPress={handleConfirm}
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
  errorBox: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    padding: 16,
  },
  errorText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
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
