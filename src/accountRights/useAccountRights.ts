/**
 * useAccountRights — shared hook for PDPA account-rights orchestration.
 *
 * Extracted from SettingsScreen.tsx (profile-tab-and-hub-ui.md §3.5, §5.3).
 *
 * Encapsulates:
 *   - runExportFlow / runExport orchestration (PDPA ม.30 — §2 account-rights-ui.md)
 *   - Export state machine (EXPORT_IDLE → EXPORT_IN_PROGRESS → EXPORT_DONE/ERROR/404)
 *   - handleSessionExpired SD-5 runner (clearTokens + ALL health stores before navigate)
 *   - AbortController abort-on-unmount useEffect (§2.7)
 *   - deleteLockRef E-13 synchronous double-tap guard
 *   - Delete sheet state + handleConfirmTap orchestration (PDPA ม.33 — §3)
 *
 * Both SettingsScreen (during Step-0 → Step-3 transition) and ProfileHubScreen
 * consume this single hook — ensuring the separately-reviewed export/delete
 * behavior has ONE implementation that cannot diverge.
 *
 * Security:
 *   - tokenStorage.load() called only at action time — never stored in state or logged.
 *   - SESSION_EXPIRED_CODE: 401 during export/delete triggers full SD-5 teardown then navigate.
 *   - No health data in hook inputs or outputs (PDPA SD-9).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import { useT } from '../i18n/LanguageContext';
import type { TokenStorage } from '../auth/tokenStorage';
import { buildSessionExpiredRunner } from '../settings/sessionExpiredRunner';

// ── Store imports (same as SettingsScreen — imported here for the SD-5 teardown) ─
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
import { consumptionMappingStore } from '../autoStockDecrement/consumptionMappingStore';
import { stockDecrementMarkerStore } from '../autoStockDecrement/stockDecrementMarkerStore';
import { performLogout } from '../auth/performLogout';

// ── Account Rights imports ────────────────────────────────────────────────────
import { runExport, type ExportPhase } from './exportOrchestration';
import { createAccountApiClient } from './accountApiClient';
import { createProductionAccountExportFileService } from './accountExportFileService';
import { runDeleteGate } from './deleteFlowLogic';
import type { DegradeTelemetryData } from './deleteFlowLogic';
import { createRealDeviceAuthAdapter } from './deviceAuthAdapter';
import {
  isSessionExpiredCode,
  resolveExportOutcome,
  acquireDeleteLock,
  releaseDeleteLock,
  mapExport401,
  mapDelete401,
} from './accountRightsController';
import type { SupportedLocale } from './confirmWordMatch';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface UseAccountRightsOptions {
  tokenStorage: TokenStorage;
  /**
   * API base URL — required for export + delete API calls.
   * When absent, `showAccountRightsRows` is false and all action handlers
   * are no-ops.
   */
  apiBaseUrl?: string;
  /**
   * Shared logout runner from BottomTabNavigator (SD-5 full teardown → Welcome).
   * Used by the delete-success path inside runDeleteGate and as fallback for
   * session-expired navigation.
   */
  onLogout: () => void;
  /**
   * Session-expired navigation callback — navigate to Welcome after teardown.
   * Optional — falls back to onLogout if not provided.
   */
  onSessionExpired?: () => void;
}

// ─── Return ───────────────────────────────────────────────────────────────────

export interface UseAccountRightsReturn {
  // ── Export state ────────────────────────────────────────────────────────────
  exportPhase: ExportPhase;
  exportErrorMsg: string | null;
  /** True when export is in EXPORT_IN_PROGRESS or EXPORT_SHARING phase. */
  isExportInProgress: boolean;
  /** True when apiBaseUrl is provided (rows should be rendered). */
  showAccountRightsRows: boolean;

  // ── Export handlers ─────────────────────────────────────────────────────────
  handleExportRowTap: () => void;
  handleExportRetry: () => void;
  handleExportDismiss: () => void;
  handleExport404Back: () => void;

  // ── Delete state ────────────────────────────────────────────────────────────
  deleteSheetVisible: boolean;
  stepUpDegraded: boolean;
  deleteInFlight: boolean;
  deleteError: string | null;
  confirmInput: string;
  setConfirmInput: React.Dispatch<React.SetStateAction<string>>;

  // ── Delete handlers ─────────────────────────────────────────────────────────
  handleDeleteRowTap: () => void;
  handleSheetCancel: () => void;
  handleNudgeDownloadTap: () => void;
  handleNudgeSkipTap: () => void;
  /** Confirm button tap — runs biometric step-up + DELETE API call. */
  handleConfirmTap: () => void;
  handleDeleteRetry: () => void;

  // ── SupportedLocale (for DeleteAccountSheet) ─────────────────────────────
  locale: SupportedLocale;
}

