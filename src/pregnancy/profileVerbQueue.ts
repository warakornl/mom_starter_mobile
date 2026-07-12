/**
 * profileVerbQueue — durable adjunct retry queue for the 4 direct-REST
 * pregnancy-profile state-transition verbs (edit_profile / loss_event /
 * reopen / birth_event).
 *
 * CLONE of the shipped `consentQueue` pattern (../consent/consentQueue.ts),
 * re-parameterised per:
 *   docs/architecture/direct-rest-offline-resilience-architecture.md §2
 *   docs/functional-spec/direct-rest-offline-resilience-functional.md §3
 *
 * Key differences from consentQueue (all per spec, not invented):
 *   - `idempotencyKey` is minted ONCE at enqueue (OR-INV-4) and replayed
 *     unchanged on every retry AND on a give-up "try again" — NEVER
 *     re-minted (PRD line 204's "per-attempt key" is a KNOWN BUG per the
 *     architecture; this queue follows the architecture, not the PRD).
 *   - `seq` is monotonic PER targetProfileId (drives FIFO/head-of-line,
 *     §5 of the functional spec) — consentQueue has no ordering concept.
 *   - `status: 'pending' | 'given_up'` — profile verbs REQUIRE a give-up
 *     state (US-5), unlike consent which retries forever.
 *   - `markGivenUp` purges the health-bearing payload (OR-INV-11 / GU-3)
 *     so no orphaned health body sits at-rest in a disposed entry.
 *   - `retryGivenUp` resets attemptCount/status/nextRetryAt but preserves
 *     idempotencyKey (§12 "same intent, same key").
 *
 * SECURITY (OR-INV-10 / TL-1..3): this module does not log or expose a
 * separate telemetry projection — health values (`lifecycle`, `loss_date`,
 * `birthDate`) live ONLY inside `entry.body`, which is durable state, never
 * emitted to a log/telemetry/crash-breadcrumb sink by this module. The
 * enforcement test for retry/give-up EVENT logging lives in
 * profileVerbSync.test.ts (where those events are actually emitted).
 */

import { v4 as uuidv4 } from 'uuid';
import type { Lifecycle } from './types';

// ─── Verb + body types ─────────────────────────────────────────────────────

export type ProfileVerb = 'loss_event' | 'reopen' | 'birth_event' | 'edit_profile';

/** Verb-specific request body. Kept loose (Record) — the caller supplies the
 * exact shape (LossEventInput / {} / BirthEventInput / PregnancyProfileInput).
 * `markGivenUp` purges this to `{}` (GU-3) so no health value is retained
 * once an entry is durably given up / disposed. */
export type ProfileVerbBody = Record<string, unknown>;

/** intendedLifecycle: null for edit_profile (no lifecycle flip). */
export type IntendedLifecycle = Lifecycle | null;

/** A single durable queued verb entry (architecture §2 ProfileVerbEntry). */
export interface ProfileVerbEntry {
  /** Client-gen UUID v4 — the queue-item identity. Survives restart. Never re-minted. */
  id: string;
  verb: ProfileVerb;
  /** Monotonic per targetProfileId. Drives FIFO order (§5). Never renumbered on removal. */
  seq: number;
  /** The pregnancy profile this verb mutates (single-profile MVP; cross-profile guard). */
  targetProfileId: string;
  /** The profile version this entry was BUILT against. Audit + intent-check only —
   * the If-Match actually sent is recomputed at drain time (resolveIfMatch, §6). */
  baseVersion: number;
  /** Stable for the entry's whole life (OR-INV-4). Replayed unchanged on every retry
   * AND on a give-up "try again". NEVER re-minted per-attempt. */
  idempotencyKey: string;
  /** Verb-specific body. Health ciphers stored already-encrypted (DR-1). Purged on give-up. */
  body: ProfileVerbBody;
  /** 'YYYY-MM-DD' captured AT CONFIRM TIME (X-Client-Date). Never recomputed at drain
   * (floating-civil — a birth confirmed just before midnight keeps the civil date seen). */
  clientDate: string;
  /** Drives the intent-satisfaction check (§9). null for edit_profile (no lifecycle flip). */
  intendedLifecycle: IntendedLifecycle;
  /** Unix ms — enqueue time. Telemetry-safe (non-health) + seq tiebreak. */
  addedAt: number;
  /** Retries so far. Feeds backoff + give-up bound (§12). */
  attemptCount: number;
  /** Unix ms; 0 or <= now = due now. Set by markRetried. */
  nextRetryAt: number;
  /** 'given_up' is durable, never dropped, manually retriable (§12.4). */
  status: 'pending' | 'given_up';
}

