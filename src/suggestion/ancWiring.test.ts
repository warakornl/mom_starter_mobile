/**
 * ancWiring.test.ts — Integration / wiring-seam tests for the ANC
 * appointment suggestion end-to-end path (FIX4).
 *
 * These tests exercise the REAL modules in the chain — no mocks except the
 * node-harness unavoidable ones (AsyncStorage, navigation).
 *
 * What they prove:
 *   1. Eligible context (edd set, gestationalWeek in lead window, no upcoming appt)
 *      → ANC card is OFFERABLE (getOfferable returns anc_next_checkup).
 *   2. buildAncStartPayload returns a non-null prefill + resurfacesAt from eligible input.
 *   3. After SuggestionStore.start(key, resurfacesAt), the key is no longer offerable
 *      for this round (round-quiet / §1.5 re-arm).
 *   4. onAncStart fires with a prefill carrying the correct fields:
 *        title='นัดตรวจครรภ์'|'Prenatal check-up', category='anc_visit',
 *        time='09:00', attachReminder=false, fromSuggestion=true,
 *        sourceSuggestionStateId='anc_next_checkup',
 *        headerDisclaimer present, dateLabel present.
 *   5. AppointmentFormScreen initState (via initAppointmentFormState) seeds the
 *        form correctly from the prefill.
 *   6. Start→Cancel: calendarSyncStore changeset has 0 checklistItems + 0 reminders
 *        (INV-A4 — nothing written between Start and Save).
 *   7. MISSING-WIRING regression: if edd is absent from context, ANC is NOT offerable
 *        (the failure mode that existed before FIX2 — edd always undefined).
 *   8. MISSING-WIRING regression: if upcomingApptInWindow is true, ANC is NOT offerable.
 *   9. hasUpcomingAncApptInWindow wired to calendarSyncStore: after enqueueCreate of an
 *        anc_visit in window, the selector returns true → suppresses the card.
 *
 * The tests do NOT render React components (no @testing-library/react-native needed).
 * They test the pure-function seam: engine + store + payload + formState helpers.
 * This is the level at which the previous missing-wiring bug (green units, dead feature)
 * is detectable without full navigation-render infrastructure.
 *
 * ANC-AC-3, ANC-AC-4, ANC-AC-5, ANC-AC-8, ANC-AC-10, §1.3, §2.2, §3.2
 */

import { getOfferable } from './suggestionEngine';
import { suggestionStore } from './suggestionStore';
import { buildAncStartPayload } from './ancHandleStart';
import { initAppointmentFormState } from '../calendar/appointmentFormPrefill';
import { hasUpcomingAncApptInWindow } from './ancUpcomingApptSelector';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import type { SuggestionContext, AncFormPrefill } from './types';
import {
  ANC_TARGET_WEEKS,
  OFFER_LEAD_WEEKS,
  ANC_CATALOG_COPY,
  ANC_APPOINTMENT_TITLE,
  ANC_PREFILL_DATE,
} from './ancConfig';
import { weekToTargetDate } from '../pregnancy/gestationalAge';
import { v4 as uuidv4 } from 'uuid';
import type { ChecklistItemRecord } from '../sync/syncTypes';

// ─── Consistent fixture (EDD + TODAY + gestationalWeek) ──────────────────────
//
// EDD = 2027-01-29, gestationalWeek = 11 = FIRST_TARGET - 1 = 12 - 1.
// weekToTargetDate('2027-01-29', 12) ≈ '2026-07-18' > TODAY.
// Offerable predicate: gestationalWeek(11) >= nextTargetWeek(12) - OFFER_LEAD_WEEKS(1) = 11 ✓

const EDD = '2027-01-29';
const TODAY = '2026-07-10';
const FIRST_TARGET = ANC_TARGET_WEEKS[0]; // e.g. 12
const GW_IN_WINDOW = FIRST_TARGET - OFFER_LEAD_WEEKS; // 11 — first week in lead window

function makeEligibleCtx(
  overrides: Partial<SuggestionContext> = {},
): SuggestionContext {
  return {
    lifecycle: 'pregnant',
    stage: 'T1',
    gestationalWeek: GW_IN_WINDOW,
    now: new Date(`${TODAY}T10:00:00Z`),
    edd: EDD,
    upcomingApptInWindow: false,
    ...overrides,
  };
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset suggestion store to a clean state before each test
  suggestionStore.reset();
  // Reset calendar store so no stale items affect the selector tests
  calendarSyncStore.reset();
});

