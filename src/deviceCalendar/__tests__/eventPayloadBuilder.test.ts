/**
 * eventPayloadBuilder — TDD tests (RED before implementation)
 *
 * CS-TITLE-1 compliance:
 *   1. Generic payload = { ANC_LOCK_SCREEN_TITLE, empty location, empty notes } only.
 *   2. Generic branch NEVER reads appointment.title / appointment.note / health fields.
 *   3. Negative scan: forbidden health terms absent from Generic payload.
 *   4. Descriptive payload carries user-typed values only per CAL-SA-10/11/12/13.
 *
 * Trace: architecture §4, functional §3, compliance §3.
 */

import {
  eventPayloadBuilder,
  ANC_LOCK_SCREEN_TITLE,
  ANC_APPOINTMENT_TITLE,
  DEFAULT_DURATION_MIN,
} from '../eventPayloadBuilder';
import type { AppointmentInput } from '../eventPayloadBuilder';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAppt(overrides: Partial<AppointmentInput> = {}): AppointmentInput {
  return {
    id: 'appt-uuid-001',
    category: 'appointment',
    title: 'สัปดาห์ที่ 20 ANC',          // health-bearing title
    scheduledAt: '2026-08-15T10:00',
    note: 'ฝากครรภ์ที่ รพ.รามาฯ สัปดาห์ 20', // health-bearing note
    source: 'user_created',
    done: false,
    ...overrides,
  };
}

// ─── Generic mode (default + privacy default) ─────────────────────────────────

describe('eventPayloadBuilder — Generic mode', () => {
  const appt = makeAppt();

  it('title is ANC_LOCK_SCREEN_TITLE constant', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    expect(payload.title).toBe(ANC_LOCK_SCREEN_TITLE);
  });

  it('location is empty string', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    expect(payload.location).toBe('');
  });

  it('notes is empty string', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    expect(payload.notes).toBe('');
  });

  it('startDate is derived from scheduledAt (not undefined)', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    expect(payload.startDate).toBeInstanceOf(Date);
  });

  it('endDate = startDate + DEFAULT_DURATION_MIN', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    const diffMs = payload.endDate.getTime() - payload.startDate.getTime();
    expect(diffMs).toBe(DEFAULT_DURATION_MIN * 60 * 1000);
  });

  it('allDay is false for timed appointment', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    expect(payload.allDay).toBe(false);
  });

  it('CS-TITLE-1 negative scan: "ANC" absent from Generic payload fields', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    const combined = [payload.title, payload.location, payload.notes].join(' ');
    expect(combined).not.toMatch(/ANC/i);
  });

  it('CS-TITLE-1 negative scan: "ฝากครรภ์" absent from Generic payload fields', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    const combined = [payload.title, payload.location, payload.notes].join(' ');
    expect(combined).not.toMatch(/ฝากครรภ์/);
  });

  it('CS-TITLE-1 negative scan: "นัดตรวจครรภ์" absent from Generic payload fields', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    const combined = [payload.title, payload.location, payload.notes].join(' ');
    expect(combined).not.toMatch(/นัดตรวจครรภ์/);
  });

  it('CS-TITLE-1 negative scan: "antenatal" absent from Generic payload fields', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    const combined = [payload.title, payload.location, payload.notes].join(' ');
    expect(combined).not.toMatch(/antenatal/i);
  });

  it('CS-TITLE-1 negative scan: health-bearing title from appointment.title NOT in payload', () => {
    // The appointment has title 'สัปดาห์ที่ 20 ANC' — must NOT appear in Generic payload
    const payload = eventPayloadBuilder(appt, 'generic');
    const combined = [payload.title, payload.location, payload.notes].join(' ');
    expect(combined).not.toContain('สัปดาห์ที่ 20');
  });

  it('CS-TITLE-1 negative scan: health-bearing note NOT in payload', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    const combined = [payload.title, payload.location, payload.notes].join(' ');
    expect(combined).not.toContain('รพ.รามาฯ');
  });

  it('off-by-543 guard: Gregorian 2026 → startDate year is 2026 (not 2569)', () => {
    const payload = eventPayloadBuilder(
      makeAppt({ scheduledAt: '2026-08-15T10:00' }),
      'generic',
    );
    expect(payload.startDate.getFullYear()).toBe(2026);
  });

  it('timeZone is set', () => {
    const payload = eventPayloadBuilder(appt, 'generic');
    expect(payload.timeZone).toBeDefined();
    expect(typeof payload.timeZone).toBe('string');
  });
});

