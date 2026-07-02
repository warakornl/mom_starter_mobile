/**
 * consentStore — module-level singleton consent state.
 *
 * Implements first-run-consent.md §4.5 hydration and gate checks.
 *
 * Design:
 * - Module-level singleton (mirrors calendarSyncStore pattern).
 * - `isGranted(type)` is fail-closed: returns false when unknown (no record).
 * - `hydrate(items)` derives effective state as the latest record per type
 *   (most recent grantedAt timestamp), matching the server's append-only model.
 * - `setGranted(type, granted, version)` updates state optimistically (for
 *   the local-first path: update immediately, sync in background).
 * - `reset()` clears all state (call on sign-out so a new user doesn't
 *   inherit the previous user's consent state).
 *
 * SECURITY: stores only consent metadata (type, granted bool, text version).
 * No health data, no tokens, no PII.
 */

import type { ConsentType, ConsentRecord } from './types';

// ─── Internal state shape ─────────────────────────────────────────────────────

interface ConsentEntry {
  /** Whether the latest action for this type is a grant (true) or withdrawal (false). */
  granted: boolean;
  /** The consent text version tag of the latest record. */
  version: string;
  /** ISO 8601 UTC timestamp of the latest record (used for hydrate LWW). */
  grantedAt: string;
}

// ─── Factory (used for createConsentStore + module singleton) ─────────────────

/**
 * Creates an isolated consent store instance.
 * Used directly for testing; the module-level `consentStore` is the
 * singleton used by screens.
 */
export function createConsentStore() {
  let state: Partial<Record<ConsentType, ConsentEntry>> = {};

  return {
    /**
     * Returns true if the latest known record for this type has granted=true.
     * Fail-closed: returns false when no record exists (undefined → false).
     */
    isGranted(type: ConsentType): boolean {
      return state[type]?.granted === true;
    },

    /**
     * Hydrate from server records (GET /v1/account/consents response items).
     *
     * For each consent type, the effective state is the record with the
     * latest `grantedAt` timestamp. This matches the server's
     * append-only model where "current state = latest row per (user, type)".
     *
     * Merges with existing state: does not clear types not present in `items`.
     */
    hydrate(items: ConsentRecord[]): void {
      for (const record of items) {
        const existing = state[record.consentType];
        if (!existing || record.grantedAt > existing.grantedAt) {
          state[record.consentType] = {
            granted: record.granted,
            version: record.consentTextVersion,
            grantedAt: record.grantedAt,
          };
        }
      }
    },

    /**
     * Update local state optimistically (before the POST is confirmed).
     * Used by ConsentScreen after user taps Grant/Withdraw, and after a
     * queued POST succeeds. Uses the current UTC timestamp as grantedAt.
     */
    setGranted(type: ConsentType, granted: boolean, version: string): void {
      state[type] = {
        granted,
        version,
        grantedAt: new Date().toISOString(),
      };
    },

    /**
     * Returns the consentTextVersion of the latest record for this type,
     * or undefined if no record exists.
     */
    getLatestVersion(type: ConsentType): string | undefined {
      return state[type]?.version;
    },

    /**
     * Clear all consent state. Call on sign-out so a new user starts fresh.
     */
    reset(): void {
      state = {};
    },

    /**
     * Read-only snapshot of the full internal state (for debugging/testing).
     */
    getState(): Readonly<Partial<Record<ConsentType, ConsentEntry>>> {
      return state;
    },
  };
}

/** The type of the object returned by `createConsentStore`. */
export type ConsentStore = ReturnType<typeof createConsentStore>;

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Module-level consent store singleton.
 *
 * Used by screens to read consent state:
 *   consentStore.isGranted('general_health')
 *
 * Hydrated on sign-in by calling:
 *   consentStore.hydrate(page.items)
 *
 * Updated optimistically on ConsentScreen grant/withdraw:
 *   consentStore.setGranted('general_health', true, 'v1.0-th')
 *
 * Cleared on sign-out:
 *   consentStore.reset()
 */
export const consentStore = createConsentStore();