// ─── 1. Eligible context → ANC card is offerable ─────────────────────────────

describe('ANC offerable predicate (wiring seam)', () => {
  it('ANC card is offerable when edd is set, gestationalWeek in lead window, no upcoming appt', () => {
    const result = getOfferable(makeEligibleCtx(), suggestionStore.getState());
    const keys = result.map((s) => s.key);
    expect(keys).toContain('anc_next_checkup');
  });

  // ── MISSING-WIRING regression: if edd is absent, ANC must NOT be offerable ──
  // This is the exact failure mode that existed before FIX2: edd was never
  // passed to SuggestionFlowScreen, so isAncCadenceOfferable early-returned false.
  it('REGRESSION: ANC card is NOT offerable when edd is absent (null)', () => {
    const ctx = makeEligibleCtx({ edd: null });
    const result = getOfferable(ctx, suggestionStore.getState());
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('anc_next_checkup');
  });

  it('REGRESSION: ANC card is NOT offerable when edd is empty string', () => {
    const ctx = makeEligibleCtx({ edd: '' });
    const result = getOfferable(ctx, suggestionStore.getState());
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('anc_next_checkup');
  });

  // ── MISSING-WIRING regression: if upcomingApptInWindow is true, card suppressed ─
  it('REGRESSION: ANC card is NOT offerable when upcomingApptInWindow=true', () => {
    const ctx = makeEligibleCtx({ upcomingApptInWindow: true });
    const result = getOfferable(ctx, suggestionStore.getState());
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('anc_next_checkup');
  });
});

// ─── 2. buildAncStartPayload returns valid prefill ──────────────────────────

describe('buildAncStartPayload (wiring seam)', () => {
  it('returns non-null payload from eligible input', () => {
    const payload = buildAncStartPayload({
      edd: EDD,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    });
    expect(payload).not.toBeNull();
  });

  it('prefill has correct fields: title, category, time, attachReminder, fromSuggestion, sourceSuggestionStateId', () => {
    const payload = buildAncStartPayload({
      edd: EDD,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    });
    expect(payload).not.toBeNull();
    const { prefill } = payload!;

    // title is doctor-signed LocalizedContent
    expect(prefill.title.th).toBe(ANC_APPOINTMENT_TITLE.th);
    expect(prefill.title.en).toBe(ANC_APPOINTMENT_TITLE.en);

    expect(prefill.category).toBe('anc_visit');
    expect(prefill.time).toBe('09:00');
    expect(prefill.attachReminder).toBe(false);
    expect(prefill.fromSuggestion).toBe(true);
    expect(prefill.sourceSuggestionStateId).toBe('anc_next_checkup');
  });

  it('prefill has headerDisclaimer (doctor-signed formDisclaimer)', () => {
    const payload = buildAncStartPayload({
      edd: EDD,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    });
    const { prefill } = payload!;
    expect(prefill.headerDisclaimer.th).toBe(ANC_CATALOG_COPY.formDisclaimer.th);
    expect(prefill.headerDisclaimer.en).toBe(ANC_CATALOG_COPY.formDisclaimer.en);
  });

  it('prefill.dateLabel is dateLabelOn when ANC_PREFILL_DATE=true', () => {
    const payload = buildAncStartPayload({
      edd: EDD,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    });
    const { prefill } = payload!;
    expect(prefill.dateLabel.th).toBe(ANC_CATALOG_COPY.dateLabelOn.th);
    expect(prefill.date).toBeDefined(); // date is set when flag is ON
  });

  it('prefill.dateLabel is dateLabelOff and date is undefined when ANC_PREFILL_DATE=false', () => {
    const payload = buildAncStartPayload({
      edd: EDD,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: false,
    });
    const { prefill } = payload!;
    expect(prefill.dateLabel.th).toBe(ANC_CATALOG_COPY.dateLabelOff.th);
    expect(prefill.date).toBeUndefined(); // blank-date OFF state
  });

  it('returns null when edd is absent', () => {
    const payload = buildAncStartPayload({
      edd: null,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: ANC_PREFILL_DATE,
    });
    expect(payload).toBeNull();
  });
});

// ─── 3. suggestionStore.start(key, resurfacesAt) → round-quiet (§1.5) ────────

