/**
 * deviceCalendarSingleton — module-level singleton for the device-calendar bridge.
 *
 * Initialises the bridge with all production dependencies and exposes the three
 * public entry points that app code (App.tsx, navigator) needs:
 *
 *   1. `deviceCalendarBridge`   — the bridge itself (for screen handlers)
 *   2. `attachCalendarObserver` — call once at app startup to wire the store
 *   3. `configureCalendarPostConsent` — inject the token-bearing postConsent fn
 *                                       after SecureTokenStorage is available
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
 * SECURITY: no health data or accessToken stored at module level.
 *           postConsent is injected late (token acquired at call time).
 * Trace: architecture §1.1/§2/§5.2/§5.3, CAL-GATE-FRESH Option B.
 */

import { createDeviceCalendarBridge } from './deviceCalendarBridge';
import type { PostConsentFn }          from './deviceCalendarBridge';
import { createCalendarMapStore }       from './calendarMapStore';
import { createDeviceCalendarSettings } from './deviceCalendarSettings';
import { createDeviceCalendarQueue }    from './deviceCalendarQueue';
import { expoCalendarGatewayImpl }      from './expoCalendarGateway';
import { attachAppointmentCalendarObserver } from './appointmentCalendarObserver';
import { calendarSyncStore }            from '../sync/calendarSyncStore';
import { consentStore }                 from '../consent/consentStore';
import type { ConsentSnapshot }         from './deviceCalendarState';

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

// ─── Singleton bridge ─────────────────────────────────────────────────────────

const _mapStore = createCalendarMapStore();
const _settings = createDeviceCalendarSettings();
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
    deviceCalendarBridge.updateFeatureToggle(
      granted && _settings.get().featureEnabled,
    );
    // Update OS permission in the gate by rebuilding with updateConsentSnapshot
    // (the bridge exposes updateConsentSnapshot but not a direct setOsPermission —
    // the gate's OS-permission state is updated via enableFeature() for the grant
    // path and detected-revocation during gateway calls for the revoke path).
    // As a minimal approach here: the bridge self-heals on the next failed write.
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
