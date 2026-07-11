/**
 * Mock factory for ExpoCalendarGateway — separate file so tests don't trigger
 * the real expo-calendar import (which uses ESM and cannot run in Jest/Node).
 *
 * Architecture: only expoCalendarGateway.ts imports expo-calendar.
 * All tests import from this mock file instead.
 */

import type { ExpoCalendarGateway } from '../expoCalendarGateway';
import type { CalendarEventPayload } from '../eventPayloadBuilder';

export function createMockExpoCalendarGateway(overrides: Partial<ExpoCalendarGateway> = {}): ExpoCalendarGateway & {
  calls: {
    requestPermission: number;
    checkPermission:   number;
    createEvent:       Array<{ calendarId: string; payload: CalendarEventPayload }>;
    updateEvent:       Array<{ nativeEventId: string; payload: CalendarEventPayload }>;
    deleteEvent:       Array<{ nativeEventId: string }>;
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
