/**
 * reopenEntryRuntimeWiring — extracted async handler functions for
 * ReopenConfirmScreen's GET-on-mount + confirm-time write.
 *
 * Mirrors profileEditRuntimeWiring.ts's pattern: the runtime wiring (network
 * calls + resolving outcomes + invoking the right callback) is extracted so
 * it is testable without mounting React (see reopenEntryRuntimeWiring.test.ts).
 *
 * mobile-reviewer BLOCKER-1 (reachability): runReopenEntryGet is the GET-on-
 * mount that lets ReopenConfirmScreen fetch its own authoritative profile +
 * version, so the screen no longer depends on an unreachable route param.
 *
 * mobile-reviewer BLOCKER-2 (no false-success): runReopenConfirm NEVER calls
 * onReopened on a network/5xx failure — those paths call onError only. The
 * screen must not tell the mother "recorded" when the server never saw the
 * write. Full optimistic-apply + offline queue (functional-spec §10.3) is an
 * explicit tracked follow-up, not implemented here.
 */

import { createPregnancyClient } from './pregnancyApiClient';
import { localCivilToday } from './gestationalAge';
import { resolveReopenEntryGetOutcome } from './lossEventLogic';
import type { ReopenEntryGetOutcome } from './lossEventLogic';
import type { GetProfileResult, ReopenResult, PregnancyProfile } from './types';
import type { AuthTokens } from '../auth/types';

// ─── Structural client interfaces (subset of PregnancyClient) ────────────────

interface GetOnlyClient {
  getProfile(token: string, date?: string): Promise<GetProfileResult>;
}

interface ReopenOnlyClient {
  reopenPregnancy(token: string, ifMatch: string): Promise<ReopenResult>;
}

interface LoadableTokenStorage {
  load(): Promise<AuthTokens | null>;
}

// ─── runReopenEntryGet ────────────────────────────────────────────────────────

export interface ReopenEntryGetDeps {
  tokenStorage: LoadableTokenStorage;
  apiBaseUrl: string;
  /** Optional injectable client factory. Default: createPregnancyClient. */
  createClient?: (url: string) => GetOnlyClient;
  /** Optional injectable getProfile call — overrides createClient entirely (test convenience). */
  getProfile?: (token: string, clientDate?: string) => Promise<GetProfileResult>;
  clientDate?: string;
  /** Called on no-token OR server-401 (SD-5). */
  onSessionExpired(): void;
  /** Called with every non-session-expiry outcome, incl. the initial 'loading'. */
  setOutcome(outcome: ReopenEntryGetOutcome): void;
}

/**
 * Fetches the fresh profile for ReopenConfirmScreen's entry GET and resolves
 * it via resolveReopenEntryGetOutcome. Sets 'loading' first, then the
 * resolved outcome — UNLESS the outcome is 'session-expired', in which case
 * onSessionExpired() is called instead (SD-5 — never leave a session-expired
 * screen in a stale show-form state).
 */
export async function runReopenEntryGet(deps: ReopenEntryGetDeps): Promise<void> {
  const { tokenStorage, apiBaseUrl, createClient, getProfile, clientDate, onSessionExpired, setOutcome } = deps;

  setOutcome({ type: 'loading' });

  const tokens = await tokenStorage.load();
  const accessToken = tokens?.accessToken;
  if (!accessToken) {
    onSessionExpired();
    return;
  }

  const today = clientDate ?? localCivilToday();
  const doGet = getProfile ?? (createClient ?? createPregnancyClient)(apiBaseUrl).getProfile;
  const result = await doGet(accessToken, today);

  const outcome = resolveReopenEntryGetOutcome(result);
  if (outcome.type === 'session-expired') {
    onSessionExpired();
    return;
  }
  setOutcome(outcome);
}

// ─── runReopenConfirm ──────────────────────────────────────────────────────────

export interface ReopenConfirmDeps {
  tokenStorage: LoadableTokenStorage;
  apiBaseUrl: string;
  profileVersion: number;
  /** Optional injectable client factory. Default: createPregnancyClient. */
  createClient?: (url: string) => ReopenOnlyClient;
  /** Optional injectable reopenPregnancy call (test convenience). */
  reopenPregnancy?: (token: string, ifMatch: string) => Promise<ReopenResult>;
  /** Called on 200 success AND 409-already-pregnant (intent satisfied, §10.4). */
  onReopened(profile: PregnancyProfile): void;
  /** Called on "Go back" callers separately; here called on the benign 409-postpartum terminal. */
  onGoBack(): void;
  /** Called on no-token OR server-401 (SD-5). */
  onSessionExpired(): void;
  /**
   * BLOCKER-2: called on EVERY other failure — network/throw, 5xx, 403, or an
   * unrecognized 409. onReopened is NEVER called on these paths. `message` is
   * an i18n-resolved calm string the caller can show inline.
   */
  onError(message: 'consentRequired' | 'conflict' | 'offline'): void;
}

/**
 * Calls POST /pregnancy-profile/reopen and routes the result.
 *
 * BLOCKER-2 (non-negotiable): a network/5xx/unrecognized failure calls
 * onError only — never onReopened. There is no "assume success" path here.
 */
export async function runReopenConfirm(deps: ReopenConfirmDeps): Promise<void> {
  const {
    tokenStorage,
    apiBaseUrl,
    profileVersion,
    createClient,
    reopenPregnancy,
    onReopened,
    onGoBack,
    onSessionExpired,
    onError,
  } = deps;

  try {
    const tokens = await tokenStorage.load();
    const accessToken = tokens?.accessToken;
    if (!accessToken) {
      onSessionExpired();
      return;
    }

    const doReopen = reopenPregnancy ?? (createClient ?? createPregnancyClient)(apiBaseUrl).reopenPregnancy;
    const result = await doReopen(accessToken, String(profileVersion));

    if (result.ok) {
      onReopened(result.profile);
      return;
    }

    if (result.status === 401) {
      onSessionExpired();
      return;
    }

    if (result.status === 403 && result.code === 'consent_required') {
      onError('consentRequired');
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
      onError('conflict');
      return;
    }

    // BLOCKER-2: any other server error (4xx/5xx) is a real failure.
    onError('conflict');
  } catch {
    // BLOCKER-2: network/offline failure is a real failure, NOT success.
    // No onReopened() call — the mother must not be told "recorded" when the
    // server never saw the request. Full optimistic-apply + offline queue is
    // a tracked follow-up (functional-spec §10.3), not implemented here.
    onError('offline');
  }
}
