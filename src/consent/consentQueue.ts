/**
 * consentQueue — offline-first consent retry queue.
 *
 * Implements §4.2 of first-run-consent.md:
 * - When POST /v1/account/consents fails (network or 5xx), queue locally.
 * - Retry with exponential backoff: 2s, 4s, 8s … capped at 5 min.
 * - Queue survives app restarts via injectable ConsentQueueStorage.
 * - Local granted state is used for all client-side gate decisions while
 *   the POST is in the queue (optimistic local, fail-gracefully).
 *
 * SECURITY: entries hold only consent metadata (type, granted bool, version).
 * No health data, no tokens. The storage key does not reveal sensitive values.
 */

import type { ConsentType } from './types';

/** Storage abstraction — inject InMemoryQueueStorage in tests, secure store in prod. */
export interface ConsentQueueStorage {
  save(json: string): Promise<void>;
  load(): Promise<string | null>;
}

/** A single queued consent POST payload with retry metadata. */
export interface QueueEntry {
  /** Unique ID for this queued attempt (UUID v4-style). */
  id: string;
  /** The consent purpose to POST. */
  consentType: ConsentType;
  /** true = grant; false = withdraw. */
  granted: boolean;
  /** The consent text version string shown to the user. */
  consentTextVersion: string;
  /** Unix ms timestamp when this entry was first added to the queue. */
  addedAt: number;
  /** Number of times this entry has been retried (0 = never retried). */
  retryCount: number;
  /**
   * Unix ms timestamp before which this entry must NOT be retried.
   * For a freshly enqueued entry this is 0 (due immediately).
   * After each failed retry this is set to now + backoff(retryCount).
   */
  nextRetryAt: number;
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 min cap

/**
 * Computes the delay in milliseconds before the next retry attempt.
 * Formula: 2^(retryCount+1) * 1000, capped at MAX_BACKOFF_MS.
 *
 * retryCount=0 → 2000ms
 * retryCount=1 → 4000ms
 * retryCount=2 → 8000ms
 * retryCount=7 → 256000ms
 * retryCount=8+ → 300000ms (5 min cap)
 */
export function computeNextRetryDelay(retryCount: number): number {
  return Math.min(Math.pow(2, retryCount + 1) * 1000, MAX_BACKOFF_MS);
}

// ─── ID generation ────────────────────────────────────────────────────────────

let _idCounter = 0;

/** Generate a simple unique ID (no crypto needed; not security-sensitive). */
function generateId(): string {
  return `cq-${Date.now()}-${++_idCounter}`;
}

// ─── Queue factory ────────────────────────────────────────────────────────────

/**
 * Creates a consent offline queue backed by injectable storage.
 *
 * Usage:
 *   const queue = createConsentQueue(storage);
 *   await queue.restore();       // call once on app start
 *   const entry = queue.enqueue('general_health', true, 'v1.0-th');
 *   await queue.persist();       // call after each mutating operation
 */
export function createConsentQueue(storage: ConsentQueueStorage) {
  let entries: QueueEntry[] = [];

  return {
    /**
     * Add a new entry to the queue. The entry is immediately due (nextRetryAt=0).
     * IMPORTANT: call `persist()` after enqueue in production to survive restarts.
     */
    enqueue(
      consentType: ConsentType,
      granted: boolean,
      consentTextVersion: string,
    ): QueueEntry {
      const entry: QueueEntry = {
        id: generateId(),
        consentType,
        granted,
        consentTextVersion,
        addedAt: Date.now(),
        retryCount: 0,
        nextRetryAt: 0, // due immediately
      };
      entries.push(entry);
      return entry;
    },

    /**
     * Returns entries whose nextRetryAt <= Date.now() (i.e. ready to retry).
     */
    getDueEntries(): QueueEntry[] {
      const now = Date.now();
      return entries.filter(e => e.nextRetryAt <= now);
    },

    /**
     * Remove a successfully processed entry from the queue.
     * Call persist() afterwards to commit the removal.
     */
    remove(id: string): void {
      entries = entries.filter(e => e.id !== id);
    },

    /**
     * Mark an entry as retried: increment retryCount and set nextRetryAt
     * based on the exponential backoff schedule.
     * Call persist() afterwards.
     */
    markRetried(id: string): void {
      const entry = entries.find(e => e.id === id);
      if (!entry) return;
      entry.retryCount += 1;
      entry.nextRetryAt = Date.now() + computeNextRetryDelay(entry.retryCount - 1);
    },

    /** Return a snapshot of all current entries (due or not). */
    getEntries(): QueueEntry[] {
      return [...entries];
    },

    /**
     * Returns true if there is already a pending entry for this (consentType, granted) pair.
     * Used by callers before enqueue to prevent duplicate queued actions (§4.2 / S1).
     *
     * Dedup key: (consentType, granted) — same purpose + same direction.
     * A pending grant and a pending withdraw for the same type are treated as different.
     */
    hasPendingEntry(consentType: ConsentType, granted: boolean): boolean {
      return entries.some(e => e.consentType === consentType && e.granted === granted);
    },

    /**
     * Remove any pending entry matching (consentType, granted).
     *
     * Call on inline retry SUCCESS so the "รอซิงค์" badge clears and
     * `drainConsentQueue` does not re-POST a duplicate row (F1 fix).
     *
     * Guard: only removes entries where BOTH consentType AND granted match —
     * a still-pending DIFFERENT action (e.g. a pending withdrawal for the
     * same type, or a pending grant for a different type) is never touched.
     *
     * Call `persist()` afterwards to commit the removal to durable storage.
     */
    removePending(consentType: ConsentType, granted: boolean): void {
      entries = entries.filter(
        (e) => !(e.consentType === consentType && e.granted === granted),
      );
    },

    /**
     * Clear all in-memory entries (does NOT persist automatically).
     * Call `persist()` afterwards to commit the empty state to durable storage.
     *
     * Used by `resetConsentQueue` during logout so a subsequent user's foreground
     * drain finds an empty queue and cannot POST a previous user's consent entries
     * under the new user's token (N1 — cross-user consent contamination).
     */
    clear(): void {
      entries = [];
    },

    /** Persist the current queue to storage. Call after every mutation. */
    async persist(): Promise<void> {
      await storage.save(JSON.stringify(entries));
    },

    /**
     * Restore entries from storage. Call once on app startup before processing.
     * On parse errors or null storage, silently starts with an empty queue.
     */
    async restore(): Promise<void> {
      try {
        const json = await storage.load();
        if (!json) return;
        const parsed = JSON.parse(json) as unknown;
        if (Array.isArray(parsed)) {
          entries = parsed as QueueEntry[];
        }
      } catch {
        // corrupt or missing storage — start fresh (no data loss: entries are retry metadata only)
        entries = [];
      }
    },
  };
}

/** The type of the object returned by `createConsentQueue`. */
export type ConsentQueue = ReturnType<typeof createConsentQueue>;
