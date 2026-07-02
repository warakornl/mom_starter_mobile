/**
 * FLAG-4 grammar validator for recurrenceRule — pure TypeScript, no React imports.
 *
 * Extracted so it can be unit-tested without React Native / JSDOM setup.
 * Imported by ReminderFormScreen.tsx and its test.
 *
 * Rules mirror the server-side validateRecurrenceRule (ReminderSyncCollection.java)
 * as a strict subset: a passing client form is guaranteed never to produce a
 * server-side 422 validation_error.
 *
 * Changes vs original (recurrence-weekly-byday-design.md §3 + §5 item 3a–3c):
 *   - Added `'weekly'` to the valid freq set.
 *   - Added `byDay` parameter (string[]).
 *   - Added `'byDay'` to RuleValidationError.field union.
 *   - byDay FORBIDDEN on one_off / daily / every_n_days → field: 'byDay'.
 *   - weekly REQUIRES non-empty canonical byDay + interval cap 1–52 (OQ-3).
 */

export interface RuleValidationError {
  field: 'freq' | 'interval' | 'timesOfDay' | 'until' | 'startAt' | 'byDay';
  message: string;
}

/** Canonical weekday token order: MO < TU < WE < TH < FR < SA < SU (ISO 5545). */
export const WEEKDAY_TOKENS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayTokenUI = typeof WEEKDAY_TOKENS[number];

export const WEEKDAY_TOKEN_SET = new Set<string>(WEEKDAY_TOKENS);
export const WEEKDAY_TOKEN_INDEX: Record<string, number> = Object.fromEntries(
  WEEKDAY_TOKENS.map((t, i) => [t, i]),
);

/**
 * Validate a recurrenceRule + startAt against the FLAG-4 grammar.
 * Returns [] on success or an array of field-level errors.
 *
 * @param freq       - 'one_off' | 'daily' | 'every_n_days' | 'weekly'
 * @param interval   - Stringified integer or empty string (absent)
 * @param timesOfDay - ["HH:mm", ...] in canonical ascending order
 * @param until      - "YYYY-MM-DD" or empty string (absent)
 * @param startAt    - "YYYY-MM-DDTHH:mm" civil anchor
 * @param byDay      - weekday tokens; required & non-empty for weekly,
 *                     MUST be empty for other freqs
 */
export function validateRecurrenceRule(
  freq: string,
  interval: string,
  timesOfDay: string[],
  until: string,
  startAt: string,
  byDay: string[],
): RuleValidationError[] {
  const errors: RuleValidationError[] = [];

  // startAt: must be "YYYY-MM-DDTHH:mm"
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt)) {
    errors.push({ field: 'startAt', message: 'startAt must be YYYY-MM-DDTHH:mm' });
  }

  if (!['one_off', 'daily', 'every_n_days', 'weekly'].includes(freq)) {
    errors.push({ field: 'freq', message: 'Unknown freq' });
    return errors; // can't validate further
  }

  // byDay is FORBIDDEN on non-weekly freqs (design §3)
  if (freq !== 'weekly' && byDay.length > 0) {
    errors.push({ field: 'byDay', message: `byDay is forbidden for ${freq}` });
  }

  if (freq === 'one_off') {
    // timesOfDay MUST be absent (forbidden for one_off)
    if (timesOfDay.length > 0) {
      errors.push({ field: 'timesOfDay', message: 'timesOfDay is forbidden for one_off' });
    }
    // interval MUST be absent
    if (interval.trim() && interval.trim() !== '1') {
      errors.push({ field: 'interval', message: 'interval must be absent for one_off' });
    }
    // until MUST be absent — server rejects until on one_off (strict-subset mirror)
    if (until.trim()) {
      errors.push({ field: 'until', message: 'until is forbidden for one_off' });
    }

  } else if (freq === 'weekly') {
    // timesOfDay required and non-empty (same as daily/every_n_days)
    if (timesOfDay.length === 0) {
      errors.push({ field: 'timesOfDay', message: 'timesOfDay must be non-empty' });
    } else {
      for (const t of timesOfDay) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
          errors.push({ field: 'timesOfDay', message: `Invalid time format: ${t}` });
        }
      }
      for (let i = 1; i < timesOfDay.length; i++) {
        if (timesOfDay[i] <= timesOfDay[i - 1]) {
          errors.push({ field: 'timesOfDay', message: 'timesOfDay must be distinct and ascending' });
          break;
        }
      }
    }

    // byDay: required non-empty, all valid tokens, canonical order (MO<TU<…<SU)
    if (byDay.length === 0) {
      errors.push({ field: 'byDay', message: 'byDay is required and must be non-empty for weekly' });
    } else {
      // Validate all tokens are known strings
      let hasInvalidToken = false;
      for (const tok of byDay) {
        if (!WEEKDAY_TOKEN_SET.has(tok)) {
          errors.push({
            field: 'byDay',
            message: `byDay entries must be one of MO,TU,WE,TH,FR,SA,SU; got: ${tok}`,
          });
          hasInvalidToken = true;
          break;
        }
      }
      // Validate strictly ascending (canonical order + no duplicates)
      if (!hasInvalidToken) {
        for (let i = 1; i < byDay.length; i++) {
          const prevIdx = WEEKDAY_TOKEN_INDEX[byDay[i - 1]] ?? -1;
          const curIdx  = WEEKDAY_TOKEN_INDEX[byDay[i]] ?? -1;
          if (curIdx <= prevIdx) {
            errors.push({
              field: 'byDay',
              message: 'byDay must be in canonical order MO<TU<WE<TH<FR<SA<SU with no duplicates',
            });
            break;
          }
        }
      }
    }

    // interval: optional for weekly; if present must be integer 1–52 (OQ-3 cap)
    if (interval.trim()) {
      const n = Number(interval.trim());
      if (!Number.isInteger(n) || n < 1 || n > 52) {
        errors.push({ field: 'interval', message: 'interval for weekly must be an integer 1–52' });
      }
    }

  } else {
    // daily / every_n_days: timesOfDay required and non-empty
    if (timesOfDay.length === 0) {
      errors.push({ field: 'timesOfDay', message: 'timesOfDay must be non-empty' });
    } else {
      // Validate each time: strict 24h "HH:mm" — rejects 25:00, 08:99 etc.
      for (const t of timesOfDay) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
          errors.push({ field: 'timesOfDay', message: `Invalid time format: ${t}` });
        }
      }
      // Validate ascending (no duplicates)
      for (let i = 1; i < timesOfDay.length; i++) {
        if (timesOfDay[i] <= timesOfDay[i - 1]) {
          errors.push({ field: 'timesOfDay', message: 'timesOfDay must be distinct and ascending' });
          break;
        }
      }
    }

    if (freq === 'every_n_days') {
      const n = Number(interval);
      if (!interval.trim() || !Number.isInteger(n) || n < 1) {
        errors.push({ field: 'interval', message: 'interval must be an integer ≥ 1 for every_n_days' });
      }
    } else if (freq === 'daily') {
      // interval must be absent (or 1)
      if (interval.trim() && interval.trim() !== '1') {
        errors.push({ field: 'interval', message: 'interval must be absent for daily' });
      }
    }
  }

  // until: if provided, must be "YYYY-MM-DD"
  if (until.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(until.trim())) {
    errors.push({ field: 'until', message: 'until must be YYYY-MM-DD' });
  }

  return errors;
}
