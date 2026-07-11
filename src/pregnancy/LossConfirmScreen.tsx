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
   * Called on success (200 ended), on 409-already-ended (intent satisfied,
   * §10.4), and on network/offline failure (optimistic — the mother's action
   * is honored immediately, functional-spec §10.3).
   */
  onLossRecorded: (profile: PregnancyProfile | null) => void;
  /**
   * Called on "Go back" (dismiss, nothing recorded) AND on the benign
   * 409-postpartum terminal (profile moved on another device — entry link
   * is hidden at postpartum, so this simply closes the loss path calmly).
   */
  onGoBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LossConfirmScreen({
  tokenStorage,
  apiBaseUrl,
  profileVersion,
  edd,
  onLossRecorded,
  onGoBack,
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
        setSubmitting(false);
        setErrorMsg(t('loss.error.consentRequired'));
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

      setErrorMsg(t('loss.error.conflict'));
    } catch {
      // Network/offline (§10.3): honor the mother's action immediately —
      // optimistic apply. The caller is responsible for flipping the local
      // snapshot and queuing the retry; this screen surfaces the calm
      // offline note and proceeds as if successful.
      onLossRecorded(null);
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
