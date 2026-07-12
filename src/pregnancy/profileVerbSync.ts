/**
 * profileVerbSync — drain orchestrator for profileVerbQueue.
 *
 * Clone of consentSync's drain shape (../consent/consentSync.ts), extended
 * with the send-result classification, rollback, give-up, and head-of-line
 * behavior pinned in:
 *   docs/functional-spec/direct-rest-offline-resilience-functional.md
 *     §5 (ordering/HOL), §6 (resolveIfMatch), §9 (classification),
 *     §10 (rollback), §12 (give-up), §13 (telemetry lock).
 *
 * SECURITY (OR-INV-10 / TL-1..3 / LOSS-INV-10): `onLogEvent` — the ONLY
 * logging hook this module exposes — receives strictly non-health metadata
 * (entryId, seq, attemptCount, kind, statusClass). It NEVER receives
 * lifecycle, loss_date, birthDate, or the verb-specific body. `verb` itself
 * is deliberately NOT forwarded to the log event (an opaque per-entry log
 * would still let a log-reader infer "this queue item is a loss" from the
 * verb string) — callers that need a coarse class for dashboards can derive
 * one from `kind`/`statusClass` only.
 */

import type { ProfileVerbQueue, ProfileVerbEntry, ProfileVerb } from './profileVerbQueue';
import { MAX_ATTEMPTS } from './profileVerbQueue';
import type { PregnancyProfile, Lifecycle } from './types';

// ─── Dispatch result — the send outcome the caller's transport reports ─────

export type DispatchResult =
  | { kind: '200'; profile: PregnancyProfile }
  | { kind: '409'; currentProfile: PregnancyProfile | null }
  | { kind: '403' }
  | { kind: 'network' }
  | { kind: 'malformed' }; // 400/422 unexpected — treated as give-up (§9)

/** The caller supplies the exact transport call (pregnancyApiClient verb dispatch). */
export type DispatchFn = (entry: ProfileVerbEntry, ifMatch: string) => Promise<DispatchResult>;

/** Non-health log event — see module doc SECURITY note. */
export interface ProfileVerbLogEvent {
  entryId: string;
  seq: number;
  attemptCount: number;
  /** send-result kind: '200' | '409' | '403' | 'network' | 'malformed' | 'give_up'. */
  kind: string;
  /** HTTP status CLASS only (2xx/4xx/5xx/network) — never a body/value. */
  statusClass: string;
}

export interface CreateProfileVerbSyncOptions {
  dispatch: DispatchFn;
  /** Seed liveProfileVersion per targetProfileId (usually the profile's current version). */
  initialLiveVersion: number;
  /** Optional non-health telemetry hook (TL-3). */
  onLogEvent?: (evt: ProfileVerbLogEvent) => void;
}

export interface DrainCallbacks {
  /** 200 / 409-intent-satisfied / 409-terminal: adopt the server profile. */
  onAdopt: (profile: PregnancyProfile) => void;
  /** 409-still-meaningful: calm "updated on another device" note (§9). */
  onConflictStillMeaningful?: (currentProfile: PregnancyProfile | null) => void;
  /** 403: move to consent-required surface (distinct from network failure, AC-5.4). */
  onConsentRequired?: (entry: ProfileVerbEntry) => void;
  /** Attempt bound reached: calm "not yet saved — tap to try again" (US-5). */
  onGiveUp?: (entry: ProfileVerbEntry) => void;
}

export interface RollbackCallbacks {
  /** Converge the local snapshot to server truth. RB-1/RB-2 (quiet, no celebratory flash). */
  onRevert: (prevServerSnapshot: PregnancyProfile) => void;
  /** Never actually called in a correct rollback — RB-5 negative-assertion hook for tests. */
  onMarkedSynced?: () => void;
}

function statusClassOf(kind: DispatchResult['kind']): string {
  switch (kind) {
    case '200': return '2xx';
    case '409': return '4xx';
    case '403': return '4xx';
    case 'malformed': return '4xx';
    case 'network': return 'network';
    default: return 'unknown';
  }
}

