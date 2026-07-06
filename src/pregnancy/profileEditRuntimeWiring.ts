/**
 * profileEditRuntimeWiring — extracted async handler functions for the
 * edit-pregnancy-profile flow.
 *
 * Extracted from ProfileEditScreen.doEntryGet (runEntryGet) and
 * ProfileSetupScreen.handleSave (runSave) so that the runtime wiring
 * — not just the pure outcome resolvers in profileEditLogic.ts — is testable
 * without mounting React components.
 *
 * AC-13 (BLOCKING, SD-5 cross-account PHI-leak guard):
 *   runEntryGet: both GET no-token and GET server-401 call onSessionExpired().
 *   runSave:     both PUT no-token and PUT server-401 call the supplied action
 *                callbacks (onNoTokenAction / onServerAuthAction), which in edit
 *                mode are both wired to onSessionExpired().
 *
 * AC-9: no reanchor/reschedule on the save path (§4.2 explicit NON-ripple).
 */

import { createPregnancyClient } from './pregnancyApiClient';
import { localCivilToday } from './gestationalAge';
import {
  resolveEditGetOutcome,
  resolveEditPutOutcome,
} from './profileEditLogic';
import type { EditGetOutcome } from './profileEditLogic';
import type {
  GetProfileResult,
  PutProfileResult,
  PregnancyProfileInput,
  PregnancyProfile,
} from './types';
import type { AuthTokens } from '../auth/types';

// ─── Structural client interfaces (subset of PregnancyClient) ─────────────────

interface GetOnlyClient {
  getProfile(token: string, date?: string): Promise<GetProfileResult>;
}

interface PutOnlyClient {
  putProfile(
    req: PregnancyProfileInput,
    token: string,
    ifMatch?: string,
    date?: string,
  ): Promise<PutProfileResult>;
}

// ─── Minimal token-storage interface ─────────────────────────────────────────

interface LoadableTokenStorage {
  load(): Promise<AuthTokens | null>;
}

// ─── runEntryGet ──────────────────────────────────────────────────────────────

export interface EntryGetDeps {
  tokenStorage: LoadableTokenStorage;
  apiBaseUrl: string;
  /**
   * Optional injectable client factory.
   * Default: createPregnancyClient (production path).
   * Override in tests with a mock.
   */
  createClient?: (url: string) => GetOnlyClient;
  /**
   * Optional client date (YYYY-MM-DD).
   * Default: localCivilToday() (production path).
   * Override in tests for determinism.
   */
  clientDate?: string;
  /**
   * AC-13 (BLOCKING, SD-5): called on BOTH GET no-token AND GET server-401.
   * The caller (ProfileEditScreen) wraps this to also clear isDirtyRef.current
   * before invoking it, so the beforeRemove guard does not trap the logout navigation.
   */
  onSessionExpired(): void;
  /**
   * Called with the resolved outcome on non-session-expiry results
   * (show-form, not-found, guard-not-editable, error).
   */
  onOutcome(o: EditGetOutcome): void;
}

/**
 * Performs the entry GET for the edit host and routes the outcome.
 *
 * AC-13 (BLOCKING): calls onSessionExpired() on no-token or server-401.
 * Used by ProfileEditScreen.doEntryGet.
 */
export async function runEntryGet(deps: EntryGetDeps): Promise<void> {
  const { tokenStorage, apiBaseUrl, onSessionExpired, onOutcome } = deps;
  const clientDate = deps.clientDate ?? localCivilToday();
  const createClientFn = deps.createClient ?? createPregnancyClient;

  const tokens = await tokenStorage.load();
  const accessToken = tokens?.accessToken;

  // No-token = session expired (AC-13, SD-5).
  if (!accessToken) {
    onSessionExpired();
    return;
  }

  try {
    const client = createClientFn(apiBaseUrl);
    const result = await client.getProfile(accessToken, clientDate);
    const resolved = resolveEditGetOutcome(result);

    if (resolved.type === 'session-expired') {
      // Server-returned 401 (AC-13, SD-5).
      onSessionExpired();
      return;
    }

    onOutcome(resolved);
  } catch {
    onOutcome({ type: 'error', retryable: true });
  }
}

// ─── runSave ──────────────────────────────────────────────────────────────────

export interface SaveDeps {
  tokenStorage: LoadableTokenStorage;
  apiBaseUrl: string;
  /**
   * Optional injectable client factory.
   * Default: createPregnancyClient (production path).
   * Override in tests with a mock.
   */
  createClient?: (url: string) => PutOnlyClient;
  /** PUT request body — XOR: { edd } or { currentWeek }. */
  body: PregnancyProfileInput;
  /** If-Match value (profile.version as string). Undefined for first create. */
  ifMatch?: string;
  /**
   * Optional client date override (YYYY-MM-DD).
   * Default: localCivilToday().
   */
  clientDate?: string;
  /** Called when no access token is found in storage.
   *  Edit flow: onSessionExpired() — clears dirty + triggers performLogout.
   *  Create flow: setErrorMsg(t('profile.errorLogin')).
   */
  onNoTokenAction(): void;
  /** Called when the server returns 401 from the PUT.
   *  Edit flow: onSessionExpired().
   *  Create flow: setErrorMsg(t('profile.errorGeneric')).
   */
  onServerAuthAction(): void;
  onSuccess(profile: PregnancyProfile): void;
  onConflict(currentProfile: PregnancyProfile | null): void;
  onValidationError(): void;
  onConsentRequired(): void;
  onPreconditionFailed(): void;
  onGenericError(): void;
  onOfflineError(): void;
  /** React state setter for the `saving` boolean. */
  setSaving(v: boolean): void;
}

/**
 * Performs the profile PUT and routes the outcome.
 *
 * AC-13 (BLOCKING): calls onNoTokenAction (no-token) or onServerAuthAction (server-401).
 * AC-9: no reanchor/reschedule in any code path here.
 * Used by ProfileSetupScreen.handleSave.
 */
export async function runSave(deps: SaveDeps): Promise<void> {
  const {
    tokenStorage,
    apiBaseUrl,
    body,
    ifMatch,
    onNoTokenAction,
    onServerAuthAction,
    onSuccess,
    onConflict,
    onValidationError,
    onConsentRequired,
    onPreconditionFailed,
    onGenericError,
    onOfflineError,
    setSaving,
  } = deps;
  const clientDate = deps.clientDate ?? localCivilToday();
  const createClientFn = deps.createClient ?? createPregnancyClient;

  setSaving(true);

  try {
    const tokens = await tokenStorage.load();
    const accessToken = tokens?.accessToken;

    // No-token = session expired for the edit flow (AC-13, SD-5).
    if (!accessToken) {
      onNoTokenAction();
      return;
    }

    const client = createClientFn(apiBaseUrl);
    const result = await client.putProfile(body, accessToken, ifMatch, clientDate);
    const outcome = resolveEditPutOutcome(result);

    if (outcome.type === 'saved') {
      onSuccess(outcome.profile);
    } else if (outcome.type === 'session-expired') {
      // Server-returned 401 (AC-13, SD-5).
      onServerAuthAction();
    } else if (outcome.type === 'conflict') {
      onConflict(outcome.currentProfile);
    } else if (outcome.type === 'validation') {
      onValidationError();
    } else if (outcome.type === 'consent-required') {
      onConsentRequired();
    } else if (outcome.type === 'precondition') {
      onPreconditionFailed();
    } else {
      onGenericError();
    }
  } catch {
    onOfflineError();
  } finally {
    setSaving(false);
  }
}