/** Fields the caller supplies at enqueue time (the rest are minted/derived). */
export interface EnqueueParams {
  verb: ProfileVerb;
  targetProfileId: string;
  baseVersion: number;
  body: ProfileVerbBody;
  clientDate: string;
  intendedLifecycle: IntendedLifecycle;
}

/** Storage abstraction — inject InMemoryQueueStorage in tests, SecureStore in prod.
 * Same seam shape as ConsentQueueStorage (../consent/consentQueue.ts). */
export interface ProfileVerbQueueStorage {
  save(json: string): Promise<void>;
  load(): Promise<string | null>;
}

// ─── Backoff — PARITY with consentQueue (verify-against-shipped, §12/§18) ──
//
// The shipped consentQueue.computeNextRetryDelay has NO give-up/max-attempts
// bound (it retries forever — see ../consent/consentQueue.ts). Per functional
// spec §12/§18 VERIFY-AGAINST-SHIPPED: "if consentQueue has NO give-up bound
// today (retries forever), then MAX_ATTEMPTS = 8 is this feature's pin."
// That branch applies here — see MAX_ATTEMPTS below.
//
// The backoff SHAPE itself (2s doubling, 300s cap) is reused VERBATIM from
// consentQueue (parity, not reinvention) — same formula, duplicated here
// rather than imported, to keep profileVerbQueue a fully independent clone
// per the architecture's "second, parallel adjunct" decision (mirrors the
// OR-BACKEND-1 rationale for a second parallel IdempotencyStore).

const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 min cap — verbatim from consentQueue

/**
 * Computes the delay in milliseconds before the next retry attempt.
 * IDENTICAL formula to consentQueue.computeNextRetryDelay: 2^(attemptCount+1) * 1000,
 * capped at MAX_BACKOFF_MS.
 */
export function computeNextRetryDelay(attemptCount: number): number {
  return Math.min(Math.pow(2, attemptCount + 1) * 1000, MAX_BACKOFF_MS);
}

/**
 * Give-up bound — PINNED per functional spec §12: MAX_ATTEMPTS = 8.
 * consentQueue has NO give-up bound (retries forever) — see the module doc
 * above — so this feature's own pin applies (profile verbs REQUIRE a give-up
 * state per US-5, unlike consent). After 8 failed send attempts (~8.5 min of
 * active retrying riding the 2s→300s-cap escalation), the entry transitions
 * to `given_up`.
 */
export const MAX_ATTEMPTS = 8;

// ─── Queue factory ─────────────────────────────────────────────────────────

/**
 * Creates a profile-verb offline queue backed by injectable storage.
 * Mirrors createConsentQueue's factory shape 1:1.
 */
