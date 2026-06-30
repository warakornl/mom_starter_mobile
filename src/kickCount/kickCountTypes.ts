/**
 * Kick Count — TypeScript types.
 *
 * Source of truth:
 *   api-contract.md §"Kick count — session lifecycle, sync & gating"
 *   kick-count-functional-spec.md §B (draft lifecycle), §A.1.1 (validation rules)
 *   kick-count.md (frontend-spec rev 4)
 *   kick-count-compliance.md §K-8 (encrypted draft)
 *
 * Status model:
 *   - `in_progress`  local-only draft (ห้ามส่ง sync — terminal-status guard D2)
 *   - `completed`    immutable finalized event (sync via kickCountSessions)
 *   - `cancelled`    local discard — ไม่มี row, ไม่ sync, ไม่มีในประวัติ
 *
 * Security: never log movementCount or any session field — MOTHER-health data (K-8).
 */

// ─── Session status ───────────────────────────────────────────────────────────

/** Only `completed` is push-accepted (terminal-status guard — D2). */
export type KickCountSessionStatus = 'completed';

// ─── KickCountSession — the synced immutable record ───────────────────────────

/**
 * KickCountSessionRecord — a finalized, immutable counting session.
 *
 * Immutable event union (D3): each session has a distinct UUIDv4 client-gen id.
 * Re-pushing the same id is a server-side no-op (version not bumped).
 *
 * create sentinel: version = 0 → server assigns version ≥ 1 and returns in applied[].
 *
 * K-7: note is stored server-side as encrypted `note_cipher` bytea.
 *   On the wire from server: may arrive as a ciphertext string or null.
 *   Client-side the note field carries the plaintext (decrypted locally).
 *   This type represents the LOCAL view (plaintext or null).
 *   For the wire push the client must encrypt the note before sending.
 *   (Encryption helper is a carry-forward — flagged for appsec-engineer.)
 *
 * FLAG-1 / D10: startedAt and endedAt are floating-civil "YYYY-MM-DDTHH:mm"
 *   (no offset, no Z). Calendar bucketing uses the date-part of startedAt.
 *
 * D4 / DRIFT-1: durationSeconds and gestationalWeekAtStart are stored verbatim;
 *   server does not recompute or cross-check them.
 */
export interface KickCountSessionRecord {
  /** UUIDv4 client-generated (lowercase 8-4-4-4-12). */
  id: string;
  /** Floating-civil session start — "YYYY-MM-DDTHH:mm" (FLAG-1). Bucket key. */
  startedAt: string;
  /** Floating-civil session end — "YYYY-MM-DDTHH:mm" (FLAG-1). Required-on-completed per OQ-K-A. */
  endedAt?: string | null;
  /** Accumulated tap count. int ≥ 0. count=0 completed is valid (B1). */
  movementCount: number;
  /** Locked to 10 in MVP (D5). Server rejects ≠ 10. */
  targetCount: 10;
  /** Only completed is push-accepted (terminal-status guard). */
  status: KickCountSessionStatus;
  /**
   * Seconds elapsed — client-computed from monotonic clock (B.3).
   * Server stores verbatim; no cross-check. int ≥ 0.
   */
  durationSeconds?: number | null;
  /**
   * Gestational week at session start — client-derived (B.3/DRIFT-1).
   * Server stores verbatim; no recompute or week-gate validation.
   */
  gestationalWeekAtStart?: number | null;
  /**
   * Optional encrypted note (K-7).
   * LOCAL type: plaintext string (or null if no note).
   * Wire push: must be AES-GCM encrypted before transmission.
   * (TODO: appsec-engineer to provide encryption utility.)
   */
  note?: string | null;
  // ── <sync> block ─────────────────────────────────────────────────────────
  /** Create sentinel = 0; server assigns ≥ 1 on first apply. */
  version: number;
  /** Server-assigned UTC ISO instant. */
  createdAt: string;
  /** Server-assigned UTC ISO instant. */
  updatedAt: string;
  /** Tombstone instant (null for live records). */
  deletedAt?: string | null;
}

// ─── KickCountDraft — local-only in-progress draft ───────────────────────────

/**
 * KickCountDraft — the local-only in-progress counting session.
 *
 * K-8 compliance: stored encrypted via expo-secure-store (NOT AsyncStorage).
 * 1 draft per device at a time.
 * NEVER pushed to the server in this state.
 *
 * sessionStartMonotonicMs: the monotonic timestamp (performance.now() in ms)
 *   captured at session start. Used to compute durationSeconds at finalize
 *   without DST/clock-adjust interference (B.3).
 *
 * On finalize: localDraftId becomes the id of the KickCountSessionRecord.
 * On cancel: crypto-shred the draft (clearDraft()) — no row, no egress.
 */
export interface KickCountDraft {
  /** UUIDv4 — becomes id of the completed KickCountSessionRecord on finalize. */
  localDraftId: string;
  /** Floating-civil session start "YYYY-MM-DDTHH:mm" (FLAG-1). */
  startedAt: string;
  /** Accumulated tap count (floor 0). */
  movementCount: number;
  /** Locked to 10 in MVP. */
  targetCount: 10;
  /**
   * Gestational week derived at session start via canonical algorithm (B.3/§3.1).
   * Snapshot — remains fixed even if the profile changes during the session.
   */
  gestationalWeekAtStart: number | null;
  /**
   * Monotonic clock value (ms) at session start — e.g. performance.now().
   * Used to compute durationSeconds at finalize without wall-clock skew.
   */
  sessionStartMonotonicMs: number;
  /** Optional note (plaintext on-device — encrypted before push via K-7). */
  note?: string | null;
}

// ─── SyncChangeSet extension for kickCountSessions ───────────────────────────

/**
 * KickCountSessions sync change-set bucket.
 *
 * Create-only union (D2/D3): only completed sessions are push-accepted.
 * in_progress/cancelled must NEVER appear in created[] or updated[].
 * Terminal-status guard is enforced BOTH server-side and client-side (D2).
 *
 * deleted[] carries bare uuids (tombstone-wins, unconditional).
 */
export interface KickCountSyncChanges {
  created: KickCountSessionRecord[];
  updated: KickCountSessionRecord[];
  deleted: string[];
}
