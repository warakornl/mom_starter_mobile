/**
 * suggestionStore — module-level singleton for suggestion dismiss/snooze state.
 *
 * Implements the local-first B5 state transitions from api-contract:
 *   offered → started | snoozed(+resurfacesAt) | dismissed
 *   dismissed → offered (re-enable)
 *
 * Design mirrors consentStore.ts:
 * - Factory function `createSuggestionStore(persistStorage?)` for testing
 * - Module-level singleton `suggestionStore` for production
 * - Injectable durable storage (same interface shape as ConsentPersistStorage)
 * - `configurePersistence(storage)` for late injection at app startup
 * - `loadFromStorage()` to restore cache on cold start
 * - All mutating methods auto-persist (fire-and-forget)
 *
 * Merge strategy on loadFromStorage: newest updatedAt wins (LWW).
 *
 * SECURITY: only stores suggestion keys + status metadata.
 * No health values, no tokens, no PII. Safe for AsyncStorage or
 * expo-secure-store (existing dependency).
 */

import type { SuggestionKey, UserSuggestionState, UserSuggestionStatus } from './types';

// ─── Durable storage interface ────────────────────────────────────────────────

/**
 * Injectable durable storage — same pattern as ConsentPersistStorage.
 * Production binding: configured at app startup via App.tsx.
 * Tests: inject InMemoryPersistStorage directly into createSuggestionStore().
 */
export interface SuggestionPersistStorage {
  save(json: string): Promise<void>;
  load(): Promise<string | null>;
}

// ─── State type ───────────────────────────────────────────────────────────────

type SuggestionStoreState = Partial<Record<SuggestionKey, UserSuggestionState>>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an isolated suggestion store instance.
 * Use directly for testing; the module-level `suggestionStore` is the
 * singleton used by screens and App.tsx.
 */
export function createSuggestionStore(persistStorage?: SuggestionPersistStorage) {
  let state: SuggestionStoreState = {};
  let _storage: SuggestionPersistStorage | undefined = persistStorage;

  /** Fire-and-forget persist — never throws, never blocks the synchronous caller. */
  function saveToStorage(): void {
    if (!_storage) return;
    void _storage.save(JSON.stringify(state));
  }

  function transition(key: SuggestionKey, status: UserSuggestionStatus, resurfacesAt?: string): void {
    state[key] = {
      key,
      status,
      ...(resurfacesAt !== undefined ? { resurfacesAt } : {}),
      updatedAt: new Date().toISOString(),
    };
    saveToStorage();
  }

  return {
    /**
     * Mark a suggestion as dismissed.
     * Dismissed suggestions never reappear in the banner unless re-enabled.
     * (suggestion-flow-ui.md §2.2 "Not for me" action)
     */
    dismiss(key: SuggestionKey): void {
      transition(key, 'dismissed');
    },

    /**
     * Snooze a suggestion for `days` calendar days.
     * Sets resurfacesAt = now + days * 86400s so the engine resurfaces it later.
     * Default duration per spec: 7 days; valid: 3 / 7 / 14 (suggestion-flow-ui.md §2.2).
     */
    snooze(key: SuggestionKey, days: number): void {
      const resurfacesAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      transition(key, 'snoozed', resurfacesAt);
    },

    /**
     * Mark a suggestion as started (the mother tapped "Start").
     * Started suggestions are excluded from the offerable list.
     * (suggestion-flow-ui.md §2.2 "Start" action)
     */
    start(key: SuggestionKey): void {
      transition(key, 'started');
    },

    /**
     * Re-enable a previously dismissed (or snoozed) suggestion.
     * Transitions → 'offered'; clears resurfacesAt.
     * (suggestion-flow-ui.md §3.1 dismissed list "Re-enable" action)
     */
    reenable(key: SuggestionKey): void {
      state[key] = {
        key,
        status: 'offered',
        updatedAt: new Date().toISOString(),
        // resurfacesAt deliberately omitted — field stays absent (undefined)
      };
      saveToStorage();
    },

    /**
     * Clear all suggestion state (call on sign-out so a new user starts fresh).
     */
    reset(): void {
      state = {};
      saveToStorage();
    },

    /**
     * Read-only snapshot of the full internal state.
     * Used by the suggestion engine: `store.getState()` → `getOfferable(ctx, state)`.
     */
    getState(): Readonly<SuggestionStoreState> {
      return state;
    },

    /**
     * Returns the keys of all suggestions currently in 'dismissed' status.
     * Used to populate the "dismissed list" (suggestion-flow-ui.md §3.1).
     */
    getDismissedKeys(): SuggestionKey[] {
      return (Object.values(state) as UserSuggestionState[])
        .filter((entry) => entry.status === 'dismissed')
        .map((entry) => entry.key);
    },

    /**
     * Load cached state from durable storage (cold-start cache restore).
     * Merge strategy: newest updatedAt wins (LWW) — same as consentStore.
     * Silently ignores corrupt JSON.
     * No-op if no storage is configured.
     */
    async loadFromStorage(): Promise<void> {
      if (!_storage) return;
      try {
        const json = await _storage.load();
        if (!json) return;
        const parsed = JSON.parse(json) as Partial<Record<SuggestionKey, UserSuggestionState>>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        for (const [key, entry] of Object.entries(parsed)) {
          const k = key as SuggestionKey;
          const existing = state[k];
          if (entry && (!existing || (entry as UserSuggestionState).updatedAt > existing.updatedAt)) {
            state[k] = entry as UserSuggestionState;
          }
        }
      } catch {
        // corrupt or unreadable storage — keep current in-memory state
      }
    },

    /**
     * Inject durable storage after the singleton is created.
     * Call once at app startup (App.tsx) before any writes.
     */
    configurePersistence(storage: SuggestionPersistStorage): void {
      _storage = storage;
    },
  };
}

/** The type of the object returned by `createSuggestionStore`. */
export type SuggestionStore = ReturnType<typeof createSuggestionStore>;

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Module-level singleton — used by screens and HomeScreen.
 *
 * App.tsx startup wires durable storage:
 *   suggestionStore.configurePersistence(secureStorage)
 *
 * HomeScreen cold-start:
 *   await suggestionStore.loadFromStorage()
 *
 * HomeScreen / SuggestionFlowScreen mutation:
 *   suggestionStore.dismiss(key)
 *   suggestionStore.snooze(key, 7)
 *   suggestionStore.start(key)
 *   suggestionStore.reenable(key)
 *
 * Sign-out:
 *   suggestionStore.reset()
 */
export const suggestionStore = createSuggestionStore();