/**
 * §5.3 / OR-HOL-2 successor-coherence recheck, run when the head entry gives
 * up and releases the lock. Returns whether the successor should proceed now
 * (against the current live lifecycle) or stay blocked/needs-reconfirm.
 *
 * This implements the exact per-verb-pair table in functional-spec §5.3 for
 * the pairs the architecture calls out as the common cases (independent
 * edit->birth/loss, loss->reopen moot-check). Ambiguous/dependent chains
 * default to "needs reconfirm" (safe default per spec).
 */
function successorIsCoherent(
  headVerb: ProfileVerb,
  successor: ProfileVerbEntry,
  liveLifecycle: Lifecycle | null,
): 'proceed' | 'intent_satisfied' | 'needs_reconfirm' {
  const successorVerb = successor.verb;

  // edit_profile head given up:
  if (headVerb === 'edit_profile') {
    if (successorVerb === 'birth_event' || successorVerb === 'loss_event') {
      // Independent — proceed as long as the profile is still pregnant.
      return liveLifecycle === 'pregnant' ? 'proceed' : 'needs_reconfirm';
    }
    if (successorVerb === 'reopen') {
      return liveLifecycle === 'ended' ? 'proceed' : 'intent_satisfied';
    }
    if (successorVerb === 'edit_profile') {
      // Default to re-confirm when ambiguous (safe, per §5.3 table).
      return 'needs_reconfirm';
    }
  }

  // loss_event head given up:
  if (headVerb === 'loss_event') {
    if (successorVerb === 'reopen') {
      // If loss never landed (still pregnant), reopen is moot.
      return liveLifecycle === 'pregnant' ? 'intent_satisfied' : 'proceed';
    }
    if (successorVerb === 'edit_profile') {
      return 'proceed';
    }
  }

  // reopen head given up:
  if (headVerb === 'reopen') {
    if (successorVerb === 'loss_event') {
      return liveLifecycle === 'pregnant' ? 'proceed' : 'intent_satisfied';
    }
    if (successorVerb === 'edit_profile') {
      return 'needs_reconfirm'; // default ambiguous-safe
    }
  }

  // birth_event head given up (leaves live pregnant):
  if (headVerb === 'birth_event') {
    return 'proceed';
  }

  return 'needs_reconfirm';
}

/**
 * Creates a testable profileVerbSync engine bound to a queue + dispatch fn.
 * Production wires a module-level singleton (see profileVerbSyncSingleton.ts)
 * exactly as consentSync wires drainConsentQueue.
 */
