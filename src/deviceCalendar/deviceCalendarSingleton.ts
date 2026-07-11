/**
 * deviceCalendarSingleton — module-level singleton for the device-calendar bridge.
 *
 * Initialises the bridge with all production dependencies and exposes the public
 * entry points that app code (App.tsx, navigator) needs:
 *
 *   1. `deviceCalendarBridge`               — the bridge itself (for screen handlers)
 *   2. `attachCalendarObserver`             — call once at app startup to wire the store
 *   3. `configureCalendarPostConsent`       — inject the token-bearing postConsent fn
 *                                             after SecureTokenStorage is available
 *   4. `initCalendarPersistenceFromStorage` — load calendarMapStore + settings from
 *                                             durable storage on cold start (BLOCKER 3 fix)
 *   5. `checkAndUpdateOsPermission`         — foreground hook to refresh OS permission state
 *   6. `syncCalendarBridgeConsentFromStore` — call after consentStore.loadFromStorage()
 *   7. `refreshCalendarBridgeConsent`       — call after server consent refresh to trigger
 *                                             self-heal on discovered withdrawal (CAL-SA-30)
 *   8. `getCalendarSyncSnapshot`            — read current settings + consent for UI
 *   9. `changePrivacyLevel`                 — re-mask sweep via bridge, using calendarSyncStore
 *  10. `backfillCalendarFromStore`          — first-enable backfill (CAL-SA-40)
 *
 * Architecture §2: the observer wiring is the key step that makes the feature
 * live. Without calling `attachCalendarObserver` the bridge is built but dead.
 *
 * Consent snapshot initialisation:
 *   The bridge is initialised with 'unknown' consent (fail-closed) because the
 *   consentStore may not have loaded its persisted state yet at module-eval time.
 *   After App.tsx restores the consent cache (`consentStore.loadFromStorage()`),
 *   it must call `syncCalendarBridgeConsentFromStore()` to open the gate with the
 *   cached granted state. The foreground refresh then keeps it up-to-date.
 *
 * Durability (BLOCKER 3 fix):
 *   `_mapStore` and `_settings` now receive durable storage via expo-file-system.
 *   `initCalendarPersistenceFromStorage()` must be called once at app startup
 *   (after expo-file-system is available) to hydrate from the previous session.
 *   Without this, relaunch empties the map → backfill creates DUPLICATE native events.
 *
 * SECURITY: no health data or accessToken stored at module level.
 *           postConsent is injected late (token acquired at call time).
 * Trace: architecture §1.1/§2/§5.2/§5.3, CAL-GATE-FRESH Option B.
 */

import { createDeviceCalendarBridge } from './deviceCalendarBridge';
import type { PostConsentFn }          from './deviceCalendarBridge';
import { createCalendarMapStore }       from './calendarMapStore';
import type { CalendarMapStorage }      from './calendarMapStore';
import { createDeviceCalendarSettings } from './deviceCalendarSettings';
import type { SettingsStorage }         from './deviceCalendarSettings';
import { createDeviceCalendarQueue }    from './deviceCalendarQueue';
import { expoCalendarGatewayImpl }      from './expoCalendarGateway';
import { attachAppointmentCalendarObserver } from './appointmentCalendarObserver';
import { calendarSyncStore }            from '../sync/calendarSyncStore';
import { consentStore }                 from '../consent/consentStore';
import type { ConsentSnapshot }         from './deviceCalendarState';
import type { PrivacyLevel, AppointmentInput } from './eventPayloadBuilder';

// ─── Late-injectable postConsent fn ──────────────────────────────────────────

/**
 * Placeholder that is overwritten via `configureCalendarPostConsent()` after
 * the app has a live token storage reference.  Returns {ok:false} until
 * configured — the bridge only calls postConsent on explicit consent actions
 * (grantConsent / disableAndWithdraw), never on the observer path.
 */
let _postConsentImpl: PostConsentFn = async () => ({ ok: false });

/** Call this from App.tsx once SecureTokenStorage is available. */
export function configureCalendarPostConsent(fn: PostConsentFn): void {
  _postConsentImpl = fn;
}

const _delegatingPostConsent: PostConsentFn = (body) => _postConsentImpl(body);

// ─── OS permission tracking ───────────────────────────────────────────────────

/**
 * Last known OS calendar permission state. Updated by checkAndUpdateOsPermission().
 * Used by getCalendarSyncSnapshot() so the settings screen shows current OS state.
 * Defaults to false (fail-closed) until the first check.
 */
let _lastKnownOsPermission = false;

// ─── Consent snapshot helper ──────────────────────────────────────────────────

/**
 * Build a ConsentSnapshot from the current consentStore state.
 * Returns 'unknown' for types that have never been fetched (fail-closed).
 */
