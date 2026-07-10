/**
 * pregnancySummary.ts — pure on-device aggregation for "สรุปการตั้งครรภ์"
 *
 * Implements buildPregnancySummary: pure fn, no I/O, no side effects.
 * Grounded in:
 *   - docs/product/pregnancy-summary.md (§3.0–§3.5, INV-PS1..4)
 *   - docs/api-spec/pregnancy-summary-design.md (§2.1 module boundary)
 *   - docs/legal/pregnancy-summary-legal.md (§2 G-PS-a..g)
 *
 * ── MANDATORY REUSE (load-bearing pins): ──────────────────────────────────────
 * 1. Trimester bucketing MUST call the FROZEN computeGestationalAge(edd, civilDate).
 *    FORBIDDEN: hand-rolled floor(daysPregnant/7) or any other formula.
 *    Result must match gestational golden vectors byte-for-byte:
 *      13w6d → T1, 14w0d → T2, 27w6d → T2, 28w0d → T3, gestWeek 0 → T1
 * 2. Civil-date bucketing MUST use bucketCivilDay (FLAG-1): slice(0,10) of
 *    the floating-civil timestamp. Do NOT convert UTC → local separately per
 *    category — both kick.startedAt and medication.occurrenceTime are floating-civil.
 *
 * ── INVARIANTS (legal + product): ────────────────────────────────────────────
 * INV-PS1: PregnancySummary output type has NO verdict/badge/severity field.
 *          No assessment, no normal/abnormal, no trend/delta/comparison.
 * INV-PS2 / K-8: NEVER console.log movementCount, sums, or avg (raw or derived).
 *                This pure fn structurally cannot egress values.
 * INV-PS3: Returns a view model only — NO writes to any store.
 * INV-PS4: Aggregates only the caller-supplied current-user data.
 *
 * ── HOSPITAL-STAY CIPHER NOTE (for future appsec): ───────────────────────────
 * When real AES-GCM encryption ships, hospitalAdmissionDate / hospitalDischargeDate
 * encrypt with recordId = accountId (row-per-account, pregnancy_profile is 1:1).
 * NOT the profile row id. See pregnancy-summary-design.md §1.2 AAD tuples.
 *
 * Security: NEVER log movementCount, total kicks, or avgKicksPerDay (K-8 / INV-PS2).
 */

import { computeGestationalAge } from './gestationalAge';
import { bucketCivilDay } from '../calendar/civilDayBucketer';
import type { KickCountSessionRecord } from '../kickCount/kickCountTypes';
import type { MedicationLog } from '../sync/syncTypes';

// ─── Input / Output types ─────────────────────────────────────────────────────

/** Pre-resolved medication plan (decoded name, ready for display). */
export interface PlanInfo {
  planId: string;
  name: string; // decoded display name (base64 already decoded by caller)
}

/** All inputs for the pure aggregation function. */
export interface BuildPregnancySummaryInput {
  /** Civil date YYYY-MM-DD, or null when not set (needsEdd edge). */
  edd: string | null;
  /** Civil date YYYY-MM-DD of birth, or null when not yet delivered. */
  birthDate: string | null;
  /**
   * Delivery type (decoded/cleartext, e.g. "vaginal" | "cesarean").
   * NEVER log this value.
   */
  deliveryType: string | null;
  /**
   * Hospital admission civil date YYYY-MM-DD, or null.
   * Future-FieldCipher note: when AES-GCM ships, recordId = accountId (NOT profile row id).
   * NEVER log this value.
   */
  hospitalAdmissionDate: string | null;
  /**
   * Hospital discharge civil date YYYY-MM-DD, or null.
   * Same encryption note as hospitalAdmissionDate above.
   * NEVER log this value.
   */
  hospitalDischargeDate: string | null;
  /**
   * COMPLETED sessions ONLY (status === 'completed', no in_progress drafts — K-8 / B1).
   * K-8: NEVER log movementCount from these sessions.
   */
  completedKickSessions: KickCountSessionRecord[];
  /** All live medication log records for this user. */
  medicationLogs: MedicationLog[];
  /** Pre-decoded plan name list. Plans with no logs are ignored (no adherence — INV-PS1). */
  plans: PlanInfo[];
  /** Device-local civil date YYYY-MM-DD (from shared §3.0 primitive localCivilToday()). */
  today: string;
}

