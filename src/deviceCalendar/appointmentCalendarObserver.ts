/**
 * appointmentCalendarObserver — wires the local appointment store to the device
 * calendar bridge (architecture §2).
 *
 * This is the ONLY production path that makes the calendar-sync feature live.
 * Without this observer the bridge is built but dead — no appointment CRUD
 * ever reaches the device calendar.
 *
 * Design:
 *   - Subscribes to CalendarSyncStore.subscribeToChecklistItemMutations()
 *   - On create/update of a ChecklistItem with category='appointment':
 *       → bridge.onAppointmentUpserted(toAppointmentInput(item))  [Path A]
 *   - On delete of a ChecklistItem with category='appointment':
 *       → bridge.onAppointmentDeleted(id)                         [Path B]
 *   - Non-appointment items (category≠appointment) are SILENTLY IGNORED
 *       (AC-2.6: a Reminder or checklist_task must produce 0 calendar events)
 *
 * Fire-and-forget async: the listener is synchronous (called within the same
 * JS turn as the enqueue) but schedules the async bridge operation via `void`.
 * This preserves the local write path's synchronous contract while allowing
 * the gateway I/O to happen asynchronously.
 *
 * Works offline: the bridge's gate (CAL-GATE-FRESH Option B) opens on
 * positively-CACHED consent; the local store write → observer → bridge chain
 * runs without a network call. Offline resilience lives in the bridge/gate.
 *
 * Returns an unsubscribe function — store it if you need to detach (tests only;
 * in production the observer is registered once at app startup and never removed).
 *
 * SECURITY: no health values logged here. Logs only op type + category guard.
 * Trace: architecture §2, functional §2.1–2.3, AC-2.6, CAL-SA-01.
 */

import type { CalendarSyncStore } from '../sync/calendarSyncStore';
import type { DeviceCalendarBridge } from './deviceCalendarBridge';
import type { AppointmentInput } from './eventPayloadBuilder';
import type { ChecklistItemRecord } from '../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a local ChecklistItemRecord (category=appointment) to the bridge's
 * AppointmentInput shape.
 *
 * Defensive defaults:
 *   - scheduledAt: appointments MUST have this (OQ-CAL-2), but guard to avoid
 *     eventPayloadBuilder throwing on a badly-formed record.
 *   - note: nullable in the store; bridge expects a non-null string.
 *   - source: optional in the store; bridge defaults to 'user_created'.
 */
function toAppointmentInput(item: ChecklistItemRecord): AppointmentInput {
  return {
    id:          item.id,
    category:    item.category,
    title:       item.title,
    scheduledAt: item.scheduledAt ?? '2000-01-01T00:00',
    note:        item.note ?? '',
    source:      item.source ?? 'user_created',
    done:        item.done,
  };
}

// ─── Observer ─────────────────────────────────────────────────────────────────

/**
 * Attach the device-calendar observer to a CalendarSyncStore instance.
 *
 * Call once at app startup after creating the singleton bridge:
 *   attachAppointmentCalendarObserver(calendarSyncStore, deviceCalendarBridge);
 *
 * The returned unsubscribe function is only needed for testing teardown; in
 * production the observer lives for the entire app session.
 *
 * @param store  The CalendarSyncStore to observe (typically the module-level singleton).
 * @param bridge The DeviceCalendarBridge to dispatch events to.
 * @returns      Unsubscribe function (call to detach the listener).
 */
export function attachAppointmentCalendarObserver(
  store:  CalendarSyncStore,
  bridge: DeviceCalendarBridge,
): () => void {
  return store.subscribeToChecklistItemMutations((event) => {
    if (event.type === 'delete') {
      // Path B (always-available, consent-exempt):
      // Only fire for items that were appointments — Reminders / tasks have
      // no map entry so bridge.onAppointmentDeleted is a safe no-op, but
      // the explicit guard saves the async call when unnecessary (AC-2.6).
      if (event.item?.category === 'appointment') {
        void bridge.onAppointmentDeleted(event.id);
      }
    } else {
      // Path A (create or update):
      // Category guard — defense-in-depth (bridge also guards, AC-2.6).
      if (event.item.category !== 'appointment') return;
      void bridge.onAppointmentUpserted(toAppointmentInput(event.item));
    }
  });
}