// ─── Local logout helper (same as SettingsScreen.buildPerformLogout) ──────────

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
      resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
      resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
      clearKickCountDraft: () => clearDraft(),
      onComplete,
    });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAccountRights({
  tokenStorage,
  apiBaseUrl,
  onLogout,
  onSessionExpired,
}: UseAccountRightsOptions): UseAccountRightsReturn {
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
      resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
      resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
      clearKickCountDraft: () => clearDraft(),
      onComplete: onSessionExpired ?? onLogout,
    })();
  }, [onSessionExpired, tokenStorage, onLogout]);

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

      // Session-aware export client: wraps 401 → SESSION_EXPIRED_CODE sentinel (I-2)
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
          // Nudge export ended → re-open delete confirm sheet (AR-AC-19)
          // Floor text (confirmInput) preserved — no reset (AR-AC-28)
          setExportPhase('EXPORT_IDLE');
          setExportErrorMsg(null);
          setDeleteSheetVisible(true);
          break;

        case 'show_error':
          if (outcome.phase === 'EXPORT_ERROR') {
            setExportErrorMsg(outcome.error);
          }
          break;

        case 'show_404':
          break;

        case 'set_idle':
          setExportErrorMsg(null);
          break;
      }
    },
    [apiBaseUrl, tokenStorage, handleSessionExpired],
  );

  // ── Export row tap handlers ───────────────────────────────────────────────────

  const handleExportRowTap = useCallback(() => {
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
    setDeleteError(null);
    setStepUpDegraded(false);
    setDeleteInFlight(false);
    setConfirmInput('');
    releaseDeleteLock(deleteLockRef);
    setDeleteSheetVisible(true);
  }, []);

  const handleSheetCancel = useCallback(() => {
    setDeleteSheetVisible(false);
    setDeleteError(null);
    setStepUpDegraded(false);
    setDeleteInFlight(false);
    setConfirmInput('');
    releaseDeleteLock(deleteLockRef);
  }, []);

  const handleNudgeDownloadTap = useCallback(() => {
    setDeleteSheetVisible(false);
    void runExportFlow(true);
  }, [runExportFlow]);

  const handleNudgeSkipTap = useCallback(() => {
    // No-op: nudge is prompt-not-block (US-26)
  }, []);

  const handleConfirmTap = useCallback(async (): Promise<void> => {
    if (!apiBaseUrl) return;

    // E-13 CRITICAL: synchronous lock — prevents rapid double-tap
    const lockResult = acquireDeleteLock(deleteLockRef);
    if (lockResult === 'already_locked') return;

    setDeleteError(null);
    setDeleteInFlight(false);

    const tokens = await tokenStorage.load().catch(() => null);
    if (!tokens) {
      releaseDeleteLock(deleteLockRef);
      handleSessionExpired();
      return;
    }

    let isDeleteSuccess = false;

    try {
      const rawApiClient = createAccountApiClient(apiBaseUrl);
      const sessionAwareDeleteApi = async (token: string) =>
        mapDelete401(await rawApiClient.deleteAccount(token));

      const logoutForDelete = buildPerformLogout(tokenStorage, onLogout);

      const telemetry = (
        event: string,
        data: DegradeTelemetryData,
      ) => {
        const enriched = {
          ...data,
          platform: Platform.OS,
          osVersion: String(Platform.Version),
        };
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[account-rights telemetry]', event, enriched);
        }
      };

      const outcome = await runDeleteGate({
        stepUpDegraded,
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

      switch (outcome.outcome) {
        case 'delete_success':
          isDeleteSuccess = true;
          break;

        case 'auth_cancelled':
          break;

        case 'stepup_degraded':
          setStepUpDegraded(true);
          break;

        case 'delete_error':
          if (isSessionExpiredCode(outcome.code)) {
            setDeleteSheetVisible(false);
            handleSessionExpired();
            return;
          }
          setDeleteError(outcome.code);
          break;
      }
    } catch {
      setDeleteError('unknown_error');
    } finally {
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

  const handleDeleteRetry = useCallback(() => {
    void handleConfirmTap();
  }, [handleConfirmTap]);

  // ─── Computed ─────────────────────────────────────────────────────────────────

  const showAccountRightsRows = Boolean(apiBaseUrl);
  const isExportInProgress =
    exportPhase === 'EXPORT_IN_PROGRESS' || exportPhase === 'EXPORT_SHARING';

  return {
    exportPhase,
    exportErrorMsg,
    isExportInProgress,
    showAccountRightsRows,
    handleExportRowTap,
    handleExportRetry,
    handleExportDismiss,
    handleExport404Back,
    deleteSheetVisible,
    stepUpDegraded,
    deleteInFlight,
    deleteError,
    confirmInput,
    setConfirmInput,
    handleDeleteRowTap,
    handleSheetCancel,
    handleNudgeDownloadTap,
    handleNudgeSkipTap,
    handleConfirmTap: () => void handleConfirmTap(),
    handleDeleteRetry,
    locale: locale as SupportedLocale,
  };
}
