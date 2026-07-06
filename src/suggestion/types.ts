/**
 * Suggestion system — shared TypeScript types.
 *
 * Implements suggestion-flow-ui.md §7 (data contract) and api-contract.md
 * `Suggestion` + `UserSuggestionState` shapes.
 *
 * All state transitions are LOCAL-FIRST (api-contract B5):
 *   offered → started | snoozed | dismissed
 *   dismissed → offered (re-enable)
 *
 * Security: suggestion keys and states are non-sensitive metadata — no health
 * values, no PII. Safe to persist via AsyncStorage (or expo-secure-store for
 * consistency with the existing consent-store pattern).
 */

import type { Stage } from '../pregnancy/gestationalAge';
import type { Lifecycle } from '../pregnancy/types';
import type { ChecklistItemCategory } from '../sync/syncTypes';

// ─── Localized content ────────────────────────────────────────────────────────

/**
 * Doctor-signed bilingual string pair.
 * clinical_signoff = true AND verify_flag = false are the content-gate invariants
 * (INV-A5). The content is static (never runtime-generated from user data).
 */
export interface LocalizedContent {
  th: string;
  en: string;
}

// ─── ANC prefill payload ──────────────────────────────────────────────────────

/**
 * Prefill payload handed from SuggestionFlowScreen → AppointmentFormScreen
 * when the mother taps Start on the ANC cadence suggestion (§2.2).
 *
 * Mutually exclusive with `existingItem` — the form opens in CREATE mode.
 * Every field is an editable convenience default (INV-A3).
 *
 * PDPA-A4 / INV-A4: nothing is written until the mother taps Save.
 */
export interface AncFormPrefill {
  /** Appointment title (doctor-signed LocalizedContent — locale-selected at render). */
  title: LocalizedContent;
  /**
   * Pre-filled date 'YYYY-MM-DD' (nextANCDate, clamped to today+3 when past).
   * Absent when ANC_PREFILL_DATE=OFF → date field renders blank (§2.3).
   */
  date?: string;
  /**
   * Doctor-signed label for the date field (LocalizedContent):
   *   date present  → "วันแนะนำโดยประมาณ (ปรับให้ตรงที่แพทย์นัด)"
   *   date absent   → "ตามที่แพทย์นัด / follow your doctor's schedule"
   * Always set regardless of the date presence (§2.1).
   */
  dateLabel: LocalizedContent;
  /** Pre-filled time — always '09:00' (flag-independent). */
  time: string;
  /** Category — always 'anc_visit' (§3.6a). */
  category: ChecklistItemCategory;
  /** Initial state of the reminder toggle (always false — default OFF). */
  attachReminder: boolean;
  /**
   * Verbatim approved §3.4(1) form-header disclaimer copy (doctor-signed,
   * clinical_signoff = true AND verify_flag = false — INV-A5/INV-A6).
   * Rendered in the rose/50 disclaimer band at the top of the form.
   */
  headerDisclaimer: LocalizedContent;
  /**
   * Marks this create as originating from an ANC suggestion.
   * Drives: source='from_suggestion' + sourceSuggestionStateId on the saved row.
   */
  fromSuggestion: true;
  /**
   * The SuggestionKey used as provenance for the saved ChecklistItem.sourceSuggestionStateId
   * (D1: key is the only stable local provenance handle in the client model).
   */
  sourceSuggestionStateId: SuggestionKey;
}

// ─── Catalog types ────────────────────────────────────────────────────────────

/**
 * Stable identifier for each suggestion in the catalog.
 * These keys are serialized to local storage — never rename an existing key.
 */
export type SuggestionKey =
  | 'kick_count_start'
  | 'triferdine_daily'
  | 'anc_t1_checkup'
  | 'anc_t2_checkup'
  | 'anc_t3_checkup'
  | 'supplies_checklist'
  | 'postnatal_checkup'
  | 'baby_feeding_log';