function buildConsentSnapshot(): ConsentSnapshot {
  const state = consentStore.getState();

  function status(key: 'calendar_sync' | 'general_health'): 'granted' | 'withdrawn' | 'unknown' {
    const entry = state[key];
    if (!entry) return 'unknown';
    return entry.granted ? 'granted' : 'withdrawn';
  }

  return {
    calendarSync:  { status: status('calendar_sync') },
    generalHealth: { status: status('general_health') },
  };
}

// ─── Durable storage for map and settings (BLOCKER 3 fix) ────────────────────

/**
 * Build a durable CalendarMapStorage backed by expo-file-system.
 * The file lives in documentDirectory (device-local, not backed up by default).
 * Health-free data only (appointmentId / nativeEventId / hash — no titles/notes).
 * expo-file-system is imported lazily (require) so tests can import this module
 * without triggering the native file-system binding.
 *
 * Trace: architecture §3 "durable, device-local, NOT synced".
 */
function createFileSystemMapStorage(): CalendarMapStorage {
  const KEY = 'calendar_map_v1.json';
  return {
    async save(json: string): Promise<void> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
        await FileSystem.writeAsStringAsync(FileSystem.documentDirectory + KEY, json, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } catch {
        // Non-fatal: worst case the map is not persisted (handled by reconciliation on restart)
      }
    },
    async load(): Promise<string | null> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
        const info = await FileSystem.getInfoAsync(FileSystem.documentDirectory + KEY);
        if (!info.exists) return null;
        return FileSystem.readAsStringAsync(FileSystem.documentDirectory + KEY, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } catch {
        return null;
      }
    },
  };
}

/**
 * Build a durable SettingsStorage backed by expo-file-system.
 * Settings object is small (<500 bytes) and health-free.
 */
function createFileSystemSettingsStorage(): SettingsStorage {
  const KEY = 'calendar_settings_v1.json';
  return {
    async save(json: string): Promise<void> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
        await FileSystem.writeAsStringAsync(FileSystem.documentDirectory + KEY, json, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } catch {
        // Non-fatal: feature defaults to OFF on next launch (safe default)
      }
    },
    async load(): Promise<string | null> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
        const info = await FileSystem.getInfoAsync(FileSystem.documentDirectory + KEY);
        if (!info.exists) return null;
        return FileSystem.readAsStringAsync(FileSystem.documentDirectory + KEY, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } catch {
        return null;
      }
    },
  };
}

// ─── Singleton bridge ─────────────────────────────────────────────────────────

const _mapStore = createCalendarMapStore(createFileSystemMapStorage());
const _settings = createDeviceCalendarSettings(createFileSystemSettingsStorage());
const _queue    = createDeviceCalendarQueue();

/**
 * Production bridge singleton. Wired to the real expo-calendar gateway.
 * Starts fail-closed (consent='unknown') until syncCalendarBridgeConsentFromStore
 * is called after the consent cache is loaded.
 */
export const deviceCalendarBridge = createDeviceCalendarBridge({
  gateway:             expoCalendarGatewayImpl,
  mapStore:            _mapStore,
  settings:            _settings,
  queue:               _queue,
  // Start fail-closed: consentStore not yet loaded at module-eval time.
  // syncCalendarBridgeConsentFromStore() opens the gate after cache restore.
  consentSnapshot:     { calendarSync: { status: 'unknown' }, generalHealth: { status: 'unknown' } },
  osPermissionGranted: false, // updated by checkAndUpdateOsPermission() at app startup
  postConsent:         _delegatingPostConsent,
});

// ─── Public helpers called from App.tsx ──────────────────────────────────────

/**
 * Wire the appointment observer to the module-level calendarSyncStore singleton.
 * Call ONCE at app startup (before any appointments can be created/edited).
 * Returns the unsubscribe fn (store it if hot-reload teardown is needed).
 */
export function attachCalendarObserver(): () => void {
  return attachAppointmentCalendarObserver(calendarSyncStore, deviceCalendarBridge);
}

/**
 * Load calendarMapStore and deviceCalendarSettings from durable storage (BLOCKER 3 fix).
 *
 * Call at app startup BEFORE any write path runs so the map knows which
 * appointments were already synced to the native calendar. Without this, each
 * relaunch empties the map and backfillCalendarFromStore() creates duplicate events.
 *
 * Also syncs the bridge's feature-toggle gate with the persisted featureEnabled
 * value so the gate is correctly open/closed without waiting for a network refresh.
 *
 * Idempotent: safe to call multiple times (subsequent calls re-apply loaded state).
 */
export async function initCalendarPersistenceFromStorage(): Promise<void> {
  // Load both concurrently
  await Promise.all([
    _mapStore.loadFromStorage(),
    _settings.loadFromStorage(),
  ]);
  // Sync bridge gate with the persisted feature state.
  // This does not persist again (bridge.updateFeatureToggle writes to settings,
  // which fires save — but saves the same value, so harmless).
  deviceCalendarBridge.updateFeatureToggle(_settings.get().featureEnabled);
}

