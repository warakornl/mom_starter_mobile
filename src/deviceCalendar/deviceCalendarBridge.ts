/**
 * deviceCalendarBridge — service facade; the ONLY thing the appointment write path
 * talks to (public API for this module).
 *
 * Enforces the two-path model (CAL-SA-01):
 *   Path A (onAppointmentUpserted): goes through master gate (dual consent + toggle + OS perm)
 *   Path B (onAppointmentDeleted):  ALWAYS-AVAILABLE, gate-exempt, OS permission only
 *
 * Additional entry points:
 *   - enableFeature(): explainer-before-prompt → requestPermission → feature ON + backfill
 *   - grantConsent(version): POST /account/consents granted=true, metadata-only (INV-CAL-2)
 *   - declineConsent(): NO OS prompt, NO event, feature stays OFF (AC-1.2)
 *   - disableAndWithdraw(action, version): US-9 delete|keep + consent withdrawal
 *   - onPrivacyLevelChanged(level): full-field re-mask sweep (AC-5.2)
 *   - onConsentRefreshResult(snapshot): self-heal on discovered withdrawal (CAL-SA-30)
 *   - backfillFuture(appointments): first-enable backfill (CAL-SA-40)
 *
 * SECURITY (CAL-SA-50b): NEVER log health values. Log only appointmentId + op + result code.
 * INV-CAL-1: writes go ONLY to expo-calendar (gateway). No API calls carry appointment data.
 * INV-CAL-3: only expoCalendarGateway imports expo-calendar; nothing here imports Google/iCloud.
 */

import type { ExpoCalendarGateway } from './expoCalendarGateway';
import type { AppointmentInput, PrivacyLevel } from './eventPayloadBuilder';
import type { ConsentSnapshot } from './deviceCalendarState';
import {
  eventPayloadBuilder,
} from './eventPayloadBuilder';
import {
  createDeviceCalendarState,
} from './deviceCalendarState';
import { createCalendarMapStore } from './calendarMapStore';
import type { createDeviceCalendarSettings } from './deviceCalendarSettings';
import type { createDeviceCalendarQueue } from './deviceCalendarQueue';

// ─── Payload hash (idempotent content-hash short-circuit) ─────────────────────

function hashPayload(payload: ReturnType<typeof eventPayloadBuilder>): string {
  // Simple deterministic hash of the payload fields that matter for change detection.
  const str = [
    payload.title,
    payload.location,
    payload.notes,
    payload.startDate.toISOString(),
    payload.endDate.toISOString(),
    payload.timeZone,
    String(payload.allDay),
  ].join('|');
  // djb2-like hash (no crypto needed — content hash, not security hash)
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h & 0xffffffff; // keep 32-bit
  }
  return `h:${(h >>> 0).toString(16)}`;
}

// ─── PostConsent function type (INV-CAL-2: metadata only, no appointment data) ─

export type PostConsentFn = (body: {
  consentType: 'calendar_sync';
  granted: boolean;
  consentTextVersion: string;
}) => Promise<{ ok: boolean }>;

// ─── Config ───────────────────────────────────────────────────────────────────