/**
 * Evidence tier per suggestion-flow-ui.md §2.1 ribbon.
 * WEAK items are gated out by the server and never appear in the catalog.
 */
export type EvidenceStrength = 'HIGH' | 'STRONG' | 'MODERATE';

/**
 * What type of tracking item this suggestion leads to (drives the capture-type
 * glyph and the deep-link action from the banner).
 */
export type CaptureTarget =
  | 'kick_count'
  | 'medication'
  | 'appointment'
  | 'supplies'
  | 'self_log';

/** Life-cycle transition states per api-contract B5. */
export type UserSuggestionStatus = 'offered' | 'snoozed' | 'dismissed' | 'started';

// ─── Catalog entry ────────────────────────────────────────────────────────────

/**
 * One entry in the static local suggestion catalog.
 * Matches the server `Suggestion` shape but cached locally for offline-first.
 */
export interface SuggestionCatalogEntry {
  key: SuggestionKey;
  captureTarget: CaptureTarget;
  /** Lifecycles during which this suggestion is relevant. */
  applicableLifecycles: Lifecycle[];
  /**
   * Trimester stages where this suggestion is relevant when lifecycle=pregnant.
   * Empty array means "all stages for this lifecycle."
   */
  applicableStages: Stage[];
  /** Show this suggestion from this gestational week onward (inclusive). */
  startWeek?: number;
  /** Stop showing this suggestion before this gestational week (exclusive). */
  endWeek?: number;
  evidenceStrength: EvidenceStrength;
  /** Official source for the evidence ribbon link. */
  source: string;
}

// ─── User state ───────────────────────────────────────────────────────────────

/**
 * Per-user state for one suggestion key, persisted locally.
 * Corresponds to api-contract UserSuggestionState / B5 local transitions.
 */
export interface UserSuggestionState {
  key: SuggestionKey;
  status: UserSuggestionStatus;
  /**
   * ISO 8601 UTC string — present when status = 'snoozed'.
   * Suggestion re-surfaces in the list once now >= resurfacesAt.
   */
  resurfacesAt?: string;
  /** ISO 8601 UTC string of last state change. */
  updatedAt: string;
}

// ─── Engine output ────────────────────────────────────────────────────────────

/**
 * A suggestion that the engine has determined is currently offerable
 * (passes all stage/week/state gates).
 */
export interface OfferableSuggestion {
  key: SuggestionKey;
  captureTarget: CaptureTarget;
  evidenceStrength: EvidenceStrength;
  source: string;
}

// ─── Engine input ─────────────────────────────────────────────────────────────

/**
 * User context passed to the suggestion engine.
 * Derived from the pregnancy profile + device clock.
 */
export interface SuggestionContext {
  /** Current lifecycle state. */
  lifecycle: Lifecycle;
  /**
   * Current trimester stage (T1/T2/T3) when lifecycle = 'pregnant';
   * null for postpartum.
   */
  stage: Stage | null;
  /**
   * Current gestational week (only meaningful when lifecycle = 'pregnant').
   * Used for startWeek / endWeek gates.
   */
  gestationalWeek: number;
  /** Wall-clock now — used to check whether snoozed suggestions have resurfaced. */
  now: Date;
  /**
   * Estimated due date (EDD) as a civil 'YYYY-MM-DD' string.
   * Required for ANC cadence offerable predicate (§1.3 item 1).
   * Optional for backward-compat with non-ANC callers.
   */
  edd?: string | null;
  /**
   * True when at least one non-done appointment or anc_visit ChecklistItem
   * exists in [today, nextTargetDate + WINDOW] for the ANC cadence key.
   * Computed by the caller (local calendar read) and injected into the engine
   * (ANC offerable predicate §1.3 item 4 — NET-NEW context input).
   * Optional for backward-compat with non-ANC callers.
   */
  upcomingApptInWindow?: boolean;
}
