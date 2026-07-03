/**
 * Sync wire types — contract-pinned shapes for POST /v1/sync/push
 * and GET /v1/sync/pull.
 *
 * Source of truth: api-contract.md §"Offline-sync engine (PINNED)"
 *
 * Collections wired here:
 *   - supplyItems        (OQ-SYNC-18 — mutable LWW, cloud_storage only,
 *                         no field-level encryption, no recurrence)
 *   - reminders          (FLAG-4 — mutable LWW + recurrenceRule grammar;
 *                         gated by cloud_storage + general_health)
 *   - reminderOccurrences (FLAG-7/W-A — mutable-status; only done/snoozed
 *                         are push-accepted; gated cloud_storage+general_health)
 *   - checklistItems     (appointment + tasks; mutable LWW;
 *                         gated cloud_storage + general_health)
 *   - kickCountSessions  (immutable event union; only status=completed push-accepted;
 *                         terminal-status guard client+server; gated cloud_storage
 *                         + general_health; note encrypted as note_cipher)
 *   - selfLogs           (immutable event union; create-only + tombstone;
 *                         5 metricTypes: weight|blood_pressure|swelling|lochia|symptom;
 *                         value/note fields are opaque base64 ciphertext strings;
 *                         gated cloud_storage + general_health; FLAG-1 loggedAt)
 *
 * Key contract rules encoded here:
 *   - push: three-bucket changes (created/updated/deleted)
 *   - push response: applied[], conflicts[], rejected[] (every pushed record
 *     lands in exactly one of the three)
 *   - applied[]: server-assigned version + updatedAt — MUST stamp local row
 *   - conflicts[]: resolution enum + serverRecord — client adopts serverRecord
 *   - rejected[]: consent/validation/unknown-collection — surfaced to caller
 *   - pull: timestamp (W1 snapshot start), nextCursor?, hasMore?, changes
 *   - watermark (timestamp) adopted ONLY on last pull page (nextCursor absent)
 *
 * FLAG-7 / W-A (OQ-CAL-4 PINNED — occurrence push model):
 *   - A `due` ReminderOccurrence is NEVER pushed (projected locally only).
 *   - `missed` is derived on-device end-of-local-day and NOT pushed in MVP.
 *   - Only `status ∈ {done, snoozed}` is push-accepted; server rejects
 *     {due, missed} with validation_error → non_terminal_status.
 *
 * Security: supplyItems is NON-health (cloud_storage only); reminders /
 * reminderOccurrences / checklistItems are MOTHER-health (general_health gate).
 * Do NOT log health data or accessToken anywhere.
 */

// ─── SupplyItem (api-contract.md §3.9 / data-model.md §3.9) ──────────────────

export type SupplyCategory =
  | 'diapers'
  | 'feeding'
  | 'hygiene'
  | 'health-supplies'
  | 'other';

/**
 * SupplyItem — full record including the <sync> block.
 * version = 0 on first create (create sentinel); server assigns version ≥ 1.
 */
