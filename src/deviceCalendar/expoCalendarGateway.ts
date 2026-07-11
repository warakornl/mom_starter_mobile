/**
 * expoCalendarGateway — thin wrapper over expo-calendar native API.
 *
 * THIS IS THE ONLY FILE THAT IMPORTS 'expo-calendar'.
 * All other deviceCalendar logic depends on the ExpoCalendarGateway interface,
 * which is mocked in tests → the module is unit-testable without a dev build.
 *
 * Responsibilities:
 *   - Permission request (write-only on iOS 17+ where available, full fallback)
 *   - Calendar discovery (target calendarId resolution)
 *   - Event CRUD: createEvent, updateEvent, deleteEvent
 *
 * Dev-build requirement (architecture §1.3):
 *   expo-calendar is a native module. It CANNOT run in Expo Go.
 *   Logic tests mock this gateway — no dev build needed for tests.
 *   The release that introduces expo-calendar = a full rebuild + store submission.
 *
 * SECURITY: NEVER log event content (title/notes/location). Log only
 * appointmentId + op + result code (CAL-SA-50b).
 */

import * as Calendar from 'expo-calendar';
import type { CalendarEventPayload } from './eventPayloadBuilder';

// ─── Interface (the testable boundary) ────────────────────────────────────────

export interface ExpoCalendarGateway {
  /** Request calendar permission. Returns the granted status. */
  requestPermission(): Promise<{ granted: boolean }>;
  /** Check current calendar permission without prompting. */
  checkPermission(): Promise<{ granted: boolean }>;
  /** Get the resolved target calendar id for writing events. */
  getDefaultCalendarId(): Promise<string | null>;
  /** Create a new event. Returns the native event id. */
  createEvent(calendarId: string, payload: CalendarEventPayload): Promise<string>;
  /** Update an existing event by native event id. Returns false if event not found. */
  updateEvent(nativeEventId: string, payload: CalendarEventPayload): Promise<boolean>;
  /** Delete an event by native event id. Returns false if event not found (no-op success). */
  deleteEvent(nativeEventId: string): Promise<boolean>;
}

// ─── Production implementation ────────────────────────────────────────────────

function toCalendarEventDetails(
  calendarId: string,
  payload: CalendarEventPayload,
): Calendar.Event {
  return {
    calendarId,
    title:     payload.title,
    location:  payload.location,
    notes:     payload.notes,
    startDate: payload.startDate,
    endDate:   payload.endDate,
    timeZone:  payload.timeZone,
    allDay:    payload.allDay,
  } as unknown as Calendar.Event;
}

function toPartialEventDetails(
  payload: CalendarEventPayload,
): Partial<Calendar.Event> {
  return {
    title:     payload.title,
    location:  payload.location,
    notes:     payload.notes,
    startDate: payload.startDate,
    endDate:   payload.endDate,
    timeZone:  payload.timeZone,
    allDay:    payload.allDay,
  } as unknown as Partial<Calendar.Event>;
}

/**
 * Production gateway backed by expo-calendar.
 * Inject this at app startup (via deviceCalendarBridge.configure).
 * Tests inject the mock gateway (createMockExpoCalendarGateway).
 */
export const expoCalendarGatewayImpl: ExpoCalendarGateway = {
  async requestPermission(): Promise<{ granted: boolean }> {
    // iOS 17+: prefer write-only access (least privilege) if the API is available.
    // Context7 note: requestCalendarWriteOnlyAccessAsync was added in expo-calendar v12
    // for iOS 17+. Fallback to requestCalendarPermissionsAsync for older versions/Android.
    const api = Calendar as unknown as Record<string, unknown>;
    if (typeof api['requestCalendarWriteOnlyAccessAsync'] === 'function') {
      const { status } = await (api['requestCalendarWriteOnlyAccessAsync'] as () => Promise<{ status: string }>)();
      return { granted: status === 'granted' };
    }
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return { granted: status === 'granted' };
  },

  async checkPermission(): Promise<{ granted: boolean }> {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    return { granted: status === 'granted' };
  },

  async getDefaultCalendarId(): Promise<string | null> {
    try {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      // Android: pick a writable, syncable, primary calendar; else first writable syncable.
      // iOS: getDefaultCalendarAsync not always available — use the first writable calendar.
      const writable = calendars.filter(
        c => c.allowsModifications && c.type !== Calendar.CalendarType.BIRTHDAYS,
      );
      if (writable.length === 0) return null;

      // Prefer "isPrimary" if available (Android-only field)
      const primary = writable.find(
        c => (c as unknown as Record<string, unknown>)['isPrimary'] === true,
      );
      return (primary ?? writable[0]).id;
    } catch {
      return null;
    }
  },

  async createEvent(calendarId: string, payload: CalendarEventPayload): Promise<string> {
    const eventId = await Calendar.createEventAsync(
      calendarId,
      toCalendarEventDetails(calendarId, payload),
    );
    return eventId;
  },

  async updateEvent(nativeEventId: string, payload: CalendarEventPayload): Promise<boolean> {
    try {
      await Calendar.updateEventAsync(nativeEventId, toPartialEventDetails(payload));
      return true;
    } catch (err) {
      // Event not found (mother deleted it in her own calendar) → no-op success (§7.3)
      if (isNotFoundError(err)) return false;
      throw err;
    }
  },

  async deleteEvent(nativeEventId: string): Promise<boolean> {
    try {
      await Calendar.deleteEventAsync(nativeEventId);
      return true;
    } catch (err) {
      // Event not found → no-op success (architecture §7.3, CAL-EDGE-03)
      if (isNotFoundError(err)) return false;
      throw err;
    }
  },
};

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as Record<string, unknown>)['message'] ?? '');
  return (
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    msg.includes('Event not found') ||
    msg.includes('No calendar event')
  );
}

// ─── Mock factory (for tests) ──────────────────────────────────────────────────

/**
 * Creates a mock ExpoCalendarGateway suitable for unit tests.
 * Tests import this and inject it into deviceCalendarBridge.
 * The mock records all calls so tests can assert them.
 */
export function createMockExpoCalendarGateway(overrides: Partial<ExpoCalendarGateway> = {}): ExpoCalendarGateway & {
  calls: {
    requestPermission: number;
    checkPermission: number;
    createEvent: Array<{ calendarId: string; payload: CalendarEventPayload }>;
    updateEvent: Array<{ nativeEventId: string; payload: CalendarEventPayload }>;
    deleteEvent: Array<{ nativeEventId: string }>;
  };
} {
  let nextEventId = 1;
  const calls = {
    requestPermission: 0,
    checkPermission:   0,
    createEvent:       [] as Array<{ calendarId: string; payload: CalendarEventPayload }>,
    updateEvent:       [] as Array<{ nativeEventId: string; payload: CalendarEventPayload }>,
    deleteEvent:       [] as Array<{ nativeEventId: string }>,
  };

  return {
    calls,
    async requestPermission() {
      calls.requestPermission++;
      return { granted: true };
    },
    async checkPermission() {
      calls.checkPermission++;
      return { granted: true };
    },
    async getDefaultCalendarId() {
      return 'mock-calendar-id';
    },
    async createEvent(calendarId, payload) {
      calls.createEvent.push({ calendarId, payload });
      return `mock-event-${nextEventId++}`;
    },
    async updateEvent(nativeEventId, payload) {
      calls.updateEvent.push({ nativeEventId, payload });
      return true;
    },
    async deleteEvent(nativeEventId) {
      calls.deleteEvent.push({ nativeEventId });
      return true;
    },
    ...overrides,
  };
}
