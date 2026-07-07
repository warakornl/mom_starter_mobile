/**
 * profileInfoEditRuntimeWiring — extracted async handler functions for the
 * edit-name-fields flow (ProfileInfoEditScreen).
 *
 * Mirrors the pattern established by profileEditRuntimeWiring.ts:
 * extracted from ProfileInfoEditScreen.doEntryGet (runInfoEntryGet) and
 * ProfileInfoEditScreen.handleSave (runInfoSave) so that the runtime wiring
 * — not just the pure outcome resolvers in profileInfoEditLogic.ts — is
 * testable without mounting React components.
 *
 * DEF-001 (MED, FIXED) — 409 conflict message carry via pendingErrorRef:
 *   runInfoSave 409 branch: stores conflict msg in pendingErrorRef (NOT setSaveError)
 *     then awaits runEntryGet().
 *   runInfoEntryGet sync prefix: reads + clears pendingErrorRef; sets loading.
 *     No setSaveError(null) here — that was the original null-collision.
 *   runInfoEntryGet show-form case (after GET await): calls setSaveError(pendingError).
 *     On conflict re-fetch: pendingError = conflict msg → shown outside the sync batch.
 *     On fresh/normal entry: pendingError = null → clears any stale generic error.
 *
 * SD-5 (BLOCKING): GET 401 and PUT 401 → onSessionExpired().
 *   runInfoEntryGet: GET no-token + GET server-401 → onSessionExpired.
 *   runInfoSave: PUT no-token + PUT server-401 → onSessionExpired.
 *
 * SD-9: No name data passed in route params; profile fetched fresh on each entryGet.
 *   Name fields decoded inside buildFormStateFromProfile — NEVER logged (PDPA PII).
 *
 * Lifecycle-agnostic: works for both pregnant and postpartum profiles
 *   (unlike profileEditRuntimeWiring.ts which is pregnant-only, AC-2 gate).
 */

import { createPregnancyClient } from './pregnancyApiClient';
import { localCivilToday } from './gestationalAge';
import {
  resolveInfoEditGetOutcome,
  resolveInfoEditPutOutcome,
  buildFormStateFromProfile,
  buildInfoEditPutInput,
} from './profileInfoEditLogic';
import type { NameFormState } from './profileInfoEditLogic';
import type {
  GetProfileResult,
  PutProfileResult,
  PregnancyProfileInput,
  PregnancyProfile,
} from './types';
import type { AuthTokens } from '../auth/types';

// ─── Screen state ─────────────────────────────────────────────────────────────
//
// Exported so ProfileInfoEditScreen can import this type rather than redefining it.
// This keeps the ScreenState definition co-located with the orchestration that
// drives it.

export type InfoScreenState =
  | { mode: 'loading' }
  | { mode: 'show-form'; profile: PregnancyProfile }
  | { mode: 'not-found' }
  | { mode: 'error'; message: string }
  | { mode: 'saving' }
  | { mode: 'saved' };

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

// ─── runInfoEntryGet ─────────────────────────────────────────────────────────

export interface InfoEntryGetDeps {
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
   * DEF-001: shared mutable ref with runInfoSave.
   * runInfoSave conflict branch stores the conflict message here (not via setSaveError).
   * runInfoEntryGet reads + clears it in the sync prefix, then applies the value
   * to setSaveError AFTER the GET await (outside the React 18 synchronous batch).
   */
  pendingErrorRef: { current: string | null };
  /**
   * Pre-translated load error message (e.g. t('profile.editLoadError')).
   * Used for GET 500 / network error / unrecognised outcome.
   */
  loadErrorMessage: string;
  /**
   * SD-5 (BLOCKING): called on GET no-token AND GET server-401.
   * Caller MUST run the full performLogout teardown.
   */
  onSessionExpired(): void;
  setScreenState(s: InfoScreenState): void;
  setFormState(s: NameFormState): void;
  setSaveError(v: string | null): void;
}

/**
 * Performs the entry GET for ProfileInfoEditScreen and routes the outcome.
 *
 * DEF-001: reads + clears pendingErrorRef before any async work.
 *   Applies pendingError to setSaveError ONLY in the show-form branch (after await).
 *   Does NOT call setSaveError(null) in the sync prefix — that was the collision.
 *
 * SD-5 (BLOCKING): calls onSessionExpired on no-token or server-401.
 */
export async function runInfoEntryGet(deps: InfoEntryGetDeps): Promise<void> {
  // DEF-001: capture + clear the pending conflict message BEFORE any state changes.
  // Captures exactly once; a second runInfoEntryGet invocation sees null.
  const pendingError = deps.pendingErrorRef.current;
  deps.pendingErrorRef.current = null;

  deps.setScreenState({ mode: 'loading' });
  // NOTE: setSaveError(null) is intentionally ABSENT from the sync prefix.
  // Conflict re-fetch: pendingError carries the message → applied below in show-form.
  // Normal/fresh entry: pendingError is null → setSaveError(null) in show-form clears stale errors.

  const tokens = await deps.tokenStorage.load();
  const accessToken = tokens?.accessToken;

  if (!accessToken) {
    // No token → session expired (SD-5).
    deps.onSessionExpired();
    return;
  }

  const clientDate = deps.clientDate ?? localCivilToday();
  const createClientFn = deps.createClient ?? createPregnancyClient;

  try {
    const client = createClientFn(deps.apiBaseUrl);
    const result = await client.getProfile(accessToken, clientDate);
    const outcome = resolveInfoEditGetOutcome(result);

    switch (outcome.type) {
      case 'session-expired':
        // Server-returned 401 (SD-5).
        deps.onSessionExpired();
        return;

      case 'show-form':
        // NEVER log name fields — PDPA identity PII (SD-9).
        deps.setFormState(buildFormStateFromProfile(outcome.profile));
        deps.setScreenState({ mode: 'show-form', profile: outcome.profile });
        // DEF-001: apply pending conflict message AFTER the GET await.
        // pendingError = conflict msg → shown on re-loaded form.
        // pendingError = null → clears any stale generic error.
        deps.setSaveError(pendingError);
        return;

      case 'not-found':
        deps.setScreenState({ mode: 'not-found' });
        return;

      default:
        deps.setScreenState({ mode: 'error', message: deps.loadErrorMessage });
    }
  } catch {
    deps.setScreenState({ mode: 'error', message: deps.loadErrorMessage });
  }
}

