/**
 * medicationAdherence — pure on-device adherence computation for the PDF assembler.
 *
 * Implements RULING 7.2 / medication-behavior.md §A.5 (PINNED).
 *
 * Formula (per plan P, per report range [dateFrom, dateTo]):
 *   M = distinct civil days in [dateFrom, dateTo] on which P.scheduleRule fires ≥1 dose,
 *       clamped to [startAt.date, until] via the FLAG-4 expander (recurrenceExpander.ts).
 *       null scheduleRule ⇒ PRN/ad-hoc plan, M = 0.
 *   N = count of M-days that have ≥1 taken medicationLog for P, bucketed by
 *       occurrenceTime civil date. COUNT(DISTINCT civil-day) — two taken logs on the
 *       same day count once (AC-22 dedup). N ≤ M always.
 *   PRN (M=0): N = count of taken log ENTRIES in range (no day-dedup, no ratio).
 *
 * Invariants (AC-20 / INV-M1 / INV-M2):
 *   - active=false has ZERO effect on M or N (no deactivation timestamp — §A.5).
 *   - deleted plan (deletedAt set) → excluded from scored set; its logs degrade to
 *     self-recorded doses (like ad-hoc).
 *   - missed logs never count toward N.
 *   - Ad-hoc logs (null medicationPlanId) → selfRecordedLogs, not any plan's adherence.
 *
 * This module is PURE: no store imports, no I/O, no React imports.
 * Security: NEVER log any plan name, dose, or log note — MOTHER-health data (SD-2/SD-5).
 */

import { expand } from '../recurrence/recurrenceExpander';
import type { MedicationScheduleRule } from '../sync/syncTypes';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * ReportMedicationPlan — a single decoded medication plan for the PDF section.
 *
 * Values (name, dose) are ALREADY DECODED from base64 by the caller (DoctorPdfScreen).
 * The assembler renders them verbatim — no interpretation, no grading.
 *
 * Security: NEVER log name or dose — SD-2/SD-5.
 */
export interface ReportMedicationPlan {
  id: string;
  /** Decoded plaintext drug/supplement name. Rendered verbatim. Never parsed. */
  name: string;
  /** Decoded plaintext dose text (optional). Rendered verbatim. Never parsed. */
  dose?: string | null;
  /**
   * FLAG-4 recurrence grammar (RULING 7.1) — drives M computation.
   * null = PRN/ad-hoc plan (M=0, no denominator).
   * scheduleRule.startAt folds in the civil anchor (medication_plan has no startAt column).
   */
  scheduleRule?: MedicationScheduleRule | null;
  /** LWW boolean — ZERO effect on M/N count (§A.5). Only governs live reminder sourcing. */
  active: boolean;
  /** Tombstone instant (non-null = deleted). Deleted plans excluded from scored set. */
  deletedAt?: string | null;
}

/**
 * ReportMedicationLog — a single medication log event for the PDF section.
 *
 * note is ALREADY DECODED from base64 by the caller. Gated on includeSensitiveNotes.
 *
 * Security: NEVER log occurrenceTime, note, or medicationPlanId — SD-5.
 */
export interface ReportMedicationLog {
  id: string;
  /** null = ad-hoc dose (no plan). Non-null = FK to a MedicationPlan. */
  medicationPlanId?: string | null;
  /**
   * Floating-civil "YYYY-MM-DDTHH:mm" — the adherence bucket key (FLAG-1).
   * Date part = civil-day key for M/N computation.
   */
  occurrenceTime: string;
  /** taken | missed — equal-weight neutral facts (AC-20). Never graded. */
  status: 'taken' | 'missed';
  /** Decoded plaintext note (optional). Gated on includeSensitiveNotes. Never parsed. */
  note?: string | null;
}

/**
 * PlanAdherence — the computed adherence record for a single live plan.
 *
 * M and N are plain counts, never graded, never thresholded (AC-20/INV-M1).
 */
export interface PlanAdherence {
  planId: string;
  /** Decoded plaintext name. Render verbatim. */
  name: string;
  /** Decoded plaintext dose. Null if absent. Render verbatim. */
  dose: string | null;
  /**
   * Scheduled civil days in range (FLAG-4 expansion → distinct dates).
   * 0 for PRN plans.
   */
  M: number;
  /**
   * Taken days (scheduled plans: distinct M-days with ≥1 taken log; PRN: count of taken entries).
   * N ≤ M always for scheduled plans.
   */
  N: number;
  /** true iff scheduleRule was null (PRN/ad-hoc plan — renders "N ครั้ง" not "N/M วัน"). */
  isPrn: boolean;
}

/**
 * AdherenceResult — full output of computeAdherence.
 */