export function createProfileVerbQueue(storage: ProfileVerbQueueStorage) {
  let entries: ProfileVerbEntry[] = [];
  const seqCounters = new Map<string, number>();

  function nextSeq(targetProfileId: string): number {
    const current = seqCounters.get(targetProfileId) ?? 0;
    const next = current + 1;
    seqCounters.set(targetProfileId, next);
    return next;
  }

  return {
    /**
     * Add a new entry to the queue. The entry is immediately due (nextRetryAt=0),
     * status='pending', and gets a freshly-minted stable idempotencyKey.
     * IMPORTANT: call `persist()` after enqueue in production to survive restarts.
     */
    enqueue(params: EnqueueParams): ProfileVerbEntry {
      const entry: ProfileVerbEntry = {
        id: uuidv4(),
        verb: params.verb,
        seq: nextSeq(params.targetProfileId),
        targetProfileId: params.targetProfileId,
        baseVersion: params.baseVersion,
        idempotencyKey: uuidv4(), // OR-INV-4: minted ONCE, never re-minted
        body: params.body,
        clientDate: params.clientDate,
        intendedLifecycle: params.intendedLifecycle,
        addedAt: Date.now(),
        attemptCount: 0,
        nextRetryAt: 0, // due immediately
        status: 'pending',
      };
      entries.push(entry);
      return entry;
    },

    /**
     * Returns due entries: status==='pending' && nextRetryAt<=now, sorted by seq
     * ascending (§5.1 FIFO-by-seq).
     */
    getDueEntries(now: number): ProfileVerbEntry[] {
      return entries
        .filter((e) => e.status === 'pending' && e.nextRetryAt <= now)
        .sort((a, b) => a.seq - b.seq);
    },

    /** Remove an entry (200 / intent-satisfied / conflict-adopted / disposed-on-abandon). */
    remove(id: string): void {
      entries = entries.filter((e) => e.id !== id);
    },

    /**
     * Mark an entry as retried after a network/5xx result: increment
     * attemptCount and set nextRetryAt via computeNextRetryDelay (parity
     * with consentQueue's backoff). Call persist() afterwards.
     */
    markRetried(id: string): void {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      entry.attemptCount += 1;
      entry.nextRetryAt = Date.now() + computeNextRetryDelay(entry.attemptCount - 1);
    },

    /**
     * Transition an entry to 'given_up' (§12 / OR-INV-11 / GU-3):
     *   - status := 'given_up'
     *   - health-bearing payload PURGED (body := {}) — never a plaintext
     *     lossDate/birthDate/deliveryType/birthNote/hospital cipher sits at
     *     rest in a disposed entry.
     *   - idempotencyKey is PRESERVED (not cleared) so a later retryGivenUp
     *     replays the same key (§12).
     * Never removes the entry — a given-up entry stays visible + retriable
     * until the mother acts (GU-1).
     */
    markGivenUp(id: string): void {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      entry.status = 'given_up';
      entry.body = {};
    },

    /**
     * Manual "try again" on a given_up entry (§12.4): resets attemptCount:=0,
     * status:='pending', nextRetryAt:=0. Re-drains on the next drain() call.
     * NEVER re-mints idempotencyKey (same intent, OR-INV-4).
     *
     * NOTE: the health-bearing body was already purged at give-up (GU-3) —
     * a manual retry after give-up re-sends the (now-minimal) body. Per §11.3
     * a given_up entry is surfaced to the mother to re-confirm rather than
     * blindly resent with a purged body; this primitive exists so the caller
     * (screen-level "try again") can choose to re-enqueue a FRESH entry with
     * a fresh body instead, if that is the chosen UX. Kept as a low-level
     * queue primitive per the spec's exact wording (§12: "Manual try again
     * resets attemptCount:=0 ... same idempotencyKey").
     */
    retryGivenUp(id: string): void {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      entry.status = 'pending';
      entry.attemptCount = 0;
      entry.nextRetryAt = 0;
    },

    /** Return a snapshot of all current entries (due or not, pending or given_up). */
    getEntries(): ProfileVerbEntry[] {
      return [...entries];
    },

    /**
     * Dedup guard (§17.1): true if a PENDING entry for this (targetProfileId, verb)
     * pair already exists. Callers use this before enqueue to prevent stacking
     * two identical-verb entries (e.g. a double-tap confirm).
     */
    hasPending(targetProfileId: string, verb: ProfileVerb): boolean {
      return entries.some(
        (e) => e.targetProfileId === targetProfileId && e.verb === verb && e.status === 'pending',
      );
    },

    /**
     * Clear all in-memory entries (does NOT persist automatically).
     * Call `persist()` afterwards to commit. Used by resetQueue during logout
     * (cross-user contamination guard, mirrors resetConsentQueue).
     */
    clear(): void {
      entries = [];
      seqCounters.clear();
    },

    /** Persist the current queue to storage. Call after every mutation (§3.2). */
    async persist(): Promise<void> {
      await storage.save(JSON.stringify(entries));
    },

    /**
     * Restore entries from storage. Call once on app startup before processing.
     * On parse errors or null storage, silently starts with an empty queue
     * (no data loss beyond retry metadata — mirrors consentQueue.restore).
     * Rehydrates the per-profile seq counters from the restored entries so a
     * subsequent enqueue continues the monotonic sequence correctly.
     */
    async restore(): Promise<void> {
      try {
        const json = await storage.load();
        if (!json) return;
        const parsed = JSON.parse(json) as unknown;
        if (Array.isArray(parsed)) {
          entries = parsed as ProfileVerbEntry[];
          seqCounters.clear();
          for (const e of entries) {
            const current = seqCounters.get(e.targetProfileId) ?? 0;
            if (e.seq > current) seqCounters.set(e.targetProfileId, e.seq);
          }
        }
      } catch {
        entries = [];
      }
    },
  };
}

/** The type of the object returned by `createProfileVerbQueue`. */
export type ProfileVerbQueue = ReturnType<typeof createProfileVerbQueue>;
