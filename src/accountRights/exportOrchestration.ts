/**
 * exportOrchestration — orchestrates the Data Export flow.
 *
 * Sequencing: fetch → write cache file → OS share sheet.
 * Drives the ExportPhase state machine and exposes phase transitions via
 * an onPhaseChange callback (for the Settings screen / useExportOrchestration).
 *
 * State machine (§2 of account-rights-behavior.md):
 *   EXPORT_IN_PROGRESS  – fetch + write running; row disabled (anti double-tap)
 *   EXPORT_SHARING      – share sheet open; fetch aborted (nav-away safe)
 *   EXPORT_IDLE         – default / silent success (no toast needed)
 *   EXPORT_ERROR        – fetch/write/share failed; show calm error + Retry + Dismiss
 *   EXPORT_UNAVAILABLE_404 – 404 (soft-deleted); terminal for session, no retry
 *
 * Security (AR-AC-22..25):
 *   - The raw export JSON is passed directly to fileService.saveAndShare()
 *     without parsing, rendering, or logging.
 *   - Nav-away abort returns to EXPORT_IDLE silently — no error surfaced (§2.7).
 *   - A failed/partial attempt is NEVER presented as success.
 */

import type { ExportAccountResult, AccountApiClient } from './accountApiClient';
import type { AccountExportFileService } from './accountExportFileService';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The five states the UI needs to render (§2.1, UI spec §2).
 * Exposed as a discriminated literal union for exhaustive switch in the screen.
 */
export type ExportPhase =
  | 'EXPORT_IDLE'
  | 'EXPORT_IN_PROGRESS'
  | 'EXPORT_SHARING'
  | 'EXPORT_ERROR'
  | 'EXPORT_UNAVAILABLE_404';

/**
 * The final outcome of `runExport()`, mapped from the terminal phase.
 * The screen uses this to decide whether to show an error card, the 404 notice,
 * or silently return to the idle row.
 */
export type ExportOutcome =
  | { phase: 'EXPORT_IDLE' }
  | { phase: 'EXPORT_ERROR'; error: string }
  | { phase: 'EXPORT_UNAVAILABLE_404' };

/** Injectable dependencies for `runExport`. */
export interface RunExportDeps {
  /** Bearer access token — NEVER log. */
  accessToken: string;

  /** Injectable API client (tests inject a mock). */
  apiClient: Pick<AccountApiClient, 'exportAccount'>;

  /** Injectable file service (tests inject a mock). */
  fileService: AccountExportFileService;

  /**
   * Optional nav-away signal (AbortSignal from the screen's AbortController).
   *
   * When the user navigates away from Settings while a fetch is in flight,
   * the screen aborts this signal. The orchestration:
   *   - EXPORT_IN_PROGRESS: passes the signal to exportAccount(); on abort,
   *     the apiClient returns `request_aborted` and the orchestration returns
   *     EXPORT_IDLE silently (§2.7 — "no error toast; no file presented").
   *   - EXPORT_SHARING: the OS share sheet is OS-owned; blur/unmount must NOT
   *     abort it. The share promise + best-effort cleanup still run (§2.7).
   */
  signal?: AbortSignal;

  /**
   * Callback invoked each time the phase transitions.
   * The screen uses this to drive its local state (setState / useReducer).
   * Fired in order: IN_PROGRESS → SHARING (when write succeeds) → final phase.
   */
  onPhaseChange?: (phase: ExportPhase) => void;
}

// ─── Orchestration function ───────────────────────────────────────────────────

/**
 * runExport — drives the full export sequence for one "Download my data" tap.
 *
 * Callers:
 *   - `useExportOrchestration` hook (Settings screen) — wraps in useState
 *   - Unit tests — inject mock apiClient + fileService, assert outcomes
 *
 * @returns A Promise<ExportOutcome> resolving to the terminal state.
 *
 * Usage (screen side):
 * ```ts
 *   const ctrl = useRef(new AbortController());
 *   // On unmount: ctrl.current.abort()
 *   const outcome = await runExport({ accessToken, apiClient, fileService,
 *     signal: ctrl.current.signal, onPhaseChange: setPhase });
 *   if (outcome.phase === 'EXPORT_ERROR') { ... }
 * ```
 */
export async function runExport(deps: RunExportDeps): Promise<ExportOutcome> {
  const { accessToken, apiClient, fileService, signal, onPhaseChange } = deps;

  // Transition → EXPORT_IN_PROGRESS (row disabled, spinner shown).
  onPhaseChange?.('EXPORT_IN_PROGRESS');

  // ── Step 1: fetch the export JSON ──────────────────────────────────────────
  let fetchResult: ExportAccountResult;
  try {
    fetchResult = await apiClient.exportAccount(accessToken, signal);
  } catch {
    // exportAccount should never throw (it returns {ok:false} for all errors),
    // but guard defensively in case of an unexpected exception.
    if (signal?.aborted) {
      onPhaseChange?.('EXPORT_IDLE');
      return { phase: 'EXPORT_IDLE' };
    }
    onPhaseChange?.('EXPORT_ERROR');
    return { phase: 'EXPORT_ERROR', error: 'Unexpected error during export fetch' };
  }

  if (!fetchResult.ok) {
    // Nav-away abort: the user left Settings intentionally — return silently (§2.7).
    if (fetchResult.code === 'request_aborted' || signal?.aborted) {
      onPhaseChange?.('EXPORT_IDLE');
      return { phase: 'EXPORT_IDLE' };
    }

    // 404 = account soft-deleted. Terminal for this session (§2.5).
    if (fetchResult.code === 'account_deleted') {
      onPhaseChange?.('EXPORT_UNAVAILABLE_404');
      return { phase: 'EXPORT_UNAVAILABLE_404' };
    }

    // All other errors: timeout, network_error, 401, 5xx → calm EXPORT_ERROR.
    const error = fetchResult.message ?? fetchResult.code;
    onPhaseChange?.('EXPORT_ERROR');
    return { phase: 'EXPORT_ERROR', error };
  }

  // ── Step 2: write to cache + share ─────────────────────────────────────────
  // SECURITY: bodyText is the raw JSON aggregate (SD-1…SD-12). It is passed
  // directly to saveAndShare without parsing, rendering, or logging (AR-AC-22/24).
  const fileResult = await fileService.saveAndShare(
    fetchResult.bodyText,
    // onSharing fires between write-complete and share-start,
    // letting the orchestration transition to EXPORT_SHARING while the OS
    // share sheet opens (the screen then knows not to abort on nav-away).
    () => onPhaseChange?.('EXPORT_SHARING'),
  );

  if (!fileResult.ok) {
    // Write or share failed — never presented as a saved file (§2.3).
    onPhaseChange?.('EXPORT_ERROR');
    return { phase: 'EXPORT_ERROR', error: fileResult.error };
  }

  // ── Step 3: success ────────────────────────────────────────────────────────
  // The share sheet resolved (complete OR cancel — both = success of app's job, §2.4).
  // Cleanup (deleteAsync) ran best-effort inside saveAndShare after share resolved.
  // No toast required; the share sheet already gave the user feedback.
  onPhaseChange?.('EXPORT_IDLE');
  return { phase: 'EXPORT_IDLE' };
}