export interface SupplyItemRecord {
  id: string;
  name: string;
  category: SupplyCategory;
  unit?: string;
  onHandQty: number;
  lowThreshold?: number;
  lowNotifiedAtVersion?: number;
  // <sync>
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ─── Reminder (api-contract.md §"Reminders" / data-model.md §3.5) ────────────

/**
 * Two-letter ISO/RFC-5545 weekday tokens — canonical order MO<TU<WE<TH<FR<SA<SU.
 * Used by RecurrenceRuleWire.byDay (weekly freq only).
 *
 * BINDING: tokens are self-describing and locale-free. Using integer weekday
 * indices (JS 0=Sun, Java 1=Mon) would cause byte-divergence in the
 * occurrence-id hash (uuidv5 input). Tokens prevent that class of bug.
 * See recurrence-weekly-byday-design.md §1.1.
 */
export type WeekdayToken = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

/**
 * RecurrenceRule wire format (the recurrenceRule field inside ReminderRecord).
 * FLAG-4 grammar — must pass server validation on sync/push:
 *   freq=one_off:     timesOfDay/interval/byDay/until MUST be absent.
 *   freq=daily:       timesOfDay R & non-empty; interval/byDay absent.
 *   freq=every_n_days: timesOfDay R; interval R ≥ 1; byDay absent.
 *   freq=weekly (NEW): timesOfDay R & non-empty; byDay R & non-empty (canonical
 *                      MO<TU<WE<TH<FR<SA<SU order); interval optional 1–52 (absent=1).
 *   timesOfDay canonical: ascending, distinct, "HH:mm" zero-padded 24h.
 *   byDay canonical: ascending (MO<TU<…<SU), distinct, non-empty iff freq=weekly.
 *   until: inclusive civil "YYYY-MM-DD" or absent.
 *
 * Contract change (see recurrence-weekly-byday-design.md) — additive/backward-compat:
 *   existing one_off/daily/every_n_days rules have no byDay and unchanged freq.
 */
export interface RecurrenceRuleWire {
  freq: 'one_off' | 'daily' | 'every_n_days' | 'weekly';
  interval?: number;
  timesOfDay?: string[];
  /** Present and non-empty iff freq === 'weekly'. Canonical order MO<TU<WE<TH<FR<SA<SU. */
  byDay?: WeekdayToken[];
  until?: string;
}

export type ReminderType =
  | 'medication'
  | 'kick_count'
  | 'feeding'
  | 'appointment'
  | 'supply_restock'
  | 'custom';

export type ReminderSourceRefType =
  | 'medication_plan'
  | 'checklist_item'
  | 'supply_item';

/**
 * Reminder — the synced DEFINITION of a recurring or one-off alarm.
 *
 * MOTHER-health: gated by cloud_storage + general_health.
 * version = 0 on create (sentinel); server assigns ≥ 1.
 * recurrenceRule + startAt expand to ReminderOccurrence civil datetimes
 * via the FLAG-4 expander (see recurrenceExpander.ts).
 *
 * Security: displayTitle is NOT encrypted (lock-screen-generic-title rule
 * removes the need — ruling 3); it is plaintext on the server.
 */
export interface ReminderRecord {
  id: string;
  type: ReminderType;
  /** Non-sensitive in-app title (NOT used as lock-screen payload). */
  displayTitle: string;
  hideOnLockScreen?: boolean;
  sourceRefType?: ReminderSourceRefType;
  sourceRefId?: string;
  /** FLAG-4 recurrence grammar — expanded with startAt. */
  recurrenceRule: RecurrenceRuleWire;
  /** Floating-civil anchor "YYYY-MM-DDTHH:mm" for expansion + first-day guard. */
  startAt: string;
  /** false ⇒ stop scheduling future occurrences (definition retained). */
  active: boolean;
  // <sync>
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ─── ReminderOccurrence (api-contract.md N6/N7 + FLAG-7/W-A) ─────────────────

export type OccurrenceStatus = 'due' | 'done' | 'snoozed' | 'missed';

/**
 * ReminderOccurrence — a materialized (done/snoozed) instance of a Reminder.
 *
 * FLAG-7 / W-A (OQ-CAL-4 PINNED):
 *   A `due` occurrence is NEVER a synced row — it is projected client-side
 *   from the Reminder definition via the FLAG-4 expander.
 *   A row is created + pushed ONLY on terminal user action: done or snoozed.
 *   `missed` is derived on-device (end-of-local-day) and NOT pushed in MVP.
 *   Server rejects pushed status ∈ {due, missed} → validation_error.
 *
 * id is DETERMINISTIC (N6/N7, 🟡-3):
 *   id = uuidv5(OCCURRENCE_NAMESPACE, lower(reminderId) + "|" + scheduledLocalTime)
 *   Computed by computeOccurrenceId() in occurrence/occurrenceId.ts.
 *   Server recomputes and rejects mismatch → validation_error.
 *
 * M1 status-merge precedence (US-15 AC#4):
 *   done/snoozed always outranks missed for the same id (not pure LWW).
 *   Prevents a device that derived missed with a later wall-clock time from
 *   overwriting a genuine done/snoozed on another device.
 *
 * MOTHER-health: gated by cloud_storage + general_health.
 */
export interface ReminderOccurrenceRecord {
  /** Deterministic uuidv5 — see computeOccurrenceId(). */
  id: string;
  /** Parent Reminder.id (soft link, no FK — order-independent push). */
  reminderId: string;
  /** Floating civil "YYYY-MM-DDTHH:mm" — the hash input for id. */
  scheduledLocalTime: string;
  /** Only done/snoozed are push-accepted (W-A). due/missed are local view-state. */
  status: OccurrenceStatus;
  /** UTC ISO instant when the user acted (done/snoozed). */
  actedAt?: string | null;
  /** UTC ISO instant when a snoozed instance re-fires. */
  snoozedUntil?: string | null;
  // <sync>
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ─── ChecklistItem (api-contract.md / data-model.md §3.4) ────────────────────

export type ChecklistItemCategory =
  | 'appointment'
  | 'anc_visit'
  | 'lab_panel'
  | 'screening'
  | 'vaccine'
  | 'checklist_task'
  | 'postpartum_check';

/**
 * ChecklistItem — a mark-done task, ANC visit, lab panel, or appointment.
 *
 * FLAG-7 §2 / OQ-CAL-1 PINNED (R-A):
 *   appointment = ChecklistItem with category=appointment (NOT a separate entity).
 *   Location / doctor / clinic are folded into the free-text `note` field
 *   (never parsed, no structured field in MVP — R-B deferred).
 *
 * OQ-CAL-2 PINNED:
 *   scheduledAt MUST NOT be null for category ∈ {appointment, anc_visit}.
 *   A time-of-day is normally carried; all-day is stored as "…T00:00".
 *   Client enforces — server stores verbatim without category-null check.
 *
 * scheduledAt is the floating-civil bucket key (FLAG-1):
 *   "YYYY-MM-DDTHH:mm" (minute precision, no zone) — calendar bucketing uses
 *   the date portion; shifts never occur on time-zone travel/DST.
 *
 * MOTHER-health: gated by cloud_storage + general_health.
 */
export interface ChecklistItemRecord {
  id: string;
  category: ChecklistItemCategory;
  title: string;
  /**
   * Floating-civil "YYYY-MM-DDTHH:mm" — bucket key (FLAG-1).
   * Nullable for undated checklist_task items only.
   * MUST be present for appointment/anc_visit (OQ-CAL-2).
   */
  scheduledAt?: string | null;
  done: boolean;
  /** UTC ISO instant when the item was marked done (server-assigned). */
  doneAt?: string | null;
  /**
   * Free-text note — NEVER parsed (G4).
   * R-A: location/doctor for appointments are concatenated here by the client.
   */
  note?: string | null;
  sourceSuggestionStateId?: string | null;
  source?: 'user_created' | 'from_suggestion';
  // <sync>
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ─── KickCountSession (api-contract.md §"Kick count — session lifecycle") ─────

/**
 * KickCountSessionRecord — the wire/storage type for a finalized session.
 *
 * Immutable event union (D3): each session has a distinct UUIDv4 client-gen id.
 * Re-pushing the same id is a server no-op (version not bumped, immutable log).
 * Only status='completed' is push-accepted (terminal-status guard D2).
 *
 * FLAG-1 / D10: startedAt / endedAt are floating-civil "YYYY-MM-DDTHH:mm".
 * D4 / DRIFT-1: durationSeconds + gestationalWeekAtStart stored verbatim.
 *
 * K-7: note is stored server-side as encrypted note_cipher bytea.
 *   The wire push must transmit an encrypted value; this type represents the
 *   LOCAL plaintext view for display. For push, the client encrypts the note.
 *   (Encryption helper is a carry-forward — flagged for appsec-engineer.)
 *
 * MOTHER-health: gated by cloud_storage + general_health.
 */
export interface KickCountSessionRecord {
  /** UUIDv4 client-generated (canonical lowercase 8-4-4-4-12). */
  id: string;
  /** Floating-civil session start — "YYYY-MM-DDTHH:mm" (FLAG-1). Bucket key. */
  startedAt: string;
  /** Floating-civil session end — "YYYY-MM-DDTHH:mm" (FLAG-1). Required on completed. */
  endedAt?: string | null;
  /** Accumulated tap count int ≥ 0. count=0 completed is valid (B1). */
  movementCount: number;
  /** Locked to 10 in MVP (D5). Server rejects ≠ 10 with target_count_locked. */
  targetCount: 10;
  /** Only 'completed' is push-accepted — client terminal-status guard (D2). */
  status: 'completed';
  /** Duration in seconds — client monotonic delta (B.3); server stores verbatim (D4). */
  durationSeconds?: number | null;
  /** Gestational week at session start — client-derived (B.3); server stores verbatim (D4). */
  gestationalWeekAtStart?: number | null;
  /**
   * Optional plaintext note (local view).
   * WIRE PUSH: must be encrypted before transmission (K-7 — TODO appsec-engineer).
   */
  note?: string | null;
  // ── <sync> block ─────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1. */
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ─── ExpenseRecord (api-contract.md §"Expenses") ─────────────────────────────

/**
 * Five-enum category for expense records (expenses-feature §3.2).
 * Keys stable; labels are i18n catalog entries (expenses.category.*).
 */
export type ExpenseCategory =
  | 'baby-supplies'
  | 'healthcare'
  | 'baby-gear'
  | 'mother'
  | 'other';

/**
 * ExpenseRecord — a single spending entry, offline-first LWW mutable record.
 *
 * Design notes:
 *   - amount: integer satang (฿1 = 100 satang) — no float drift; display as ฿ with 2 decimals.
 *   - incurredOn: floating-civil "YYYY-MM-DD" bucket key (FLAG-1); decides which
 *     month's total the expense counts toward. Never shifts on TZ travel.
 *   - note: optional free-text, client-encrypted (EX-2), never parsed server-side.
 *   - clientId: client-generated stable id for device tracking.
 *   - version: 0 = create sentinel; server assigns ≥ 1.
 *
 * Security: expense amounts are financial (not health) data — cloud_storage gate.
 * note field is the one field that could carry a health proxy — client-encrypted (EX-2).
 * NEVER log amount, note, or incurredOn to console.
 */
export interface ExpenseRecord {
  /** UUIDv4 client-generated. */
  id: string;
  /** Amount in satang (integer). ฿1 = 100 satang. */
  amount: number;
  /** The fixed five-enum spending bucket (expenses-feature §3.2). */
  category: ExpenseCategory;
  /** Floating-civil "YYYY-MM-DD" — the month-bucket key (FLAG-1). */
  incurredOn: string;
  /** Optional free-text note — client-encrypted (EX-2), never parsed. */
  note?: string | null;
  /** Client identifier for per-device tracking. */
  clientId: string;
  // ── <sync> block ────────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1. LWW mutable. */
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ─── SelfLog (api-contract.md §687 + self-log-behavior.md §1/§B) ─────────────

/**
 * Five-enum metric type for self-log records (self-log-behavior.md §1).
 * Contract: metricType enum(weight, blood_pressure, swelling, lochia, symptom).
 * The only accepted enum values; server has a DB CHECK on the same set.
 */
export type SelfLogMetricType =
  | 'weight'
  | 'blood_pressure'
  | 'swelling'
  | 'lochia'
  | 'symptom';

/**
 * SelfLogInput — the write-side payload for a self-log create (sync/push).
 *
 * Immutable event (D2/contract §687): each record has a distinct client-gen UUIDv4.
 * Re-pushing the same id is a server no-op (version not bumped, no field overwrite).
 * Updates are NOT accepted — a correction creates a NEW row + tombstones the old one.
 *
 * Field population by metricType (self-log-behavior.md §1):
 *   weight          → valueNumeric R, unit="kg",   others null
 *   blood_pressure  → valueNumeric R (systolic), valueNumericSecondary R (diastolic),
 *                      unit="mmHg", valueText null
 *   swelling        → valueText R, valueNumeric/Secondary null, unit null
 *   lochia          → valueText R, valueNumeric/Secondary null, unit null
 *   symptom         → valueText R, valueNumeric/Secondary null, unit null
 *
 * Encryption posture (MVP — self-log-behavior.md §B.3 + ADR self-log-encryption-posture.md):
 *   valueNumeric / valueNumericSecondary / valueText / note are opaque base64 strings
 *   produced by the client (MVP: plaintext bytes base64-encoded). Same local-string
 *   posture as KickCountSessionRecord.note (K-7). The server stores them verbatim
 *   as bytea ciphertext and never parses/bounds-checks them (D3/D4/G4).
 *
 * loggedAt is the floating-civil bucket key "YYYY-MM-DDTHH:mm" (FLAG-1).
 * unit is a fixed plaintext label chosen by metricType; never user-typed.
 *
 * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
 * Security: never log any value/note field — health data (SD-5).
 */
export interface SelfLogInput {
  /** Closed enum — 5 values (self-log-behavior.md §1). */
  metricType: SelfLogMetricType;
  /**
   * Base64 ciphertext — numeric value (systolic for blood_pressure, kg for weight).
   * Required for weight and blood_pressure; null/absent for swelling/lochia/symptom.
   */
  valueNumeric?: string | null;
  /**
   * Base64 ciphertext — diastolic reading (blood_pressure only).
   * Required for blood_pressure; null/absent for all others.
   */
  valueNumericSecondary?: string | null;
  /**
   * Base64 ciphertext — descriptive text value (swelling / lochia / symptom).
   * Required for swelling, lochia, symptom; null/absent for weight / blood_pressure.
   * Never scored, never parsed (no-interpretation boundary — INV-S2/D3).
   */
  valueText?: string | null;
  /**
   * Plaintext unit label — "kg" | "mmHg" | null.
   * Chosen by metricType (never user-typed): weight→"kg", blood_pressure→"mmHg",
   * others→null. Display metadata only; server never keys on it.
   */
  unit?: string | null;
  /**
   * Floating-civil "YYYY-MM-DDTHH:mm" — the calendar bucket key (FLAG-1).
   * No offset, no trailing Z. Calendar bucketing uses the date-part.
   * Never UTC-normalized; shifts never occur on time-zone travel/DST.
   */
  loggedAt: string;
  /**
   * Optional free-text note — base64 ciphertext. Never parsed (INV-S4).
   * Applies to any metricType. PDF inclusion gated by sensitive_lab_results.
   */
  note?: string | null;
}

/**
 * SelfLog — full self-log record including the <sync> block.
 *
 * Returned by GET /self-logs and by sync/pull.
 * Value/note fields are returned as ciphertext for the client to decrypt.
 * The server never decrypts server-side; cross-user access is structurally
 * impossible (every query is user_id = subject — D7).
 *
 * version = 0 is the create sentinel; server assigns version ≥ 1 on first apply.
 * Immutable event — once created a row is never rewritten in place (D2).
 */
export interface SelfLog {
  /** UUIDv4 client-generated (canonical lowercase 8-4-4-4-12). */
  id: string;
  /** Closed enum — 5 values. */
  metricType: SelfLogMetricType;
  /** Base64 ciphertext — see SelfLogInput for per-type population rules. */
  valueNumeric?: string | null;
  /** Base64 ciphertext — diastolic (blood_pressure only). */
  valueNumericSecondary?: string | null;
  /** Base64 ciphertext — descriptive value (swelling/lochia/symptom only). */
  valueText?: string | null;
  /** Plaintext unit label: "kg" | "mmHg" | null. */
  unit?: string | null;
  /** Floating-civil "YYYY-MM-DDTHH:mm" — the calendar bucket key (FLAG-1). */
  loggedAt: string;
  /** Base64 ciphertext — optional note. Never parsed (INV-S4). */
  note?: string | null;
  // ── <sync> block ─────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1 on first apply. */
  version: number;
  /** Server-assigned UTC ISO instant. */
  createdAt: string;
  /** Server-assigned UTC ISO instant. */
  updatedAt: string;
  /** Tombstone instant (null / absent for live records). */
  deletedAt?: string | null;
}

// ─── Union of all sync records (for ConflictRecord.serverRecord) ──────────────

export type SyncRecord =
  | SupplyItemRecord
  | ReminderRecord
  | ReminderOccurrenceRecord
  | ChecklistItemRecord
  | KickCountSessionRecord
  | ExpenseRecord
  | SelfLog;

// ─── Push request ─────────────────────────────────────────────────────────────

/**
 * Three-bucket change set per collection.
 * created vs updated is a client-side hint — server upserts by id.
 * deleted[] carries bare uuids (tombstone-wins, no base version).
 *
 * FLAG-7 / W-A: reminderOccurrences created/updated MUST only contain
 * status ∈ {done, snoozed}.  Status {due, missed} must never appear here.
 */
export interface SyncChangeSet {
  supplyItems?: {
    created: SupplyItemRecord[];
    updated: SupplyItemRecord[];
    deleted: string[];
  };
  reminders?: {
    created: ReminderRecord[];
    updated: ReminderRecord[];
    deleted: string[];
  };
  reminderOccurrences?: {
    /** Only done/snoozed (W-A) — server rejects due/missed with validation_error. */
    created: ReminderOccurrenceRecord[];
    updated: ReminderOccurrenceRecord[];
    deleted: string[];
  };
  checklistItems?: {
    created: ChecklistItemRecord[];
    updated: ChecklistItemRecord[];
    deleted: string[];
  };
  /**
   * kickCountSessions — immutable event union (D2/D3).
   * Only status='completed' is push-accepted.
   * in_progress/cancelled MUST NEVER appear here (client terminal-status guard).
   * Server rejects non-terminal status with validation_error(non_terminal_status).
   * updated[] is always empty for this collection (create-only union).
   */
  kickCountSessions?: {
    /** Only completed rows — terminal guard enforced by kickCountSyncStore.drainQueue(). */
    created: KickCountSessionRecord[];
    /** Always empty for kickCountSessions (immutable event — no updates). */
    updated: KickCountSessionRecord[];
    /** Bare uuids for tombstone-wins (soft delete). */
    deleted: string[];
  };
  /**
   * expenses — mutable LWW spending entries (expenses-feature §3.1).
   * amount in satang (integer). incurredOn is floating-civil YYYY-MM-DD.
   * note is client-encrypted (EX-2). Cloud_storage gated (no health consent needed).
   */
  expenses?: {
    created: ExpenseRecord[];
    updated: ExpenseRecord[];
    /** Bare uuids (tombstone-wins, soft-delete). */
    deleted: string[];
  };
  /**
   * selfLogs — immutable event union (D2/contract §687).
   *
   * Create-only: each self-log is a distinct client-gen UUIDv4 that unions
   * across devices without conflict (like kickCountSessions / MedicationLog).
   * updated[] is ALWAYS EMPTY — immutable event logs have no in-place rewrites.
   * A correction creates a new row (new UUID) and/or tombstones the old one.
   *
   * Server: per-collection general_health gate (rejected[] when absent);
   *   whole-batch cloud_storage gate first. Re-push of existing id = no-op
   *   (version not bumped, fields not overwritten — D2).
   *
   * Security: value/note fields are base64 ciphertext; never log them (SD-5).
   * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
   */
  selfLogs?: {
    /** New self-log events from this device's offline queue. */
    created: SelfLog[];
    /** Always empty — immutable event, no in-place rewrites (D2). */
    updated: SelfLog[];
    /** Bare uuids for tombstone-wins (soft-delete via crypto-shred). */
    deleted: string[];
  };
}

// ─── Push response ────────────────────────────────────────────────────────────

export interface AppliedRecord {
  collection: string;
  id: string;
  version: number;
  updatedAt: string;
}

export interface ConflictRecord {
  collection: string;
  id: string;
  resolution: 'server_won' | 'client_won' | 'tombstone_won';
  /** Authoritative server record — client MUST adopt it. Discriminate by collection. */
  serverRecord: SyncRecord;
}

export interface RejectedRecord {
  collection: string;
  id?: string;
  code: string;
  details?: string;
}

export interface SyncPushResponse {
  timestamp: string;
  applied: AppliedRecord[];
  conflicts: ConflictRecord[];
  rejected: RejectedRecord[];
}

// ─── Pull response ────────────────────────────────────────────────────────────

export interface SyncPullPage {
  /** W1 snapshot-start watermark — same on all pages; adopt on last page only. */
  timestamp: string;
  nextCursor?: string;
  hasMore?: boolean;
  changes: {
    supplyItems?: {
      created: SupplyItemRecord[];
      updated: SupplyItemRecord[];
      deleted: string[];
    };
    reminders?: {
      created: ReminderRecord[];
      updated: ReminderRecord[];
      deleted: string[];
    };
    reminderOccurrences?: {
      created: ReminderOccurrenceRecord[];
      updated: ReminderOccurrenceRecord[];
      deleted: string[];
    };
    checklistItems?: {
      created: ChecklistItemRecord[];
      updated: ChecklistItemRecord[];
      deleted: string[];
    };
    /** kickCountSessions pull: live rows in updated[], tombstones in deleted[]. */
    kickCountSessions?: {
      /** OQ-SYNC-17: server always sends live rows here (not created[]). */
      created: KickCountSessionRecord[];
      updated: KickCountSessionRecord[];
      deleted: string[];
    };
    /** expenses pull: live rows updated/created, tombstones in deleted[]. */
    expenses?: {
      created: ExpenseRecord[];
      updated: ExpenseRecord[];
      deleted: string[];
    };
    /**
     * selfLogs pull — immutable event union.
     * OQ-SYNC-17: server returns live rows in updated[], tombstones in deleted[],
     * created[] always empty on pull. Client upserts by id.
     * Value/note fields are returned as ciphertext for client-side decryption.
     */
    selfLogs?: {
      /** OQ-SYNC-17: always empty on pull (server puts live rows in updated[]). */
      created: SelfLog[];
      /** Live self-log rows in the pull window — client upserts by id. */
      updated: SelfLog[];
      /** Tombstoned uuids — client removes matching local rows. */
      deleted: string[];
    };
  };
}

// ─── Result types (discriminated unions) ──────────────────────────────────────

export interface SyncApiError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type SyncPushResult =
  | {
      ok: true;
      applied: AppliedRecord[];
      conflicts: ConflictRecord[];
      rejected: RejectedRecord[];
    }
  | SyncApiError;

export type SyncPullResult =
  | {
      ok: true;
      watermark: string;
    }
  | SyncApiError;