// ─── Output types (INV-PS1: no verdict/badge/severity/trend/delta) ────────────

/**
 * Per-trimester kick summary.
 * INV-PS1: NO verdict, NO badge, NO color/severity, NO trend/delta.
 * Legal §2 G-PS-c: daysWithData MUST always be surfaced with avgKicksPerDay in UI.
 * Legal §2 G-PS-d: NO cross-trimester delta/comparison — per-trimester data only.
 */
export interface KicksSummaryData {
  /** K-8: avgKicksPerDay is for display only; NEVER log or send to analytics. */
  avgKicksPerDay: number;
  /** Count of distinct civil dates with ≥1 completed session. Always shown with avg. */
  daysWithData: number;
}

/** Per-medication summary within a trimester. */
export interface MedSummaryData {
  /** planId key (null for ad-hoc doses). */
  planId: string | null;
  /** Resolved display label. "ยา (ไม่พบชื่อ)" on join-miss; "ยาที่บันทึกเอง" for ad-hoc. */
  label: string;
  /** Count of distinct civil days with ≥1 log of this plan. */
  distinctDayCount: number;
  /** Sorted list of distinct YYYY-MM-DD dates. */
  dates: string[];
}

/** Summary data for one trimester. */
export interface TrimesterData {
  /**
   * Kick summary, or null when no completed sessions in this trimester.
   * null renders as "ยังไม่มีข้อมูล" in the UI.
   */
  kicks: KicksSummaryData | null;
  /** Per-medication summary. Empty when no logs in this trimester. */
  medications: MedSummaryData[];
}

/** Delivery record (NOT trimester-bucketed; exempt from postpartum-exclusion §3.1). */
export interface DeliveryRecordData {
  deliveryType: string | null;
  birthDate: string | null;
  /** Hospital admission civil date, or null when not recorded. */
  hospitalAdmissionDate: string | null;
  /** Hospital discharge civil date, or null when not recorded. */
  hospitalDischargeDate: string | null;
}

/**
 * Output of buildPregnancySummary.
 *
 * INV-PS1 guarantee: this type deliberately has NO fields for:
 *   - verdict (ปกติ/ผิดปกติ)
 *   - badge/severity
 *   - trend/delta/comparison across trimesters (G-PS-d)
 *   - assessment/normal-range reference
 * Adding such fields would require legal re-review (docs/legal/pregnancy-summary-legal.md §5).
 */
export interface PregnancySummary {
  /** True when edd is absent — trimesters cannot be computed; prompt user to set EDD. */
  needsEdd: boolean;
  T1: TrimesterData;
  T2: TrimesterData;
  T3: TrimesterData;
  /**
   * Delivery record — null when no birth data (still pregnant or no birth event).
   * NOT trimester-bucketed; exempt from postpartum-exclusion (§3.1 must-pin).
   */
  delivery: DeliveryRecordData | null;
}

// ─── Internal trimester type ──────────────────────────────────────────────────

type TrimesterKey = 'T1' | 'T2' | 'T3';
type TrimesterOrOut = TrimesterKey | 'OUT_OF_RANGE';

// ─── Pure sub-helpers ─────────────────────────────────────────────────────────

/**
 * trimesterOf — map a civil date to T1/T2/T3 or OUT_OF_RANGE.
 *
 * MANDATORY: uses FROZEN computeGestationalAge(edd, civilDate).gestationalWeek.
 * FORBIDDEN: hand-rolled week formula.
 *
 * OUT_OF_RANGE when:
 *   (a) gestWeek < 0  (before 0w0d — before start of pregnancy period)
 *   (b) civilDate > birthDate (postpartum med/kick events — excluded per §3.1)
 *       NOTE: delivery record data is NOT routed through this; it is exempt.
 */
