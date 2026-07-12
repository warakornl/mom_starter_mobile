/**
 * LossConfirmScreen — Screen B: pregnancy-loss two-step confirmation.
 *
 * Implements pregnancy-loss-recording-ui.md §3 + functional-spec §14.
 * Highest-sensitivity screen in the app — plain, unhurried, no stage glyph,
 * no celebratory fill anywhere (TONE-4).
 *
 * Two-step confirm discipline (non-negotiable):
 *   - "Go back" is the PROMINENT primary action (amber-700 filled button,
 *     52dp height) — TONE-5: the safe exit is the easier, more visible action.
 *   - Quiet Confirm is a plain-text link (caption size, no fill) requiring a
 *     deliberate, separate tap.
 *   - Both controls disabled during Submitting (single-flight guard).
 *
 * Writes via POST /pregnancy-profile/loss-event (LOSS-INV-1). Calling this
 * is the ONLY production caller of recordLossEvent in the app.
 *
 * Copy: all strings are i18n keys (Z-19 gate) — see messages.ts 'loss.*'
 * block. Do NOT hardcode strings here.
 *
 * mobile-reviewer BLOCKER-2 fix (no false-success): a network/5xx failure on
 * confirm is NEVER treated as success — there is no onLossRecorded(null)
 * "assume success" path. The screen shows a calm inline error and stays on
 * screen so the mother is never told "recorded" when nothing was recorded
 * server-side. Full optimistic-apply + offline queue (functional-spec §10.3)
 * is an explicit follow-up (to be done together with BirthEvent and
 * ReopenConfirmScreen for consistency), NOT implemented in this pass.
 *
 * mobile-reviewer 🟡 fixes:
 *   - A missing accessToken (session expired) now calls onSessionExpired,
 *     NOT the consent-required message (those are different failure modes).
 *   - The 403 consent backstop now renders a real "Go to consent" action
 *     (§3.5), wired to onGoToConsent — not just a bare error string.
 *
 * Security: NEVER log accessToken or the resolved lossDate value.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';
import { createPregnancyClient } from './pregnancyApiClient';
import { localCivilToday } from './gestationalAge';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { validateLossDate, buildLossEventInput } from './lossEventLogic';
import type { PregnancyProfile } from './types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LossConfirmScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Current profile version (for If-Match: "<version>" header). */
  profileVersion: number;
  /** Retained EDD — used only for the client-side lossDate lower-floor check. */
  edd: string;
  /**
   * Called on success (200 ended) and on 409-already-ended (intent
   * satisfied, §10.4). NEVER called on network/5xx failure (BLOCKER-2 — no
   * false-success).
   */
  onLossRecorded: (profile: PregnancyProfile) => void;
  /**
   * Called on "Go back" (dismiss, nothing recorded) AND on the benign
   * 409-postpartum terminal (profile moved on another device — entry link
   * is hidden at postpartum, so this simply closes the loss path calmly).
   */
  onGoBack: () => void;
  /** SD-5: called when accessToken is missing or the server returns 401. */
  onSessionExpired?: () => void;
  /** §3.5: consent backstop's "Go to consent" route-out affordance. */
  onGoToConsent?: () => void;
  /**
   * direct-rest-offline-resilience §7: called on network/offline failure
   * INSTEAD of showing the generic conflict error — the caller (RootNavigator)
   * runs the NEW optimistic-apply producer (lossOptimisticApply.ts): flips the
   * raw snapshot to lifecycle:'ended' via useProfileSnapshotSetter() and
   * enqueues a profileVerbQueue loss_event entry, then navigates on (same as
   * onLossRecorded). If omitted (backward-compat), falls back to the calm
   * "offline · will sync" error copy with NO local-state flip (today's
   * behavior). Never called for a 4xx/5xx server response — only for a
   * network/offline throw (BLOCKER-2 still holds: no false-success on an
   * actual server rejection).
   */
  onOfflineApply?: (lossDate: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LossConfirmScreen({
  tokenStorage,
  apiBaseUrl,
  profileVersion,
  edd,
  onLossRecorded,
  onGoBack,
  onSessionExpired,
  onGoToConsent,
  onOfflineApply,
}: LossConfirmScreenProps): React.JSX.Element {
  const { t } = useT();

  const [dateInput, setDateInput] = useState('');
  const [dateHint, setDateHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConsentBackstop, setShowConsentBackstop] = useState(false);

  async function handleConfirm(): Promise<void> {
    if (submitting) return; // single-flight guard (§10.1)

    const today = localCivilToday();
    const validation = validateLossDate(dateInput, today, edd);
    if (!validation.valid) {
      setDateHint(
        validation.error === 'malformed'
          ? t('loss.confirm.dateMalformedHint')
          : t('loss.confirm.dateRangeHint'),
      );
      return;
    }
    setDateHint(null);
    setErrorMsg(null);
    setShowConsentBackstop(false);
    setSubmitting(true);

    try {
      const tokens = await tokenStorage.load();
      const accessToken = tokens?.accessToken;
      if (!accessToken) {
        // Session expired — a DIFFERENT failure mode from consent-required
        // (mobile-reviewer 🟡 fix). Never show consent copy here.
        setSubmitting(false);
        if (onSessionExpired) {
          onSessionExpired();
        } else {
          setErrorMsg(t('loss.error.conflict'));
        }
        return;
      }

      const client = createPregnancyClient(apiBaseUrl);
      const input = buildLossEventInput(dateInput);
      const result = await client.recordLossEvent(
        input,
        accessToken,
        String(profileVersion),
        today,
      );

      if (result.ok) {
        // Success — quiet acknowledgement, lands on the now loss-gated Home (§5).
        onLossRecorded(result.profile);
        return;
      }

      if (result.status === 401) {
        onSessionExpired?.();
        return;
      }

      if (result.status === 403 && result.code === 'consent_required') {
        setShowConsentBackstop(true);
        setErrorMsg(t('loss.error.consentRequired'));
        return;
      }

      if (result.status === 409) {
        const current = 'currentProfile' in result ? result.currentProfile : null;
        if (current?.lifecycle === 'ended') {
          // Intent already satisfied (another device recorded it first, §10.4).
          onLossRecorded(current);
          return;
        }
        if (current?.lifecycle === 'postpartum') {
          // Benign terminal — profile moved to postpartum elsewhere.
          onGoBack();
          return;
        }
        // Any other conflict — calm re-pull note, stay on screen.
        setErrorMsg(t('loss.error.conflict'));
        return;
      }

      // BLOCKER-2: any other server error (4xx/5xx) is a real failure — never
      // treated as success. Calm, retryable, no local-state flip.
      setErrorMsg(t('loss.error.conflict'));
    } catch {
      // BLOCKER-2 still holds: network/offline failure is a real failure —
      // onLossRecorded (the server-confirmed callback) is NEVER called here.
      // direct-rest-offline-resilience §7: instead of just showing a generic
      // error, run the NEW optimistic-apply producer via onOfflineApply —
      // the caller (RootNavigator) flips the raw snapshot to 'ended' +
      // enqueues the profileVerbQueue entry, then navigates on (same as a
      // server 200 would, but honestly marked pending-sync, never "saved").
      if (onOfflineApply) {
        onOfflineApply(dateInput);
      } else {
        // Backward-compat fallback (no producer wired) — calm error, no flip.
        setErrorMsg(t('loss.error.offlineQueued'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title} accessibilityRole="header">
          {t('loss.confirm.title')}
        </Text>
        <Text style={styles.body}>{t('loss.confirm.body')}</Text>

        <View style={styles.divider} />

        <Text style={styles.fieldLabel}>{t('loss.confirm.dateLabel')}</Text>
        <Text style={styles.skipHint}>{t('loss.confirm.dateSkipHint')}</Text>
        <TextInput
          testID="loss-confirm-date"
          style={styles.dateField}
          value={dateInput}
          onChangeText={(v) => {
            setDateInput(v);
            setDateHint(null);
          }}
          placeholder={t('loss.confirm.datePlaceholder')}
          placeholderTextColor={T.input.placeholder}
          accessibilityLabel={t('loss.confirm.dateLabel')}
          editable={!submitting}
        />
        {dateHint != null && (
          <Text
            style={styles.dateHintText}
            accessibilityLiveRegion="polite"
          >
            {dateHint}
          </Text>
        )}

        <Text style={styles.disclaimer}>{t('loss.confirm.disclaimer')}</Text>

        {showConsentBackstop && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMsg}</Text>
            {onGoToConsent != null && (
              <TouchableOpacity
                testID="loss-confirm-goto-consent"
                style={styles.retryLink}
                onPress={onGoToConsent}
                accessibilityRole="button"
                accessibilityLabel={t('loss.error.goToConsent')}
              >
                <Text style={styles.retryLinkText}>{t('loss.error.goToConsent')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {!showConsentBackstop && errorMsg != null && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* "Go back" — PROMINENT primary action (TONE-5). */}
        <TouchableOpacity
          testID="loss-confirm-goback"
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
          testID="loss-confirm-quiet"
          style={styles.quietLink}
          onPress={handleConfirm}
          disabled={submitting}
          accessibilityRole="link"
          accessibilityLabel={
            submitting
              ? `${t('loss.confirm.quietConfirm')} ${t('loss.confirm.submitting')}`
              : t('loss.confirm.quietConfirm')
          }
          accessibilityState={{ disabled: submitting }}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={T.color.text.primary} />
          ) : (
            <Text style={styles.quietLinkText}>{t('loss.confirm.quietConfirm')}</Text>
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
  fieldLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color: T.color.text.primary,
  },
  skipHint: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    marginTop: -8,
  },
  dateField: {
    backgroundColor: T.input.bg,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    paddingHorizontal: 16,
    minHeight: 56,
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.input.text,
  },
  dateHintText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  disclaimer: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  errorBox: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    padding: 16,
    gap: 8,
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
  errorText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  // "Go back" — the MORE prominent action (TONE-5): filled button, ≥52dp.
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
  // Quiet Confirm — plain text link, no fill, caption size, ≥48dp tap target.
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
