/**
 * homeTabAdoptOnDrain — the profileVerbQueue drain's onAdopt handler,
 * extracted from HomeTabScreen's AppState 'active' handler so its real
 * behavior (not a mocked stand-in) can be exercised in Jest without a
 * component renderer (this codebase has none — see homeTabSnapshotLoader.ts /
 * homeTabProfileVerbDrain.ts convention notes).
 *
 * §9: when a queued profile-verb (loss_event / reopen / birth_event /
 * edit_profile) drains successfully (200 / 409-intent-satisfied /
 * 409-terminal), runHomeTabProfileVerbDrain's onAdopt callback fires with the
 * server-confirmed profile. This function is the REAL production logic that
 * callback runs — it settles the pending-sync UI state AND rewrites the
 * shared ProfileSnapshot (consumed by ProfileHubScreen, CalendarScreen,
 * suggestionEngine, WeeklyMilestoneSheet, etc.) via setSnapshot.
 *
 * RED-LINE (appsec + mobile-reviewer BLOCKER, loss-gate fail-open):
 *   The profile's lifecycle is threaded through RAW — never defaulted or
 *   remapped to 'pregnant'. A loss (lifecycle='ended') that drains
 *   successfully MUST produce a snapshot with lifecycle:'ended', or every
 *   loss-gated surface silently re-opens for a mother who just recorded a
 *   loss. See homeTabAdoptOnDrain.test.ts for the fail-on-revert coverage
 *   (real queue + real dispatch + real drain, fetch boundary stubbed only).
 *
 * Note on ScreenState.kind: this screen's local ScreenState union has no
 * 'ended' kind — 'ended' profiles are represented as kind:'pregnant' with
 * profile.lifecycle==='ended' (the render branch derives `isLoss` from the
 * raw profile.lifecycle, see HomeTabScreen.tsx's "Pregnant mode" section).
 * This mirrors the existing convention used by the normal GET path's
 * onPregnant callback (homeTabSnapshotLoader.ts) — intentionally unchanged
 * here to avoid a second divergent lifecycle representation.
 */

import { localCivilToday, computeGestationalAge } from '../pregnancy/gestationalAge';
import type { GestationalAge } from '../pregnancy/gestationalAge';
import { computePostpartumAge } from '../pregnancy/postpartumAge';
import type { PostpartumAge } from '../pregnancy/postpartumAge';
import type { PregnancyProfile } from '../pregnancy/types';
import type { ProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import { buildCalendarTabSnapshot } from './calendarTabSnapshotBuilder';

export type HomeTabAdoptedState =
  | { kind: 'postpartum'; profile: PregnancyProfile; pp: PostpartumAge }
  | { kind: 'pregnant'; profile: PregnancyProfile; ga: GestationalAge };

export interface ApplyAdoptedProfileParams {
  profile: PregnancyProfile;
  generalHealthConsented: boolean;
  setState: (state: HomeTabAdoptedState) => void;
  setSnapshot: (snapshot: ProfileSnapshot) => void;
  /** Ref-setter side effects — mirrors HomeTabScreen's loadedEdd/loadedBirthDate refs. */
  setLoadedEdd: (edd: string | null) => void;
  setLoadedBirthDate: (birthDate: string | null) => void;
}

/**
 * Apply a server-confirmed adopted profile (from a successful profileVerbQueue
 * drain) into HomeTabScreen's local state and the shared ProfileSnapshot.
 *
 * This is the SINGLE authoritative implementation of the drain-onAdopt path.
 * A test that reverts the lifecycle-passthrough fix in
 * calendarTabSnapshotBuilder.ts will fail homeTabAdoptOnDrain.test.ts's
 * RED-LINE assertion — by design, to prevent silent regressions.
 */
export function applyAdoptedProfileToHomeTab(params: ApplyAdoptedProfileParams): void {
  const { profile, generalHealthConsented, setState, setSnapshot, setLoadedEdd, setLoadedBirthDate } = params;
  const todayCivil = localCivilToday();

  if (profile.lifecycle === 'postpartum' && profile.birthDate) {
    const pp = computePostpartumAge(profile.birthDate, todayCivil);
    setLoadedBirthDate(profile.birthDate);
    setLoadedEdd(null);
    setState({ kind: 'postpartum', profile, pp });
    setSnapshot(
      buildCalendarTabSnapshot({
        profile,
        ga: null,
        generalHealthConsented,
        todayCivil,
      }),
    );
    return;
  }

  // Pregnant / ended (loss): ga is client-derived from EDD (still present on
  // an 'ended' profile). Raw lifecycle wiring (GAP-2-safe) — no `?? 'pregnant'`.
  const ga = computeGestationalAge(profile.edd, todayCivil);
  setLoadedEdd(profile.edd);
  setLoadedBirthDate(null);
  setState({ kind: 'pregnant', profile, ga });
  setSnapshot(
    buildCalendarTabSnapshot({
      profile,
      ga,
      generalHealthConsented,
      todayCivil,
    }),
  );
}
