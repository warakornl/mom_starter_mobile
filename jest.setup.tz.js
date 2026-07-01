/**
 * Jest TZ pin — runs before any test module is loaded.
 *
 * Why: The dateTimePickerFormat helpers must use LOCAL Date components (not UTC)
 * so that "YYYY-MM-DD" strings never shift to an adjacent day regardless of the
 * device timezone.  On a bare UTC runner (process.env.TZ unset) local == UTC, so
 * a buggy UTC-based implementation would accidentally pass all tests.
 *
 * Pinning to America/New_York (UTC-5 EST / UTC-4 EDT with spring-forward DST)
 * makes the full suite exercise the UTC-vs-local invariant:
 *   - In EDT (UTC-4, ~Mar–Nov): UTC midnight is 20:00 local the previous day, so
 *     a helper that reads UTC components would return the WRONG civil date.
 *   - In EST (UTC-5, ~Nov–Mar): UTC midnight is 19:00 local the previous day,
 *     same effect.
 *
 * DST note: The test comments label 2026-03-29 and 2026-10-25 as "DST transition
 * days in many TZs."  For America/New_York, DST transitions are 2026-03-08 and
 * 2026-11-01, so those specific dates are not transition days in this zone.
 * However, pinning ANY non-UTC zone with a multi-hour offset provides stronger
 * coverage than UTC because it exposes UTC-vs-local discrepancies.  The helpers
 * are correct for DST-transition days in all zones because they use the Date(y,m,d)
 * constructor (local midnight) + getFullYear/Month/Date (local), never toISOString
 * or UTC methods.
 *
 * Safety: All 452 tests pass with this pin.  Tests that need TZ-independence use
 * Date.UTC + getUTC* throughout (gestationalAge, postpartumAge, recurrenceExpander).
 */
process.env.TZ = 'America/New_York';
