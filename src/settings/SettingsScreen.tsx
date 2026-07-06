/**
 * SettingsScreen — the account/settings menu.
 *
 * Logout lives HERE (not on Home) so it is two levels deep (Home ⚙ → Settings →
 * ออกจากระบบ → confirm) and cannot be triggered by accident. It reuses the shared
 * performLogout runner so the same PDPA health-store clearing (1.1 appsec) applies.
 *
 * PDPA entry point: "Manage Permissions" button navigates to ManageConsentsScreen (S8)
 * where users can review, grant, or withdraw any of the 6 consent types (ม.19 —
 * withdrawal is as easy as granting).
 *
 * Account rights (Task 3 — account-rights-ui.md §1):
 *   "Download my data" row  → runExport orchestration (§2)
 *   "Delete my account" row → DeleteAccountSheet confirm + runDeleteGate (§3)
 *
 * Security: tokenStorage.load() is called only at action time — never stored in
 * component state or logged. The export body is passed directly through without
 * parsing, rendering, or logging (AR-AC-22/24/25).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  View,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n/LanguageContext';
import type { TokenStorage } from '../auth/tokenStorage';
import { performLogout } from '../auth/performLogout';
import { supplySyncStore } from '../sync/supplySyncStore';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { clearDraft } from '../kickCount/kickCountDraftStore';
import { consentStore } from '../consent/consentStore';
import { resetConsentQueue } from '../consent/consentSync';
import { suggestionStore } from '../suggestion/suggestionStore';
import { expensesSyncStore } from '../expenses/expensesSyncStore';
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { medicationPlanSyncStore } from '../medication/medicationPlanSyncStore';
import { medicationLogSyncStore } from '../medication/medicationLogSyncStore';

// SD-5 session-expired teardown runner (thin testable factory — option b fix)
import { buildSessionExpiredRunner } from './sessionExpiredRunner';

// Account Rights imports
import { runExport, type ExportPhase } from '../accountRights/exportOrchestration';
import { createAccountApiClient } from '../accountRights/accountApiClient';
import { createProductionAccountExportFileService } from '../accountRights/accountExportFileService';
import { runDeleteGate } from '../accountRights/deleteFlowLogic';
import { createRealDeviceAuthAdapter } from '../accountRights/deviceAuthAdapter';
import { DeleteAccountSheet } from '../accountRights/DeleteAccountSheet';
import {
  SESSION_EXPIRED_CODE,
  isSessionExpiredCode,
  resolveExportOutcome,
  acquireDeleteLock,
  releaseDeleteLock,
  mapExport401,
  mapDelete401,
} from '../accountRights/accountRightsController';
import type { SupportedLocale } from '../accountRights/confirmWordMatch';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SettingsScreenProps {
  /** Shared secure token storage — cleared on logout. */
  tokenStorage: TokenStorage;
  /** Runs after logout completes — navigate to the unauthenticated entry (Welcome). */
  onLogout: () => void;
  /**
   * Navigate to ManageConsentsScreen (S8) so the user can review, grant, or
   * withdraw any of the 6 PDPA consent types (ม.19 compliance).
   * Optional — no-op if not provided (so existing tests do not break).
   */
  onManageConsent?: () => void;
  /**
   * API base URL — required to build accountApiClient for export + delete.
   * Optional for backwards-compat; rows are hidden if not provided.
   */
  apiBaseUrl?: string;
  /**
   * Called when a 401 is encountered during export or delete (token expired).
   * Routes to S1 via the global session-expired path (not an export/delete-specific
   * error — §2.3 E-20, §3.2 E-21).
   * Optional for backwards-compat; defaults to onLogout behavior.
   */
  onSessionExpired?: () => void;
  /**
   * AC-2 — The current profile lifecycle, sourced from `profileSnapshot` in
   * RootNavigator. Used to decide whether to show the "แก้ไขข้อมูลการตั้งครรภ์"
   * row (shown ONLY when lifecycle === 'pregnant'; hidden for postpartum/ended/
   * no-profile/unknown — fail-closed per §1.2).
   * Optional — when absent the row is hidden (safe default for existing tests).
   */
  profileLifecycle?: import('../pregnancy/types').Lifecycle | null;
  /**
   * Navigate to ProfileEditScreen (edit-pregnancy-profile feature).
   * Called on row tap; navigator pushes ProfileEdit onto the stack.
   * Optional — when absent the row is hidden even if lifecycle=pregnant.
   */
  onEditPregnancy?: () => void;
}

