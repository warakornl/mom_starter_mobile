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
import { consentQueue } from '../consent/consentSync';
import { useT } from '../i18n/LanguageContext';
import type { Locale } from '../auth/types';
import { T } from '../theme/tokens';

// ─── Consent text version ─────────────────────────────────────────────────────

/** Returns the consent text version tag for the given locale. */
function consentTextVersion(locale: Locale): string {
  return locale === 'en' ? 'v1.0-en' : 'v1.0-th';
}

// NOTE: consentQueue is imported from consentSync (module-level durable queue).
// It is backed by a storage proxy configured at app startup (App.tsx) with
// expo-secure-store, so queued consents survive app-kill restarts (B2 §4.2.4).
// Drain is wired in HomeScreen on AppState 'active' (foreground).

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
        // Queue for background retry — dedup so retrying the screen doesn't
        // append duplicate entries (S1: dedup by consentType + granted direction)
        if (!consentQueue.hasPendingEntry('general_health', true)) {
          consentQueue.enqueue('general_health', true, version);
          void consentQueue.persist();
        }
        // Optimistic local state stays so health logging proceeds offline
        consentStore.setGranted('general_health', true, version);
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
        if (!consentQueue.hasPendingEntry('cloud_storage', true)) {
          consentQueue.enqueue('cloud_storage', true, version);
          void consentQueue.persist();
        }
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
            if (!consentQueue.hasPendingEntry('cloud_storage', true)) {
              consentQueue.enqueue('cloud_storage', true, version);
              void consentQueue.persist();
            }
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
              trackColor={{ false: T.color.surface.divider, true: T.color.accent.interactive }}
              thumbColor={T.color.surface.base}
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
            <ActivityIndicator color={T.button.primary.text} size="small" />
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