function trimesterOf(
  edd: string,
  civilDate: string,
  birthDate: string | null,
): TrimesterOrOut {
  // Postpartum-exclusion: events after birthDate excluded from all 3 trimesters
  // (delivery record itself is NOT routed through here — exempt from §3.1)
  if (birthDate !== null && civilDate > birthDate) {
    return 'OUT_OF_RANGE';
  }

  const { gestationalWeek } = computeGestationalAge(edd, civilDate);

  // Before 0w0d (negative gestWeek) → OUT_OF_RANGE
  if (gestationalWeek < 0) {
    return 'OUT_OF_RANGE';
  }

  // Trimester bands (0-indexed gestWeek, §3.1):
  // T1: 0–13, T2: 14–27, T3: 28+
  if (gestationalWeek <= 13) return 'T1';
  if (gestationalWeek <= 27) return 'T2';
  return 'T3';
}

/**
 * buildEmptyTrimester — empty trimester data (no data state).
 */
function buildEmptyTrimester(): TrimesterData {
  return { kicks: null, medications: [] };
}

/**
 * computeKicksForTrimester — pure kick-count aggregation per §3.2.
 *
 * K-8 invariant: NEVER log movementCount, totalMovements, or avgKicksPerDay.
 *
 * @param sessions  All completed sessions that map to this trimester.
 * @returns KicksSummaryData or null (when no sessions).
 */
function computeKicksForTrimester(
  sessions: KickCountSessionRecord[],
): KicksSummaryData | null {
  if (sessions.length === 0) return null;

  // Group by civil date (FLAG-1: startedAt is floating-civil → slice(0,10))
  const dayMap = new Map<string, number>(); // civilDate → sum of movementCounts

  for (const session of sessions) {
    const civilDate = bucketCivilDay(session.startedAt);
    const current = dayMap.get(civilDate) ?? 0;
    // K-8: do NOT log session.movementCount individually
    dayMap.set(civilDate, current + session.movementCount);
  }

  // daysWithData = count of distinct civil dates with ≥1 completed session
  // (a 0-count session still counts as a day — §3.2 must-pin)
  const daysWithData = dayMap.size;

  // K-8: do NOT log totalMovements or avgKicksPerDay
  let totalMovements = 0;
  for (const count of dayMap.values()) {
    totalMovements += count;
  }
  const avgKicksPerDay = daysWithData > 0 ? totalMovements / daysWithData : 0;

  return { avgKicksPerDay, daysWithData };
}

/**
 * computeMedsForTrimester — pure medication aggregation per §3.3.
 *
 * OQ-PS2 join-miss fallback: "ยา (ไม่พบชื่อ)" (two distinct deleted plans
 * stay two groups, both labelled identically — per design §3).
 * Ad-hoc (planId=null): single "ยาที่บันทึกเอง" neutral bucket.
 */
function computeMedsForTrimester(
  logs: MedicationLog[],
  plans: PlanInfo[],
): MedSummaryData[] {
  if (logs.length === 0) return [];

  const planLookup = new Map<string, string>(plans.map((p) => [p.planId, p.name]));

  // Group by planId key — null for ad-hoc
  // Using Map with null key serialized as '__adhoc__' sentinel
  const AD_HOC_KEY = '__adhoc__';
  const groupDays = new Map<string, Set<string>>(); // planKey → Set<civilDate>
  const planIdByKey = new Map<string, string | null>(); // planKey → planId

  for (const log of logs) {
    const planId = log.medicationPlanId ?? null;
    const key: string = planId === null ? AD_HOC_KEY : planId;
    planIdByKey.set(key, planId);

    const civilDate = bucketCivilDay(log.occurrenceTime);
    if (!groupDays.has(key)) {
      groupDays.set(key, new Set());
    }
    groupDays.get(key)!.add(civilDate);
  }

  const result: MedSummaryData[] = [];
  for (const [key, days] of groupDays.entries()) {
    const planId = planIdByKey.get(key) ?? null;

    let label: string;
    if (planId === null) {
      // Ad-hoc dose (null planId)
      label = 'ยาที่บันทึกเอง';
    } else {
      // Try join; fall back to "ยา (ไม่พบชื่อ)" on miss
      label = planLookup.get(planId) ?? 'ยา (ไม่พบชื่อ)';
    }

    const sortedDates = Array.from(days).sort();
    result.push({
      planId,
      label,
      distinctDayCount: days.size,
      dates: sortedDates,
    });
  }

  // Sort by planId for deterministic output (null last)
  result.sort((a, b) => {
    if (a.planId === null) return 1;
    if (b.planId === null) return -1;
    return a.planId.localeCompare(b.planId);
  });

  return result;
}