// ─── Local logout helper ──────────────────────────────────────────────────────

type PerformLogoutFn = () => Promise<void>;

function buildPerformLogout(
  tokenStorage: TokenStorage,
  onComplete: () => void,
): PerformLogoutFn {
  return () =>
    performLogout({
      clearTokens: () => tokenStorage.clear(),
      resetSupplyStore: () => supplySyncStore.reset(),
      resetKickCountStore: () => kickCountSyncStore.reset(),
      resetCalendarStore: () => calendarSyncStore.reset(),
      resetConsentStore: () => consentStore.reset(),
      resetConsentQueue: () => resetConsentQueue(),
      resetSuggestionStore: () => suggestionStore.reset(),
      resetExpensesStore: () => expensesSyncStore.reset(),
      resetSelfLogStore: () => selfLogSyncStore.reset(),
      resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
      resetMedicationLogStore: () => medicationLogSyncStore.reset(),
      clearKickCountDraft: () => clearDraft(),
      onComplete,
    });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsScreen({
  tokenStorage,
  onLogout,
  onManageConsent,
  apiBaseUrl,
  onSessionExpired,
  profileLifecycle,
  onEditPregnancy,
}: SettingsScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  // ── Export state (§2 — EXPORT_ states) ──────────────────────────────────────
  const [exportPhase, setExportPhase] = useState<ExportPhase>('EXPORT_IDLE');
  const [exportErrorMsg, setExportErrorMsg] = useState<string | null>(null);
  // AbortController ref for nav-away cancellation (§2.7)
  const exportAbortRef = useRef<AbortController | null>(null);

  // ── Delete sheet state (§3 — CONFIRM_OPEN / DELETE_IN_FLIGHT / DELETE_ERROR) ──
  const [deleteSheetVisible, setDeleteSheetVisible] = useState(false);
  const [stepUpDegraded, setStepUpDegraded] = useState(false);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Floor text — PRESERVED across nudge export and step-up returns (AR-AC-28)
  const [confirmInput, setConfirmInput] = useState('');
  // nudgeExportRef REMOVED (M-4): the fromNudge flag flows as a parameter to
  // runExportFlow(fromNudge) directly — the ref was written but never read.

  // E-13 synchronous double-tap guard — ref so mutations are visible before re-render
  const deleteLockRef = useRef(false);

  // ── Abort export on unmount (§2.7) ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort();
    };
  }, []);

  // ── Effective session-expired handler (SD-5 fix) ──────────────────────────────
  // ALWAYS runs the full performLogout teardown (clearTokens + ALL health stores)
  // THEN calls onSessionExpired (navigate) or falls back to onLogout.
  // Prior behaviour called onSessionExpired() directly (navigate-only), leaving
  // tokens + all health SyncStores populated — a cross-account PHI leak (SD-5).
  // buildSessionExpiredRunner delegates to performLogout with onComplete = navigate.
  const handleSessionExpired = useCallback(() => {
    void buildSessionExpiredRunner({
      clearTokens: () => tokenStorage.clear(),
      resetSupplyStore: () => supplySyncStore.reset(),
      resetKickCountStore: () => kickCountSyncStore.reset(),
      resetCalendarStore: () => calendarSyncStore.reset(),
      resetConsentStore: () => consentStore.reset(),
      resetConsentQueue: () => resetConsentQueue(),
      resetSuggestionStore: () => suggestionStore.reset(),
      resetExpensesStore: () => expensesSyncStore.reset(),
      resetSelfLogStore: () => selfLogSyncStore.reset(),
      resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
      resetMedicationLogStore: () => medicationLogSyncStore.reset(),
      clearKickCountDraft: () => clearDraft(),
      // onSessionExpired is the navigate callback (called LAST, after all stores cleared).
      // Falls back to onLogout so the screen stays functional without the prop.
      onComplete: onSessionExpired ?? onLogout,
    })();
  }, [onSessionExpired, tokenStorage, onLogout]);

  // ─── Logout (existing) ────────────────────────────────────────────────────────

  async function handleLogout(): Promise<void> {
    await buildPerformLogout(tokenStorage, onLogout)();
  }

  function confirmLogout(): void {
    Alert.alert(
      t('home.logoutTitle'),
      t('home.logoutMessage'),
      [
        { text: t('home.logoutCancel'), style: 'cancel' },
        {
          text: t('home.logoutConfirm'),
          style: 'destructive',
          onPress: () => void handleLogout(),
        },
      ],
    );
  }

  // ─── Export orchestration ────────────────────────────────────────────────────

  const runExportFlow = useCallback(
    async (fromNudge: boolean): Promise<void> => {
      if (!apiBaseUrl) return;

      // Abort any existing in-flight export before starting a new one (nav-away safe)
      exportAbortRef.current?.abort();
      const abortController = new AbortController();
      exportAbortRef.current = abortController;

      const tokens = await tokenStorage.load().catch(() => null);
      if (!tokens) {
        handleSessionExpired();
        return;
      }

      // Session-aware export client: wraps 401 → SESSION_EXPIRED_CODE sentinel via
      // the extracted pure mapper (I-2). mapExport401 drops `message` so downstream
      // `message ?? code` resolves to session_expired, not a stale server message.
      const rawApiClient = createAccountApiClient(apiBaseUrl);
      const sessionAwareApiClient = {
        exportAccount: async (
          accessToken: string,
          signal?: AbortSignal,
        ) => mapExport401(await rawApiClient.exportAccount(accessToken, signal)),
      };

      const fileService = createProductionAccountExportFileService();

      const outcome = await runExport({
        accessToken: tokens.accessToken,
        apiClient: sessionAwareApiClient,
        fileService,
        signal: abortController.signal,
        onPhaseChange: (phase) => {
          setExportPhase(phase);
          if (phase !== 'EXPORT_ERROR' && phase !== 'EXPORT_UNAVAILABLE_404') {
            setExportErrorMsg(null);
          }
        },
      });

      const action = resolveExportOutcome(outcome, fromNudge);

      switch (action) {
        case 'session_expired':
          handleSessionExpired();
          break;

        case 'restore_confirm':
          // Nudge export ended (any outcome) → re-open delete confirm sheet (AR-AC-19)
          // Floor text (confirmInput) is preserved in state — no reset (AR-AC-28)
          setExportPhase('EXPORT_IDLE');
          setExportErrorMsg(null);
          setDeleteSheetVisible(true);
          break;

        case 'show_error':
          if (outcome.phase === 'EXPORT_ERROR') {
            setExportErrorMsg(outcome.error);
          }
          // exportPhase already set to EXPORT_ERROR by onPhaseChange
          break;

        case 'show_404':
          // exportPhase already set to EXPORT_UNAVAILABLE_404 by onPhaseChange
          break;

        case 'set_idle':
          // Success (share complete/cancel) or nav-away abort — already EXPORT_IDLE
          setExportErrorMsg(null);
          break;
      }
    },
    [apiBaseUrl, tokenStorage, handleSessionExpired],
  );

  // ── Tapping the "Download my data" row ───────────────────────────────────────
  const handleExportRowTap = useCallback(() => {
    // Guard: double-tap suppressed by the EXPORT_IN_PROGRESS state (row disabled)
    if (exportPhase !== 'EXPORT_IDLE') return;
    void runExportFlow(false);
  }, [exportPhase, runExportFlow]);

  const handleExportRetry = useCallback(() => {
    void runExportFlow(false);
  }, [runExportFlow]);

  const handleExportDismiss = useCallback(() => {
    setExportPhase('EXPORT_IDLE');
    setExportErrorMsg(null);
  }, []);

  const handleExport404Back = useCallback(() => {
    setExportPhase('EXPORT_IDLE');
    setExportErrorMsg(null);
  }, []);

  // ── Delete sheet orchestration ────────────────────────────────────────────────

  const handleDeleteRowTap = useCallback(() => {
    // Reset per-session state when opening a fresh sheet (§3.2 SETTINGS_IDLE→CONFIRM_OPEN)
    setDeleteError(null);
    setStepUpDegraded(false);
    setDeleteInFlight(false);
    // Floor text intentionally NOT reset here — carry-forward from prior sessions is
    // not a concern (sheet was previously closed → floor was reset then)
    setConfirmInput('');
    releaseDeleteLock(deleteLockRef);
    setDeleteSheetVisible(true);
  }, []);

  const handleSheetCancel = useCallback(() => {
    // NO delete, NO sign-out, NO local clear (AR-AC-14, US-25)
    setDeleteSheetVisible(false);
    setDeleteError(null);
    setStepUpDegraded(false);
    setDeleteInFlight(false);
    setConfirmInput(''); // reset floor only on full cancel/dismiss
    releaseDeleteLock(deleteLockRef);
  }, []);

  // "Download my data first" from the nudge
  const handleNudgeDownloadTap = useCallback(() => {
    // Dismiss sheet temporarily; run export with fromNudge=true; re-open on any outcome (FLAG-D1)
    setDeleteSheetVisible(false);
    // confirmInput is NOT reset — preserved for when the sheet re-opens (AR-AC-28)
    void runExportFlow(true);
  }, [runExportFlow]);

  // "Skip and continue" from the nudge — no action, user proceeds to delete
  const handleNudgeSkipTap = useCallback(() => {
    // No-op: nudge is prompt-not-block (US-26). User stays at CONFIRM_OPEN.
  }, []);

  // Confirm button tap — E-13 synchronous guard + run delete gate
  const handleConfirmTap = useCallback(async (): Promise<void> => {
    if (!apiBaseUrl) return;

    // E-13 CRITICAL: acquireDeleteLock is synchronous — sets ref.current=true
    // immediately, before any await. A rapid second tap sees ref.current=true
    // and returns 'already_locked' without proceeding.
    const lockResult = acquireDeleteLock(deleteLockRef);
    if (lockResult === 'already_locked') return;

    // Reset delete error from any prior attempt (retry path)
    setDeleteError(null);
    setDeleteInFlight(false); // will be set true by onStateChange → DELETE_IN_FLIGHT

    const tokens = await tokenStorage.load().catch(() => null);
    if (!tokens) {
      releaseDeleteLock(deleteLockRef);
      handleSessionExpired();
      return;
    }

    // I-1: Track whether the gate ended in delete_success so the finally block can
    // skip the lock/in-flight release (the screen unmounts after success; calling
    // setState would cause a harmless but noisy "unmounted component" warning).
    let isDeleteSuccess = false;

    try {
      // NOTE (M-1 / §2.3 E-20, §3.2 E-21): There is NO shared refresh interceptor in
      // this codebase — authApiClient exposes `refresh()` but no wrapper transparently
      // retries 401 responses across endpoints. The current behaviour (ANY 401 →
      // session_expired sentinel → onSessionExpired()) is therefore the honest design.
      // A retry-on-refresh path is deliberately deferred pending a shared authed-fetch
      // helper; flag to solution-architect / backlog before Phase 2.
      const rawApiClient = createAccountApiClient(apiBaseUrl);

      // Session-aware delete wrapper: uses the extracted pure mapper (I-2).
      // mapDelete401 drops `message` on 401 so `message ?? code` → session_expired.
      const sessionAwareDeleteApi = async (token: string) =>
        mapDelete401(await rawApiClient.deleteAccount(token));

      const logoutForDelete = buildPerformLogout(tokenStorage, onLogout);

      // Telemetry — enriched with Platform.OS + Platform.Version (Task-2 minor)
      const telemetry = (
        event: string,
        data: import('../accountRights/deleteFlowLogic').DegradeTelemetryData,
      ) => {
        const enriched = {
          ...data,
          platform: Platform.OS,
          osVersion: String(Platform.Version),
        };
        // In prod, forward to crash reporter / analytics (no PII in enriched)
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[account-rights telemetry]', event, enriched);
        }
      };

      const outcome = await runDeleteGate({
        stepUpDegraded,
        // I-1: createRealDeviceAuthAdapter() may throw synchronously if the native
        // module is absent. The try/finally below guarantees the lock is released.
        deviceAuth: createRealDeviceAuthAdapter(),
        deleteAccountApi: sessionAwareDeleteApi,
        performLogout: logoutForDelete,
        telemetry,
        getToken: () => tokens.accessToken,
        promptMessage: t('accountRights.delete.biometricPrompt'),
        onStateChange: (state) => {
          if (state === 'DELETE_IN_FLIGHT' || state === 'STEPUP_IN_FLIGHT') {
            setDeleteInFlight(true);
          }
        },
      });

      // Outcome handling (lock + in-flight release consolidated in finally below):
      switch (outcome.outcome) {
        case 'delete_success':
          // performLogout already ran inside runDeleteGate → onLogout navigates to S1.
          // Sheet teardown is implicit (screen unmounts). Mark so finally skips release.
          isDeleteSuccess = true;
          break;

        case 'auth_cancelled':
          // No delete, no sign-out — re-enable button; floor stays satisfied
          break;

        case 'stepup_degraded':
          // C-2 throw-degrade: show non-alarming notice; floor stays satisfied
          setStepUpDegraded(true);
          break;

        case 'delete_error':
          // Check for session-expired sentinel
          if (isSessionExpiredCode(outcome.code)) {
            setDeleteSheetVisible(false);
            handleSessionExpired();
            return; // finally still runs → releases lock + clears in-flight
          }
          // Regular delete error — stays signed in, data intact (AR-AC-13)
          setDeleteError(outcome.code);
          break;
      }
    } catch {
      // I-1: Unexpected synchronous or async throw (e.g. missing native module on a
      // device that lacks the biometrics bridge). Surface a calm retry-able error and
      // let the finally block release the lock so the user can tap again.
      setDeleteError('unknown_error');
    } finally {
      // I-1 GUARANTEE: on every non-success terminal outcome — including unexpected
      // throws — release the lock and clear the in-flight spinner. On delete_success
      // the screen unmounts; skip state updates to avoid the "unmounted" warning.
      if (!isDeleteSuccess) {
        releaseDeleteLock(deleteLockRef);
        setDeleteInFlight(false);
      }
    }
  }, [
    apiBaseUrl,
    stepUpDegraded,
    tokenStorage,
    onLogout,
    handleSessionExpired,
    t,
  ]);

  // Retry after DELETE_ERROR
  const handleDeleteRetry = useCallback(() => {
    // Re-run the full delete gate (step-up precedes DELETE again, 0f rule 4)
    void handleConfirmTap();
  }, [handleConfirmTap]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const showAccountRightsRows = Boolean(apiBaseUrl);
  const isExportInProgress =
    exportPhase === 'EXPORT_IN_PROGRESS' || exportPhase === 'EXPORT_SHARING';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} testID="settings-screen">
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* ── Pregnancy section (AC-2: shown ONLY when lifecycle=pregnant) ──── */}
        {/* §1.1: placed ABOVE Privacy section; §1.2: row hidden unless pregnant */}
        {profileLifecycle === 'pregnant' && onEditPregnancy && (
          <>
            <Text style={styles.sectionLabel}>{t('settings.pregnancy')}</Text>
            <TouchableOpacity
              testID="settings-edit-pregnancy-btn"
              style={styles.menuRow}
              onPress={onEditPregnancy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.editPregnancy')}
            >
              <View style={styles.menuRowIconWrap}>
                {/* Calendar/pencil glyph — rose tint, matching download row style */}
                <Text style={styles.menuRowIconText} accessibilityElementsHidden>
                  {'✎'}
                </Text>
              </View>
              <View style={styles.menuRowTextGroup}>
                <Text style={styles.menuRowText}>{t('settings.editPregnancy')}</Text>
                <Text style={styles.menuRowSubtext}>{t('settings.editPregnancySubtitle')}</Text>
              </View>
              <Text style={styles.menuRowChevron}>{'›'}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Privacy & Consent section ─────────────────────────────────────── */}
        {(onManageConsent || showAccountRightsRows) && (
          <Text style={styles.sectionLabel}>{t('settings.privacy')}</Text>
        )}

        {onManageConsent && (
          <TouchableOpacity
            testID="settings-manage-consent-btn"
            style={styles.menuRow}
            onPress={onManageConsent}
            accessibilityRole="button"
            accessibilityLabel={t('consent.settings.manage_btn')}
          >
            <Text style={styles.menuRowText}>{t('consent.settings.manage_btn')}</Text>
            <Text style={styles.menuRowChevron}>›</Text>
          </TouchableOpacity>
        )}

        {/* ── "Download my data" row (§1.2 — EXPORT flow) ─────────────────── */}
        {showAccountRightsRows && exportPhase !== 'EXPORT_UNAVAILABLE_404' && (
          <TouchableOpacity
            testID="settings-download-data-btn"
            style={[
              styles.menuRow,
              isExportInProgress && styles.menuRowInProgress,
            ]}
            onPress={handleExportRowTap}
            disabled={isExportInProgress}
            accessibilityRole="button"
            accessibilityLabel={
              isExportInProgress
                ? (locale === 'th' ? 'กำลังเตรียมไฟล์ข้อมูล' : 'Preparing your data file')
                : (locale === 'th'
                    ? 'ดาวน์โหลดข้อมูลของฉัน, PDPA ม.30/31'
                    : 'Download my data, PDPA Article 30/31')
            }
            // polite live region for in-progress state (§5.4, UI spec §2.2)
            accessibilityLiveRegion={isExportInProgress ? 'polite' : 'none'}
          >
            <View style={styles.menuRowIconWrap}>
              <Text style={styles.menuRowIconText} accessibilityElementsHidden>
                {'↓'}
              </Text>
            </View>
            <View style={styles.menuRowTextGroup}>
              <Text style={styles.menuRowText}>
                {t('accountRights.downloadLabel')}
              </Text>
              <Text style={styles.menuRowSubtext}>
                {isExportInProgress
                  ? t('accountRights.export.inProgress')
                  : t('accountRights.downloadSubtitle')}
              </Text>
            </View>
            {isExportInProgress ? (
              <ActivityIndicator
                size="small"
                color="#9B1C35"
                testID="settings-download-spinner"
                accessibilityElementsHidden
              />
            ) : (
              <Text style={styles.menuRowChevron}>›</Text>
            )}
          </TouchableOpacity>
        )}

        {/* EXPORT_ERROR card (§2.3) */}
        {showAccountRightsRows && exportPhase === 'EXPORT_ERROR' && (
          <View
            testID="settings-export-error-card"
            style={styles.exportErrorCard}
            // polite — calm, non-alarming (UI spec §5.4 M-2; NOT assertive)
            accessibilityLiveRegion="polite"
            accessibilityRole="none"
          >
            <Text style={styles.exportErrorTitle}>
              {t('accountRights.export.errorTitle')}
            </Text>
            <Text style={styles.exportErrorBody}>
              {t('accountRights.export.errorBody')}
            </Text>
            <View style={styles.exportErrorActions}>
              <TouchableOpacity
                testID="settings-export-retry-btn"
                style={styles.exportRetryBtn}
                onPress={handleExportRetry}
                accessibilityRole="button"
                accessibilityLabel={t('accountRights.export.retry')}
              >
                <Text style={styles.exportRetryBtnLabel}>
                  {t('accountRights.export.retry')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="settings-export-dismiss-btn"
                style={styles.exportDismissBtn}
                onPress={handleExportDismiss}
                accessibilityRole="button"
                accessibilityLabel={t('accountRights.export.dismiss')}
              >
                <Text style={styles.exportDismissBtnLabel}>
                  {t('accountRights.export.dismiss')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* EXPORT_UNAVAILABLE_404 notice (§2.4 — terminal, no retry) */}
        {showAccountRightsRows && exportPhase === 'EXPORT_UNAVAILABLE_404' && (
          <View
            testID="settings-export-404-notice"
            style={styles.export404Card}
            // polite live region (§5.4)
            accessibilityLiveRegion="polite"
            accessibilityRole="none"
          >
            <Text style={styles.export404Title}>
              {t('accountRights.export.notAvailableTitle')}
            </Text>
            <TouchableOpacity
              testID="settings-export-404-back-btn"
              style={styles.export404BackBtn}
              onPress={handleExport404Back}
              accessibilityRole="button"
              accessibilityLabel={t('accountRights.export.backToSettings')}
            >
              <Text style={styles.export404BackBtnLabel}>
                {t('accountRights.export.backToSettings')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Account section ───────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.account')}</Text>

        {/* Logout — de-emphasized, rose, at the bottom of the account section. */}
        <TouchableOpacity
          style={styles.logoutRow}
          onPress={confirmLogout}
          accessibilityRole="button"
          accessibilityLabel={t('home.logout')}
          testID="settings-logout"
        >
          <Text style={styles.logoutText}>{t('home.logout')}</Text>
        </TouchableOpacity>

        {/* ── Hairline separator before destructive row ──────────────────────── */}
        {showAccountRightsRows && <View style={styles.hairline} />}

        {/* ── "Delete my account" row (§1.3 — destructive) ──────────────────── */}
        {showAccountRightsRows && (
          <TouchableOpacity
            testID="settings-delete-account-btn"
            style={styles.menuRow}
            onPress={handleDeleteRowTap}
            accessibilityRole="button"
            accessibilityLabel={
              locale === 'th'
                ? 'ลบบัญชีของฉัน, การลบเป็นการถาวรและไม่มีการกู้คืน'
                : 'Delete my account, permanently removes your account with no recovery'
            }
          >
            <View style={styles.deleteRowIconWrap}>
              <Text style={styles.deleteRowIconText} accessibilityElementsHidden>
                {'🗑'}
              </Text>
            </View>
            <View style={styles.menuRowTextGroup}>
              {/* Label color rose/700 — destructive signal (§1.3, §5.2) */}
              <Text style={[styles.menuRowText, styles.deleteRowLabelText]}>
                {t('accountRights.deleteLabel')}
              </Text>
              {/* Subtitle — second independent non-color cue */}
              <Text style={styles.menuRowSubtext}>
                {t('accountRights.deleteSubtitle')}
              </Text>
            </View>
            {/* Trailing chevron in rose/700 — third independent cue */}
            <Text style={styles.deleteRowChevron}>›</Text>
          </TouchableOpacity>
        )}

      </ScrollView>

      {/* ── DeleteAccountSheet — renders over S7 as a bottom-sheet Modal ──── */}
      <DeleteAccountSheet
        visible={deleteSheetVisible}
        locale={locale as SupportedLocale}
        confirmInput={confirmInput}
        onConfirmInputChange={setConfirmInput}
        deleteInFlight={deleteInFlight}
        deleteError={deleteError}
        stepUpDegraded={stepUpDegraded}
        onConfirmTap={() => void handleConfirmTap()}
        onCancelTap={handleSheetCancel}
        onNudgeDownloadTap={handleNudgeDownloadTap}
        onNudgeSkipTap={handleNudgeSkipTap}
        onRetryTap={handleDeleteRetry}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ROSE_700 = '#9B1C35';
const HONEY_100 = '#FBE9D2';
const HONEY_BORDER = '#E9C097';
const INK = '#3A2A30';
const INK_SOFT = '#5F4A52';
const INK_FAINT = '#94818A';
const SURFACE_PAGE_SUNK = '#F5F0ED';
const HAIRLINE_COLOR = '#EBE1D9';
const ROSE_50 = '#FFF0F0';  // icon background for download row

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontSize: 13,
    color: INK_FAINT,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 16,
  },

  // ── Shared menu row ─────────────────────────────────────────────────────────
  // Min-height 56dp (UI spec §1.2, §5.1 ≥48dp target)
  menuRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    elevation: 1,
    shadowColor: INK,
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  menuRowInProgress: {
    backgroundColor: SURFACE_PAGE_SUNK,
  },
  menuRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: ROSE_50,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuRowIconText: {
    fontSize: 16,
    color: ROSE_700,
  },
  menuRowTextGroup: {
    flex: 1,
  },
  menuRowText: {
    fontSize: 16,
    color: INK,
    fontWeight: '500',
  },
  menuRowSubtext: {
    fontSize: 13,
    color: INK_FAINT,
    marginTop: 2,
  },
  menuRowChevron: {
    fontSize: 18,
    color: INK_FAINT,
    marginLeft: 8,
  },

  // ── Logout row ──────────────────────────────────────────────────────────────
  logoutRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 52,
    justifyContent: 'center',
  },
  logoutText: {
    color: ROSE_700,
    fontSize: 16,
    fontWeight: '500',
  },

  // ── Hairline separator before delete row ───────────────────────────────────
  hairline: {
    height: 1,
    backgroundColor: HAIRLINE_COLOR,
    marginVertical: 8,
    marginHorizontal: 4,
  },

  // ── Delete account row (destructive §1.3) ──────────────────────────────────
  deleteRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FEF2F2', // warm red tint (§1.3)
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  deleteRowIconText: {
    fontSize: 15,
    color: '#C0392B', // §1.3 icon stroke
  },
  deleteRowLabelText: {
    color: ROSE_700, // rose/700 — destructive signal (§1.3, §5.2)
  },
  deleteRowChevron: {
    fontSize: 18,
    color: ROSE_700, // rose/700 — third independent destructive cue (§5.2)
    marginLeft: 8,
  },

  // ── EXPORT_ERROR card (§2.3 — warm amber, NOT red) ─────────────────────────
  exportErrorCard: {
    backgroundColor: HONEY_100,
    borderWidth: 1,
    borderColor: HONEY_BORDER,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  exportErrorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: INK,
    marginBottom: 4,
  },
  exportErrorBody: {
    fontSize: 13,
    lineHeight: 20,
    color: INK_SOFT,
    marginBottom: 12,
  },
  exportErrorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exportRetryBtn: {
    // ≥ 44dp (UI spec §5.1 error card inline actions)
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: ROSE_700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportRetryBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: ROSE_700,
  },
  exportDismissBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportDismissBtnLabel: {
    fontSize: 14,
    color: INK_FAINT,
    textDecorationLine: 'underline',
  },

  // ── EXPORT_UNAVAILABLE_404 notice (§2.4 — neutral/sunk, not alarming) ──────
  export404Card: {
    backgroundColor: SURFACE_PAGE_SUNK,
    borderWidth: 1,
    borderColor: HAIRLINE_COLOR,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  export404Title: {
    fontSize: 14,
    color: INK_SOFT,
    textAlign: 'center',
    marginBottom: 12,
  },
  export404BackBtn: {
    // ≥ 44dp (UI spec §5.1)
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  export404BackBtnLabel: {
    fontSize: 14,
    color: ROSE_700,
    fontWeight: '600',
  },
});