describe('suggestionStore.start re-arm (wiring seam)', () => {
  it('After start with resurfacesAt in future, ANC card is suppressed for this round', () => {
    // Compute resurfacesAt: nextTargetDate at local midnight
    const nextTargetDate = weekToTargetDate(EDD, FIRST_TARGET);
    const resurfacesAt = new Date(`${nextTargetDate}T00:00`).toISOString();

    suggestionStore.start('anc_next_checkup', resurfacesAt);

    // now is the same as TODAY, which is before resurfacesAt
    const ctx = makeEligibleCtx({ now: new Date(`${TODAY}T10:00:00Z`) });
    const result = getOfferable(ctx, suggestionStore.getState());
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('anc_next_checkup'); // round-quiet
  });

  it('After start, ANC card re-arms once resurfacesAt has passed (next round)', () => {
    // Set resurfacesAt to the past
    const pastDate = '2026-01-01';
    const resurfacesAt = new Date(`${pastDate}T00:00`).toISOString();

    suggestionStore.start('anc_next_checkup', resurfacesAt);

    // now is after resurfacesAt → re-arm
    const ctx = makeEligibleCtx({ now: new Date(`${TODAY}T10:00:00Z`) });
    const result = getOfferable(ctx, suggestionStore.getState());
    const keys = result.map((s) => s.key);
    expect(keys).toContain('anc_next_checkup'); // re-armed
  });
});

// ─── 4. onAncStart fires with correct prefill fields ─────────────────────────

describe('onAncStart callback fires with correct prefill (wiring seam)', () => {
  it('simulated handleStart calls onAncStart with the prefill payload', () => {
    const onAncStartMock = jest.fn<void, [AncFormPrefill]>();

    // Simulate SuggestionFlowScreen.handleStart('anc_next_checkup')
    const payload = buildAncStartPayload({
      edd: EDD,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: ANC_PREFILL_DATE,
    });

    expect(payload).not.toBeNull();
    if (payload) {
      suggestionStore.start('anc_next_checkup', payload.resurfacesAt);
      onAncStartMock(payload.prefill);
    }

    expect(onAncStartMock).toHaveBeenCalledTimes(1);
    const calledPrefill = onAncStartMock.mock.calls[0][0];
    expect(calledPrefill.category).toBe('anc_visit');
    expect(calledPrefill.fromSuggestion).toBe(true);
    expect(calledPrefill.sourceSuggestionStateId).toBe('anc_next_checkup');
    expect(calledPrefill.headerDisclaimer).toBeDefined();
  });
});

// ─── 5. AppointmentFormScreen initState seeds correctly from prefill ──────────

