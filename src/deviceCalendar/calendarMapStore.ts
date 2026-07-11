/**
 * calendarMapStore — durable appointmentId ↔ nativeEventId map.
 *
 * Architecture §3.1/§3.2 decision:
 *   - PK = appointmentId (enforces one appointment ≤ one native event — INV-C5)
 *   - Durable (survives relaunch — cannot be in-memory only)
 *   - Device-local, NEVER synced (nativeEventId/calendarId are meaningless on other devices)
 *   - Health-FREE: stores only { appointmentId, nativeEventId, calendarId,
 *     privacyLevelAtWrite, syncedContentHash, updatedAt } — NO title, note, scheduledAt,
 *     location (CAL-SA-50a, INV-CAL-1)
 *
 * Storage tier: injectable KV-backed (MVP) — carry-forward to SQLite non-synced table.
 * Tests inject an InMemoryStorage; production injects MMKV/AsyncStorage.
 *
 * SECURITY: NEVER log entry values other than appointmentId + op + result code.
 */

import type { PrivacyLevel } from './eventPayloadBuilder';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single entry in the idempotent map.
 * Health-free by construction: no title, note, scheduledAt, location.
 */
export interface CalendarMapEntry {
  /** Primary key — ChecklistItem.id (UUID). */
  appointmentId: string;
  /** The id returned by expo-calendar createEventAsync. */
  nativeEventId: string;
  /** Which device calendar the event was written to. */
  calendarId: string;
  /** Privacy level used when this event was last written. */
  privacyLevelAtWrite: PrivacyLevel;
  /** Hash of the last-written payload; used for no-op short-circuit (architecture §3.1). */
  syncedContentHash: string;
  /** Epoch ms, device-local. */
  updatedAt: number;
}

/** Injectable durable storage for the map. */
export interface CalendarMapStorage {
  save(json: string): Promise<void>;
  load(): Promise<string | null>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCalendarMapStore(storage?: CalendarMapStorage) {
  let _map: Map<string, CalendarMapEntry> = new Map();
  let _storage = storage;

  function saveToStorage(): void {
    if (!_storage) return;
    const json = JSON.stringify(Array.from(_map.entries()));
    void _storage.save(json);
  }

  return {
    /** Retrieve an entry by appointmentId. Returns undefined if not present. */
    get(appointmentId: string): CalendarMapEntry | undefined {
      return _map.get(appointmentId);
    },

    /**
     * Upsert an entry.
     * PK = appointmentId — second put with same PK overwrites (idempotent).
     * Auto-persists if storage is configured.
     */
    put(entry: CalendarMapEntry): void {
      _map.set(entry.appointmentId, entry);
      saveToStorage();
    },

    /**
     * Remove an entry by appointmentId.
     * No-op if not present (missing = no-op success — architecture §7.3).
     */
    delete(appointmentId: string): void {
      _map.delete(appointmentId);
      saveToStorage();
    },

    /** Returns all entries as an array (order not guaranteed). */
    entries(): CalendarMapEntry[] {
      return Array.from(_map.values());
    },

    /**
     * Remove all entries (called on US-9 clear — architecture §5.5).
     * Auto-persists if storage is configured.
     */
    clear(): void {
      _map = new Map();
      saveToStorage();
    },

    /**
     * Explicitly persist state to durable storage (call after put/delete/clear
     * to flush in tests, or to await persistence before shutdown).
     */
    async persist(): Promise<void> {
      if (!_storage) return;
      const json = JSON.stringify(Array.from(_map.entries()));
      await _storage.save(json);
    },

    /**
     * Hydrate from durable storage on cold start.
     * Call once at startup before any get/put/delete.
     */
    async loadFromStorage(): Promise<void> {
      if (!_storage) return;
      const json = await _storage.load();
      if (!json) return;
      try {
        const entries = JSON.parse(json) as Array<[string, CalendarMapEntry]>;
        _map = new Map(entries);
      } catch {
        // Corrupted storage — start fresh (safe default)
        _map = new Map();
      }
    },
  };
}

// ─── Module singleton ─────────────────────────────────────────────────────────

/**
 * The module-level singleton map store.
 * Production binding: configure storage via `calendarMapStore.configurePersistence(storage)`
 * called from App.tsx startup (same pattern as consentStore).
 */
let _singleton: ReturnType<typeof createCalendarMapStore> | null = null;

export function getCalendarMapStore(storage?: CalendarMapStorage): ReturnType<typeof createCalendarMapStore> {
  if (!_singleton) {
    _singleton = createCalendarMapStore(storage);
  }
  return _singleton;
}

/** Reset singleton (tests only). */
export function _resetCalendarMapStoreSingleton(): void {
  _singleton = null;
}
