/**
 * Recurrence expander — FLAG-4 deterministic expansion.
 *
 * Implements the algorithm pinned in api-contract.md §"Recurrence grammar &
 * deterministic expansion (b)" + data-model.md §3.5.
 *
 * Output strings "YYYY-MM-DDTHH:mm" are byte-identical to the backend Java
 * implementation, so projected ↔ materialized instances hash to the same
 * occurrence id via uuidv5(OCCURRENCE_NAMESPACE, reminderId|scheduledLocalCivil).
 *
 * Algorithm (from the contract derivation notes):
 *   step = (freq=="daily") ? 1 : interval
 *   gap  = max(0, civilDaysBetween(anchor.date, windowStart))
 *   k0   = ceil(gap / step)
 *   first emitted d = addDays(anchor.date, k0*step)
 *   loop d <= min(windowEnd, until ?? windowEnd):
 *     emit each timesOfDay, SKIPPING on d==anchor.date any t < anchor.time
 *     (first-day anchor guard — a reminder created at 14:00 does not back-fill 08:00)
 *   one_off: emit startAt directly iff anchor.date in [windowStart, windowEnd]
 *
 * All arithmetic is on civil dates (no timezone, no offset, no UTC).
 * DST never affects expansion (firing re-anchoring is a scheduler concern only).
 */

export type Freq = 'one_off' | 'daily' | 'every_n_days';

export interface RecurrenceRule {
  freq: Freq;
  /**
   * Required iff freq='every_n_days'; MUST be absent (or 1) otherwise.
   * Whole civil-day step count.
   */
  interval?: number;
  /**
   * Required and non-empty for freq='daily' / 'every_n_days'.
   * FORBIDDEN for freq='one_off' (time comes from startAt directly).
   * Canonical: ascending, distinct, "HH:mm" zero-padded 24-hour.
   */
  timesOfDay?: string[];
  /**
   * Floating-civil anchor "YYYY-MM-DDTHH:mm" (zoneless, minute precision).
   * For one_off: this IS the single occurrence datetime.
   * For daily/every_n_days: anchor.date is the expansion start; anchor.time
   * is the first-day guard threshold.
   */
  startAt: string;
  /** Inclusive civil end date "YYYY-MM-DD". */
  until?: string;
}

// ─── Civil-day helpers (UTC math avoids local-tz day shifts) ─────────────────

/** Convert "YYYY-MM-DD" to days-since-epoch (UTC floor). */
function toEpochDay(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Convert days-since-epoch back to "YYYY-MM-DD". */
function fromEpochDay(epochDay: number): string {
  const dt = new Date(epochDay * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Expansion ────────────────────────────────────────────────────────────────

/**
 * Expand a recurrence rule into an ascending list of
 * "YYYY-MM-DDTHH:mm" floating-civil strings within [windowStart, windowEnd].
 *
 * @param rule         RecurrenceRule with startAt + optional timesOfDay/interval/until
 * @param windowStart  Inclusive civil date "YYYY-MM-DD"
 * @param windowEnd    Inclusive civil date "YYYY-MM-DD"
 * @returns            Ascending list of "YYYY-MM-DDTHH:mm" strings
 *
 * Golden test-vectors: data-model.md §3.5 — all 9 cases (GV-1..GV-7 incl. GV-2b, GV-6b)
 * MUST pass identically on backend (Java) and mobile (JS).
 */
export function expand(
  rule: RecurrenceRule,
  windowStart: string,
  windowEnd: string,
): string[] {
  // Extract date "YYYY-MM-DD" and time "HH:mm" from "YYYY-MM-DDTHH:mm"
  const anchorDate = rule.startAt.slice(0, 10);
  const anchorTime = rule.startAt.slice(11, 16);

  const anchorDay = toEpochDay(anchorDate);
  const wStartDay = toEpochDay(windowStart);
  const wEndDay   = toEpochDay(windowEnd);
  const untilDay  = rule.until ? toEpochDay(rule.until) : Infinity;
  const hardEnd   = Math.min(wEndDay, untilDay);

  // ── one_off: fires exactly once at startAt ───────────────────────────────
  if (rule.freq === 'one_off') {
    // Emit the full startAt string iff anchor date falls in [windowStart, windowEnd]
    if (anchorDay >= wStartDay && anchorDay <= hardEnd) {
      return [rule.startAt]; // "YYYY-MM-DDTHH:mm" — zero-padded, no zone (GV-7)
    }
    return [];
  }

  // ── daily / every_n_days ─────────────────────────────────────────────────
  const step = rule.freq === 'daily' ? 1 : Math.max(1, rule.interval ?? 1);
  const times = rule.timesOfDay ?? []; // canonical: ascending, "HH:mm"

  // gap = max(0, civilDaysBetween(anchor.date, windowStart))
  // k0  = ceil(gap / step)  — first on-cycle date >= windowStart
  // d   = anchor.date + k0*step
  const gap = Math.max(0, wStartDay - anchorDay);
  const k0  = gap === 0 ? 0 : Math.ceil(gap / step);
  const firstDay = anchorDay + k0 * step;

  // If firstDay > hardEnd the loop body never executes → [] (GV-5)
  const out: string[] = [];
  for (let d = firstDay; d <= hardEnd; d += step) {
    const dateStr = fromEpochDay(d);
    for (const t of times) {
      // First-day anchor guard (GV-3): on the anchor date, skip times
      // strictly before anchor.time so back-fill never happens.
      if (d === anchorDay && t < anchorTime) continue;
      out.push(`${dateStr}T${t}`);
    }
  }
  // Output is already ascending (dates ascending → times ascending within each date)
  return out;
}
