/**
 * ConsentScreen — S3 First-run consent (two PDPA purposes).
 *
 * Design: first-run-consent.md §3.1 (v2, design-reviewed).
 * Copy:   consent-copy.md §2/§3 (v1.0 DRAFT — lawyer review pending §Z-2).
 * API:    consent-slice-design.md §3 (POST /v1/account/consents).
 *
 * Presents:
 *   Item 1 — general_health (ม.26): affirmative grant card (not a toggle).
 *   Item 2 — cloud_storage  (ม.26): opt-in toggle, OFF by default.
 *
 * Screen states: default | submitting | error | offline
 * On submit: sequential POSTs (general_health first, cloud_storage second).
 * On failure: queue locally, show inline error panel, allow Continue.
 * On decline general_health: show calm bottom sheet, allow limited mode.
 *
 * testIDs from first-run-consent.md §5 (all prefixed with `consent-screen-*`).
 *
 * PDPA rules enforced here (§2 design spec):
 *   1. No consent is pre-ticked or pre-toggled to ON.
 *   2. No consent is bundled with the account creation tap.
 *   3. Each consent is individually grantable.
 *   4. "Off" / declined is never shown as an error state (no amber/red).
 *   5. The continue button is always visible and always tappable.
 *
 * SECURITY: never log accessToken; no health data flows through this screen.
 *
 * Consent text version: "v1.0-th" (Thai locale) / "v1.0-en" (English).
 * This must match what the server stores for the audit trail.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';

import type { TokenStorage } from '../auth/tokenStorage';
import { createConsentApiClient } from '../consent/consentApiClient';
import { consentStore } from '../consent/consentStore';
import { createConsentQueue } from '../consent/consentQueue';
import type { ConsentQueueStorage } from '../consent/consentQueue';
import { useT } from '../i18n/LanguageContext';
import type { Locale } from '../auth/types';

// ─── Consent text version ─────────────────────────────────────────────────────

/** Returns the consent text version tag for the given locale. */
function consentTextVersion(locale: Locale): string {
  return locale === 'en' ? 'v1.0-en' : 'v1.0-th';
}

// ─── In-memory queue storage (queue survives RN memory; SecureStore binding is prod) ─

/**
 * In-memory ConsentQueueStorage.
 * For the first-run slice the queue is in-memory only. A SecureStore binding
 * (to survive full app-kill restarts) is a carry-forward for the next slice.
 */
