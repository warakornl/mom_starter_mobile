/**
 * Pregnancy profile — shared TypeScript types.
 *
 * Derived from api-contract.md §"Gestational-age & stage computation",
 * §"Key schemas" (PregnancyProfileInput / PregnancyProfile), and
 * data-model.md §3.1.
 *
 * These types are the contract between the pregnancy API client, the
 * ProfileSetup screen, and the HomeScreen dashboard.  They carry NO tokens
 * and NO sensitive health data beyond the civil EDD date.
 */

import type { Stage } from './gestationalAge';

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * `pregnant`   — active pregnancy tracking (this phase)
 * `postpartum` — post-birth (birth-event phase, deferred)
 * `ended`      — pregnancy ended without birth event (deferred)
 */
export type Lifecycle = 'pregnant' | 'postpartum' | 'ended';

/** How the EDD was originally entered. */
export type EddBasis = 'due_date' | 'current_week';

// ─── Request ─────────────────────────────────────────────────────────────────

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

// ─── Response ────────────────────────────────────────────────────────────────

/**
 * Derived gestational-age snapshot returned by the server.
 *
 * Advisory: the client overrides these locally using `computeGestationalAge()`
 * with the device's own civil today.  The server snapshot is used only as a
 * cross-check and for a freshly-pulled device before its first local recompute.
 *
 * (api-contract §"Gestational-age" — OQ-2/RESOLVED: client is authoritative
 * for display; server snapshot is advisory.)
 */
export interface GestationalAgeSnapshot {
  gestationalWeek: number;
  gestationalDay: number;
  /** Days until EDD; negative once past EDD. */
  daysRemaining: number;
  /** 0..1 ring progress (real division, clamped). */
  progress: number;
  /** T1/T2/T3/postpartum (postpartum only after birth-event phase). */
  currentStage: Stage | 'postpartum';
  /** True when lifecycle=pregnant AND gestationalWeek>=37 (delivery overlay). */
  deliveryWindowActive: boolean;
}

/**
 * PregnancyProfile — full response from GET/PUT /v1/pregnancy-profile.
 *
 * Includes the <sync> block fields (id, version, createdAt, updatedAt) for
 * optimistic-concurrency (If-Match) and the derived GestationalAgeSnapshot.
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
 *   `{ ok: false, status: 409 }` — version mismatch (another device saved first)
 *   `{ ok: false, status: 422 }` — validation error (EDD out of range, XOR violation)
 *   `{ ok: false, status: 403, code: 'consent_required' }` — general_health gate
 */
export type PutProfileResult =
  | { ok: true; profile: PregnancyProfile; created: boolean }
  | PregnancyApiError;