// ─── Main aggregation function ────────────────────────────────────────────────

/**
 * buildPregnancySummary — pure on-device aggregation.
 *
 * No network, no analytics, no logging of health values (INV-PS2 / K-8).
 * Returns a read-only view model — no store writes (INV-PS3).
 * Aggregates only the caller-supplied current-user data (INV-PS4).
 *
 * INV-PS1: Output type structurally has NO verdict/assessment/trend/delta field.
 *
 * @param input  All required data (edd, sessions, logs, plans, birthDate, etc.)
 * @returns PregnancySummary — trimester data + delivery record
 */
export function buildPregnancySummary(
  input: BuildPregnancySummaryInput,
): PregnancySummary {
  const {
    edd,
    birthDate,
    deliveryType,
    hospitalAdmissionDate,
    hospitalDischargeDate,
    completedKickSessions,
    medicationLogs,
    plans,
  } = input;

  // ── No EDD: cannot bucket into trimesters ────────────────────────────────────
  if (edd === null) {
    return {
      needsEdd: true,
      T1: buildEmptyTrimester(),
      T2: buildEmptyTrimester(),
      T3: buildEmptyTrimester(),
      delivery: null,
    };
  }

  // ── Route kick sessions into trimester buckets ───────────────────────────────
  // (FLAG-1: startedAt is floating-civil → bucketCivilDay = slice(0,10))
  const kicksByTrimester: Record<TrimesterKey, KickCountSessionRecord[]> = {
    T1: [], T2: [], T3: [],
  };

  for (const session of completedKickSessions) {
    const civilDate = bucketCivilDay(session.startedAt);
    const trimester = trimesterOf(edd, civilDate, birthDate);
    if (trimester !== 'OUT_OF_RANGE') {
      kicksByTrimester[trimester].push(session);
    }
  }

  // ── Route medication logs into trimester buckets ─────────────────────────────
  // (FLAG-1: occurrenceTime is floating-civil → bucketCivilDay = slice(0,10))
  const logsByTrimester: Record<TrimesterKey, MedicationLog[]> = {
    T1: [], T2: [], T3: [],
  };

  for (const log of medicationLogs) {
    const civilDate = bucketCivilDay(log.occurrenceTime);
    const trimester = trimesterOf(edd, civilDate, birthDate);
    if (trimester !== 'OUT_OF_RANGE') {
      logsByTrimester[trimester].push(log);
    }
  }

  // ── Build per-trimester summaries ────────────────────────────────────────────
  const T1: TrimesterData = {
    kicks: computeKicksForTrimester(kicksByTrimester.T1),
    medications: computeMedsForTrimester(logsByTrimester.T1, plans),
  };
  const T2: TrimesterData = {
    kicks: computeKicksForTrimester(kicksByTrimester.T2),
    medications: computeMedsForTrimester(logsByTrimester.T2, plans),
  };
  const T3: TrimesterData = {
    kicks: computeKicksForTrimester(kicksByTrimester.T3),
    medications: computeMedsForTrimester(logsByTrimester.T3, plans),
  };

  // ── Delivery record (NOT trimester-bucketed; exempt from postpartum-exclusion) ─
  // Must-pin §3.1: admission/discharge naturally fall at/after birthDate → exempt.
  const delivery: DeliveryRecordData | null =
    birthDate !== null
      ? {
          deliveryType,
          birthDate,
          hospitalAdmissionDate,
          hospitalDischargeDate,
        }
      : null;

  return {
    needsEdd: false,
    T1,
    T2,
    T3,
    delivery,
  };
}
