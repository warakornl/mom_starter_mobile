/**
 * Consent domain types — shared across API client, queue, and store.
 *
 * Six PDPA consent purposes (ม.26 sensitive health + ม.20 parental):
 *   general_health     — S3 first-run, core health logging gate
 *   cloud_storage      — S3 first-run, optional cross-device sync
 *   sensitive_lab_results — JIT before PDF note inclusion
 *   pdf_egress         — JIT before first PDF creation
 *   infant_feeding     — JIT before first feeding log (ม.20 parental)
 *   child_health       — JIT before first baby health log (ม.20+26+21/27)
 *
 * SECURITY: This module does NOT log or store any health data values —
 * only consent metadata (type, granted boolean, text version, timestamp).
 */

/** The seven PDPA consent purpose identifiers. */
export type ConsentType =
  | 'general_health'
  | 'cloud_storage'
  | 'sensitive_lab_results'
  | 'pdf_egress'
  | 'infant_feeding'
  | 'child_health'
  /** Consent type #7 — calendar_sync: write ANC appointments to device calendar (Approach A).
   *  Dual-gated with general_health (architecture §5.2). Added per compliance §1.1. */
  | 'calendar_sync';

/** A single consent event returned by GET /v1/account/consents. */
export interface ConsentRecord {
  /** Server-generated UUID. */
  id: string;
  /** Which consent purpose this record addresses. */
  consentType: ConsentType;
  /** true = consent granted; false = consent withdrawn. */
  granted: boolean;
  /** Version tag of the consent text shown to the user (e.g. "v1.0-th"). */
  consentTextVersion: string;
  /** Server-authoritative ISO 8601 UTC timestamp. */
  grantedAt: string;
}

/** Paginated response from GET /v1/account/consents. */
export interface ConsentsPage {
  items: ConsentRecord[];
  nextCursor: string | null;
}

/** Response body from a successful POST /v1/account/consents (201). */
export type PostConsentResponse = ConsentRecord;

// ─── Result types (discriminated union, ok: true | false) ────────────────────

export type PostConsentResult =
  | { ok: true; record: PostConsentResponse }
  | { ok: false; status: number; code: string; message: string };

export type GetConsentsResult =
  | { ok: true; page: ConsentsPage }
  | { ok: false; status: number; code: string; message: string };