class InMemoryConsentQueueStorage implements ConsentQueueStorage {
  private data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

// Module-level queue so it persists across re-mounts within a session.
const _queueStorage = new InMemoryConsentQueueStorage();
const _consentQueue = createConsentQueue(_queueStorage);

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConsentScreenProps {
  /** Shared secure token storage (read-only here — we never write tokens). */
  tokenStorage: TokenStorage;
  /** API base URL from config. */
  apiBaseUrl: string;
  /**
   * Called when the user has finished the consent step (regardless of what
   * they chose). The caller navigates to ProfileSetup or Home.
   * @param generalHealthGranted - true if the user granted general_health;
   *   false means the app enters limited mode.
   */
  onContinue: (generalHealthGranted: boolean) => void;
}

// ─── Screen state ─────────────────────────────────────────────────────────────

type SubmitStatus = 'idle' | 'submitting' | 'error';

// ─── Component ────────────────────────────────────────────────────────────────

export function ConsentScreen({
  tokenStorage,
  apiBaseUrl,
  onContinue,
}: ConsentScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  // ── Per-consent state ────────────────────────────────────────────────────────
  const [generalHealthGranted, setGeneralHealthGranted] = useState(false);
  const [cloudStorageGranted, setCloudStorageGranted] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
  const [showSkipSheet, setShowSkipSheet] = useState(false);

  // ─── Grant general_health ────────────────────────────────────────────────────

  const handleGrantGeneralHealth = useCallback(() => {
    if (generalHealthGranted) return; // already granted — idempotent
    setGeneralHealthGranted(true);
    // Optimistic local update so gate decisions work even before server confirms
    consentStore.setGranted('general_health', true, consentTextVersion(locale));
  }, [generalHealthGranted, locale]);

  // ─── Submit consents ─────────────────────────────────────────────────────────

  const submitConsents = useCallback(async (): Promise<boolean> => {
    const tokens = await tokenStorage.load();
    if (!tokens) return false;

    const client = createConsentApiClient(apiBaseUrl);
    const version = consentTextVersion(locale);
    let hadError = false;

    // POST general_health first (if granted)
    if (generalHealthGranted) {
      const result = await client.postConsent(
        'general_health',
        true,
        version,
        tokens.accessToken,
      );
      if (result.ok) {
        consentStore.setGranted('general_health', true, version);
      } else {
        // Queue for background retry
        const entry = _consentQueue.enqueue('general_health', true, version);
        void _queueStorage.save(JSON.stringify(_consentQueue.getEntries()));
        // Mark as pending but don't block the user
        consentStore.setGranted('general_health', true, version); // optimistic stays
        void entry; // suppress unused variable warning
        hadError = true;
      }
    }

    // POST cloud_storage second (if granted)
    if (cloudStorageGranted) {
      const result = await client.postConsent(
        'cloud_storage',
        true,
        version,
        tokens.accessToken,
      );
      if (result.ok) {
        consentStore.setGranted('cloud_storage', true, version);
      } else {
        _consentQueue.enqueue('cloud_storage', true, version);
        void _queueStorage.save(JSON.stringify(_consentQueue.getEntries()));
        consentStore.setGranted('cloud_storage', true, version); // optimistic
        hadError = true;
      }
    }

    return !hadError;
  }, [apiBaseUrl, generalHealthGranted, cloudStorageGranted, locale, tokenStorage]);

  // ─── Continue tap ─────────────────────────────────────────────────────────────

  const handleContinue = useCallback(async () => {
    if (!generalHealthGranted) {
      // Show calm bottom sheet warning — do NOT block
      setShowSkipSheet(true);
      return;
    }
    await handleContinueWithHealthGranted();
  }, [generalHealthGranted]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinueWithHealthGranted = useCallback(async () => {
    setSubmitStatus('submitting');
    try {
      await submitConsents();
      // Always proceed — errors are queued, not blocking
      setSubmitStatus('idle');
      onContinue(generalHealthGranted);
    } catch {
      setSubmitStatus('error');
    }
  }, [submitConsents, onContinue, generalHealthGranted]);

  // ─── Skip sheet handlers ──────────────────────────────────────────────────────

  const handleGoBackToGrant = useCallback(() => {
    setShowSkipSheet(false);
  }, []);

  const handleContinueWithoutLogging = useCallback(async () => {
    setShowSkipSheet(false);
    setSubmitStatus('submitting');
    try {
      // cloud_storage is still submitted if user toggled it on
      if (cloudStorageGranted) {
        const tokens = await tokenStorage.load();
        if (tokens) {
          const client = createConsentApiClient(apiBaseUrl);
          const version = consentTextVersion(locale);
          const result = await client.postConsent(
            'cloud_storage',
            true,
            version,
            tokens.accessToken,
          );
          if (!result.ok) {
            _consentQueue.enqueue('cloud_storage', true, version);
            void _queueStorage.save(JSON.stringify(_consentQueue.getEntries()));
            consentStore.setGranted('cloud_storage', true, version);
          } else {
            consentStore.setGranted('cloud_storage', true, version);
          }
        }
      }
      setSubmitStatus('idle');
      onContinue(false); // generalHealthGranted = false → limited mode
    } catch {
      setSubmitStatus('idle');
      onContinue(false);
    }
  }, [cloudStorageGranted, tokenStorage, apiBaseUrl, locale, onContinue]);

  // ─── Retry ─────────────────────────────────────────────────────────────────────

  const handleRetry = useCallback(async () => {
    setSubmitStatus('submitting');
    try {
      await submitConsents();
      setSubmitStatus('idle');
      onContinue(generalHealthGranted);
    } catch {
      setSubmitStatus('error');
    }
  }, [submitConsents, onContinue, generalHealthGranted]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  const isSubmitting = submitStatus === 'submitting';
  const showErrorPanel = submitStatus === 'error';

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Screen title ───────────────────────────────────────────────────── */}
        <Text testID="consent-screen-title" style={styles.displayTitle}>
          {t('consent.screen.title')}
        </Text>
        <Text style={styles.subtitle}>
          {t('consent.screen.subtitle')}
        </Text>

        {/* ── Item 1: general_health — grant card ──────────────────────────── */}
        <View
          testID="consent-screen-general-health-card"
          style={[
            styles.card,
            generalHealthGranted && styles.cardGranted,
          ]}
        >
          {/* Mark glyph */}
          <Text
            testID="consent-screen-general-health-mark"
            style={generalHealthGranted ? styles.markGranted : styles.markDue}
            accessibilityElementsHidden
          >
            {generalHealthGranted ? '◉' : '◯'}
          </Text>

          <Text style={styles.cardTitle}>
            {t('consent.general_health.title')}
          </Text>
          <Text style={styles.cardBody}>
            {t('consent.general_health.data_copy')}
          </Text>
          <Text style={styles.cardCaption}>
            {t('consent.general_health.purpose_copy')}
          </Text>

          {/* Grant / Granted button */}
          <TouchableOpacity
            testID="consent-screen-general-health-grant-btn"
            style={[
              styles.grantBtn,
              generalHealthGranted && styles.grantBtnGranted,
            ]}
            onPress={handleGrantGeneralHealth}
            disabled={generalHealthGranted || isSubmitting}
            accessibilityLabel={
              generalHealthGranted
                ? `${t('consent.general_health.title')}, ${t('consent.general_health.granted_label')}`
                : `${t('consent.general_health.title')}, ยังไม่ได้ยินยอม, แตะเพื่อให้ความยินยอม`
            }
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.grantBtnLabel,
                generalHealthGranted && styles.grantBtnLabelGranted,
              ]}
            >
              {generalHealthGranted
                ? `◉  ${t('consent.general_health.granted_label')}`
                : `◯  ${t('consent.general_health.grant_btn')}`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Item 2: cloud_storage — toggle ───────────────────────────────── */}
        <View style={[styles.card, cloudStorageGranted && styles.cardGranted]}>
          <View style={styles.cloudStorageRow}>
            <View style={styles.cloudStorageTextGroup}>
              <Text
                testID="consent-screen-cloud-storage-mark"
                style={cloudStorageGranted ? styles.markGranted : styles.markDue}
                accessibilityElementsHidden
              >
                {cloudStorageGranted ? '◉' : '◯'}
              </Text>
              <Text style={styles.cardTitle}>
                {t('consent.cloud_storage.title')}
              </Text>
            </View>
            <Switch
              testID="consent-screen-cloud-storage-toggle"
              value={cloudStorageGranted}
              onValueChange={(v) => {
                setCloudStorageGranted(v);
                if (v) {
                  consentStore.setGranted('cloud_storage', true, consentTextVersion(locale));
                }
              }}
              disabled={isSubmitting}
              trackColor={{ false: '#EBE1D9', true: '#A8505A' }}
              thumbColor="#FFFFFF"
              accessibilityLabel={`${t('consent.cloud_storage.title')}, ${cloudStorageGranted ? 'เปิดอยู่' : 'ปิดอยู่'}`}
              accessibilityRole="switch"
            />
          </View>
          <Text style={styles.cardBody}>
            {t('consent.cloud_storage.data_copy')}
          </Text>
          <Text style={styles.cardCaption}>
            {t('consent.cloud_storage.purpose_copy')}
          </Text>
          {!cloudStorageGranted && (
            <Text style={styles.offNote}>
              {t('consent.cloud_storage.off_note')}
            </Text>
          )}
        </View>