// ─── runInfoSave ─────────────────────────────────────────────────────────────

export interface InfoSaveDeps {
  tokenStorage: LoadableTokenStorage;
  apiBaseUrl: string;
  /**
   * Optional injectable client factory.
   * Default: createPregnancyClient (production path).
   * Override in tests with a mock.
   */
  createClient?: (url: string) => PutOnlyClient;
  /**
   * Optional client date (YYYY-MM-DD).
   * Default: localCivilToday().
   */
  clientDate?: string;
  /**
   * Current screen state — must be 'show-form' to proceed (early-return guard).
   * Provides the loaded profile for If-Match version and PUT body EDD.
   */
  screenState: InfoScreenState;
  /** Current form input values (decoded plaintext — NEVER log, PDPA PII). */
  formState: NameFormState;
  /**
   * DEF-001: shared mutable ref with runInfoEntryGet.
   * On 409 conflict: stores the conflict message here, then runEntryGet() is awaited.
   * runInfoEntryGet reads + clears this in its sync prefix, applies after GET await.
   */
  pendingErrorRef: { current: string | null };
  /** Pre-translated conflict message (e.g. t('profileInfo.error.conflict')). */
  conflictMessage: string;
  /** Pre-translated generic error message (e.g. t('profileInfo.error.generic')). */
  genericErrorMessage: string;
  /**
   * SD-5 (BLOCKING): called on PUT no-token AND PUT server-401.
   * Caller MUST run the full performLogout teardown.
   */
  onSessionExpired(): void;
  onSaveComplete(profile: PregnancyProfile): void;
  setScreenState(s: InfoScreenState): void;
  setSaveError(v: string | null): void;
  /**
   * The re-fetch function to call on 409 conflict.
   * Component binds this to its own doEntryGet, which shares the same pendingErrorRef.
   * In tests, bind to runInfoEntryGet(entryGetDeps) with matching pendingErrorRef.
   */
  runEntryGet(): Promise<void>;
}

/**
 * Performs the profile PUT for ProfileInfoEditScreen and routes the outcome.
 *
 * DEF-001: on 409, stores conflict msg in pendingErrorRef (NOT setSaveError),
 *   then awaits runEntryGet(). The message is applied by runInfoEntryGet in the
 *   show-form branch, AFTER the GET await — outside the React 18 synchronous batch.
 *
 * SD-5 (BLOCKING): calls onSessionExpired on no-token or server-401.
 * If-Match: sends String(profile.version) per api-contract §"Endpoints".
 * Lifecycle-agnostic: works for pregnant and postpartum (no AC-2 gate here).
 */
export async function runInfoSave(deps: InfoSaveDeps): Promise<void> {
  // Guard: only proceed from the show-form state (profile must be loaded).
  if (deps.screenState.mode !== 'show-form') return;

  const activeProfile = deps.screenState.profile;

  deps.setSaveError(null);
  deps.setScreenState({ mode: 'saving' });

  const tokens = await deps.tokenStorage.load();
  const accessToken = tokens?.accessToken;

  if (!accessToken) {
    // No token → session expired (SD-5).
    deps.onSessionExpired();
    return;
  }

  const clientDate = deps.clientDate ?? localCivilToday();
  const createClientFn = deps.createClient ?? createPregnancyClient;

  try {
    const client = createClientFn(deps.apiBaseUrl);
    // Build PUT body (EDD echoed from profile — no-op-PUT pin; names base64-encoded)
    const body = buildInfoEditPutInput(activeProfile, deps.formState);
    // If-Match: version as string (api-contract §"Endpoints" — required for update)
    const ifMatch = String(activeProfile.version);

    const result = await client.putProfile(body, accessToken, ifMatch, clientDate);
    const outcome = resolveInfoEditPutOutcome(result);

    switch (outcome.type) {
      case 'saved':
        deps.onSaveComplete(outcome.profile);
        return;

      case 'session-expired':
        // Server-returned 401 (SD-5).
        deps.onSessionExpired();
        return;

      case 'conflict':
        // DEF-001 fix: store conflict message in ref, NOT via setSaveError.
        // Direct setSaveError(conflictMsg) would be cleared by runInfoEntryGet's
        // synchronous setScreenState({ mode: 'loading' }) in the same React 18
        // auto-batch (last-write-wins = null). The ref is mutation-safe across
        // async boundaries.
        deps.pendingErrorRef.current = deps.conflictMessage;
        await deps.runEntryGet();
        return;

      default:
        // 428, 422, 403, 500, and unrecognised outcomes
        deps.setSaveError(deps.genericErrorMessage);
        deps.setScreenState({ mode: 'show-form', profile: activeProfile });
    }
  } catch {
    deps.setSaveError(deps.genericErrorMessage);
    deps.setScreenState({ mode: 'show-form', profile: activeProfile });
  }
}
