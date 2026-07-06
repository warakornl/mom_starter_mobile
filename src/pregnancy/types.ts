/**
 * Pregnancy profile — shared TypeScript types.
 *
 * Derived from api-contract.md §"Gestational-age & stage computation",
 * §"Birth-event & postpartum counting", and data-model.md §3.1.
 *
 * These types are the contract between the pregnancy API client, the
 * ProfileSetup screen, the BirthEvent screen, and the HomeScreen dashboard.
 *
 * Security: carry NO tokens and NO sensitive health data beyond civil dates.
 * deliveryType / birthNote are client-encrypted fields (AES-GCM, TODO) —
 * passed as plaintext strings to the API client which transmits them; the
 * server stores the encrypted bytea.  Never log these values.
 */

import type { Stage } from './gestationalAge';

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * `pregnant`   — active pregnancy tracking
 * `postpartum` — post-birth (set by POST /pregnancy-profile/birth-event)
 * `ended`      — pregnancy ended without birth event (OQ-PP7, deferred)
 */
export type Lifecycle = 'pregnant' | 'postpartum' | 'ended';

/** How the EDD was originally entered. */
export type EddBasis = 'due_date' | 'current_week';

// ─── PUT /pregnancy-profile — request ────────────────────────────────────────

/**
 * PUT /v1/pregnancy-profile request body.
 *
 * Exactly ONE of `edd` or `currentWeek` must be provided (XOR — both or
 * neither → 422 from the server).
 *
 * api-contract §"Gestational-age":
 *   `edd`          — YYYY-MM-DD civil date (zoneless)
 *   `currentWeek`  — completed-N weeks (1–42); server derives edd = today + (280 − N×7)
 */
export interface PregnancyProfileInput {
  /** Zoneless civil due date YYYY-MM-DD. Required when eddBasis = due_date. */
  edd?: string;
  /**
   * Completed gestational weeks 1–42.  Required when eddBasis = current_week.
   * Server derives edd from this + X-Client-Date (UTC fallback).
   */
  currentWeek?: number;
}

// ─── POST /pregnancy-profile/birth-event — request ───────────────────────────

/**
 * POST /v1/pregnancy-profile/birth-event request body.
 *
 * api-contract §"Birth-event & postpartum counting" (OQ-8 RESOLVED):
 * - `birthDate` REQUIRED — floating-civil date (YYYY-MM-DD, zoneless).
 *   No time-of-day (OQ-11 RESOLVED: birth_date is civil date, not timestamptz).
 * - `deliveryType` optional — e.g. "vaginal"|"cesarean"|"other"; free value.
 *   TODO: must be AES-GCM client-encrypted before sending (contract ruling 4,
 *   data-model §3.1 delivery_type_cipher).  Currently passed as plaintext;
 *   appsec-engineer to provide encryption utility before production.
 * - `birthNote` optional — free-text note.
 *   TODO: AES-GCM client-encrypted (same ruling 4).
 */
export interface BirthEventInput {
  /** YYYY-MM-DD civil date of birth (required). */
  birthDate: string;
  /**
   * Optional delivery type (free value e.g. "vaginal"|"cesarean"|"other"|"prefer_not").
   * TODO (security): encrypt with AES-GCM before transmission (data-model §3.1).
   */
  deliveryType?: string;
  /**
   * Optional short note about the birth.
   * TODO (security): encrypt with AES-GCM before transmission (data-model §3.1).
   */
  birthNote?: string;
}

// ─── Derived snapshot ─────────────────────────────────────────────────────────

/**
 * Derived gestational-age snapshot returned by the server in every
 * GET/PUT/POST /pregnancy-profile response.
 *
 * Advisory: the client overrides these locally using `computeGestationalAge()`
 * (pregnant) or `computePostpartumAge()` (postpartum) with the device's own
 * civil today.  The server snapshot is used only as a cross-check and for a
 * freshly-pulled device before its first local recompute.
 *
 * NULLABILITY (api-contract §"Birth-event & postpartum counting"):
 * When lifecycle === 'postpartum', the gestational numeric fields
 * (gestationalWeek, gestationalDay, daysRemaining, progress) are returned
 * as null by the server.  currentStage === 'postpartum'; deliveryWindowActive === false.
 */
export interface GestationalAgeSnapshot {
  /**
   * Completed gestational weeks (floor toward −∞).
   * null when lifecycle === 'postpartum'.
   */
  gestationalWeek: number | null;
  /**
   * Day-in-week (Euclidean 0..6).
   * null when lifecycle === 'postpartum'.
   */
  gestationalDay: number | null;
  /**
   * Days until EDD; negative once past EDD.
   * null when lifecycle === 'postpartum'.
   */
  daysRemaining: number | null;
  /**
   * 0..1 ring progress (real division, clamped).
   * null when lifecycle === 'postpartum'.
   */
  progress: number | null;
  /**
   * Current lifecycle stage.
   * 'T1'|'T2'|'T3' when pregnant; 'postpartum' when postpartum.
   */
  currentStage: Stage | 'postpartum';
  /**
   * True when lifecycle=pregnant AND gestationalWeek>=37 (delivery overlay).
   * Always false when postpartum.
   */
  deliveryWindowActive: boolean;
}

