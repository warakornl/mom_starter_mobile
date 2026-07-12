/**
 * homeTabProfileVerbDrain — the profileVerbQueue drain trigger HomeTabScreen's
 * AppState 'active' handler calls.
 *
 * OR-STRUCT-1 (architecture §1.3 / functional-spec §17.2): the drain host is
 * HomeTabScreen's EXISTING AppState 'active' handler — the same handler that
 * already calls drainConsentQueue (HomeTabScreen.tsx ~line 762). This module
 * is that call, extracted to a pure/testable function so its real behavior
 * (not a mocked stand-in) can be exercised in Jest without a component
 * renderer (this codebase has none — see supplies/SuppliesScreen.motherRoom.test.tsx
 * convention note).
 *
 * Real production caller: HomeTabScreen.tsx's AppState handler calls this
 * function directly (see the `handleAppState` useEffect) — this is NOT a
 * dead/orphaned helper.
 *
 * NG-5: no headless-while-killed loop — this function does nothing unless
 * called, and is only ever called from the foreground AppState 'active'
 * event or once at app startup (App.tsx).
 */

import type { TokenStorage } from '../auth/tokenStorage';
import { drainProfileVerbQueue } from '../pregnancy/profileVerbSyncSingleton';
import type { FetchFn } from '../auth/authApiClient';
import type { PregnancyProfile } from '../pregnancy/types';

export interface RunHomeTabProfileVerbDrainParams {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** The caller's current known profile version (from the already-loaded
   * HomeTabScreen state) — seeds resolveIfMatch on first drain this session. */
  liveProfileVersion: number;
  /** Injectable fetch (tests only) — production omits this (defaults to global fetch). */
  fetchFn?: FetchFn;
  /** 200 / 409-intent-satisfied / 409-terminal: adopt the server profile into
   * the caller's local state (e.g. re-set the ProfileSnapshot / screen state). */
  onAdopt: (profile: PregnancyProfile) => void;
  onConflictStillMeaningful?: (currentProfile: PregnancyProfile | null) => void;
  onConsentRequired?: () => void;
  onGiveUp?: () => void;
}

/**
 * Drains due profileVerbQueue entries via the real dispatch mapping.
 * Best-effort: never throws (mirrors drainConsentQueue's contract).
 */
export async function runHomeTabProfileVerbDrain(
  params: RunHomeTabProfileVerbDrainParams,
): Promise<void> {
  try {
    await drainProfileVerbQueue(
      params.tokenStorage,
      params.apiBaseUrl,
      params.liveProfileVersion,
      {
        onAdopt: params.onAdopt,
        onConflictStillMeaningful: params.onConflictStillMeaningful,
        onConsentRequired: params.onConsentRequired ? () => params.onConsentRequired!() : undefined,
        onGiveUp: params.onGiveUp ? () => params.onGiveUp!() : undefined,
      },
      params.fetchFn,
    );
  } catch {
    // Best-effort — never throws out to the AppState handler (mirrors
    // drainConsentQueue's swallow-all-top-level-errors contract).
  }
}
