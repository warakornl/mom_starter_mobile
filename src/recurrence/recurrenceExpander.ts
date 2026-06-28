export type Freq = 'one_off' | 'daily' | 'every_n_days';

export interface RecurrenceRule {
  freq: Freq;
  interval?: number; // for every_n_days
  timesOfDay: string[]; // "HH:mm"
  startDate: string; // "YYYY-MM-DD"
  until?: string; // inclusive "YYYY-MM-DD"
}

/** Civil-only date helpers (UTC math avoids any local-tz day shift). */
function toEpochDay(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
function fromEpochDay(epochDay: number): string {
  const dt = new Date(epochDay * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * FLAG-4: deterministic expansion. Emits minute-precision floating civil strings
 * "YYYY-MM-DDTHH:mm", byte-identical to the backend, so projected and
 * materialized instances hash to the same occurrence id.
 */
export function expand(
  rule: RecurrenceRule,
  windowStart: string,
  windowEnd: string,
): string[] {
  const out: string[] = [];
  const start = toEpochDay(rule.startDate);
  const wStart = toEpochDay(windowStart);
  const wEnd = toEpochDay(windowEnd);
  const until = rule.until ? toEpochDay(rule.until) : Infinity;
  const hardEnd = Math.min(wEnd, until);

  const emit = (epochDay: number) => {
    const date = fromEpochDay(epochDay);
    for (const t of rule.timesOfDay) out.push(`${date}T${t}`);
  };

  if (rule.freq === 'one_off') {
    if (start >= wStart && start <= hardEnd) emit(start);
    return out;
  }

  const step = rule.freq === 'daily' ? 1 : Math.max(1, rule.interval ?? 1);

  let first = start;
  if (first < wStart) {
    const gap = wStart - start;
    const stepsAhead = Math.ceil(gap / step);
    first = start + stepsAhead * step;
  }
  for (let d = first; d <= hardEnd; d += step) emit(d);
  return out;
}
