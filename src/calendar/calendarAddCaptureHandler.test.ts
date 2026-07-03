/**
 * calendarAddCaptureHandler.test.ts — TDD RED phase.
 *
 * Tests for the pure handler that builds Capture route params when the user
 * taps the Day-Detail "Add / บันทึกสุขภาพ" button (calendar-add-capture-btn).
 *
 * Spec refs:
 *   capture-ui.md §2     — date defaults to the selected civil day passed from
 *                          the calendar; no metricType = generic Add, shows the
 *                          type segmented control.
 *   calendar-home-screens §4.4 — civil-day hand-off: pass the YYYY-MM-DD date
 *                          string; do NOT convert to UTC or localise the tz.
 *   types.ts Capture     — params shape: { metricType?, loggedAtDate?, defaultTime? }
 *
 * These tests FAIL until src/calendar/calendarAddCaptureHandler.ts is created.
 */

import { buildAddCaptureParams } from './calendarAddCaptureHandler';

describe('buildAddCaptureParams — Day-Detail "Add" → Capture civil-day hand-off', () => {
  it('returns loggedAtDate equal to the selected civil day', () => {
    const params = buildAddCaptureParams('2026-07-03');
    expect(params.loggedAtDate).toBe('2026-07-03');
  });

  it('does NOT include metricType — generic Add shows the type segmented control (capture-ui §2)', () => {
    const params = buildAddCaptureParams('2026-07-03');
    expect('metricType' in params).toBe(false);
  });

  it('does NOT include defaultTime — time defaults handled inside CaptureScreen (capture-ui §2)', () => {
    const params = buildAddCaptureParams('2026-07-03');
    expect('defaultTime' in params).toBe(false);
  });

  it('passes the civil date string byte-for-byte (§4.4 — no timezone conversion)', () => {
    const date = '2026-01-15';
    expect(buildAddCaptureParams(date).loggedAtDate).toBe(date);
  });

  it('works for a past civil date (calendar past-day view)', () => {
    expect(buildAddCaptureParams('2026-06-28').loggedAtDate).toBe('2026-06-28');
  });

  it('works for a future civil date (calendar future-day view)', () => {
    expect(buildAddCaptureParams('2026-12-31').loggedAtDate).toBe('2026-12-31');
  });

  it('result shape satisfies Capture route param contract (loggedAtDate only)', () => {
    const params = buildAddCaptureParams('2026-07-03');
    expect(Object.keys(params)).toEqual(['loggedAtDate']);
  });
});
