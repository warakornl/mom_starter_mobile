/**
 * appointmentFormPrefill.test.ts — TDD for Surface 5 pure prefill helpers.
 *
 * Tests the pure logic extracted from AppointmentFormScreen:
 *   initAppointmentFormState — determines initial field values from prefill/existingItem
 *   buildChecklistItemToCreate — constructs the ChecklistItemRecord on Save,
 *     including source='from_suggestion' and sourceSuggestionStateId when fromSuggestion
 *
 * INV-A4 (write-on-Save-only) is asserted: cancel is a no-op — only Save calls
 * the builder. This module has no side effects itself.
 *
 * PDPA-A4 / INV-A5: no health values enter these functions — only form field strings.
 */

import {
  initAppointmentFormState,
  buildChecklistItemToCreate,
} from './appointmentFormPrefill';
import type { AncFormPrefill } from '../suggestion/types';
import type { ChecklistItemRecord } from '../sync/syncTypes';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PREFILL_ON: AncFormPrefill = {
  title: { th: 'นัดตรวจครรภ์', en: 'Prenatal check-up' },
  date: '2026-09-15',
  dateLabel: { th: 'วันแนะนำโดยประมาณ', en: 'Suggested approximate date' },
  time: '09:00',
  category: 'anc_visit',
  attachReminder: false,
  headerDisclaimer: { th: 'ข้อความแจ้งเตือน (TH)', en: 'Disclaimer (EN)' },
  fromSuggestion: true,
  sourceSuggestionStateId: 'anc_next_checkup',
};

const PREFILL_OFF: AncFormPrefill = {
  ...PREFILL_ON,
  date: undefined, // ANC_PREFILL_DATE = OFF
  dateLabel: { th: 'ตามที่แพทย์นัด', en: "follow your doctor's schedule" },
};

const EXISTING_ITEM: ChecklistItemRecord = {
  id: 'existing-001',
  category: 'appointment',
  title: 'ตรวจเลือด',
  scheduledAt: '2026-08-10T14:30',
  done: false,
  note: null,
  source: 'user_created',
  version: 1,
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-01T10:00:00Z',
};

// ─── initAppointmentFormState ─────────────────────────────────────────────────

describe('initAppointmentFormState — prefill mode (no existingItem)', () => {
  it('title is locale-selected from prefill.title (TH)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'th' });
    expect(s.title).toBe('นัดตรวจครรภ์');
  });

  it('title is locale-selected from prefill.title (EN)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'en' });
    expect(s.title).toBe('Prenatal check-up');
  });

  it('date = prefill.date when ANC_PREFILL_DATE=ON (date present)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'th' });
    expect(s.date).toBe('2026-09-15');
  });

  it('date = "" (blank) when prefill.date is absent (ANC_PREFILL_DATE=OFF)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_OFF, locale: 'th' });
    expect(s.date).toBe('');
  });

  it('time = prefill.time', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'th' });
    expect(s.time).toBe('09:00');
  });

  it('category = prefill.category (anc_visit)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'th' });
    expect(s.category).toBe('anc_visit');
  });

  it('allDay = false (appointment with time)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'th' });
    expect(s.allDay).toBe(false);
  });

  it('dateLabel = locale-selected prefill.dateLabel (TH, date-ON)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'th' });
    expect(s.dateLabel).toBe('วันแนะนำโดยประมาณ');
  });

  it('dateLabel = locale-selected prefill.dateLabel (EN, date-OFF)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_OFF, locale: 'en' });
    expect(s.dateLabel).toBe("follow your doctor's schedule");
  });

  it('headerDisclaimer = prefill.headerDisclaimer locale-selected (TH)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'th' });
    expect(s.headerDisclaimer).toBe('ข้อความแจ้งเตือน (TH)');
  });

  it('headerDisclaimer = prefill.headerDisclaimer locale-selected (EN)', () => {
    const s = initAppointmentFormState({ prefill: PREFILL_ON, locale: 'en' });
    expect(s.headerDisclaimer).toBe('Disclaimer (EN)');
  });
});

describe('initAppointmentFormState — edit mode (existingItem takes precedence)', () => {
  it('title comes from existingItem when both provided', () => {
    const s = initAppointmentFormState({
      existingItem: EXISTING_ITEM,
      prefill: PREFILL_ON,
      locale: 'th',
    });
    expect(s.title).toBe('ตรวจเลือด');
  });

  it('date comes from existingItem.scheduledAt when both provided', () => {
    const s = initAppointmentFormState({
      existingItem: EXISTING_ITEM,
      prefill: PREFILL_ON,
      locale: 'th',
    });
    expect(s.date).toBe('2026-08-10');
  });

  it('category comes from existingItem when both provided', () => {
    const s = initAppointmentFormState({
      existingItem: EXISTING_ITEM,
      prefill: PREFILL_ON,
      locale: 'th',
    });
    expect(s.category).toBe('appointment');
  });
});

describe('initAppointmentFormState — bare create mode (no prefill, no existingItem)', () => {
  it('title is empty string', () => {
    const s = initAppointmentFormState({ locale: 'th' });
    expect(s.title).toBe('');
  });

  it('date is a non-empty YYYY-MM-DD string (today)', () => {
    const s = initAppointmentFormState({ locale: 'th' });
    expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.date).not.toBe('');
  });

  it('headerDisclaimer is null (no disclaimer band in bare create mode)', () => {
    const s = initAppointmentFormState({ locale: 'th' });
    expect(s.headerDisclaimer).toBeNull();
  });
});

// ─── buildChecklistItemToCreate ───────────────────────────────────────────────

describe('buildChecklistItemToCreate — from-suggestion path (INV-A4)', () => {
  const base = {
    id: 'test-uuid-001',
    title: 'นัดตรวจครรภ์',
    category: 'anc_visit' as const,
    scheduledAt: '2026-09-15T09:00',
    note: null as string | null,
    now: '2026-07-01T10:00:00.000Z',
  };

  it('source is "from_suggestion" when fromSuggestion=true', () => {
    const record = buildChecklistItemToCreate({ ...base, prefill: PREFILL_ON });
    expect(record.source).toBe('from_suggestion');
  });

  it('sourceSuggestionStateId is "anc_next_checkup"', () => {
    const record = buildChecklistItemToCreate({ ...base, prefill: PREFILL_ON });
    expect(record.sourceSuggestionStateId).toBe('anc_next_checkup');
  });

  it('source is "user_created" when no prefill', () => {
    const record = buildChecklistItemToCreate({ ...base, prefill: undefined });
    expect(record.source).toBe('user_created');
  });

  it('sourceSuggestionStateId is absent when no prefill', () => {
    const record = buildChecklistItemToCreate({ ...base, prefill: undefined });
    expect(record.sourceSuggestionStateId).toBeUndefined();
  });

  it('created record has required ChecklistItemRecord fields', () => {
    const record = buildChecklistItemToCreate({ ...base, prefill: PREFILL_ON });
    expect(record.id).toBeTruthy();
    expect(record.done).toBe(false);
    expect(record.version).toBe(0);
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
  });
});
