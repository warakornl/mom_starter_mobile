/**
 * calendarTabSnapshotBuilder — pure helper to build a ProfileSnapshot from the
 * GET /v1/pregnancy-profile response inside CalendarTabScreen.
 *
 * Extracted so the snapshot-building logic can be tested independently of the
 * React component rendering machinery (design-reviewer F2 — snapshot propagation
 * must be verifiably correct, non-stale, non-undefined).
 *
 * The built snapshot is written into PregnancyProfileContext via
 * useProfileSnapshotSetter() after a successful profile GET so that non-tab
 * screens (KickCount*, Settings, DoctorPdf, Suggestions) read correct values.
 *
 * Rules:
 *   - gestationalWeek comes from the CLIENT-derived GestationalAge (ga), NOT
 *     from the advisory profile.gestationalWeek (server snapshot may be stale).
 *   - For postpartum, ga is null; gestationalWeek is set to 0 (not applicable).
 *   - edd is always taken from profile.edd (the server-authoritative stored fact).
 *   - generalHealthConsented is passed in by the caller (from consentStore).
 *   - todayCivil is passed in by the caller (from localCivilToday() at call site).
 *
 * Security: only civil dates and numeric values — no tokens, no raw health data.
 */

import type { PregnancyProfile } from '../pregnancy/types';
import type { GestationalAge } from '../pregnancy/gestationalAge';
import type { ProfileSnapshot } from '../pregnancy/PregnancyProfileContext';

export interface BuildSnapshotParams {
  /** Server-authoritative profile from GET /v1/pregnancy-profile. */
  profile: PregnancyProfile;
  /**
   * Client-derived gestational age (pregnant) or null (postpartum).
   * Must be freshly computed from profile.edd + todayCivil at call site.
   */
  ga: GestationalAge | null;
  /** Whether general_health consent is currently granted (from consentStore). */
  generalHealthConsented: boolean;
  /** Device-local civil today "YYYY-MM-DD" captured at call site. */
  todayCivil: string;
}

/**
 * Build a ProfileSnapshot from a successful GET /v1/pregnancy-profile response.
 *
 * Returns a snapshot with all fields populated (no undefined/null) suitable
 * for writing into PregnancyProfileContext via useProfileSnapshotSetter().
 */
export function buildCalendarTabSnapshot({
  profile,
  ga,
  generalHealthConsented,
  todayCivil,
}: BuildSnapshotParams): ProfileSnapshot {
  if (profile.lifecycle === 'postpartum') {
    return {
      gestationalWeek: 0,
      edd: profile.edd,
      todayCivil,
      lifecycle: 'postpartum',
      generalHealthConsented,
      // Thread the civil birth date so ProfileHubScreen can call computePostpartumAge.
      // null when profile has no birthDate (defensive — server always sends it postpartum).
      birthDate: profile.birthDate ?? null,
    };
  }

  // Pregnant: use client-derived ga.gestationalWeek (not advisory profile value).
  // birthDate is null — no birth event has occurred yet.
  return {
    gestationalWeek: ga?.gestationalWeek ?? 0,
    edd: profile.edd,
    todayCivil,
    lifecycle: 'pregnant',
    generalHealthConsented,
    birthDate: null,
  };
}
