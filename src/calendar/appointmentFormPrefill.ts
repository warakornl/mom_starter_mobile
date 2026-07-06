/**
 * appointmentFormPrefill.ts — pure helpers for AppointmentFormScreen prefill.
 *
 * Extracted so the initialization and record-building logic can be unit-tested
 * without React component rendering.
 *
 * INV-A4: no writes happen in this module. The caller (AppointmentFormScreen)
 *   calls calendarSyncStore.enqueueCreateChecklistItem() only on Save.
 *
 * Surface 5 spec:
 *   - initAppointmentFormState: determines initial field values from
 *     existingItem / prefill / defaults (existingItem takes precedence)
 *   - Blank-date OFF: when prefill.date is absent → date = '' (not localCivilToday)
 *   - Flag-driven dateLabel: prefill.dateLabel locale-selected from LocalizedContent
 *   - headerDisclaimer: verbatim prefill.headerDisclaimer locale-selected (INV-A6)
 *   - buildChecklistItemToCreate: sets source='from_suggestion' and
 *     sourceSuggestionStateId when prefill.fromSuggestion is true
 */

import type { AncFormPrefill } from '../suggestion/types';
import type { ChecklistItemRecord, ChecklistItemCategory } from '../sync/syncTypes';
import { localCivilToday } from '../pregnancy/gestationalAge';

// ─── initAppointmentFormState ─────────────────────────────────────────────────

export interface AppointmentFormState {
  title: string;
  category: ChecklistItemCategory;
  date: string;
  time: string;
  allDay: boolean;
  /** Locale-selected label shown above the date picker. */
  dateLabel: string;
  /**
   * Locale-selected disclaimer text rendered in the header band (INV-A6).
   * Null when there is no prefill (bare create or edit modes).
   */
  headerDisclaimer: string | null;
}

export interface InitAppointmentFormStateInput {
  existingItem?: ChecklistItemRecord;
  prefill?: AncFormPrefill;
  locale: string;
  /** Default category when neither existingItem nor prefill specify one. */
  defaultCategory?: ChecklistItemCategory;
}

/**
 * Compute the initial form state.
 *
 * Precedence (per spec §3.5 existingItem?.x ?? prefill?.x ?? default):
 *   1. existingItem field (edit mode — always wins)
 *   2. prefill field (from-suggestion create mode)
 *   3. Hard default (bare create mode)
 *
 * BLANK-DATE INVARIANT (§2.3):
 *   When prefill is provided but prefill.date is absent (ANC_PREFILL_DATE=OFF),
 *   the date field MUST be blank (''), NOT localCivilToday().
 *   This ensures the mother is not mis-anchored on today's date.
 */
export function initAppointmentFormState(
  input: InitAppointmentFormStateInput,
): AppointmentFormState {
  const { existingItem, prefill, locale, defaultCategory = 'appointment' } = input;
  const isLocaleEn = locale === 'en';

  // title
  const title =
    existingItem?.title ??
    (prefill ? (isLocaleEn ? prefill.title.en : prefill.title.th) : '');

  // category
  const category: ChecklistItemCategory =
    existingItem?.category ?? prefill?.category ?? defaultCategory;

  // date
  let date: string;
  if (existingItem?.scheduledAt) {
    date = existingItem.scheduledAt.slice(0, 10);
  } else if (prefill) {
    // Blank-date invariant: absent prefill.date → '' (not today)
    date = prefill.date ?? '';
  } else {
    date = localCivilToday();
  }

  // time
  const time =
    existingItem?.scheduledAt?.slice(11, 16) ?? prefill?.time ?? '09:00';

  // allDay
  const allDay = existingItem?.scheduledAt?.endsWith('T00:00') ?? false;

  // dateLabel — locale-selected from prefill.dateLabel, or generic i18n key name
  // (the component uses the generic 'appointment.fieldDate' key when dateLabel is null)
  const dateLabel: string = prefill
    ? (isLocaleEn ? prefill.dateLabel.en : prefill.dateLabel.th)
    : ''; // empty = caller uses the default i18n key

  // headerDisclaimer — null when no prefill (INV-A6: only shown for from-suggestion)
  const headerDisclaimer: string | null = prefill
    ? (isLocaleEn ? prefill.headerDisclaimer.en : prefill.headerDisclaimer.th)
    : null;

  return { title, category, date, time, allDay, dateLabel, headerDisclaimer };
}

// ─── buildChecklistItemToCreate ───────────────────────────────────────────────

export interface BuildChecklistItemInput {
  id: string;
  title: string;
  category: ChecklistItemCategory;
  scheduledAt: string;
  note: string | null;
  now: string;
  prefill?: AncFormPrefill;
}

/**
 * Build the ChecklistItemRecord for a new appointment.
 *
 * When prefill.fromSuggestion is true:
 *   - source = 'from_suggestion'
 *   - sourceSuggestionStateId = prefill.sourceSuggestionStateId
 *
 * Otherwise source = 'user_created' and sourceSuggestionStateId is omitted.
 *
 * INV-A4: this function is pure — it creates no side effects. The caller
 *   must call calendarSyncStore.enqueueCreateChecklistItem() only on Save.
 */
export function buildChecklistItemToCreate(
  input: BuildChecklistItemInput,
): ChecklistItemRecord {
  const { id, title, category, scheduledAt, note, now, prefill } = input;

  const isFromSuggestion = prefill?.fromSuggestion === true;

  return {
    id,
    category,
    title,
    scheduledAt,
    done: false,
    note,
    source: isFromSuggestion ? 'from_suggestion' : 'user_created',
    ...(isFromSuggestion && prefill?.sourceSuggestionStateId
      ? { sourceSuggestionStateId: prefill.sourceSuggestionStateId }
      : {}),
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}
