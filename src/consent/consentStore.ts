/**
 * consentStore — module-level singleton consent state with durable persistence.
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
 * Persistence (B1 — §4.5.4):
 * - `loadFromStorage()` hydrates from durable storage before the network GET.
 *   This ensures that a returning consented user is NOT dropped into limited
 *   mode when GET /account/consents fails (offline / 5xx).
 * - `setGranted` / `hydrate` / `reset` auto-persist (fire-and-forget) so the
 *   cache always reflects the latest known state.
 * - `configurePersistence(storage)` injects the durable storage binding at
 *   app startup (App.tsx). Tests inject via `createConsentStore(storage)`.
 *
 * SECURITY: stores only consent metadata (type, granted bool, text version).
 * No health data, no tokens, no PII. ConsentPersistStorage is appropriate for
 * expo-secure-store (or AsyncStorage if installed) — not secrets.
 */

import type { ConsentType, ConsentRecord } from './types';

// ─── Durable storage interface ────────────────────────────────────────────────

/**
 * Injectable durable storage for consent state.
 * Production binding: expo-secure-store (configured at app startup via App.tsx).
 * Tests: InMemoryPersistStorage injected directly into createConsentStore().
 *
 * Consent flags are NOT secrets, so AsyncStorage would be equally appropriate;
 * we use expo-secure-store because it is already installed.
 */
export interface ConsentPersistStorage {
  save(json: string): Promise<void>;
  load(): Promise<string | null>;
}

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
 *
 * @param persistStorage - optional durable storage for consent state.
 *   When provided, setGranted/hydrate/reset auto-persist (fire-and-forget)
 *   and loadFromStorage() can restore cache on cold start (§4.5.4).
 *   Tests inject an in-memory implementation; production uses expo-secure-store
 *   via consentStore.configurePersistence() at app startup.
 */
export function createConsentStore(persistStorage?: ConsentPersistStorage) {
  let state: Partial<Record<ConsentType, ConsentEntry>> = {};
  let _storage: ConsentPersistStorage | undefined = persistStorage;

  /** Fire-and-forget persist — never throws, never blocks the synchronous caller. */
  function saveToStorage(): void {
    if (!_storage) return;
    void _storage.save(JSON.stringify(state));
  }

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
     * Auto-persists merged state to durable storage (§4.5.4).
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
      saveToStorage();
    },

    /**
     * Update local state optimistically (before the POST is confirmed).
     * Used by ConsentScreen after user taps Grant/Withdraw, and after a
     * queued POST succeeds. Uses the current UTC timestamp as grantedAt.
     * Auto-persists to durable storage (§4.5.4).
     */
    setGranted(type: ConsentType, granted: boolean, version: string): void {
      state[type] = {
        granted,
        version,
        grantedAt: new Date().toISOString(),
      };
      saveToStorage();
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
     * Auto-persists the cleared state to durable storage.
     */
    reset(): void {
      state = {};
      saveToStorage();
    },

    /**
     * Read-only snapshot of the full internal state (for debugging/testing).
     */
    getState(): Readonly<Partial<Record<ConsentType, ConsentEntry>>> {
      return state;
    },

    /**
     * Load cached consent state from durable storage (B1 — §4.5.4).
     *
     * Call once on app start BEFORE GET /account/consents so that on
     * GET failure (offline / 5xx), a previously-consented user is NOT
     * wrongly dropped to limited mode (fail-closed only for genuinely-new users).
     *
     * Merge strategy: only updates entries that are newer than the current
     * in-memory state (grantedAt LWW). Silently ignores corrupt storage —
     * keeps the current in-memory state on parse errors.
     *
     * No-op if no storage has been configured.
     */
    async loadFromStorage(): Promise<void> {
      if (!_storage) return;
      try {
        const json = await _storage.load();
        if (!json) return;
        const parsed = JSON.parse(json) as Partial<Record<ConsentType, ConsentEntry>>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        for (const [type, entry] of Object.entries(parsed)) {
          const key = type as ConsentType;
          const existing = state[key];
          if (entry && (!existing || (entry as ConsentEntry).grantedAt > existing.grantedAt)) {
            state[key] = entry as ConsentEntry;
          }
        }
      } catch {
        // corrupt or unreadable storage — keep current in-memory state
      }
    },

    /**
     * Inject durable storage into an already-created store (B1).
     *
     * Called at app startup (App.tsx) to wire the expo-secure-store binding
     * AFTER the singleton is exported from this module. This keeps the module
     * free of any native imports so tests can import it without mocking.
     *
     * Once configured, all subsequent setGranted / hydrate / reset calls
     * will auto-persist; loadFromStorage() will read from the configured store.
     */
    configurePersistence(storage: ConsentPersistStorage): void {
      _storage = storage;
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
 * On app startup (App.tsx), configure durable persistence FIRST:
 *   consentStore.configurePersistence(secureConsentStorage)
 *
 * Then, before GET /account/consents, restore the cache:
 *   await consentStore.loadFromStorage()   // HomeScreen.loadProfile
 *
 * Hydrated on sign-in by calling (only updates if newer):
 *   consentStore.hydrate(page.items)
 *
 * Updated optimistically on ConsentScreen grant/withdraw:
 *   consentStore.setGranted('general_health', true, 'v1.0-th')
 *
 * Cleared on sign-out (also clears durable storage):
 *   consentStore.reset()
 */
export const consentStore = createConsentStore();
