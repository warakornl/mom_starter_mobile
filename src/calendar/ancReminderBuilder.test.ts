/**
 * ancReminderBuilder.test.ts — TDD for the ANC one-off reminder builder (Surface 6).
 *
 * Tests the pure buildAncReminderRecord() helper that constructs a ReminderRecord
 * for an ANC appointment without any side effects.
 *
 * Invariants tested:
 *   INV-A4: builder is pure (no side effects) — callerSave triggers the write
 *   PDPA-A4: displayTitle is the generic lock-screen title (never appointment name)
 *            hideOnLockScreen = true enforced
 *   startAt: scheduledAt date − 1 day @ 18:00 (floating civil, not UTC)
 *   recurrenceRule.freq = 'one_off' (no timesOfDay/interval/until — FLAG-4 grammar)
 */

import { buildAncReminderRecord } from './ancReminderBuilder';
import { ANC_LOCK_SCREEN_TITLE, ANC_APPOINTMENT_TITLE } from '../suggestion/ancConfig';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const SCHEDULED_AT = '2026-09-15T09:00'; // floating civil
const ITEM_ID = 'checklist-abc-123';
const NOW = '2026-07-01T10:00:00.000Z';

// ─── PDPA-A4: generic lock-screen title ───────────────────────────────────────

describe('buildAncReminderRecord — PDPA-A4 generic lock-screen title', () => {
  it('displayTitle is ANC_LOCK_SCREEN_TITLE.th when locale=th', () => {
    const r = buildAncReminderRecord({
      checklistItemId: ITEM_ID,
      scheduledAt: SCHEDULED_AT,
      locale: 'th',
      id: 'reminder-001',
      now: NOW,
    });
    expect(r.displayTitle).toBe(ANC_LOCK_SCREEN_TITLE.th);
  });

  it('displayTitle is ANC_LOCK_SCREEN_TITLE.en when locale=en', () => {
    const r = buildAncReminderRecord({
      checklistItemId: ITEM_ID,
      scheduledAt: SCHEDULED_AT,
      locale: 'en',
      id: 'reminder-001',
      now: NOW,
    });
    expect(r.displayTitle).toBe(ANC_LOCK_SCREEN_TITLE.en);
  });

  it('displayTitle is NEVER the appointment name (PDPA-A4)', () => {
    const r = buildAncReminderRecord({
      checklistItemId: ITEM_ID,
      scheduledAt: SCHEDULED_AT,
      locale: 'th',
      id: 'reminder-001',
      now: NOW,
    });
    // Must not reveal appointment type on lock screen
    expect(r.displayTitle).not.toBe(ANC_APPOINTMENT_TITLE.th);
    expect(r.displayTitle).not.toBe(ANC_APPOINTMENT_TITLE.en);
    expect(r.displayTitle).not.toContain('นัด');
    expect(r.displayTitle).not.toContain('ตรวจ');
    expect(r.displayTitle).not.toContain('ครรภ์');
  });

  it('hideOnLockScreen is true (PDPA-A4)', () => {
    const r = buildAncReminderRecord({
      checklistItemId: ITEM_ID,
      scheduledAt: SCHEDULED_AT,
      locale: 'th',
      id: 'reminder-001',
      now: NOW,
    });
    expect(r.hideOnLockScreen).toBe(true);
  });
});

// ─── startAt computation ──────────────────────────────────────────────────────

describe('buildAncReminderRecord — startAt (1 day before at 18:00)', () => {
  it('startAt is the day before scheduledAt at 18:00', () => {
    const r = buildAncReminderRecord({
      checklistItemId: ITEM_ID,
      scheduledAt: '2026-09-15T09:00',
      locale: 'th',
      id: 'reminder-001',
      now: NOW,
    });
    expect(r.startAt).toBe('2026-09-14T18:00');
  });

  it('startAt crosses month boundary correctly (Oct 1 → Sep 30)', () => {
    const r = buildAncReminderRecord({
      checklistItemId: ITEM_ID,
      scheduledAt: '2026-10-01T09:00',
      locale: 'th',
      id: 'reminder-001',
      now: NOW,
    });
    expect(r.startAt).toBe('2026-09-30T18:00');
  });

  it('startAt crosses year boundary correctly (Jan 1 → Dec 31)', () => {
    const r = buildAncReminderRecord({
      checklistItemId: ITEM_ID,
      scheduledAt: '2027-01-01T09:00',
      locale: 'th',
      id: 'reminder-001',
      now: NOW,
    });
    expect(r.startAt).toBe('2026-12-31T18:00');
  });
});

// ─── Record shape ─────────────────────────────────────────────────────────────

describe('buildAncReminderRecord — record shape', () => {
  const r = buildAncReminderRecord({
    checklistItemId: ITEM_ID,
    scheduledAt: SCHEDULED_AT,
    locale: 'th',
    id: 'reminder-001',
    now: NOW,
  });

  it('type is appointment', () => {
    expect(r.type).toBe('appointment');
  });

  it('recurrenceRule.freq is one_off', () => {
    expect(r.recurrenceRule.freq).toBe('one_off');
  });

  it('recurrenceRule has no timesOfDay (one_off rule — FLAG-4)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.recurrenceRule as unknown as Record<string, unknown>).timesOfDay).toBeUndefined();
  });

  it('sourceRefType is checklist_item', () => {
    expect(r.sourceRefType).toBe('checklist_item');
  });

  it('sourceRefId matches the checklistItemId', () => {
    expect(r.sourceRefId).toBe(ITEM_ID);
  });

  it('active is true', () => {
    expect(r.active).toBe(true);
  });

  it('version is 0 (server assigns version ≥ 1)', () => {
    expect(r.version).toBe(0);
  });

  it('id is the provided id', () => {
    expect(r.id).toBe('reminder-001');
  });
});
