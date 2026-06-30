/**
 * Gestational-age utility — on-device civil-date computation.
 *
 * Implements the CANONICAL algorithm from:
 *   - api-contract.md §"Gestational-age & stage computation" (pinned)
 *   - data-model.md §3.1 "Canonical gestational-age & stage computation"
 *
 * This formula is FROZEN and must be byte-identical to the Spring Boot backend
 * (springboot-backend-dev) so server and client never disagree on the week
 * number for any input — including the negative daysPregnant band.
 *
 * Key correctness constraints (data-model §3.1 — MANDATORY, NOT truncation):
 *   gestationalWeek = Math.floor(daysPregnant / 7)    // floor toward −∞
 *   gestationalDay  = ((daysPregnant % 7) + 7) % 7    // Euclidean 0..6
 *
 * Raw JS `/` and `%` MUST NOT be used alone on potentially-negative operands:
 *   daysPregnant = -1 → truncating gives week=0, day=-1  (WRONG)
 *                     → flooring gives   week=-1, day=6  (CORRECT)
 *
 * Invariant (all inputs, incl. negative): gestationalWeek * 7 + gestationalDay === daysPregnant
 *
 * Security: this module handles only civil EDD dates (no tokens, no health data
 * beyond the civil date itself).
 */

export type Stage = 'T1' | 'T2' | 'T3';

/** All gestational-age derived values computed from a civil EDD and civil today. */
export interface GestationalAge {
  /** 280 − daysUntilEdd; may be negative when EDD is far in the future. */
  daysPregnant: number;
  /**
   * Completed gestational weeks (floor toward −∞ — matches Java Math.floorDiv).
   * May be negative when daysPregnant < 0.
   */
  gestationalWeek: number;
  /**
   * Day-in-week (Euclidean modulo 0..6 — matches Java Math.floorMod).
   * Invariant: gestationalWeek * 7 + gestationalDay === daysPregnant.
   */
  gestationalDay: number;
  /** Days until EDD; same sign as daysUntilEdd; negative once past EDD. */
  daysRemaining: number;
  /** Ring progress 0..1.  Real/float division, clamped. */
  progress: number;
  /** Trimester stage derived from gestationalWeek. */
  currentStage: Stage;
  /** True when gestationalWeek >= 37 (delivery-window overlay, NOT a stage). */
  deliveryWindowActive: boolean;
  /**
   * The week number to display: max(0, gestationalWeek).
   * Never shows negative; upper end is NOT clamped (wk 41/42/… display faithfully).
   */
  displayedWeek: number;
  /**
   * True when gestationalWeek < 0.
   * Client MUST suppress the "+d วัน" suffix and show displayedWeek as 0
   * (to avoid misleading "0 สัปดาห์ 6 วัน" rendering for a far-future EDD).
   */
  suppressDayDisplay: boolean;
}

// ─── Civil-date helpers ───────────────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD civil-date string to UTC midnight milliseconds.
 * Using Date.UTC avoids local-timezone DST offsets that could shift the
 * civil date by one day.
 *
 * Exported so kickCountLogic.ts can import it (Y-4: remove algo duplicate).
 */
export function parseCivilDateMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * civilDaysBetween(a, b) = b − a in whole calendar days (zoneless civil).
 *
 * @param a - YYYY-MM-DD civil date (the "from" date)
 * @param b - YYYY-MM-DD civil date (the "to" date)
 * @returns Positive when b is in the future of a; negative when past.
 */
export function civilDaysBetween(a: string, b: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((parseCivilDateMs(b) - parseCivilDateMs(a)) / MS_PER_DAY);
}

/**
 * Return today's civil date as YYYY-MM-DD in the device's LOCAL timezone.
 *
 * This is the correct "today" for gestational-age computation because the
 * spec (api-contract §"Gestational-age") requires the device-local civil date,
 * not UTC midnight.  Send this value in the X-Client-Date header.
 */
export function localCivilToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Main computation ─────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Compute all gestational-age derived values from the stored EDD and a
 * civil "today" date string.
 *
 * Algorithm (frozen — api-contract §"Gestational-age" / data-model §3.1):
 *   daysUntilEdd    = civilDaysBetween(today, edd)
 *   daysPregnant    = 280 - daysUntilEdd
 *   gestationalWeek = Math.floor(daysPregnant / 7)          // floor toward −∞
 *   gestationalDay  = ((daysPregnant % 7) + 7) % 7          // Euclidean 0..6
 *   daysRemaining   = daysUntilEdd
 *   progress        = clamp(daysPregnant / 280, 0, 1)       // real division
 *   currentStage    = T1 if wk<=13; T2 if 14-27; T3 if >=28
 *   deliveryWindowActive = gestationalWeek >= 37
 *
 * @param edd   The stored civil due date (YYYY-MM-DD, zoneless).
 * @param today The device's local civil date (YYYY-MM-DD).
 *              Use `localCivilToday()` in production; inject a fixed date in tests.
 */
export function computeGestationalAge(edd: string, today: string): GestationalAge {
  const daysUntilEdd = civilDaysBetween(today, edd);
  const daysPregnant = 280 - daysUntilEdd;

  // MANDATORY: floor toward −∞, NOT truncation toward 0.
  // Negative operand example: daysPregnant=-1 → Math.floor(-1/7)=-1 (correct).
  // Raw division: Math.trunc(-1/7)=0 (WRONG — breaks the T1 band and the invariant).
  const gestationalWeek = Math.floor(daysPregnant / 7);

  // MANDATORY: Euclidean modulo, NOT raw JS `%` on negative operands.
  // Example: daysPregnant=-1 → ((-1%7)+7)%7 = ((-1)+7)%7 = 6 (correct, invariant holds).
  // Raw: -1 % 7 = -1 (WRONG — invariant (-1)*7+(-1) = -8 ≠ -1 breaks).
  const gestationalDay = ((daysPregnant % 7) + 7) % 7;

  const daysRemaining = daysUntilEdd;

  // Real/float division — integer division would give 0 for daysPregnant 0..279.
  const progress = clamp(daysPregnant / 280, 0, 1);

  // Stage boundaries (data-model §3.1):
  //   T1: wk <= 13  (includes wk 0, negative weeks — clamps to T1, never blank)
  //   T2: 14 <= wk <= 27
  //   T3: wk >= 28  (includes wk 41/42+ and past-EDD — still T3, neutral)
  const currentStage: Stage =
    gestationalWeek <= 13 ? 'T1'
    : gestationalWeek <= 27 ? 'T2'
    : 'T3';

  // deliveryWindowActive is an OVERLAY, NOT a stage value.
  const deliveryWindowActive = gestationalWeek >= 37;

  // Display rules (api-contract §"Gestational-age" / data-model §3.1):
  //   displayedWeek = max(0, gestationalWeek)     — never show negative
  //   suppressDayDisplay = gestationalWeek < 0    — hide "+d วัน" for far-future EDD
  //   Upper end NOT clamped: wk 41/42/… display faithfully while stage stays T3.
  const displayedWeek = Math.max(0, gestationalWeek);
  const suppressDayDisplay = gestationalWeek < 0;

  return {
    daysPregnant,
    gestationalWeek,
    gestationalDay,
    daysRemaining,
    progress,
    currentStage,
    deliveryWindowActive,
    displayedWeek,
    suppressDayDisplay,
  };
}
