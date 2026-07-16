/**
 * ManageConsentsScreen — S8 Manage Consents (PDPA ม.19 withdrawal).
 *
 * Design ref: first-run-consent.md §3.3 (v2, design-reviewed).
 * Copy ref:   consent-copy.md §7 (withdrawal confirmation copy, v1.0 DRAFT).
 *
 * Shows all 6 PDPA consent purposes grouped in 3 sections:
 *   Core            → general_health
 *   Sync & reports  → cloud_storage, pdf_egress, sensitive_lab_results
 *   Baby data       → infant_feeding, child_health
 *
 * Screen states (§3.3.0):
 *   skeleton — local store empty, GET in flight
 *   loaded   — full list (normal path, no spinner on open)
 *   error    — GET failed, retry available
 *
 * Per-row states (§3.3.3):
 *   idle     — toggle + mark shown
 *   toggling — toggle disabled, spinner replaces mark
 *   error    — inline error under row, toggle springs back
 *
 * Withdrawal flow (§3.3.2):
 *   Toggle OFF (general_health / cloud_storage / infant_feeding / child_health)
 *     → confirmation sheet → POST granted:false
 *   Toggle OFF (pdf_egress / sensitive_lab_results)
 *     → POST directly (no confirmation needed)
 *   Toggle ON (any type) → POST granted:true (no confirmation)
 *
 * Pending sync badge (§4.2 step 5): shown when entry is in the offline queue.
 *
 * SECURITY: never logs accessToken; no health data flows through this screen.
 * testIDs from first-run-consent.md §5 (prefixed consent-manage-*).
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  Modal,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

import type { TokenStorage } from '../auth/tokenStorage';
import { T } from '../theme/tokens';
import { createConsentApiClient } from '../consent/consentApiClient';
import { consentStore } from '../consent/consentStore';
import { consentQueue } from '../consent/consentSync';
import { refreshCalendarBridgeConsent } from '../deviceCalendar/deviceCalendarSingleton';
import { useT } from '../i18n/LanguageContext';
import type { MessageKey } from '../i18n/messages';
import type { ConsentType } from '../consent/types';
import {
  CONSENT_SECTION_ORDER,
  SECTION_CONSENT_TYPES,
  needsWithdrawalConfirmation,
  withdrawalConfirmTestId,
} from '../consent/consentManageLogic';
import {
  consentTextVersion,
  screenStatusFromStore,
  ROW_TOGGLE_TESTID,
  ROW_ERROR_TESTID,
  PENDING_BADGE_TESTID,
  ROW_TESTID,
  type ScreenStatus,
} from './manageConsentsScreenLogic';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ManageConsentsScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  onBack: () => void;
  /**
   * Navigate to PrivacyPolicyScreen (task #40 — was a dead footer link;
   * now a real, honest-placeholder route since no lawyer-approved policy
   * copy exists yet — see PrivacyPolicyScreen.tsx doc comment).
   * Optional for backward compat with any caller not yet passing it;
   * the row renders as an inactive Text (no role) when absent, same as before.
   */
  onNavigatePrivacyPolicy?: () => void;
  /**
   * Navigate to ConsentHistoryScreen (task #40 — was a dead footer link;
   * now wired to the real GET /v1/account/consents endpoint).
   * Optional for backward compat; row renders as inactive Text when absent.
   */
  onNavigateConsentHistory?: () => void;
}

// ─── Row state ────────────────────────────────────────────────────────────────

type RowStatus = 'idle' | 'toggling' | 'error';
type RowState = Record<ConsentType, RowStatus>;

function initialRowState(): RowState {
  return {
    general_health:        'idle',
    cloud_storage:         'idle',
    pdf_egress:            'idle',
    sensitive_lab_results: 'idle',
    infant_feeding:        'idle',
    child_health:          'idle',
    // calendar_sync (#7): toggle-on → CalendarSyncConsentSheet; toggle-off → disable dialog
    calendar_sync:         'idle',
  };
}