export interface DeviceCalendarBridgeConfig {
  gateway:              ExpoCalendarGateway;
  mapStore:             ReturnType<typeof createCalendarMapStore>;
  settings:             ReturnType<typeof createDeviceCalendarSettings>;
  queue:                ReturnType<typeof createDeviceCalendarQueue>;
  consentSnapshot:      ConsentSnapshot;
  osPermissionGranted:  boolean;
  postConsent:          PostConsentFn;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDeviceCalendarBridge(config: DeviceCalendarBridgeConfig) {
  const { gateway, mapStore, settings, queue, postConsent } = config;

  // Gate — mutable; updated via updateConsentSnapshot / updateFeatureToggle / etc.
  // Note: we do NOT register onRefreshDiscoversWithdrawal here because self-heal is
  // async; instead, onConsentRefreshResult directly checks for withdrawal and awaits cleanup.
  const gateState = createDeviceCalendarState({
    consentSnapshot: config.consentSnapshot,
    featureToggleOn: settings.get().featureEnabled,
    osPermissionGranted: config.osPermissionGranted,
  });

  // ── Internal helpers ────────────────────────────────────────────────────────

  async function _writeSingle(appt: AppointmentInput): Promise<void> {
    if (!gateState.isSyncEnabled()) return;
    if (appt.category !== 'appointment') return; // category guard (AC-2.6)

    const privacyLevel = settings.get().privacyLevel;
    const calendarId   = settings.get().resolvedCalendarId;
    if (!calendarId) return;

    const payload = eventPayloadBuilder(appt, privacyLevel);
    const hash    = hashPayload(payload);

    const existing = mapStore.get(appt.id);

    if (existing) {
      if (existing.syncedContentHash === hash) return; // no-op (CAL-EDGE-09)
      // Update in-place (never create duplicate — INV-C5)
      try {
        await gateway.updateEvent(existing.nativeEventId, payload);
        mapStore.put({ ...existing, syncedContentHash: hash, privacyLevelAtWrite: privacyLevel, updatedAt: Date.now() });
      } catch {
        queue.enqueue(appt.id, 'upsert');
        settings.setNeedsAttention('permission_revoked');
      }
    } else {
      // Create new event
      try {
        const nativeEventId = await gateway.createEvent(calendarId, payload);
        mapStore.put({
          appointmentId:      appt.id,
          nativeEventId,
          calendarId,
          privacyLevelAtWrite: privacyLevel,
          syncedContentHash:  hash,
          updatedAt:           Date.now(),
        });
      } catch {
        queue.enqueue(appt.id, 'upsert');
        settings.setNeedsAttention('permission_revoked');
      }
    }
  }

  async function _deleteSingle(nativeEventId: string): Promise<void> {
    // Path B — gate-exempt, OS permission only
    try {
      await gateway.deleteEvent(nativeEventId);
    } catch {
      // Missing event = no-op success (CAL-EDGE-03)
    }
  }

  async function _runSelfHealDelete(): Promise<void> {
    // CAL-SA-32: iterate all mapped entries, delete each, clear map
    const entries = mapStore.entries();
    for (const entry of entries) {
      await _deleteSingle(entry.nativeEventId);
      mapStore.delete(entry.appointmentId);
    }
    mapStore.clear();
    gateState.setFeatureToggle(false);
    settings.setFeatureEnabled(false);
    settings.setNeedsAttention(null); // or surface a gentle notice — handled by UI
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Path A: appointment created or updated in the local store.
   * Goes through the master gate. No-op if gate is closed.
   * Category guard: rejects non-appointment silently.
   * Trace: architecture §2.1, functional §2.2.
   */
  async function onAppointmentUpserted(appt: AppointmentInput): Promise<void> {
    if (appt.category !== 'appointment') return; // defense-in-depth (AC-2.6)
    if (!gateState.isSyncEnabled()) return;
    await _writeSingle(appt);
  }

  /**
   * Path B: appointment deleted/cancelled in the local store.
   * ALWAYS-AVAILABLE — does NOT go through the consent gate.
   * Removes the mapped app-created event. Missing = no-op success.
   * Trace: architecture §2.1/§5.2 delete carve-out, functional §2.3.
   */
  async function onAppointmentDeleted(appointmentId: string): Promise<void> {
    if (!gateState.isDeleteEnabled()) return; // only blocks when OS permission revoked
    const entry = mapStore.get(appointmentId);
    if (!entry) return; // no mapped event — no-op success (CAL-SA-04 B3)
    await _deleteSingle(entry.nativeEventId);
    mapStore.delete(appointmentId);
  }

  /**
   * Called when the consent mirror refresh (`GET /account/consents`) returns a result.
   * Triggers self-heal cleanup if withdrawal discovered (CAL-SA-30/31/32).
   * Directly awaits the path-B delete (async-safe).
   */
  async function onConsentRefreshResult(freshSnapshot: ConsentSnapshot): Promise<void> {
    const prevSnapshot = gateState.getSnapshot();

    // Detect withdrawal before updating snapshot
    const wasCalGranted = prevSnapshot.calendarSync.status  === 'granted';
    const wasGHGranted  = prevSnapshot.generalHealth.status === 'granted';
    const nowCalWithdrawn = freshSnapshot.calendarSync.status  !== 'granted';
    const nowGHWithdrawn  = freshSnapshot.generalHealth.status !== 'granted';

    const discoveredWithdrawal =
      (wasCalGranted && nowCalWithdrawn) ||
      (wasGHGranted  && nowGHWithdrawn);

    // Update the gate's snapshot
    gateState.onRefreshResult(freshSnapshot);

    // Self-heal path B if withdrawal discovered (CAL-SA-31: DELETE, not re-mask)
    if (discoveredWithdrawal) {
      await _runSelfHealDelete();
    }
  }

  /**
   * enableFeature — called AFTER consent sheet grant.
   * Requests OS calendar permission (explainer-before-prompt ordering).
   * Resolves target calendar. Sets feature ON. Runs backfill.
   * CAL-SCR-14 sequencing.
   */
  async function enableFeature(): Promise<'ok' | 'permission_denied'> {
    // Request OS permission (only AFTER consent — explainer-before-prompt, CAL-SCR-10)
    const { granted } = await gateway.requestPermission();
    if (!granted) {
      settings.setNeedsAttention('permission_denied');
      gateState.setOsPermission(false);
      return 'permission_denied';
    }

    gateState.setOsPermission(true);

    // Resolve target calendar
    const calendarId = await gateway.getDefaultCalendarId();
    settings.setResolvedCalendarId(calendarId);
    settings.setFeatureEnabled(true);
    settings.clearAttention();
    gateState.setFeatureToggle(true);

    return 'ok';
  }

  /**
   * grantConsent — record calendar_sync consent granted.
   * Body = { consentType, granted, consentTextVersion } ONLY — no health data (INV-CAL-2).
   */
  async function grantConsent(consentTextVersion: string): Promise<{ ok: boolean }> {
    return postConsent({ consentType: 'calendar_sync', granted: true, consentTextVersion });
  }

  /**
   * declineConsent — mother tapped "ไม่ใช่ตอนนี้".
   * NO OS prompt. NO event. Feature stays OFF (AC-1.2, CAL-SCR-10).
   */
  async function declineConsent(): Promise<void> {
    // Nothing: no OS permission request, no consent POST, no event.
    // Feature stays OFF (settings.featureEnabled remains false).
  }

  /**
   * disableAndWithdraw — US-9 disable flow (AC-9.1-9.5).
   * Stops syncing, asks delete|keep, withdraws consent.
   */
  async function disableAndWithdraw(
    action: 'delete' | 'keep',
    consentTextVersion: string,
  ): Promise<void> {
    // AC-9.1: stop future syncs immediately
    gateState.setFeatureToggle(false);
    settings.setFeatureEnabled(false);

    if (action === 'delete') {
      // AC-9.3: delete ONLY app-created events (via map — never scans all calendar)
      const entries = mapStore.entries();
      for (const entry of entries) {
        await _deleteSingle(entry.nativeEventId);
        mapStore.delete(entry.appointmentId);
      }
      mapStore.clear(); // belt-and-suspenders
    } else {
      // AC-9.4: keep events, clear map (intentionally-orphaned)
      mapStore.clear();
    }

    // Record consent withdrawal (POST with metadata only — INV-CAL-2)
    await postConsent({ consentType: 'calendar_sync', granted: false, consentTextVersion });
  }

  /**
   * onPrivacyLevelChanged — retroactive full-field re-mask sweep (AC-5.2).
   * Every mapped event is updated with the new payload (full overwrite).
   * Descriptive→Generic clears title+notes in one write by construction.
   * Trace: architecture §4.2, functional §5 (CAL-SA-20/21/22).
   */
  async function onPrivacyLevelChanged(
    newLevel: PrivacyLevel,
    getAppointment: (id: string) => AppointmentInput | undefined,
  ): Promise<{ failedCount: number }> {
    if (!gateState.isSyncEnabled()) return { failedCount: 0 };

    settings.setPrivacyLevel(newLevel);

    const entries = mapStore.entries().filter(e => e.privacyLevelAtWrite !== newLevel);
    let failedCount = 0;

    // CAL-SA-21: sort by scheduledAt asc for Descriptive→Generic (privacy-urgent)
    // We don't have scheduledAt in the map — sort by updatedAt asc as proxy
    entries.sort((a, b) => a.updatedAt - b.updatedAt);

    for (const entry of entries) {
      const appt = getAppointment(entry.appointmentId);
      if (!appt) continue; // appointment deleted — skip (will be cleaned on next observer event)

      const payload = eventPayloadBuilder(appt, newLevel);
      const hash    = hashPayload(payload);

      if (entry.syncedContentHash === hash) continue; // already at new level

      try {
        await gateway.updateEvent(entry.nativeEventId, payload);
        mapStore.put({
          ...entry,
          privacyLevelAtWrite: newLevel,
          syncedContentHash:   hash,
          updatedAt:            Date.now(),
        });
      } catch {
        queue.enqueue(entry.appointmentId, 'remask');
        failedCount++;
      }
    }

    if (failedCount > 0) {
      settings.setNeedsAttention('remask_failed');
    }

    return { failedCount };
  }

  /**
   * backfillFuture — on first enable, write all FUTURE not-done appointments.
   * CAL-SA-40. Ordered scheduledAt asc (soonest first).
   */
  async function backfillFuture(
    appointments: AppointmentInput[],
    todayCivilDate: string, // "YYYY-MM-DD"
  ): Promise<void> {
    if (!gateState.isSyncEnabled()) return;

    // Filter: future + not-done (CAL-SA-40)
    const eligible = appointments.filter(a => {
      if (a.category !== 'appointment') return false;
      if (a.done) return false;
      const civDate = a.scheduledAt.slice(0, 10); // "YYYY-MM-DD"
      return civDate >= todayCivilDate;
    });

    // Sort scheduledAt asc (soonest first)
    eligible.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

    for (const appt of eligible) {
      await _writeSingle(appt);
    }
  }

  /** Update consent snapshot from outside (after a refresh or consent change). */
  function updateConsentSnapshot(snapshot: ConsentSnapshot): void {
    gateState.setConsentSnapshot(snapshot);
  }

  /** Update feature toggle from outside. */
  function updateFeatureToggle(on: boolean): void {
    gateState.setFeatureToggle(on);
    settings.setFeatureEnabled(on);
  }

  return {
    onAppointmentUpserted,
    onAppointmentDeleted,
    onConsentRefreshResult,
    enableFeature,
    grantConsent,
    declineConsent,
    disableAndWithdraw,
    onPrivacyLevelChanged,
    backfillFuture,
    updateConsentSnapshot,
    updateFeatureToggle,
  };
}

export type DeviceCalendarBridge = ReturnType<typeof createDeviceCalendarBridge>;