// ─── Styles — ALL values from T.* tokens; NO inline hex ──────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.color.surface.base,             // #FBF6F1
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },

  // Title / subtitle
  displayTitle: {
    fontFamily: T.type.display.fontFamily,              // Sarabun-SemiBold
    fontSize: 28,
    lineHeight: 45,                                     // ~1.6× Thai
    color: T.color.text.heading,                        // #4A2230 roselle-900
    marginBottom: T.spacing[2],                         // 8dp
    letterSpacing: 0,
  },
  subtitle: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 roselle-700 (NOT #5F4A52)
    marginBottom: T.spacing[6],                         // 24dp
    letterSpacing: 0,
  },

  // Card (both items)
  card: {
    backgroundColor: T.color.surface.subtle,            // #F5EDE6 ivory-200 (NOT white)
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.color.surface.divider,               // #E8DDD5 (NOT #EBE1D9)
    padding: T.spacing[4],                              // 16dp
    marginBottom: T.spacing[4],                         // 16dp
    elevation: 1,
    shadowColor: T.color.text.heading,                  // #4A2230 (NOT raw #3A2A30)
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  cardGranted: {
    backgroundColor: T.color.surface.wash.jade,         // #E4EDE7 jade-100 (NOT sage #EBF2EC)
    borderColor: T.color.surface.divider,               // #E8DDD5
  },
  cardTitle: {
    fontFamily: T.type.heading2.fontFamily,             // Sarabun-SemiBold
    fontSize: T.type.heading2.size,                     // 20sp (was 18)
    lineHeight: T.type.heading2.lineHeight,             // 33
    color: T.color.text.heading,                        // #4A2230
    marginTop: T.spacing[1],                            // 4dp
    marginBottom: T.spacing[1],                         // 4dp (was 6)
    letterSpacing: 0,
  },
  cardBody: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 roselle-700 (NOT #5F4A52)
    marginBottom: T.spacing[1],                         // 4dp (was 6)
    letterSpacing: 0,
  },
  // DESIGN-REVIEWER GATE: cardCaption MUST use type.caption (13sp) + text.primary (7.70:1)
  cardCaption: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.text.primary,                        // #7A3A52 roselle-700 (NOT banned #94818A)
    marginBottom: T.spacing[3],                         // 12dp
    letterSpacing: 0,
  },

  // Status marks — decorative (accessibilityElementsHidden)
  markDue: {
    fontSize: 18,
    color: T.color.text.primary,                        // #7A3A52 roselle-700
    marginBottom: T.spacing[1],                         // 4dp
  },
  markGranted: {
    fontSize: 18,
    color: T.color.text.botanical,                      // #2F5042 jade-800 (NOT sage #4A7A56)
    marginBottom: T.spacing[1],                         // 4dp
  },

  // Grant button (general_health item 1)
  grantBtn: {
    backgroundColor: T.color.surface.subtle,            // #F5EDE6 ivory-200 (NOT white)
    borderWidth: 1.5,
    borderColor: T.color.accent.interactive,            // #9A5F0A amber-700 (NOT #A8505A)
    borderRadius: T.radius.sm,                          // 6dp (was 8)
    paddingVertical: 12,
    paddingHorizontal: T.spacing[4],                    // 16dp
    alignItems: 'center',
    minHeight: 52,                                      // ≥52dp touch target
    justifyContent: 'center',
  },
  grantBtnGranted: {
    backgroundColor: T.color.surface.wash.jade,         // jade-100 (NOT sage #EBF2EC)
    borderColor: T.color.text.botanical,                // jade-800 (NOT sage #4A7A56)
  },
  grantBtnLabel: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.color.text.primary,                        // #7A3A52 roselle-700 (NOT #A8505A)
    letterSpacing: 0,
  },
  grantBtnLabelGranted: {
    color: T.color.text.botanical,                      // jade-800 (NOT sage #3D6647)
  },

  // cloud_storage toggle row
  cloudStorageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: T.spacing[2],                         // 8dp
  },
  cloudStorageTextGroup: {
    flex: 1,
  },
  offNote: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.text.primary,                        // #7A3A52 (NOT banned #94818A)
    letterSpacing: 0,
  },

  // Policy row
  policyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: T.spacing[4],                         // 16dp
  },
  caption: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.text.primary,                        // #7A3A52 (NOT banned #94818A)
    letterSpacing: 0,
  },
  policyLink: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.accent.interactive,                  // amber-700 (NOT #A8505A)
    letterSpacing: 0,
  },

  // Error panel
  errorPanel: {
    backgroundColor: T.color.surface.subtle,            // #F5EDE6 (NOT #F5F0ED)
    borderRadius: T.radius.sm,                          // 6dp
    padding: T.spacing[3],                              // 12dp
    marginBottom: T.spacing[3],                         // 12dp
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorPanelText: {
    flex: 1,
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    letterSpacing: 0,
  },
  retryBtn: {
    marginLeft: T.spacing[3],                           // 12dp
    paddingHorizontal: T.spacing[3],                    // 12dp
    paddingVertical: T.spacing[1],                      // 4dp (was 6)
    borderRadius: T.radius.sm,                          // 6dp (was 6)
    borderWidth: 1,
    borderColor: T.color.text.primary,                  // #7A3A52 (NOT #A8505A)
  },
  retryBtnLabel: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.body.size,                         // 15sp
    color: T.color.text.primary,                        // #7A3A52 (NOT #A8505A)
    letterSpacing: 0,
  },

  // Continue button — amber-700 CTA
  continueBtn: {
    backgroundColor: T.button.primary.bg,               // #9A5F0A amber-700 (NOT #A8505A)
    borderRadius: T.button.primary.radius,              // 14dp
    minHeight: T.button.primary.height,                 // 52dp
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.spacing[3],                         // 12dp
  },
  continueBtnDisabled: {
    opacity: 0.6,
  },
  continueBtnLabel: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.button.primary.text,                       // #FBF6F1 (NOT raw #FFFFFF)
    letterSpacing: 0,
  },

  // Health required note
  healthRequiredNote: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    textAlign: 'center',
    marginBottom: T.spacing[2],                         // 8dp
    letterSpacing: 0,
  },

  // Change later note — PDPA trust marker
  changeLaterNote: {
    fontFamily: T.type.caption.fontFamily,              // Sarabun-Regular
    fontSize: T.type.caption.size,                      // 13sp
    lineHeight: T.type.caption.lineHeight,              // 21
    color: T.color.text.primary,                        // #7A3A52 roselle-700 (NOT banned #94818A)
    textAlign: 'center',
    letterSpacing: 0,
  },

  // Skip sheet (bottom sheet modal)
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(58, 42, 48, 0.4)',           // overlay — not a color token
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.color.surface.subtle,            // #F5EDE6 (NOT white)
    borderTopLeftRadius: T.radius.lg,                   // 20dp
    borderTopRightRadius: T.radius.lg,                  // 20dp
    padding: T.spacing[6],                              // 24dp
    paddingBottom: 40,
  },
  sheetTitle: {
    fontFamily: T.type.heading2.fontFamily,             // Sarabun-SemiBold
    fontSize: T.type.heading2.size,                     // 20sp
    lineHeight: T.type.heading2.lineHeight,             // 33
    color: T.color.text.heading,                        // #4A2230 (NOT raw #3A2A30)
    marginBottom: T.spacing[3],                         // 12dp
    letterSpacing: 0,
  },
  sheetBody: {
    fontFamily: T.type.body.fontFamily,                 // Sarabun-Regular
    fontSize: T.type.body.size,                         // 15sp
    lineHeight: T.type.body.lineHeight,                 // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT #5F4A52)
    marginBottom: T.spacing[6],                         // 24dp
    letterSpacing: 0,
  },
  sheetPrimaryBtn: {
    backgroundColor: T.button.primary.bg,               // amber-700 (NOT #A8505A)
    borderRadius: T.button.primary.radius,              // 14dp
    minHeight: T.button.primary.height,                 // 52dp
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.spacing[3],                         // 12dp
  },
  sheetPrimaryBtnLabel: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.button.primary.text,                       // #FBF6F1
    letterSpacing: 0,
  },
  sheetQuietBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sheetQuietBtnLabel: {
    fontFamily: T.type.label.fontFamily,                // Sarabun-SemiBold
    fontSize: T.type.label.size,                        // 15sp
    lineHeight: T.type.label.lineHeight,                // 25
    color: T.color.text.primary,                        // #7A3A52 (NOT old rose/700 #8E3A44)
    letterSpacing: 0,
  },
});
