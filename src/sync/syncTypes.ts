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
 * RecurrenceRule wire format (the recurrenceRule field inside ReminderRecord).
 * FLAG-4 grammar — must pass server validation on sync/push:
 *   freq=one_off: timesOfDay/interval/until MUST be absent.
 *   freq=daily:   timesOfDay R & non-empty; interval absent.
 *   freq=every_n_days: timesOfDay R; interval R ≥ 1.
 *   timesOfDay canonical: ascending, distinct, "HH:mm" zero-padded 24h.
 *   until: inclusive civil "YYYY-MM-DD" or absent.
 */
export interface RecurrenceRuleWire {
  freq: 'one_off' | 'daily' | 'every_n_days';
  interval?: number;
  timesOfDay?: string[];
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
  /**
   * SD-11 privacy opt-in: when true the user has explicitly chosen to see
   * displayTitle on the lock screen.  DEFAULT is false/absent = generic title —
   * health data is NEVER shown on lock screen by default (secure-by-default).
   *
   * Replaces the old hideOnLockScreen field with inverted, opt-in semantics.
   */
  showDetailsOnLockScreen?: boolean;
  /**
   * @deprecated Use showDetailsOnLockScreen instead.
   * Kept for backward-compat with data already on the server.
   * The service layer ignores this field — showDetailsOnLockScreen governs.
   */
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

// ─── Union of all sync records (for ConflictRecord.serverRecord) ──────────────

export type SyncRecord =
  | SupplyItemRecord
  | ReminderRecord
  | ReminderOccurrenceRecord
  | ChecklistItemRecord;

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