// ─── Descriptive mode (active opt-in) ─────────────────────────────────────────

describe('eventPayloadBuilder — Descriptive mode, source=user_created', () => {
  const appt = makeAppt({ source: 'user_created', title: 'เช็คเลือด', note: 'ห้อง 201' });

  it('title = appointment.title verbatim (user_created)', () => {
    const payload = eventPayloadBuilder(appt, 'descriptive');
    expect(payload.title).toBe('เช็คเลือด');
  });

  it('notes = appointment.note verbatim', () => {
    const payload = eventPayloadBuilder(appt, 'descriptive');
    expect(payload.notes).toBe('ห้อง 201');
  });

  it('location is ALWAYS empty (MVP, CAL-SA-12)', () => {
    const payload = eventPayloadBuilder(appt, 'descriptive');
    expect(payload.location).toBe('');
  });
});

describe('eventPayloadBuilder — Descriptive mode, source=from_suggestion', () => {
  const appt = makeAppt({
    source: 'from_suggestion',
    title: 'ตรวจเลือด GA 28 สัปดาห์ คลินิกฝากครรภ์ รพ.จุฬา',
    note: 'โน้ต',
  });

  it('title = ANC_APPOINTMENT_TITLE constant (not raw suggestion title) — CAL-SA-11', () => {
    const payload = eventPayloadBuilder(appt, 'descriptive');
    expect(payload.title).toBe(ANC_APPOINTMENT_TITLE);
  });

  it('forbidden specifics from raw suggestion title NOT in payload — CAL-SA-11', () => {
    const payload = eventPayloadBuilder(appt, 'descriptive');
    const combined = [payload.title, payload.location, payload.notes].join(' ');
    // ANC_APPOINTMENT_TITLE = "นัดตรวจครรภ์" is permitted in Descriptive (CS-TITLE-1 scoped to Generic)
    // But the raw suggestion string with "GA 28 สัปดาห์" and clinic name must be absent
    expect(combined).not.toContain('GA 28');
    expect(combined).not.toContain('รพ.จุฬา');
  });

  it('notes = appointment.note verbatim for from_suggestion too', () => {
    const payload = eventPayloadBuilder(appt, 'descriptive');
    expect(payload.notes).toBe('โน้ต');
  });
});

// ─── Re-mask: Descriptive payload → rebuild as Generic wipes all fields ────────

describe('eventPayloadBuilder — re-mask assertion (Generic overwrites all Descriptive fields)', () => {
  it('full-field overwrite: all payload fields reset to Generic values', () => {
    const appt = makeAppt({
      source: 'user_created',
      title: 'เช็คเลือด',
      note: 'ที่คลินิก',
    });

    const descriptive = eventPayloadBuilder(appt, 'descriptive');
    expect(descriptive.title).toBe('เช็คเลือด');   // sanity check
    expect(descriptive.notes).toBe('ที่คลินิก');

    const generic = eventPayloadBuilder(appt, 'generic');
    // Full overwrite — every field
    expect(generic.title).toBe(ANC_LOCK_SCREEN_TITLE);
    expect(generic.location).toBe('');
    expect(generic.notes).toBe('');
  });
});

// ─── category guard ────────────────────────────────────────────────────────────

describe('eventPayloadBuilder — category guard (defense-in-depth)', () => {
  it('throws if category is not appointment', () => {
    const nonAppt = makeAppt({ category: 'reminder' });
    expect(() => eventPayloadBuilder(nonAppt, 'generic')).toThrow();
  });
});
