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
import { createConsentApiClient } from '../consent/consentApiClient';
import { consentStore } from '../consent/consentStore';
import { consentQueue } from '../consent/consentSync';
import { useT } from '../i18n/LanguageContext';
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

const ROW_TITLE_KEY: Record<ConsentType, string> = {
  general_health:        'consent.general_health.title',
  cloud_storage:         'consent.cloud_storage.title',
  pdf_egress:            'consent.pdf_egress.title',
  sensitive_lab_results: 'consent.sensitive_lab.title',
  infant_feeding:        'consent.infant_feeding.title',
  child_health:          'consent.child_health.title',
  calendar_sync:         'consent.calendar_sync.title',
};

const ROW_CAPTION_KEY: Record<ConsentType, string> = {
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
                      `${t(ROW_TITLE_KEY[type] as Parameters<typeof t>[0])}, ${isOn ? 'เปิดอยู่' : 'ปิดอยู่'}, กดสองครั้งเพื่อเปลี่ยน`
                    }
                  >
                    <View style={styles.rowLeft}>
                      {isBusy ? (
                        <ActivityIndicator size="small" color="#A8505A" style={styles.rowMark} />
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
                          {t(ROW_TITLE_KEY[type] as Parameters<typeof t>[0])}
                        </Text>
                        <Text style={styles.rowCaption}>
                          {t(ROW_CAPTION_KEY[type] as Parameters<typeof t>[0])}
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
                      trackColor={{ false: '#EBE1D9', true: '#A8505A' }}
                      thumbColor="#FFFFFF"
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
        <View style={styles.footer}>
          <Text style={styles.footerCaption}>{t('consent.text_version.label')} v1.0</Text>
          <Text
            testID="consent-manage-policy-link"
            style={styles.footerLink}
            accessibilityRole="link"
          >
            {t('consent.manage.policy_link')} ›
          </Text>
          <Text
            testID="consent-manage-history-link"
            style={styles.footerLink}
            accessibilityRole="link"
          >
            {t('consent.manage.history_link')} ›
          </Text>
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
                  `${t(`consent.manage.withdraw_confirm.${confirmWithdrawType}.title` as Parameters<typeof t>[0])}, ยืนยัน`
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
    backgroundColor: '#FBF6F1', // bg/warm-milk
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },

  backRow: { marginBottom: 8 },
  backText: { fontSize: 16, color: '#A8505A', fontWeight: '500' },

  screenTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 22,
    lineHeight: 32,
    color: '#3A2A30',
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: '#5F4A52',
    marginBottom: 24,
  },

  sectionHeader: {
    fontSize: 12,
    lineHeight: 18,
    color: '#94818A',
    marginBottom: 8,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#3A2A30',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  rowMark: { width: 20, marginRight: 8 },
  markGranted: { fontSize: 16, color: '#4A7A56', marginRight: 8 },
  markDue:     { fontSize: 16, color: '#9A7E86', marginRight: 8 },
  rowTextGroup: { flex: 1 },
  rowTitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#3A2A30',
    fontWeight: '500',
  },
  rowCaption: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94818A',
    marginTop: 2,
  },
  pendingSyncBadge: {
    fontSize: 12,
    color: '#9A7E86',
    marginTop: 2,
  },

  rowErrorPanel: {
    backgroundColor: '#F5F0ED',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowErrorText: { flex: 1, fontSize: 13, color: '#5F4A52' },
  rowRetryBtn: { marginLeft: 8 },
  rowRetryBtnLabel: { fontSize: 13, fontWeight: '700', color: '#A8505A' },

  footer: { marginTop: 24 },
  footerCaption: { fontSize: 13, color: '#94818A', marginBottom: 6 },
  footerLink: { fontSize: 13, color: '#A8505A', fontWeight: '700', marginBottom: 4 },

  skeletonRow: {
    height: 52,
    backgroundColor: '#EBE1D9',
    borderRadius: 12,
    opacity: 0.5,
    marginBottom: 8,
  },

  loadErrorPanel: {
    marginTop: 24,
    backgroundColor: '#F5F0ED',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  loadErrorText: { fontSize: 15, color: '#5F4A52', marginBottom: 12, textAlign: 'center' },
  loadRetryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#A8505A',
  },
  loadRetryBtnLabel: { fontSize: 15, fontWeight: '700', color: '#A8505A' },

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
  sheetSecondaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#A8505A',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sheetSecondaryBtnLabel: { fontWeight: '700', fontSize: 16, color: '#A8505A' },
  sheetQuietBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  sheetQuietBtnLabel: { fontWeight: '700', fontSize: 16, color: '#8E3A44' },
});