export interface AdherenceResult {
  /** Adherence records for every live (non-deleted) plan. */
  planAdherences: PlanAdherence[];
  /**
   * Self-recorded dose logs in range:
   *   - Ad-hoc logs (null medicationPlanId), and
   *   - Logs belonging to deleted (tombstoned) plans.
   * These are listed separately from plan adherence — never forced into a ratio.
   */
  selfRecordedLogs: ReportMedicationLog[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Civil date part of a floating-civil or ISO datetime. */
function civilDate(isoOrFloating: string): string {
  return isoOrFloating.substring(0, 10);
}

/** Returns true iff the log's occurrenceTime civil date is within [dateFrom, dateTo]. */
function logInRange(log: ReportMedicationLog, dateFrom: string, dateTo: string): boolean {
  const d = civilDate(log.occurrenceTime);
  return d >= dateFrom && d <= dateTo;
}

// ─── Main computation ─────────────────────────────────────────────────────────

/**
 * computeAdherence — derive per-plan adherence counts from local store data.
 *
 * Pure function — deterministic for identical inputs, no side effects.
 * Reuses the FLAG-4 recurrenceExpander (expand()) to derive the M fire-day set.
 * This is the SINGLE source of truth for M computation; the same expander guards
 * the golden test-vectors in data-model.md §3.5.
 *
 * @param plans    All medication plans (including deleted, active=false).
 *                 Caller passes the full set; this function filters.
 * @param logs     All live medication logs (getLogs() from medicationLogSyncStore).
 *                 Unsorted; this function filters by range.
 * @param dateFrom Civil "YYYY-MM-DD" start of the report range (inclusive).
 * @param dateTo   Civil "YYYY-MM-DD" end of the report range (inclusive).
 */
export function computeAdherence(
  plans: ReportMedicationPlan[],
  logs: ReportMedicationLog[],
  dateFrom: string,
  dateTo: string,
): AdherenceResult {
  // Partition plans into live (non-deleted) and deleted
  const deletedPlanIds = new Set<string>();
  const livePlans: ReportMedicationPlan[] = [];

  for (const plan of plans) {
    if (plan.deletedAt != null) {
      deletedPlanIds.add(plan.id);
    } else {
      livePlans.push(plan);
    }
  }

  // Build a set of live plan IDs for routing
  const livePlanIds = new Set(livePlans.map((p) => p.id));

  // Filter logs by range (occurrenceTime civil date within [dateFrom, dateTo])
  const logsInRange = logs.filter((log) => logInRange(log, dateFrom, dateTo));

  // Build a complete set of all known plan IDs (live + deleted passed in)
  const allKnownPlanIds = new Set([...livePlans.map((p) => p.id), ...deletedPlanIds]);

  // Self-recorded logs:
  //   - Ad-hoc (null/undefined planId), OR
  //   - Belonging to a deleted (tombstoned) plan, OR
  //   - Orphaned: planId references a plan not present in the passed set at all
  //     (e.g., deleted plan whose record was not passed; spec: logs degrade to self-recorded).
  // Logs belonging to a live plan are routed to that plan's adherence computation.
  const selfRecordedLogs = logsInRange.filter(
    (log) =>
      log.medicationPlanId == null ||
      deletedPlanIds.has(log.medicationPlanId) ||
      !allKnownPlanIds.has(log.medicationPlanId),
  );

  // Compute adherence for each live plan
  const planAdherences: PlanAdherence[] = livePlans.map((plan) => {
    const isPrn = plan.scheduleRule == null;

    // Logs for this plan in range
    const planLogsInRange = logsInRange.filter(
      (log) => log.medicationPlanId === plan.id,
    );
    const planTakenLogs = planLogsInRange.filter((log) => log.status === 'taken');

    if (isPrn) {
      // PRN: N = count of taken log entries in range (no day-dedup, no ratio)
      return {
        planId: plan.id,
        name: plan.name,
        dose: plan.dose ?? null,
        M: 0,
        N: planTakenLogs.length,
        isPrn: true,
      };
    }

    // Scheduled plan: expand FLAG-4 rule to get M fire-day set.
    // expand() is clamped to [dateFrom, dateTo] ∩ [startAt.date, until] automatically:
    //   - anchorDay > wStartDay → expansion starts from anchorDay (mid-range startAt clamp)
    //   - untilDay  < wEndDay  → expansion stops at untilDay  (until clamp)
    // scheduleRule is non-null here (narrowed by isPrn check above).
    const rule = plan.scheduleRule!;
    const occurrences = expand(rule, dateFrom, dateTo);
    const mDays = new Set(occurrences.map((occ) => civilDate(occ)));
    const M = mDays.size;

    // N = count of M-days that have ≥1 taken log (COUNT DISTINCT civil-day)
    // A taken log on a non-fire day does NOT increment N (N ≤ M invariant).
    const takenLogDays = new Set(
      planTakenLogs.map((log) => civilDate(log.occurrenceTime)),
    );
    let N = 0;
    for (const day of mDays) {
      if (takenLogDays.has(day)) N++;
    }

    return {
      planId: plan.id,
      name: plan.name,
      dose: plan.dose ?? null,
      M,
      N,
      isPrn: false,
    };
  });

  return { planAdherences, selfRecordedLogs };
}
