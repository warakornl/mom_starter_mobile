import { v5 as uuidv5 } from 'uuid';

/**
 * Deterministic ReminderOccurrence id — MUST match the backend
 * (uuidv5 of the frozen namespace + "reminderId|scheduledLocalCivil").
 */
export const OCCURRENCE_NAMESPACE = '4328078f-6339-4c38-a2ce-eabff6cbf387';

/** scheduledLocalCivil = minute-precision floating civil string "YYYY-MM-DDTHH:mm". */
export function computeOccurrenceId(reminderId: string, scheduledLocalCivil: string): string {
  return uuidv5(`${reminderId}|${scheduledLocalCivil}`, OCCURRENCE_NAMESPACE);
}
