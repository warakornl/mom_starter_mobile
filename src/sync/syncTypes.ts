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
 *   - medicationPlans    (mutable LWW like expenses/supplyItems; name/dose are opaque
 *                         base64 ciphertext (ruling 4); scheduleRule jsonb plain;
 *                         gated cloud_storage + general_health; FLAG-4 scheduleRule)
 *   - medicationLogs     (immutable event union like selfLogs/kickCountSessions;
 *                         create-only union-merge; note opaque base64 ciphertext;
 *                         occurrenceTime floating-civil bucket key (FLAG-1/D5);
 *                         loggedAt = response-only absolute UTC; gated
 *                         cloud_storage + general_health)
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
 *
 * Auto stock-decrement additions (api-contract.md §SupplyItemInput):
 *   usesPerContainer — SYNCED; int ≥ 1; NULL = discrete/manual item (unchanged path).
 *   usesRemainingInOpenContainer — MOBILE-LOCAL-ONLY; NEVER in push/pull payload;
 *     a per-scoop mutation NEVER bumps version/updatedAt (INV-ASD-8).
 */
export interface SupplyItemRecord {
  id: string;
  name: string;
  category: SupplyCategory;
  unit?: string;
  onHandQty: number;
  lowThreshold?: number;
  lowNotifiedAtVersion?: number;
  /**
   * Uses per container (pack/tin/bottle) — SYNCED config.
   * int ≥ 1; NULL = discrete/manual item (whole-unit path unchanged).
   * See auto-stock-decrement-architecture.md §3.1.
   */
  usesPerContainer?: number | null;
  /**
   * Uses remaining in the currently open container — MOBILE-LOCAL-ONLY.
   * NEVER pushed or pulled (INV-ASD-8). Range: [0, usesPerContainer].
   * Absent from server schema. A per-scoop mutation NEVER bumps version/updatedAt.
   */
  usesRemainingInOpenContainer?: number;
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
 *
 * Auto stock-decrement (api-contract.md §ReminderInput):
 *   careActivityType — nullable; SYNCED, general_health. Self-identifies a
 *   care-activity reminder whose terminal done occurrence is the canonical T-D
 *   decrement signal (auto-stock-decrement-architecture.md §1.1).
 *   feeding is intentionally absent (structural anti-double-count, US-AS6).
 */
export interface ReminderRecord {
  id: string;
  type: ReminderType;
  /** Non-sensitive in-app title (NOT used as lock-screen payload). */
  displayTitle: string;
  hideOnLockScreen?: boolean;
  sourceRefType?: ReminderSourceRefType;
  sourceRefId?: string;
  /**
   * Care-activity type — auto-stock-decrement T-D signal (INV-ASD-9).
   * NULL = ordinary reminder, never decrements.
   * diaper_change | bathing → terminal done occurrence is the T-D trigger.
   * feeding is NOT a valid value here (structural anti-double-count US-AS6).
   * SYNCED, gated general_health.
   */
  careActivityType?: 'diaper_change' | 'bathing' | null;
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

// ─── MedicationPlan + MedicationLog (api-contract.md §682–683 + medication-behavior.md §1) ──

/**
 * MedicationScheduleRule — the FLAG-4 recurrence grammar for medication plans.
 *
 * RULING 7.1 (medication-behavior.md §1.1): reuses the FLAG-4 expansion engine
 * but with the civil anchor (startAt) folded INTO the rule rather than kept
 * on the parent Reminder (which has its own separate `startAt` field).
 *
 * Grammar constraints (medication-behavior.md §1.1, RULING 7.1):
 *   freq=one_off:      timesOfDay FORBIDDEN, interval absent, until absent.
 *   freq=daily:        timesOfDay R & non-empty; interval absent.
 *   freq=every_n_days: timesOfDay R & non-empty; interval R ≥ 2
 *                      (interval=1 is canonicalized → 'daily' on push);
 *                      until optional.
 *
 * Differences from RecurrenceRuleWire (reminders):
 *   - No 'weekly' freq, no byDay (medication schedules are day-interval only).
 *   - Adds startAt (floating-civil "YYYY-MM-DDTHH:mm" day-0 anchor; required).
 *   - interval ≥ 2 (≥ 1 for reminders); interval=1 canonicalized to 'daily'.
 *
 * null scheduleRule ⇒ PRN / ad-hoc (M=0, no adherence denominator — §A.5).
 * Closed grammar — unknown keys rejected on push (schedule_rule_invalid).
 *
 * MOTHER-health: scheduleRule is plaintext jsonb (not encrypted — D4).
 * Security: do NOT log scheduleRule if it carries timing that infers drug class.
 */
export interface MedicationScheduleRule {
  /** Recurrence cadence. */
  freq: 'one_off' | 'daily' | 'every_n_days';
  /**
   * Floating-civil day-0 anchor "YYYY-MM-DDTHH:mm" (FLAG-1).
   * Required for all freq values. Drives the first occurrence date and the
   * FLAG-4 expansion engine. Never UTC-normalized.
   */
  startAt: string;
  /**
   * Wall-clock times for daily/every_n_days, each "HH:mm" zero-padded 24h.
   * Required and non-empty for daily/every_n_days. FORBIDDEN for one_off.
   * Canonical: ascending, distinct.
   */
  timesOfDay?: string[];
  /**
   * Step between occurrences — integer ≥ 2 (required iff freq='every_n_days').
   * interval=1 MUST be canonicalized to freq='daily' before push (RULING 7.1).
   * Absent for one_off and daily.
   */
  interval?: number;
  /**
   * Inclusive civil end date "YYYY-MM-DD" (optional for daily/every_n_days).
   * Absent for one_off. When absent the plan runs indefinitely.
   */
  until?: string;
}

/**
 * MedicationPlanInput — write-side payload for a medication plan create/update.
 *
 * Mutable record → LWW (like SupplyItem/Expense/ChecklistItem).
 * Written via sync/push only (D1 — no REST write verb).
 * Edits on the same id arbitrate by server version (S-A).
 *
 * Security (D4 / ruling 4):
 *   name and dose are opaque base64 strings (MVP: plaintext-bytes-as-base64).
 *   Same posture as SelfLog value/note fields (K-7).
 *   The server stores them verbatim as name_cipher/dose_cipher bytea and
 *   NEVER parses, queries, or decrypts them server-side.
 *   scheduleRule, active, sourceSuggestionStateId are plaintext.
 *   NEVER log name or dose (SD-2 / SD-5).
 *
 * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
 */
export interface MedicationPlanInput {
  /**
   * Drug / supplement name — opaque base64 ciphertext (ruling 4 / D4).
   * Required on live (non-tombstone) rows — enforced by ck_medication_plan__live_name.
   * Shown verbatim, never translated, never parsed (no-interpretation boundary).
   */
  name: string;
  /**
   * Dose text (e.g. "1 เม็ด", "150 mg") — opaque base64 ciphertext (ruling 4).
   * Optional. Verbatim echo only; server never parses or queries.
   */
  dose?: string | null;
  /**
   * Recurrence rule — FLAG-4 grammar. null = PRN/ad-hoc (M=0, no denominator).
   * When present MUST conform to MedicationScheduleRule grammar or server rejects
   * with validation_error(schedule_rule_invalid).
   */
  scheduleRule?: MedicationScheduleRule | null;
  /**
   * Whether this plan is currently active.
   * A single mutable boolean (LWW) — not a time-series.
   * Deactivating never deletes; it stops the plan from feeding the reminder engine.
   */
  active: boolean;
  /**
   * Soft provenance link to the UserSuggestionState the plan was started from.
   * NO DB FK (RULING 2 — server table not in MVP). Null for user-created plans.
   * Apply-path ownership check is deferred/additive (D7 / §G-4).
   */
  sourceSuggestionStateId?: string | null;
}

/**
 * MedicationPlan — full medication plan record including the <sync> block.
 *
 * Returned by GET /medication-plans and by sync/pull.
 * name/dose are returned as ciphertext for the client to decrypt.
 *
 * version = 0 is the create sentinel; server assigns version ≥ 1 on first apply.
 * Mutable LWW — every applied create/update ALWAYS bumps version (no no-op,
 * because name_cipher/dose_cipher random IV defeats byte-compare — D2).
 *
 * Soft-delete tombstone: deletedAt is set + name_cipher/dose_cipher crypto-shredded
 * to null (§4.4(A)). The DB CHECK ck_medication_plan__live_name allows null on
 * tombstone rows.
 *
 * MOTHER-health: gated cloud_storage + general_health.
 */
export interface MedicationPlan {
  /** UUIDv4 client-generated (canonical lowercase 8-4-4-4-12). */
  id: string;
  /** Opaque base64 ciphertext — see MedicationPlanInput.name. */
  name: string;
  /** Opaque base64 ciphertext — optional dose text. */
  dose?: string | null;
  /** FLAG-4 recurrence grammar. null = PRN/ad-hoc. */
  scheduleRule?: MedicationScheduleRule | null;
  /** Active state (LWW boolean). */
  active: boolean;
  /** Soft provenance ref — nullable soft link (no FK). */
  sourceSuggestionStateId?: string | null;
  // ── <sync> block ────────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1 on first apply. LWW mutable. */
  version: number;
  /** Server-assigned UTC ISO instant. */
  createdAt: string;
  /** Server-assigned UTC ISO instant (LWW ordering clock). */
  updatedAt: string;
  /** Tombstone instant (null / absent for live records). Soft-delete + crypto-shred. */
  deletedAt?: string | null;
}

/**
 * MedicationLogInput — write-side payload for a medication log create.
 *
 * Immutable event — create-only union-merge (D3, like SelfLog/KickCountSession).
 * Each log has a distinct client-gen UUIDv4 → union across devices, no conflict.
 * Re-pushing the same id = idempotent no-op (version not bumped, fields not overwritten).
 * Updates are NOT accepted — a correction is a NEW row (new UUID) + tombstone of old.
 *
 * NOTE: loggedAt is NOT in MedicationLogInput. It is response-only (D5) —
 * the server-assigned absolute-UTC record-creation instant. The client must
 * not send it; the server ignores / rejects it if present.
 *
 * Security (D4):
 *   note is an opaque base64 string (same posture as SelfLog.note).
 *   NEVER log note, occurrenceTime, or medicationPlanId (health data — SD-5).
 *
 * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
 */
export interface MedicationLogInput {
  /**
   * The medication plan this dose fulfils. null = ad-hoc dose (no plan).
   * When present MUST belong to the same JWT subject, else server rejects
   * with validation_error(medication_plan_not_found) (D7 / §A.1).
   */
  medicationPlanId?: string | null;
  /**
   * Floating-civil wall-clock time "YYYY-MM-DDTHH:mm" — the adherence bucket key
   * (FLAG-1 / D5). No offset, no trailing Z. Never UTC-normalized; shifts never
   * occur on time-zone travel/DST. For a mark-done log it is the occurrence's
   * scheduled scheduledLocalTime (AC-17), not now().
   */
  occurrenceTime: string;
  /**
   * Two-state enum — taken or missed. Both are equal-weight neutral facts (D3 /
   * capture-ui §3.1). Never graded, never coloured, never shamed (AC-20).
   * Server has DB CHECK IN ('taken','missed').
   */
  status: 'taken' | 'missed';
  /**
   * Optional free-text note — opaque base64 ciphertext (D4). Never parsed.
   * PDF inclusion gated by sensitive_lab_results consent (§A.6).
   */
  note?: string | null;
}

/**
 * MedicationLog — full log record including loggedAt (response-only) and
 * the <sync> block.
 *
 * Returned by GET /medication-logs and by sync/pull.
 *
 * loggedAt is the server-assigned absolute-UTC record-creation instant. It is
 * NOT a bucket key and is NOT in MedicationLogInput (D5). It is the immutable
 * event's creation clock; the adherence bucket key is occurrenceTime.
 *
 * version = 0 is the create sentinel; server assigns ≥ 1 on first apply.
 * Immutable event — re-push of same id is a no-op (version not bumped).
 *
 * MOTHER-health: gated cloud_storage + general_health.
 */
export interface MedicationLog {
  /** UUIDv4 client-generated (canonical lowercase 8-4-4-4-12). */
  id: string;
  /** FK to MedicationPlan.id — nullable (null = ad-hoc dose). */
  medicationPlanId?: string | null;
  /**
   * Floating-civil bucket key "YYYY-MM-DDTHH:mm" (FLAG-1 / D5).
   * Date-part = adherence civil-day key (§A.5 / AC-22).
   */
  occurrenceTime: string;
  /** Two-state enum — taken or missed. Equal-weight neutral facts (AC-20). */
  status: 'taken' | 'missed';
  /** Opaque base64 ciphertext — optional note. Never parsed. */
  note?: string | null;
  /**
   * Absolute-UTC record-creation instant (server-assigned, response-only).
   * NOT in MedicationLogInput (D5). NOT a bucket key. NOT sent by the client.
   * The immutable event's creation clock; used for ordering in GET /medication-logs.
   */
  loggedAt: string;
  // ── <sync> block ────────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1 on first apply. */
  version: number;
  /** Server-assigned UTC ISO instant. */
  createdAt: string;
  /** Server-assigned UTC ISO instant. */
  updatedAt: string;
  /** Tombstone instant (null / absent for live records). */
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

// ─── FeedingSession (api-contract.md §FeedingSessionInput / §2 ASD) ──────────

/**
 * Activity type enum for auto-stock-decrement mappings.
 * feeding is intentionally absent (structural anti-double-count US-AS6):
 * a feeding reminder-done never decrements — only a FeedingSession(kind=formula) does.
 */
export type CareActivityType = 'diaper_change' | 'bathing';

/**
 * FeedingSessionRecord — an immutable feeding event.
 *
 * Auto stock-decrement extension: kind gains 'formula'; amountSubUnits added.
 *   kind=formula → the canonical T-F decrement trigger (arch §2).
 *   amountSubUnits: nullable int ≥ 0 — meaningful only for kind=formula.
 *     null = fall back to enabled feeding_formula mapping's defaultQty (D-2).
 *     0   = no-op draw (still logs, no decrement — D-2).
 *     n≥1 = verbatim amount used this feed (overrides defaultQty).
 *   HEALTH-side (SD-10) — dual-gated infant_feeding + general_health.
 *   amountSubUnits NEVER copied to the supplies side (INV-ASD-4).
 *
 * Immutable event: create-only; corrections = new row + tombstone of old.
 * MOTHER-health: gated cloud_storage (whole-batch) + infant_feeding (per-collection).
 * Security: NEVER log amountSubUnits or any feeding value (SD-5 / K-8).
 */
export interface FeedingSessionRecord {
  /** UUIDv4 client-generated (canonical lowercase 8-4-4-4-12). */
  id: string;
  /** Feed kind — breastfeed/pump unchanged; formula = T-F decrement trigger. */
  kind: 'breastfeed' | 'pump' | 'formula';
  /** Which breast — left | right | both. Meaningful for breastfeed only. */
  side?: 'left' | 'right' | 'both' | null;
  /**
   * Floating-civil "YYYY-MM-DDTHH:mm" — bucket key (FLAG-1).
   * NEVER UTC-normalized; calendar bucketing uses the date-part.
   */
  startedAt: string;
  /** Session duration in seconds (optional). */
  durationSeconds?: number | null;
  /** Volume in mL (optional, orthogonal to amountSubUnits). */
  volumeMl?: number | null;
  /**
   * Servings/scoops given this feed — meaningful only when kind=formula.
   * null = fall back to mapping.defaultQty (D-2 defensive branch).
   * 0   = no-op draw (valid; still logs — D-2 / E-1).
   * n≥1 = verbatim sub-unit amount for this feed.
   * NEVER interpreted server-side. HEALTH-side, NEVER on supplies row (INV-ASD-4).
   * NEVER log this value (K-8 / SD-5).
   */
  amountSubUnits?: number | null;
  /** Optional free-text note — encrypted (SD-10). Never parsed. */
  note?: string | null;
  // ── <sync> block ─────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1 on first apply. */
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ─── ConsumptionMapping (api-contract.md §ConsumptionMappingInput / ASD §4) ──

/**
 * ActivityType for ConsumptionMapping — the three supported activity triggers.
 * feeding_formula → gated infant_feeding + general_health (dual, like FeedingSession).
 * diaper_change / bathing → gated general_health only.
 */
export type MappingActivityType = 'feeding_formula' | 'diaper_change' | 'bathing';

/**
 * ConsumptionMappingRecord — health-side mapping of an activity → supply item.
 *
 * Mutable → LWW on server updatedAt + optimistic version (like SupplyItem).
 * Per-row consent by activityType (api-contract.md §ConsumptionMappingInput).
 * Stored in the feed-log crypto-shred / GC circle.
 *
 * HEALTH-side (INV-ASD-9): the supply row carries ZERO activity linkage.
 * The health→supply reference lives HERE, never the reverse.
 *
 * D-4 steer-to-pack: enabled=true is only valid when the linked item has
 * usesPerContainer ≥ 2. Client enforces; trigger-time backstop (functional §5.3).
 *
 * Milk-Code (FW-1): no brand/product/price/vendor field on this record.
 * NEVER log supplyItemId or defaultQty (health-adjacent, SD-5 / INV-ASD-5).
 */
export interface ConsumptionMappingRecord {
  /** UUIDv4 client-generated. */
  id: string;
  /** Which completion event drives this mapping (one mapping per activity per device). */
  activityType: MappingActivityType;
  /**
   * Soft ref to SupplyItem.id — NO server FK cascade (INV-ASD-9).
   * null/absent = mapping configured but not yet linked to an item → skip (E-2).
   */
  supplyItemId?: string | null;
  /**
   * Per-use decrement amount (int ≥ 0).
   * 0 = no-op draw (valid; still records the marker).
   * For T-F, this is the default; the mother may override per feed via amountSubUnits.
   * For T-D, this is always used (no per-occurrence override).
   * NEVER log this value (health-adjacent, INV-ASD-5).
   */
  defaultQty: number;
  /**
   * Whether this mapping is currently active.
   * D-4 steer-to-pack: enabled=true only if linked item usesPerContainer ≥ 2.
   * Client enforces; trigger-time backstop (functional §5.3 E-9).
   */
  enabled: boolean;
  // ── <sync> block ─────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1 on first apply. */
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
  | ChecklistItemRecord
  | KickCountSessionRecord
  | ExpenseRecord
  | SelfLog
  | MedicationPlan
  | MedicationLog
  | FeedingSessionRecord
  | ConsumptionMappingRecord;

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
  /**
   * medicationPlans — mutable LWW records (D2 / medication-behavior.md §1.1).
   *
   * Like expenses/supplyItems/checklistItems: all three buckets are live.
   * Edits on the same id arbitrate by server version (S-A / version-arbitrated).
   * base version == current → apply + always bump (no no-op — *_cipher random IV).
   * base < current → server_won. Tombstone-wins on soft-delete.
   *
   * name/dose are opaque base64 ciphertext (ruling 4 / D4) — server stores
   * verbatim as name_cipher/dose_cipher bytea, never parses or queries.
   * scheduleRule is plaintext jsonb. active and sourceSuggestionStateId plaintext.
   *
   * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
   * Security: NEVER log name or dose (SD-2 / sensitive health data).
   */
  medicationPlans?: {
    /** New medication plans from this device's offline queue (create sentinel version=0). */
    created: MedicationPlan[];
    /** Edited plans — LWW merge, version must match current server version. */
    updated: MedicationPlan[];
    /** Bare uuids for tombstone-wins (soft-delete + crypto-shred of name_cipher/dose_cipher). */
    deleted: string[];
  };
  /**
   * medicationLogs — immutable event union (D3 / medication-behavior.md §1.2).
   *
   * Like selfLogs/kickCountSessions: create-only union-merge across devices.
   * Each log has a distinct client-gen UUIDv4 → union-merge, no conflict.
   * updated[] is ALWAYS EMPTY — immutable event, no in-place rewrites (D3).
   * A "correction" is a NEW row (new UUID) and/or a tombstone of the old one.
   * Re-push of existing id = idempotent no-op (version not bumped, D3).
   *
   * occurrenceTime is the floating-civil bucket key (FLAG-1 / D5).
   * note is opaque base64 ciphertext (D4). status = taken | missed (AC-20 —
   * both are equal-weight neutral facts; never graded, never coloured).
   *
   * Server: per-collection general_health gate (rejected[] when absent);
   *   whole-batch cloud_storage gate first.
   * MOTHER-health: gated cloud_storage (whole-batch) + general_health (per-collection).
   * Security: NEVER log note, occurrenceTime, or medicationPlanId (SD-5).
   */
  medicationLogs?: {
    /** New medication log events from this device's offline queue. */
    created: MedicationLog[];
    /** Always empty — immutable event, no in-place rewrites (D3). */
    updated: MedicationLog[];
    /** Bare uuids for tombstone-wins (soft-delete). */
    deleted: string[];
  };
  /**
   * feedingSessions — immutable event union (arch §2 / FeedingSessionRecord).
   *
   * Create-only: each session has a distinct client-gen UUIDv4.
   * updated[] is ALWAYS EMPTY — immutable event.
   * kind=formula rows are the T-F auto-decrement trigger (arch §1.1).
   * amountSubUnits is transmitted but NEVER interpreted server-side (INV-ASD-4).
   * HEALTH-side: gated cloud_storage (whole-batch) + infant_feeding (per-collection, ruling 6).
   * Security: NEVER log amountSubUnits or any feeding value (SD-5 / K-8).
   */
  feedingSessions?: {
    /** New feeding session events from this device's offline queue. */
    created: FeedingSessionRecord[];
    /** Always empty — immutable event union (no in-place rewrites). */
    updated: FeedingSessionRecord[];
    /** Bare uuids for tombstone-wins (soft-delete). */
    deleted: string[];
  };
  /**
   * consumptionMappings — mutable LWW health-side mappings (arch §4 / INV-ASD-9).
   *
   * Like SupplyItem/MedicationPlan: all three buckets are live.
   * Per-row consent by activityType (api-contract.md §ConsumptionMappingInput):
   *   feeding_formula → infant_feeding + general_health (dual).
   *   diaper_change / bathing → general_health only.
   * The supply row carries ZERO activity linkage (INV-ASD-9).
   * HEALTH-side: gated cloud_storage (whole-batch) + per-row consent.
   * Milk-Code (FW-1): no brand/product/price/vendor field.
   * Security: NEVER log supplyItemId or defaultQty (INV-ASD-5 / SD-5).
   */
  consumptionMappings?: {
    /** New mappings (create sentinel version=0). */
    created: ConsumptionMappingRecord[];
    /** Edited mappings — LWW merge. */
    updated: ConsumptionMappingRecord[];
    /** Bare uuids for tombstone-wins (soft-delete). */
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
    /**
     * medicationPlans pull — mutable LWW.
     * OQ-SYNC-17: server returns live rows in updated[], tombstones in deleted[].
     * name/dose returned as ciphertext for client-side decryption.
     * MOTHER-health: gated cloud_storage + general_health.
     */
    medicationPlans?: {
      /** OQ-SYNC-17: server puts live rows in updated[]; created[] typically empty on pull. */
      created: MedicationPlan[];
      /** Live medication plan rows in the pull window — client upserts by id. */
      updated: MedicationPlan[];
      /** Tombstoned uuids — client removes matching local rows. */
      deleted: string[];
    };
    /**
     * medicationLogs pull — immutable event union.
     * OQ-SYNC-17: server returns live rows in updated[], tombstones in deleted[],
     * created[] always empty on pull. Client upserts by id.
     * note returned as ciphertext for client-side decryption.
     * MOTHER-health: gated cloud_storage + general_health.
     */
    medicationLogs?: {
      /** OQ-SYNC-17: always empty on pull (server puts live rows in updated[]). */
      created: MedicationLog[];
      /** Live medication log rows in the pull window — client upserts by id. */
      updated: MedicationLog[];
      /** Tombstoned uuids — client removes matching local rows. */
      deleted: string[];
    };
    /**
     * feedingSessions pull — immutable event union (arch §2 / A5≡A16).
     * Extended with kind=formula + amount_sub_units for formula-feed logging.
     * MOTHER-health: dual-gated infant_feeding + general_health (SD-10).
     * Pulled records NEVER trigger the T-F decrement (D-1 guard on trigger engine).
     */
    feedingSessions?: {
      created: FeedingSessionRecord[];
      updated: FeedingSessionRecord[];
      deleted: string[];
    };
    /**
     * consumptionMappings pull — mutable LWW health-side (arch §4 / INV-ASD-9).
     * The supplies row carries ZERO activity linkage — this is health-side.
     * MOTHER-health: gated by activityType-specific consent (general_health /
     * infant_feeding+general_health per row).
     */
    consumptionMappings?: {
      created: ConsumptionMappingRecord[];
      updated: ConsumptionMappingRecord[];
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