/**
 * PregnancyProfile — full response from GET/PUT /v1/pregnancy-profile
 * and POST /v1/pregnancy-profile/birth-event.
 *
 * Includes the <sync> block fields (id, version, createdAt, updatedAt) for
 * optimistic-concurrency (If-Match) and the derived snapshot.
 *
 * Postpartum-specific fields (present and non-null when lifecycle === 'postpartum'):
 *   birthDate      — civil date of birth (YYYY-MM-DD, zoneless — OQ-11)
 *   postpartumDays — advisory snapshot (client recomputes from birthDate)
 *   postpartumWeek — advisory snapshot
 *   postpartumDay  — advisory snapshot
 *
 * NOTE: the server snapshot values are advisory; the client always overrides
 * them by calling computePostpartumAge(birthDate, localCivilToday()) on every
 * foreground event (same authority rule as the gestational counter — OQ-2).
 */
export interface PregnancyProfile extends GestationalAgeSnapshot {
  /** Server-assigned UUID (client-generated per api-contract §"Conventions"). */
  id: string;
  /** Monotonic server-assigned int; used in If-Match: "<version>" header. */
  version: number;
  /** Zoneless civil EDD YYYY-MM-DD (the server-authoritative stored fact). */
  edd: string;
  /** How the EDD was entered. */
  eddBasis: EddBasis;
  /** Pregnancy lifecycle state. */
  lifecycle: Lifecycle;
  /** Server-assigned ISO-8601 UTC creation instant. */
  createdAt: string;
  /** Server-assigned ISO-8601 UTC last-update instant. */
  updatedAt: string;
  /** Soft-delete timestamp (null for active records). */
  deletedAt?: string | null;

  // ── Postpartum fields ─────────────────────────────────────────────────────
  // Present (and non-null) when lifecycle === 'postpartum'.
  // null / absent when lifecycle === 'pregnant' | 'ended'.

  /**
   * Floating-civil birth date YYYY-MM-DD (zoneless — OQ-11).
   * The anchor for the postpartum civil-day counter.
   * null when lifecycle === 'pregnant'.
   */
  birthDate?: string | null;

  /**
   * Server-advisory snapshot: calendar days since birth.
   * Client recomputes from birthDate using computePostpartumAge() on every
   * foreground event; this snapshot is used only on first pull (OQ-2 rule).
   */
  postpartumDays?: number | null;

  /**
   * Server-advisory snapshot: completed postpartum weeks (floorDiv(days, 7)).
   * Client recomputes locally; this is advisory only.
   */
  postpartumWeek?: number | null;

  /**
   * Server-advisory snapshot: day-in-week (Euclidean 0..6).
   * Client recomputes locally; this is advisory only.
   */
  postpartumDay?: number | null;
}

// ─── API result shapes (discriminated unions) ─────────────────────────────────

/** Error shape returned by pregnancyApiClient functions. */
export interface PregnancyApiError {
  ok: false;
  /** HTTP status code. */
  status: number;
  /** Problem.code string from the response body. */
  code: string;
  message: string;
}

/**
 * GET /v1/pregnancy-profile results:
 *   `{ ok: true, profile }` — 200 success
 *   `{ ok: false, status: 404, code: 'not_found' }` — no profile yet
 *   other errors (401, 403, 500)
 */
export type GetProfileResult =
  | { ok: true; profile: PregnancyProfile }
  | { ok: false; status: 404; code: 'not_found'; message: string }
  | PregnancyApiError;

/**
 * PUT /v1/pregnancy-profile results:
 *   `{ ok: true, profile, created: true }` — 201 (first-time creation)
 *   `{ ok: true, profile, created: false }` — 200 (update)
 *   `{ ok: false, status: 428 }` — If-Match header missing (update only)
 *   `{ ok: false, status: 409, currentProfile }` — version mismatch; body = current
 *     authoritative profile (G-4 mobile-internal type change; wire contract unchanged —
 *     PregnancyProfileController.java L102-103 already returns e.getCurrentProfile()).
 *   `{ ok: false, status: 422 }` — validation error (EDD out of range, XOR violation)
 *   `{ ok: false, status: 403, code: 'consent_required' }` — general_health gate
 */
export type PutProfileResult =
  | { ok: true; profile: PregnancyProfile; created: boolean }
  | { ok: false; status: 409; code: string; message: string; currentProfile: PregnancyProfile | null }
  | PregnancyApiError;

/**
 * POST /v1/pregnancy-profile/birth-event results:
 *   `{ ok: true, profile }` — 200 (lifecycle → postpartum; or no-op if already postpartum
 *     with same birthDate — OQ-12/PP6)
 *   `{ ok: false, status: 404 }` — no profile exists yet
 *   `{ ok: false, status: 409 }` — optimistic-concurrency mismatch (another device)
 *   `{ ok: false, status: 422 }` — validation: birthDate in future or before EDD−126d
 *   `{ ok: false, status: 428 }` — If-Match header missing
 *   `{ ok: false, status: 403, code: 'consent_required' }` — general_health gate
 */
export type RecordBirthEventResult =
  | { ok: true; profile: PregnancyProfile }
  | PregnancyApiError;