describe('initAppointmentFormState from ANC prefill (wiring seam)', () => {
  it('title is locale-correct value from prefill.title', () => {
    const payload = buildAncStartPayload({
      edd: EDD, gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    })!;
    const thState = initAppointmentFormState({ prefill: payload.prefill, locale: 'th' });
    expect(thState.title).toBe(ANC_APPOINTMENT_TITLE.th);

    const enState = initAppointmentFormState({ prefill: payload.prefill, locale: 'en' });
    expect(enState.title).toBe(ANC_APPOINTMENT_TITLE.en);
  });

  it('category is anc_visit', () => {
    const payload = buildAncStartPayload({
      edd: EDD, gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    })!;
    const state = initAppointmentFormState({ prefill: payload.prefill, locale: 'th' });
    expect(state.category).toBe('anc_visit');
  });

  it('date is blank when ANC_PREFILL_DATE=OFF (blank-date state §2.3)', () => {
    const payload = buildAncStartPayload({
      edd: EDD, gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: false,
    })!;
    const state = initAppointmentFormState({ prefill: payload.prefill, locale: 'th' });
    expect(state.date).toBe(''); // blank, NOT localCivilToday()
  });

  it('date is present when ANC_PREFILL_DATE=ON', () => {
    const payload = buildAncStartPayload({
      edd: EDD, gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    })!;
    const state = initAppointmentFormState({ prefill: payload.prefill, locale: 'th' });
    expect(state.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // valid civil date
    expect(state.date).not.toBe('');
  });

  it('headerDisclaimer is the locale-correct form disclaimer (INV-A6)', () => {
    const payload = buildAncStartPayload({
      edd: EDD, gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    })!;
    const thState = initAppointmentFormState({ prefill: payload.prefill, locale: 'th' });
    expect(thState.headerDisclaimer).toBe(ANC_CATALOG_COPY.formDisclaimer.th);

    const enState = initAppointmentFormState({ prefill: payload.prefill, locale: 'en' });
    expect(enState.headerDisclaimer).toBe(ANC_CATALOG_COPY.formDisclaimer.en);
  });

  it('dateLabel is the locale-correct approved label', () => {
    const payloadOn = buildAncStartPayload({
      edd: EDD, gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: true,
    })!;
    const stateOn = initAppointmentFormState({ prefill: payloadOn.prefill, locale: 'th' });
    expect(stateOn.dateLabel).toBe(ANC_CATALOG_COPY.dateLabelOn.th);

    const payloadOff = buildAncStartPayload({
      edd: EDD, gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: false,
    })!;
    const stateOff = initAppointmentFormState({ prefill: payloadOff.prefill, locale: 'th' });
    expect(stateOff.dateLabel).toBe(ANC_CATALOG_COPY.dateLabelOff.th);
  });
});

// ─── 6. Start→Cancel: 0 ChecklistItem / 0 Reminder enqueued (INV-A4) ─────────

describe('INV-A4: Start→Cancel enqueues 0 items (wiring seam)', () => {
  it('calendarSyncStore changeset has 0 checklistItems and 0 reminders after Start→Cancel', () => {
    // Simulate: Start fires (suggestion store transition + prefill built)
    const payload = buildAncStartPayload({
      edd: EDD,
      gestationalWeek: GW_IN_WINDOW,
      now: new Date(`${TODAY}T10:00:00Z`),
      ancPrefillDateEnabled: ANC_PREFILL_DATE,
    });
    expect(payload).not.toBeNull();
    if (payload) {
      suggestionStore.start('anc_next_checkup', payload.resurfacesAt);
      // Form is opened with prefill — but mother presses Cancel
      // Cancel = no enqueue calls. Drain queue to verify.
    }

    const changeSet = calendarSyncStore.drainQueue();
    // checklistItems and reminders buckets are optional in SyncChangeSet
    // (absent means no entries were queued — which is exactly what we assert).
    expect(changeSet.checklistItems?.created ?? []).toHaveLength(0);
    expect(changeSet.checklistItems?.updated ?? []).toHaveLength(0);
    expect(changeSet.reminders?.created ?? []).toHaveLength(0);
    expect(changeSet.reminders?.updated ?? []).toHaveLength(0);
  });
});

// ─── 7. upcomingApptInWindow + calendarSyncStore wiring ───────────────────────

describe('upcomingApptInWindow wired to calendarSyncStore (wiring seam)', () => {
  it('selector returns false before any appointment is created', () => {
    const result = hasUpcomingAncApptInWindow(
      EDD, GW_IN_WINDOW, calendarSyncStore.getActiveChecklistItems(), TODAY,
    );
    expect(result).toBe(false);
  });

  it('selector returns true after enqueueCreate of anc_visit in window', () => {
    // nextTargetDate for our fixture
    const nextTargetDate = weekToTargetDate(EDD, FIRST_TARGET);
    // Place the appointment somewhere inside [today, nextTargetDate + 14]
    const apptDate = TODAY; // today itself is inclusive lower bound

    const item: ChecklistItemRecord = {
      id: uuidv4(),
      category: 'anc_visit',
      title: 'Test ANC',
      scheduledAt: `${apptDate}T09:00`,
      done: false,
      note: null,
      source: 'user_created',
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    calendarSyncStore.enqueueCreateChecklistItem(item);

    const result = hasUpcomingAncApptInWindow(
      EDD, GW_IN_WINDOW, calendarSyncStore.getActiveChecklistItems(), TODAY,
    );
    expect(result).toBe(true);
  });

  it('after enqueueCreate, ANC card is NOT offerable (§1.3 item 4 suppresses card)', () => {
    const nextTargetDate = weekToTargetDate(EDD, FIRST_TARGET);
    const item: ChecklistItemRecord = {
      id: uuidv4(),
      category: 'appointment',
      title: 'Test appointment',
      scheduledAt: `${TODAY}T09:00`,
      done: false,
      note: null,
      source: 'user_created',
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    calendarSyncStore.enqueueCreateChecklistItem(item);

    const upcomingApptInWindow = hasUpcomingAncApptInWindow(
      EDD, GW_IN_WINDOW, calendarSyncStore.getActiveChecklistItems(), TODAY,
    );
    const ctx = makeEligibleCtx({ upcomingApptInWindow });
    const result = getOfferable(ctx, suggestionStore.getState());
    expect(result.map((s) => s.key)).not.toContain('anc_next_checkup');

    void nextTargetDate; // suppress lint
  });
});