export function createProfileVerbSync(
  queue: ProfileVerbQueue,
  options: CreateProfileVerbSyncOptions,
) {
  const { dispatch, onLogEvent } = options;
  const liveVersions = new Map<string, number>();
  const liveLifecycles = new Map<string, Lifecycle | null>();
  let _draining = false;

  function seedIfAbsent(targetProfileId: string): void {
    if (!liveVersions.has(targetProfileId)) {
      liveVersions.set(targetProfileId, options.initialLiveVersion);
    }
  }

  function resolveIfMatch(entry: ProfileVerbEntry): string {
    seedIfAbsent(entry.targetProfileId);
    return String(liveVersions.get(entry.targetProfileId));
  }

  function adopt(profile: PregnancyProfile): void {
    liveVersions.set(profile.id, profile.version);
    liveLifecycles.set(profile.id, profile.lifecycle);
  }

  function log(entry: ProfileVerbEntry, kind: string): void {
    onLogEvent?.({
      entryId: entry.id,
      seq: entry.seq,
      attemptCount: entry.attemptCount,
      kind,
      statusClass: statusClassOf(kind as DispatchResult['kind']),
    });
  }

  /**
   * Drain due entries, one targetProfileId's head-of-line at a time (§5.1/§5.2).
   * Best-effort per entry: never throws.
   */
  async function drain(callbacks: DrainCallbacks): Promise<void> {
    if (_draining) return;
    _draining = true;
    try {
      const now = Date.now();
      const due = queue.getDueEntries(now);

      // Group by targetProfileId; within each profile only the LOWEST-seq
      // due entry may send this pass (OR-HOL-1) — but the FULL set of
      // pending entries (not just "due") determines whether an earlier,
      // still-pending (not-yet-resolved) entry blocks a later one, even if
      // that earlier entry isn't itself due this tick (it's mid-backoff).
      const byProfile = new Map<string, ProfileVerbEntry[]>();
      for (const e of due) {
        const arr = byProfile.get(e.targetProfileId) ?? [];
        arr.push(e);
        byProfile.set(e.targetProfileId, arr);
      }

      for (const [targetProfileId, dueForProfile] of byProfile) {
        for (const entry of dueForProfile.sort((a, b) => a.seq - b.seq)) {
          // Head-of-line (OR-HOL-1): an earlier-seq pending entry for the
          // SAME profile blocks this one. Recomputed fresh on every entry
          // (not cached) because an earlier entry processed EARLIER IN THIS
          // SAME drain pass may have just resolved (200/409/give-up), which
          // must immediately unblock this entry within the same drain() call
          // (OR-HOL-2 release + successor-coherence, §5.3).
          const stillPending = queue
            .getEntries()
            .filter((e) => e.targetProfileId === targetProfileId && e.status === 'pending')
            .sort((a, b) => a.seq - b.seq);
          const earlierUnresolved = stillPending.find((e) => e.seq < entry.seq);
          if (earlierUnresolved) {
            break; // stop processing this profile's due list this pass
          }

          const ifMatch = resolveIfMatch(entry);
          const result = await dispatch(entry, ifMatch);

          if (result.kind === '200') {
            adopt(result.profile);
            queue.remove(entry.id);
            callbacks.onAdopt(result.profile);
            log(entry, '200');
            await queue.persist();
            continue;
          }

          if (result.kind === '409') {
            const current = result.currentProfile;
            if (current) {
              adopt(current);
              const intentSatisfied = isIntentSatisfied(entry, current);
              queue.remove(entry.id);
              if (intentSatisfied) {
                callbacks.onAdopt(current); // AC-4.2: silent, no error surfaced
              } else if (isTerminalConflict(entry, current)) {
                callbacks.onAdopt(current); // terminal — adopt calmly, no ping-pong
              } else {
                callbacks.onAdopt(current);
                callbacks.onConflictStillMeaningful?.(current);
              }
            } else {
              queue.remove(entry.id);
              callbacks.onConflictStillMeaningful?.(null);
            }
            log(entry, '409');
            await queue.persist();
            continue;
          }

          if (result.kind === '403') {
            // RB-4: stop retrying as a network blip; park (do NOT remove).
            // Snapshot revert is NOT performed here — only on explicit
            // abandonment (rollbackAbandon) or on re-grant success (200).
            callbacks.onConsentRequired?.(entry);
            log(entry, '403');
            await queue.persist();
            break; // do not proceed to a later entry while this one is parked
          }

          if (result.kind === 'malformed') {
            // §9: 400/422 unexpected — cannot succeed on retry. Give up.
            queue.markGivenUp(entry.id);
            callbacks.onGiveUp?.(entry);
            log(entry, 'malformed');
            await queue.persist();
            const successor = queue.getEntries().filter((e) => e.targetProfileId === targetProfileId && e.status === 'pending').sort((a, b) => a.seq - b.seq).find((e) => e.seq > entry.seq);
            if (successor) {
              handleSuccessorRecheck(entry.verb, successor, targetProfileId, callbacks);
            }
            continue;
          }

          // network/5xx/timeout/0
          queue.markRetried(entry.id);
          const updated = queue.getEntries().find((e) => e.id === entry.id);
          if (updated && updated.attemptCount >= MAX_ATTEMPTS) {
            queue.markGivenUp(entry.id);
            callbacks.onGiveUp?.(entry);
            log(entry, 'give_up');
            await queue.persist();
            const successor = queue.getEntries().filter((e) => e.targetProfileId === targetProfileId && e.status === 'pending').sort((a, b) => a.seq - b.seq).find((e) => e.seq > entry.seq);
            if (successor) {
              handleSuccessorRecheck(entry.verb, successor, targetProfileId, callbacks);
            }
          } else {
            log(entry, 'network');
            await queue.persist();
          }
          break; // network/5xx keeps head-of-line held — stop this profile's pass
        }
      }
    } finally {
      _draining = false;
    }
  }

  function handleSuccessorRecheck(
    headVerb: ProfileVerb,
    successor: ProfileVerbEntry,
    targetProfileId: string,
    callbacks: DrainCallbacks,
  ): void {
    const liveLifecycle = liveLifecycles.get(targetProfileId) ?? null;
    const verdict = successorIsCoherent(headVerb, successor, liveLifecycle);
    if (verdict === 'intent_satisfied') {
      queue.remove(successor.id);
    }
    // 'proceed' — leave pending; the successor will be picked up on the
    // NEXT drain() call now that the head-of-line lock is released (its
    // seq is no longer blocked by an earlier pending entry).
    // 'needs_reconfirm' — leave pending too; screen-level UX surfaces the
    // calm "needs your confirmation again" state (same as give-up) rather
    // than blind-sending; this engine does not auto-resend a dependent
    // successor without a fresh confirm (out of scope for the queue itself).
  }

  /**
   * §10 rollback — triggered on 403-abandon or any path where the optimistic
   * value must be undone. RB-1: converge to server truth (prevServerSnapshot
   * when no authoritative body was returned). RB-2/RB-5: quiet, no celebratory
   * flash, never marked synced. RB-3 (reminder re-activation) is the caller's
   * responsibility (screen-level side-effect), not this engine's.
   */
  async function rollbackAbandon(
    entryId: string,
    prevServerSnapshot: PregnancyProfile,
    callbacks: RollbackCallbacks,
  ): Promise<void> {
    callbacks.onRevert(prevServerSnapshot);
    adopt(prevServerSnapshot);
    queue.remove(entryId);
    await queue.persist();
    // callbacks.onMarkedSynced is intentionally NEVER invoked — RB-5.
  }

  return {
    drain,
    rollbackAbandon,
    getLiveVersion(targetProfileId: string): number {
      seedIfAbsent(targetProfileId);
      return liveVersions.get(targetProfileId)!;
    },
    /** Test/production hook: seed the live lifecycle for successor-coherence checks. */
    setLiveLifecycle(targetProfileId: string, lifecycle: Lifecycle | null): void {
      liveLifecycles.set(targetProfileId, lifecycle);
    },
  };
}

/** Intent-satisfaction predicate per verb (§9). */
function isIntentSatisfied(entry: ProfileVerbEntry, current: PregnancyProfile): boolean {
  switch (entry.verb) {
    case 'loss_event':
      return current.lifecycle === 'ended';
    case 'reopen':
      return current.lifecycle === 'pregnant';
    case 'birth_event':
      return current.lifecycle === 'postpartum';
    case 'edit_profile': {
      const body = entry.body as { edd?: string; currentWeek?: number };
      if (body.edd != null) return current.edd === body.edd;
      return false; // conservative — a currentWeek edit is not byte-compared here
    }
    default:
      return false;
  }
}

/** Mutually-exclusive terminal conflict — the queued verb's target lifecycle
 * can never be reached from the server's CURRENT lifecycle (§9 terminal row). */
function isTerminalConflict(entry: ProfileVerbEntry, current: PregnancyProfile): boolean {
  if (entry.verb === 'loss_event' && current.lifecycle === 'postpartum') return true;
  if (entry.verb === 'birth_event' && current.lifecycle === 'ended') return true;
  if (entry.verb === 'reopen' && current.lifecycle === 'postpartum') return true;
  return false;
}

export type ProfileVerbSync = ReturnType<typeof createProfileVerbSync>;
