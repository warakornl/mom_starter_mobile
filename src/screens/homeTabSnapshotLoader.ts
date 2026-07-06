/**
 * homeTabSnapshotLoader — extracted pure async orchestration for the
 * HomeTabScreen snapshot-population path.
 *
 * Extracted from HomeTabScreen so the critical wiring can be unit-tested in
 * a pure Node/ts-jest environment (testEnvironment: 'node') without React
 * Native or react-navigation stubs.
 *
 * Critical path (spec §3 build risk):
 *   HomeTabScreen MUST be the first screen to call setSnapshot because
 *   initialRouteName = 'Home'. Non-tab screens (DoctorReport, KickCount*,
 *   Settings) all read useProfileSnapshot() which is only populated after
 *   this path runs.
 *
 * Rules:
 *   - null accessToken → onLogout (session expired before navigation)
 *   - 200 + pregnant   → compute GA → buildCalendarTabSnapshot → setSnapshot
 *   - 200 + postpartum → compute PP → buildCalendarTabSnapshot (ga=null) → setSnapshot
 *   - 404             → onNeedsProfile (no profile yet — needs onboarding)
 *   - 401             → onLogout (token rejected by server)
 *   - other error     → onError? (network / server error — component shows retry)
 *
 * Security: no accessToken or health values are logged (SD-9).
 */

import {
  computeGestationalAge,
} from '../pregnancy/gestationalAge';
import { computePostpartumAge } from '../pregnancy/postpartumAge';
import type { GestationalAge } from '../pregnancy/gestationalAge';
import type { PostpartumAge } from '../pregnancy/postpartumAge';
import type { PregnancyProfile, GetProfileResult } from '../pregnancy/types';
import type { ProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import { buildCalendarTabSnapshot } from './calendarTabSnapshotBuilder';

// ─── Params ───────────────────────────────────────────────────────────────────

export interface LoadProfileIntoSnapshotParams {
  /**
   * Pre-loaded access token from tokenStorage.
   * null triggers onLogout immediately (no API call made).
   */
  accessToken: string | null;
  /**
   * Injectable getProfile function.
   * Typically `createPregnancyClient(apiBaseUrl).getProfile`.
   */
  getProfile: (token: string, todayCivil: string) => Promise<GetProfileResult>;
  /** Device-local civil today "YYYY-MM-DD" captured at call site. */
  todayCivil: string;
  /** Whether general_health consent is currently granted (from consentStore). */
  generalHealthConsented: boolean;
  /** Write the built snapshot into PregnancyProfileContext. */
  setSnapshot: (snapshot: ProfileSnapshot) => void;
  /** Called when session is invalid: no token or 401 from server. */
  onLogout: () => void;
  /** Called when GET returns 404 — no profile yet, navigate to onboarding. */
  onNeedsProfile: () => void;
  /**
   * Called after a successful pregnant profile load (200 + lifecycle=pregnant).
   * Optional — HomeTabScreen uses it to update local component state.
   */
  onPregnant?: (profile: PregnancyProfile, ga: GestationalAge) => void;
  /**
   * Called after a successful postpartum profile load (200 + lifecycle=postpartum).
   * Optional — HomeTabScreen uses it to update local component state.
   */
  onPostpartum?: (profile: PregnancyProfile, pp: PostpartumAge) => void;
  /**
   * Called when GET fails with a non-auth error (network / 5xx).
   * Optional — HomeTabScreen uses it to set error state and show retry.
   */
  onError?: (message: string) => void;
}

// ─── Pure async orchestration ─────────────────────────────────────────────────

/**
 * loadProfileIntoSnapshot — fetch the profile and write the snapshot into context.
 *
 * This is the SINGLE authoritative implementation of the snapshot-population
 * path. HomeTabScreen calls it on both mount (via useFocusEffect) and on every
 * subsequent tab focus (AC-8: heals stale EDD after ProfileEdit).
 *
 * The function is pure-async (no React hooks, no React Native imports) so it
 * can be unit-tested in the ts-jest Node environment.
 *
 * Snapshot-write invariant:
 *   setSnapshot is called exactly once per successful profile GET (200).
 *   It is NEVER called for 401, 404, no-token, or error responses.
 *   A test that removes or guards setSnapshot will fail the assertions in
 *   homeTabSnapshotLoader.test.ts — by design, to prevent silent regressions.
 */
export async function loadProfileIntoSnapshot(
  p: LoadProfileIntoSnapshotParams,
): Promise<void> {
  // ── Guard: no token → session expired before the GET ──────────────────────
  if (!p.accessToken) {
    p.onLogout();
    return;
  }

  const result = await p.getProfile(p.accessToken, p.todayCivil);

  if (result.ok) {
    const { profile } = result;

    if (profile.lifecycle === 'postpartum' && profile.birthDate) {
      // ── Postpartum path ──────────────────────────────────────────────────
      const pp = computePostpartumAge(profile.birthDate, p.todayCivil);
      // §3 build risk: snapshot uses ga=null for postpartum (gestationalWeek → 0)
      p.setSnapshot(
        buildCalendarTabSnapshot({
          profile,
          ga: null,
          generalHealthConsented: p.generalHealthConsented,
          todayCivil: p.todayCivil,
        }),
      );
      p.onPostpartum?.(profile, pp);
    } else {
      // ── Pregnant path (default) ──────────────────────────────────────────
      const ga = computeGestationalAge(profile.edd, p.todayCivil);
      p.setSnapshot(
        buildCalendarTabSnapshot({
          profile,
          ga,
          generalHealthConsented: p.generalHealthConsented,
          todayCivil: p.todayCivil,
        }),
      );
      p.onPregnant?.(profile, ga);
    }
  } else if (result.status === 404) {
    // ── No profile yet — navigate to onboarding ────────────────────────────
    p.onNeedsProfile();
  } else if (result.status === 401) {
    // ── Token rejected — log out ───────────────────────────────────────────
    p.onLogout();
  } else {
    // ── Network / server error — show retry in the component ──────────────
    p.onError?.(result.message);
  }
}
