/**
 * Postpartum-age utility — on-device civil-date computation.
 *
 * Implements the CANONICAL postpartum day/week counter from:
 *   data-model.md §3.1 "Birth-event & postpartum counting" (canonical home)
 *   api-contract.md §"Birth-event & postpartum counting"  (lockstep mirror)
 *
 * This formula is FROZEN and MUST be byte-identical to the Spring Boot backend
 * (springboot-backend-dev) so server and client never disagree on the week.
 *
 * Formula (data-model §3.1):
 *   postpartumDays = max(0, civilDaysBetween(birthDate, today))
 *   postpartumWeek = Math.floor(postpartumDays / 7)        // floorDiv
 *   postpartumDay  = ((postpartumDays % 7) + 7) % 7        // floorMod (Euclidean)
 *
 * floorDiv / floorMod are MANDATORY for cross-platform parity with the
 * gestational counter (Java Math.floorDiv / Math.floorMod).  postpartumDays is
 * always ≥ 0 after the clamp, so plain floor and floorDiv agree — but the
 * Euclidean forms are kept for contract parity.
 *
 * Invariant: postpartumWeek * 7 + postpartumDay === postpartumDays (all inputs).
 *
 * Reuses civilDaysBetween and localCivilToday from gestationalAge.ts so civil-
 * date arithmetic stays in one place and both counters share the same guarantee.
 *
 * Security: handles only civil dates (no tokens, no sensitive health data beyond
 * the civil birthDate itself).
 */

import { civilDaysBetween, localCivilToday } from './gestationalAge';

// Re-export so callers can import localCivilToday from this module without
// adding an explicit gestationalAge import.
export { localCivilToday };

// ─── Public types ─────────────────────────────────────────────────────────────

/** All postpartum-age derived values computed from a civil birthDate and civil today. */
export interface PostpartumAge {
  /**
   * Calendar days since birth.  0 on the birth day, counts up.
   * Always ≥ 0 (clamped to protect against cross-device clock skew where the
   * local "today" briefly trails a birthDate recorded on another device).
   */
  postpartumDays: number;
  /**
   * Completed weeks since birth (week 0 = first week postpartum).
   * floorDiv(postpartumDays, 7) — floor toward −∞ (equals Math.floor since ≥ 0).
   */
  postpartumWeek: number;
  /**
   * Day-in-week (Euclidean 0..6).
   * floorMod(postpartumDays, 7) — ((d%7)+7)%7 form for backend parity.
   * Invariant: postpartumWeek * 7 + postpartumDay === postpartumDays.
   */
  postpartumDay: number;
}

// ─── Main computation ─────────────────────────────────────────────────────────

/**
 * Compute all postpartum-age derived values from the stored birthDate and a
 * civil "today" date string.
 *
 * Algorithm (frozen — data-model.md §3.1 / api-contract.md §"Birth-event"):
 *   postpartumDays = max(0, civilDaysBetween(birthDate, today))
 *   postpartumWeek = Math.floor(postpartumDays / 7)          // floor toward −∞
 *   postpartumDay  = ((postpartumDays % 7) + 7) % 7          // Euclidean 0..6
 *
 * @param birthDate YYYY-MM-DD civil date (floating-civil, zoneless — OQ-11).
 * @param today     YYYY-MM-DD device-local civil date.
 *                  Use `localCivilToday()` in production; inject a fixed date
 *                  in tests (same injection pattern as computeGestationalAge).
 */
export function computePostpartumAge(birthDate: string, today: string): PostpartumAge {
  // Signed calendar days from birthDate to today.
  // civilDaysBetween(a, b) = b − a; positive when today > birthDate.
  const raw = civilDaysBetween(birthDate, today);

  // Clamp to ≥ 0 — data-model §3.1:
  // "guards a device whose local 'today' briefly trails a birthDate recorded
  //  on another device/zone" (cross-device clock skew).
  const postpartumDays = Math.max(0, raw);

  // MANDATORY: floor toward −∞ (floorDiv), same as the gestational counter.
  // postpartumDays ≥ 0 always after the clamp, so Math.floor and floorDiv agree;
  // the Euclidean form is kept for cross-platform contract parity.
  const postpartumWeek = Math.floor(postpartumDays / 7);

  // MANDATORY: Euclidean modulo (floorMod), for backend parity.
  // Since postpartumDays ≥ 0: ((d%7)+7)%7 equals d%7, but the form is required.
  const postpartumDay = ((postpartumDays % 7) + 7) % 7;

  return { postpartumDays, postpartumWeek, postpartumDay };
}
