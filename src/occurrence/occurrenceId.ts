import { v5 as uuidv5 } from 'uuid';

/**
 * Deterministic ReminderOccurrence id — MUST match the backend.
 *
 * Formula (api-contract.md "Deterministic ReminderOccurrence id", N6/N7 + 🟡-3):
 *   id = uuidv5(OCCURRENCE_NAMESPACE, name)
 *   name = lower(reminderId) + "|" + scheduledLocalCivil
 *
 * CANONICAL-LOWERCASE IS PART OF THE HASH INPUT (🟡-3):
 *   reminderId MUST be lowercased before building `name`.  An uppercase/
 *   mixed-case reminderId hashes to a DIFFERENT uuidv5, which would fork
 *   the occurrence and cause a legitimate done/snoozed to be false-rejected
 *   with validation_error on sync/push — permanent adherence-data loss.
 *   The server also normalises to lowercase before recomputing, so a client
 *   that sends an uppercase reminderId still converges (no false-rejection),
 *   but both sides MUST hash the lowercase form so they agree before push.
 *
 * scheduledLocalCivil ≡ scheduledLocalTime: the exact "YYYY-MM-DDTHH:mm"
 *   byte string from the FLAG-4 expander output (no zone, no seconds, T literal).
 *
 * OCCURRENCE_NAMESPACE is a FIXED app constant — NOT per-device or per-install.
 *   Frozen in mom-starter-contract; byte-identical on iOS, Android, and server.
 */
export const OCCURRENCE_NAMESPACE = '4328078f-6339-4c38-a2ce-eabff6cbf387';

/**
 * Compute the deterministic id for a reminder occurrence.
 *
 * @param reminderId           Reminder.id — lowercased before hashing (🟡-3)
 * @param scheduledLocalCivil  "YYYY-MM-DDTHH:mm" from the FLAG-4 expander
 * @returns  Deterministic UUIDv5 string
 */
export function computeOccurrenceId(
  reminderId: string,
  scheduledLocalCivil: string,
): string {
  // MUST lowercase reminderId (🟡-3) — uppercase UUID hashes to a DIFFERENT id
  const name = `${reminderId.toLowerCase()}|${scheduledLocalCivil}`;
  return uuidv5(name, OCCURRENCE_NAMESPACE);
}