function initialGrantedState(): Record<ConsentType, boolean> {
  return {
    general_health:        consentStore.isGranted('general_health'),
    cloud_storage:         consentStore.isGranted('cloud_storage'),
    pdf_egress:            consentStore.isGranted('pdf_egress'),
    sensitive_lab_results: consentStore.isGranted('sensitive_lab_results'),
    infant_feeding:        consentStore.isGranted('infant_feeding'),
    child_health:          consentStore.isGranted('child_health'),
    calendar_sync:         consentStore.isGranted('calendar_sync'),
  };
}

// ─── Row i18n keys ────────────────────────────────────────────────────────────

const ROW_TITLE_KEY: Record<ConsentType, MessageKey> = {
  general_health:        'consent.general_health.title',
  cloud_storage:         'consent.cloud_storage.title',
  pdf_egress:            'consent.pdf_egress.title',
  sensitive_lab_results: 'consent.sensitive_lab.title',
  infant_feeding:        'consent.infant_feeding.title',
  child_health:          'consent.child_health.title',
  calendar_sync:         'consent.calendar_sync.title',
};

const ROW_CAPTION_KEY: Record<ConsentType, MessageKey> = {
  general_health:        'consent.manage.row.general_health.caption',
  cloud_storage:         'consent.manage.row.cloud_storage.caption',
  pdf_egress:            'consent.manage.row.pdf_egress.caption',
  sensitive_lab_results: 'consent.manage.row.sensitive_lab.caption',
  infant_feeding:        'consent.infant_feeding.parental_note',
  child_health:          'consent.child_health.parental_note',
  // calendar_sync: "เพิ่มนัดฝากครรภ์ลงปฏิทินในเครื่อง" — data_copy verbatim from consent-copy-doc
  calendar_sync:         'consent.calendar_sync.data_copy',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ManageConsentsScreen({
  tokenStorage,
  apiBaseUrl,
  onBack,
  onNavigatePrivacyPolicy,
  onNavigateConsentHistory,
}: ManageConsentsScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  const [screenStatus, setScreenStatus] = useState<ScreenStatus>(() =>
    screenStatusFromStore(Object.keys(consentStore.getState()).length > 0),
  );

  const [grantedState, setGrantedState] =
    useState<Record<ConsentType, boolean>>(initialGrantedState);

  const [rowStatus, setRowStatus] = useState<RowState>(initialRowState);

  // Active withdrawal confirmation sheet (null = sheet closed)
  const [confirmWithdrawType, setConfirmWithdrawType] = useState<ConsentType | null>(null);

  // ── Hydrate from server when store is empty ──────────────────────────────────
  useEffect(() => {
    if (screenStatus !== 'skeleton') return;
    let cancelled = false;

    void (async () => {
      try {
        const tokens = await tokenStorage.load();
        if (!tokens || cancelled) return;
        const client = createConsentApiClient(apiBaseUrl);
        const result = await client.getConsents(tokens.accessToken);
        if (cancelled) return;
        if (result.ok) {
          consentStore.hydrate(result.page.items);
          // Trigger self-heal if server refresh discovers a consent withdrawal
          // (CAL-SA-30/31/32 — onConsentRefreshResult deletes app-created events
          // and disables the feature if calendar_sync was withdrawn remotely).
          void refreshCalendarBridgeConsent();
          setGrantedState(initialGrantedState());
          setScreenStatus('loaded');
        } else {
          setScreenStatus('error');
        }
      } catch {
        if (!cancelled) setScreenStatus('error');
      }
    })();

    return () => { cancelled = true; };
  }, [screenStatus, tokenStorage, apiBaseUrl]);

  // ── POST a consent change ─────────────────────────────────────────────────────
  const postConsentChange = useCallback(
    async (type: ConsentType, granted: boolean): Promise<void> => {
      const version = consentTextVersion(locale);

      // Optimistic update — gate decisions work even before server confirms
      setGrantedState((prev) => ({ ...prev, [type]: granted }));
      consentStore.setGranted(type, granted, version);
      setRowStatus((prev) => ({ ...prev, [type]: 'toggling' }));

      try {
        const tokens = await tokenStorage.load();
        if (!tokens) throw new Error('no_tokens');

        const client = createConsentApiClient(apiBaseUrl);
        const result = await client.postConsent(type, granted, version, tokens.accessToken);

        if (result.ok) {
          // Dequeue any queued entry for (type, granted) so the "รอซิงค์"
          // badge clears and drainConsentQueue does not re-POST (F1 fix).
          if (consentQueue.hasPendingEntry(type, granted)) {
            consentQueue.removePending(type, granted);
            void consentQueue.persist();
          }
          setRowStatus((prev) => ({ ...prev, [type]: 'idle' }));
        } else {
          // Queue for background retry; show inline error
          if (!consentQueue.hasPendingEntry(type, granted)) {
            consentQueue.enqueue(type, granted, version);
            void consentQueue.persist();
          }
          setRowStatus((prev) => ({ ...prev, [type]: 'error' }));
        }
      } catch {
        if (!consentQueue.hasPendingEntry(type, granted)) {
          consentQueue.enqueue(type, granted, version);
          void consentQueue.persist();
        }
        setRowStatus((prev) => ({ ...prev, [type]: 'error' }));
      }
    },
    [locale, tokenStorage, apiBaseUrl],
  );

  // ── Toggle tapped ─────────────────────────────────────────────────────────────
  const handleToggle = useCallback(
    (type: ConsentType, newValue: boolean): void => {
      if (rowStatus[type] === 'toggling') return;
      if (!newValue && needsWithdrawalConfirmation(type)) {
        // Show confirmation sheet — do NOT post yet
        setConfirmWithdrawType(type);
      } else {
        void postConsentChange(type, newValue);
      }
    },
    [rowStatus, postConsentChange],
  );

  // ── Withdrawal confirmed ──────────────────────────────────────────────────────
  const handleWithdrawConfirm = useCallback((): void => {
    if (!confirmWithdrawType) return;
    const type = confirmWithdrawType;
    setConfirmWithdrawType(null);
    void postConsentChange(type, false);
  }, [confirmWithdrawType, postConsentChange]);

  // ── Row retry ─────────────────────────────────────────────────────────────────
  const handleRowRetry = useCallback(
    (type: ConsentType): void => {
      void postConsentChange(type, grantedState[type]);
    },
    [grantedState, postConsentChange],
  );

  // ─── Skeleton state ──────────────────────────────────────────────────────────
  if (screenStatus === 'skeleton') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.scroll}>
          <TouchableOpacity style={styles.backRow} onPress={onBack}>
            <Text style={styles.backText}>{t('general.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>{t('consent.manage.title')}</Text>
          <View testID="consent-manage-screen-skeleton">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={styles.skeletonRow} />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error state ─────────────────────────────────────────────────────────────
  if (screenStatus === 'error') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.scroll}>
          <TouchableOpacity style={styles.backRow} onPress={onBack}>
            <Text style={styles.backText}>{t('general.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>{t('consent.manage.title')}</Text>
          <View testID="consent-manage-screen-load-error" style={styles.loadErrorPanel}>
            <Text style={styles.loadErrorText}>{t('consent.manage.load_error')}</Text>
            <TouchableOpacity
              testID="consent-manage-screen-load-retry-btn"
              style={styles.loadRetryBtn}
              onPress={() => setScreenStatus('skeleton')}
            >
              <Text style={styles.loadRetryBtnLabel}>{t('consent.manage.load_retry_btn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Full list view ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView testID="consent-manage-screen" style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity style={styles.backRow} onPress={onBack}>
          <Text style={styles.backText}>{t('general.back')}</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>{t('consent.manage.title')}</Text>
        <Text style={styles.screenSubtitle}>{t('consent.manage.subtitle')}</Text>

        {CONSENT_SECTION_ORDER.map((section) => (
          <View key={section}>
            <Text style={styles.sectionHeader}>
              {t(`consent.manage.section.${section}` as Parameters<typeof t>[0])}
            </Text>

            {SECTION_CONSENT_TYPES[section].map((type) => {
              const isOn = grantedState[type];
              const status = rowStatus[type];
              const isBusy = status === 'toggling';
              const hasError = status === 'error';
              const pendingSync = consentQueue.hasPendingEntry(type, isOn);

              return (
                <React.Fragment key={type}>
                  <TouchableOpacity
                    testID={ROW_TESTID[type]}
                    style={styles.row}
                    onPress={() => handleToggle(type, !isOn)}
                    accessibilityRole="switch"
                    accessibilityLabel={
                      `${t(ROW_TITLE_KEY[type])}, ${isOn ? t('consent.manage.row.stateOn') : t('consent.manage.row.stateOff')}, ${t('consent.manage.row.toggleHint')}`
                    }
                  >
                    <View style={styles.rowLeft}>
                      {isBusy ? (
                        <ActivityIndicator size="small" color={T.color.accent.interactive} style={styles.rowMark} />
                      ) : (
                        <Text
                          style={isOn ? styles.markGranted : styles.markDue}
                          accessibilityElementsHidden
                        >
                          {isOn ? '◉' : '◯'}
                        </Text>
                      )}
                      <View style={styles.rowTextGroup}>
                        <Text style={styles.rowTitle}>
                          {t(ROW_TITLE_KEY[type])}
                        </Text>
                        <Text style={styles.rowCaption}>
                          {t(ROW_CAPTION_KEY[type])}
                        </Text>
                        {pendingSync && (
                          <Text
                            testID={PENDING_BADGE_TESTID[type]}
                            style={styles.pendingSyncBadge}
                          >
                            {t('consent.manage.pending_sync_badge')}
                          </Text>
                        )}
                      </View>
                    </View>

                    <Switch
                      testID={ROW_TOGGLE_TESTID[type]}
                      value={isOn}
                      onValueChange={(v) => handleToggle(type, v)}
                      disabled={isBusy}
                      trackColor={{ false: T.color.surface.divider, true: T.color.accent.interactive }}
                      thumbColor={T.color.surface.base}
                      accessibilityElementsHidden
                    />
                  </TouchableOpacity>

                  {hasError && (
                    <View
                      testID={ROW_ERROR_TESTID[type]}
                      style={styles.rowErrorPanel}
                    >
                      <Text style={styles.rowErrorText}>
                        {t('consent.error.save_failed')}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleRowRetry(type)}
                        style={styles.rowRetryBtn}
                      >
                        <Text style={styles.rowRetryBtnLabel}>
                          {t('consent.error.retry_btn')} ›
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </React.Fragment>
              );
            })}
          </View>
        ))}

        {/* Footer */}
        {/* task #40 fix: these two rows previously had accessibilityRole="link"
         * with NO onPress and NO navigable target (mobile-reviewer cluster 6
         * finding) — an unreachable, misleading affordance for screen-reader
         * users. Both routes now exist (PrivacyPolicyScreen — honest
         * "in progress" placeholder, no lawyer-approved copy exists yet;
         * ConsentHistoryScreen — real, wired to GET /v1/account/consents), so
         * these render as real interactive links whenever the caller passes
         * the nav callbacks; they fall back to the prior inactive-text
         * treatment only if a caller doesn't wire the callbacks (defensive
         * backward-compat, should not happen once RootNavigator is updated). */}
        <View style={styles.footer}>
          <Text style={styles.footerCaption}>{t('consent.text_version.label')} v1.0</Text>
          {onNavigatePrivacyPolicy ? (
            <TouchableOpacity
              testID="consent-manage-policy-link"
              style={styles.footerLinkRow}
              onPress={onNavigatePrivacyPolicy}
              accessibilityRole="link"
              accessibilityLabel={t('consent.manage.policy_link')}
            >
              <Text style={styles.footerLinkText}>{t('consent.manage.policy_link')} ›</Text>
            </TouchableOpacity>
          ) : (
            <Text
              testID="consent-manage-policy-link"
              style={styles.footerTextInactive}
            >
              {t('consent.manage.policy_link')}
            </Text>
          )}
          {onNavigateConsentHistory ? (
            <TouchableOpacity
              testID="consent-manage-history-link"
              style={styles.footerLinkRow}
              onPress={onNavigateConsentHistory}
              accessibilityRole="link"
              accessibilityLabel={t('consent.manage.history_link')}
            >
              <Text style={styles.footerLinkText}>{t('consent.manage.history_link')} ›</Text>
            </TouchableOpacity>
          ) : (
            <Text
              testID="consent-manage-history-link"
              style={styles.footerTextInactive}
            >
              {t('consent.manage.history_link')}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* ── Withdrawal confirmation sheet (§3.3.2) ─────────────────────────── */}
      {confirmWithdrawType !== null && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setConfirmWithdrawType(null)}
          accessibilityViewIsModal
        >
          <View style={styles.sheetOverlay}>
            <View
              testID={withdrawalConfirmTestId(confirmWithdrawType)}
              style={styles.sheet}
            >
              <Text style={styles.sheetTitle}>
                {t(`consent.manage.withdraw_confirm.${confirmWithdrawType}.title` as Parameters<typeof t>[0])}
              </Text>
              <Text style={styles.sheetBody}>
                {t(`consent.manage.withdraw_confirm.${confirmWithdrawType}.body` as Parameters<typeof t>[0])}
              </Text>

              {/* Secondary (not destructive Primary) — §3.3.2 */}
              <TouchableOpacity
                testID="consent-manage-withdraw-confirm-do-it-btn"
                style={styles.sheetSecondaryBtn}
                onPress={handleWithdrawConfirm}
                accessibilityRole="button"
                accessibilityLabel={
                  `${t(`consent.manage.withdraw_confirm.${confirmWithdrawType}.title` as Parameters<typeof t>[0])}, ${t('consent.manage.confirmA11ySuffix')}`
                }
              >
                <Text style={styles.sheetSecondaryBtnLabel}>
                  {t('consent.manage.withdraw_confirm.do_it_btn')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="consent-manage-withdraw-cancel-btn"
                style={styles.sheetQuietBtn}
                onPress={() => setConfirmWithdrawType(null)}
                accessibilityRole="button"
              >
                <Text style={styles.sheetQuietBtnLabel}>
                  {t('consent.manage.withdraw_confirm.cancel_btn')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },
  scroll: {
    padding: T.spacing[5],
    paddingBottom: T.spacing[10],
  },

  backRow: { marginBottom: T.spacing[2] },
  backText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.accent.interactive,
    fontWeight: '500',
  },

  screenTitle: {
    fontFamily: T.type.heading1.fontFamily,
    fontSize: T.type.heading1.size,
    lineHeight: T.type.heading1.lineHeight,
    color: T.color.text.heading,
    marginBottom: T.spacing[1] + 2,
  },
  screenSubtitle: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    marginBottom: T.spacing[6],
  },

  sectionHeader: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    letterSpacing: T.type.label.letterSpacing,
    color: T.color.text.botanical,
    marginBottom: T.spacing[2],
    marginTop: T.spacing[3],
  },

  row: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    paddingVertical: 14,
    paddingHorizontal: T.spacing[4],
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: T.spacing[2],
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: T.spacing[3],
  },
  rowMark: { width: 20, marginRight: T.spacing[2] },
  markGranted: { fontSize: 16, color: T.color.state.success, marginRight: T.spacing[2] },
  markDue:     { fontSize: 16, color: T.color.text.secondary, marginRight: T.spacing[2] },
  rowTextGroup: { flex: 1 },
  rowTitle: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    color: T.color.text.heading,
    fontWeight: '500',
  },
  rowCaption: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.botanical,
    marginTop: 2,
  },
  // mobile-reviewer fix (cluster 6 review): was T.type.micro (11sp) with
  // T.color.text.secondary (jade-600) — jade-600 is HARD-gated to ≥15sp (§0 R4);
  // at 11sp this fails the contrast floor. Bumped to T.type.caption (13sp) —
  // still fails the ≥15sp floor for jade-600, so also retoken to
  // T.color.text.botanical (jade-800, AAA at any size) to satisfy R4 cleanly.
  pendingSyncBadge: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.botanical,
    marginTop: 2,
  },

  rowErrorPanel: {
    backgroundColor: T.errorPanel.bg,
    borderRadius: T.radius.sm,
    padding: T.spacing[3] - 2,
    marginBottom: T.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowErrorText: { flex: 1, fontSize: T.type.caption.size, color: T.errorPanel.body },
  rowRetryBtn: { marginLeft: T.spacing[2] },
  rowRetryBtnLabel: { fontSize: T.type.caption.size, fontWeight: '700', color: T.color.accent.interactive },

  footer: { marginTop: T.spacing[6] },
  footerCaption: { fontSize: T.type.caption.size, color: T.color.text.botanical, marginBottom: T.spacing[1] + 2 },
  // mobile-reviewer fix (cluster 6 review): was footerLink (accent.interactive,
  // implying a navigable link) — these two rows have no route yet (see REPORT:
  // PrivacyPolicy / ConsentHistory routes needed). Rendered as plain inactive
  // text (text.primary, no chevron) until the routes exist.
  footerTextInactive: { fontSize: T.type.caption.size, color: T.color.text.primary, marginBottom: T.spacing[1] },
  // task #40: real interactive footer links (>=48dp tap target).
  footerLinkRow: { minHeight: 48, justifyContent: 'center' },
  footerLinkText: { fontSize: T.type.caption.size, color: T.color.accent.interactive, fontWeight: '600' },

  skeletonRow: {
    height: 52,
    backgroundColor: T.skeleton.color,
    borderRadius: T.radius.md,
    opacity: 0.5,
    marginBottom: T.spacing[2],
  },

  loadErrorPanel: {
    marginTop: T.spacing[6],
    backgroundColor: T.errorPanel.bg,
    borderRadius: T.radius.md,
    padding: T.spacing[4],
    alignItems: 'center',
  },
  loadErrorText: {
    fontSize: T.type.bodyLarge.size,
    color: T.errorPanel.body,
    marginBottom: T.spacing[3],
    textAlign: 'center',
  },
  loadRetryBtn: {
    paddingHorizontal: T.spacing[5],
    paddingVertical: T.spacing[2] + 2,
    borderRadius: T.radius.sm,
    borderWidth: 1.5,
    borderColor: T.color.accent.interactive,
  },
  loadRetryBtnLabel: { fontSize: T.type.bodyLarge.size, fontWeight: '700', color: T.color.accent.interactive },

  sheetOverlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    padding: T.spacing[6],
    paddingBottom: T.spacing[10],
  },
  sheetTitle: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
    marginBottom: T.spacing[3],
  },
  sheetBody: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    color: T.color.text.primary,
    marginBottom: T.spacing[6],
  },
  sheetSecondaryBtn: {
    backgroundColor: T.color.surface.base,
    borderRadius: T.radius.md,
    borderWidth: 1.5,
    borderColor: T.color.accent.interactive,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.spacing[3],
  },
  sheetSecondaryBtnLabel: { fontWeight: '700', fontSize: T.type.bodyLarge.size, color: T.color.accent.interactive },
  sheetQuietBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  // cluster 6 review fix: this is the CANCEL / keep-consent button in the
  // withdrawal sheet — not a genuine emergency. It was wired to the reserved
  // error colour (T.color.state.error), which visually alarmed the mother over
  // a calm "keep as is" choice. Retoned to quiet roselle-900 heading ink — the
  // withdraw action itself (sheetSecondaryBtn, above) stays the calm
  // amber-outline treatment.
  sheetQuietBtnLabel: { fontWeight: '700', fontSize: T.type.bodyLarge.size, color: T.color.text.heading },
});