        {/* ── Version + policy link ─────────────────────────────────────────── */}
        <View style={styles.policyRow}>
          <Text
            testID="consent-screen-text-version-label"
            style={styles.caption}
          >
            {t('consent.text_version.label')} v1.0 ·{' '}
          </Text>
          <Text
            testID="consent-screen-policy-link"
            style={styles.policyLink}
            accessibilityRole="link"
          >
            {t('consent.policy_link')} ›
          </Text>
        </View>

        {/* ── Error panel (§3.1.5) ─────────────────────────────────────────── */}
        {showErrorPanel && (
          <View style={styles.errorPanel}>
            <Text style={styles.errorPanelText}>
              {t('consent.error.save_failed')}
            </Text>
            <TouchableOpacity
              testID="consent-screen-retry-btn"
              style={styles.retryBtn}
              onPress={() => void handleRetry()}
            >
              <Text style={styles.retryBtnLabel}>
                {t('consent.error.retry_btn')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Continue button ───────────────────────────────────────────────── */}
        <TouchableOpacity
          testID="consent-screen-continue-btn"
          style={[styles.continueBtn, isSubmitting && styles.continueBtnDisabled]}
          onPress={() => void handleContinue()}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel={t('consent.screen.continue_btn')}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.continueBtnLabel}>
              {t('consent.screen.continue_btn')}
            </Text>
          )}
        </TouchableOpacity>

        {/* ── Health-required note (shown when not yet granted) ─────────────── */}
        {!generalHealthGranted && (
          <Text
            testID="consent-screen-health-required-note"
            style={styles.healthRequiredNote}
          >
            {t('consent.general_health.required_note')}
          </Text>
        )}

        {/* ── Change later caption ──────────────────────────────────────────── */}
        <Text
          testID="consent-screen-change-later-note"
          style={styles.changeLaterNote}
        >
          {t('consent.change_later_note')}
        </Text>
      </ScrollView>

      {/* ── Skip-general-health bottom sheet (§3.1.6) ──────────────────────── */}
      <Modal
        visible={showSkipSheet}
        transparent
        animationType="slide"
        onRequestClose={handleGoBackToGrant}
        accessibilityViewIsModal
      >
        <View style={styles.sheetOverlay}>
          <View
            testID="consent-screen-skip-general-health-sheet"
            style={styles.sheet}
          >
            <Text style={styles.sheetTitle}>
              {t('consent.general_health.skip_sheet.title')}
            </Text>
            <Text style={styles.sheetBody}>
              {t('consent.general_health.skip_sheet.body')}
            </Text>

            {/* Go back & grant (Primary) */}
            <TouchableOpacity
              testID="consent-screen-go-back-to-grant-btn"
              style={styles.sheetPrimaryBtn}
              onPress={handleGoBackToGrant}
              accessibilityRole="button"
            >
              <Text style={styles.sheetPrimaryBtnLabel}>
                {t('consent.general_health.skip_sheet.go_back_btn')}
              </Text>
            </TouchableOpacity>

            {/* Continue anyway (quiet) */}
            <TouchableOpacity
              testID="consent-screen-continue-without-logging-btn"
              style={styles.sheetQuietBtn}
              onPress={() => void handleContinueWithoutLogging()}
              accessibilityRole="button"
            >
              <Text style={styles.sheetQuietBtnLabel}>
                {t('consent.general_health.skip_sheet.continue_anyway_btn')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles (design-system.md tokens) ────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FBF6F1', // bg/warm-milk
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },

  // Title / subtitle
  displayTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 28,
    lineHeight: 38,
    color: '#3A2A30', // ink
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#5F4A52', // ink/soft
    marginBottom: 24,
  },

  // Card (both items)
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBE1D9', // hairline
    padding: 16,
    marginBottom: 16,
    elevation: 1,
    shadowColor: '#3A2A30',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  cardGranted: {
    backgroundColor: '#EBF2EC', // sage/50 wash
    borderColor: '#C8DFcc', // sage/100
  },
  cardTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
    marginTop: 4,
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 16,
    lineHeight: 24,
    color: '#5F4A52',
    marginBottom: 6,
  },
  cardCaption: {
    fontSize: 13,
    lineHeight: 20,
    color: '#94818A', // ink/faint
    marginBottom: 12,
  },

  // Status marks
  markDue: {
    fontSize: 18,
    color: '#9A7E86', // status/due
    marginBottom: 4,
  },
  markGranted: {
    fontSize: 18,
    color: '#4A7A56', // sage/600
    marginBottom: 4,
  },

  // Grant button (general_health item 1)
  grantBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#A8505A', // rose/600
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  grantBtnGranted: {
    backgroundColor: '#EBF2EC', // sage/50
    borderColor: '#4A7A56', // sage/600
  },
  grantBtnLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: '#A8505A', // rose/600
  },
  grantBtnLabelGranted: {
    color: '#3D6647', // sage/700
  },

  // cloud_storage toggle row
  cloudStorageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cloudStorageTextGroup: {
    flex: 1,
  },
  offNote: {
    fontSize: 13,
    color: '#94818A',
    fontStyle: 'italic',
  },

  // Policy row
  policyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  caption: {
    fontSize: 13,
    color: '#94818A',
  },
  policyLink: {
    fontSize: 13,
    color: '#A8505A',
    fontWeight: '700',
  },

  // Error panel
  errorPanel: {
    backgroundColor: '#F5F0ED', // surface/page-sunk approximation
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorPanelText: {
    flex: 1,
    fontSize: 14,
    color: '#5F4A52',
  },
  retryBtn: {
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A8505A',
  },
  retryBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#A8505A',
  },

  // Continue button
  continueBtn: {
    backgroundColor: '#A8505A', // rose/600
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  continueBtnDisabled: {
    opacity: 0.6,
  },
  continueBtnLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: '#FFFFFF',
  },

  // Health required note
  healthRequiredNote: {
    fontSize: 14,
    color: '#5F4A52',
    textAlign: 'center',
    marginBottom: 8,
  },

  // Change later note
  changeLaterNote: {
    fontSize: 13,
    color: '#94818A',
    textAlign: 'center',
  },

  // Skip sheet (bottom sheet modal)
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(58, 42, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  sheetTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
    marginBottom: 12,
  },
  sheetBody: {
    fontSize: 16,
    lineHeight: 24,
    color: '#5F4A52',
    marginBottom: 24,
  },
  sheetPrimaryBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sheetPrimaryBtnLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: '#FFFFFF',
  },
  sheetQuietBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sheetQuietBtnLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: '#8E3A44', // rose/700
  },
});