/**
 * Sync the bridge's consent snapshot from the in-memory consentStore.
 * Call after consentStore.loadFromStorage() completes so the bridge opens
 * the gate for users who previously granted consent (CAL-GATE-FRESH Option B).
 *
 * Also call after any consent change (grant / withdrawal) so the bridge gate
 * reflects the new state without waiting for the next scheduled refresh.
 */
export function syncCalendarBridgeConsentFromStore(): void {
  deviceCalendarBridge.updateConsentSnapshot(buildConsentSnapshot());
}

/**
 * Call this after GET /account/consents returns (server consent refresh).
 * Triggers self-heal cleanup if withdrawal is discovered (CAL-SA-30/31/32).
 *
 * Unlike syncCalendarBridgeConsentFromStore (which just updates the snapshot),
 * this also checks for the transition from granted → withdrawn and runs the
 * async cleanup path (delete all app-created native events) if needed.
 */
export async function refreshCalendarBridgeConsent(): Promise<void> {
  await deviceCalendarBridge.onConsentRefreshResult(buildConsentSnapshot());
}

/**
 * Check the current OS calendar permission and update the bridge.
 * Call on app foreground to detect post-install revocations.
 * Returns true if permission is granted; false otherwise.
 *
 * Note: this performs a UI-permission-check (not a prompt). If denied, the
 * bridge's delete path is still always-available (path B — compliance MUST-1).
 */
export async function checkAndUpdateOsPermission(): Promise<boolean> {
  try {
    const { granted } = await expoCalendarGatewayImpl.checkPermission();
    _lastKnownOsPermission = granted;
    // If OS permission was revoked while the feature was enabled, update the gate.
    // The bridge self-heals on the next failed write; this closes the create-path
    // gate immediately so no new events are attempted until the user restores access.
    if (!granted && _settings.get().featureEnabled) {
      deviceCalendarBridge.updateFeatureToggle(false);
    } else if (granted && _settings.get().featureEnabled) {
      // Re-open the gate if OS permission was restored in system settings
      deviceCalendarBridge.updateFeatureToggle(true);
    }
    return granted;
  } catch {
    return false;
  }
}

/**
 * Backfill future not-done appointments into the device calendar.
 * Call immediately after a successful enableFeature() call (first-enable path).
 * CAL-SA-40: only future+not-done appointments are eligible.
 *
 * @param todayCivilDate  "YYYY-MM-DD" civil date used as the recency cutoff.
 */
export async function backfillCalendarFromStore(todayCivilDate: string): Promise<void> {
  const items = calendarSyncStore.getActiveChecklistItems();
  const appts = items
    .filter(item => item.category === 'appointment' && item.scheduledAt)
    .map(item => ({
      id:          item.id,
      category:    item.category,
      title:       item.title,
      scheduledAt: item.scheduledAt!,
      note:        item.note ?? '',
      source:      item.source ?? 'user_created' as const,
      done:        item.done,
    }));

  await deviceCalendarBridge.backfillFuture(appts, todayCivilDate);
}

/**
 * Change the calendar privacy level and re-mask all existing synced events.
 * Wraps bridge.onPrivacyLevelChanged() with a getAppointment resolver that
 * reads from the calendarSyncStore (the production store holding all appointments).
 *
 * Call this from the navigator's onLevelSelected handler.
 * Trace: AC-5.2 full-field re-mask sweep, CAL-SA-20/21/22.
 */
export async function changePrivacyLevel(
  newLevel: PrivacyLevel,
): Promise<{ failedCount: number }> {
  const getAppointment = (id: string): AppointmentInput | undefined => {
    const item = calendarSyncStore.getChecklistItem(id);
    if (!item || item.category !== 'appointment' || item.deletedAt) return undefined;
    return {
      id:          item.id,
      category:    item.category,
      title:       item.title,
      scheduledAt: item.scheduledAt ?? '2000-01-01T00:00',
      note:        item.note ?? '',
      source:      item.source ?? 'user_created',
      done:        item.done,
    };
  };

  return deviceCalendarBridge.onPrivacyLevelChanged(newLevel, getAppointment);
}

/**
 * Read the current calendar-sync state for display in the settings screen.
 * Returns a snapshot of featureEnabled, privacyLevel, consentGranted, and
 * the last-known OS permission state (updated by checkAndUpdateOsPermission).
 *
 * This is a pure read — no side effects.
 */
export function getCalendarSyncSnapshot(): {
  featureEnabled:       boolean;
  privacyLevel:         PrivacyLevel;
  consentGranted:       boolean;
  osPermissionGranted:  boolean;
} {
  const settings = _settings.get();
  const calConsent = consentStore.getState().calendar_sync;
  return {
    featureEnabled:      settings.featureEnabled,
    privacyLevel:        settings.privacyLevel,
    consentGranted:      calConsent?.granted ?? false,
    osPermissionGranted: _lastKnownOsPermission,
  };
}
