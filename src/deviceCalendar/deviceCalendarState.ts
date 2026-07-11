/**
 * deviceCalendarState — master gate (CAL-GATE-FRESH Option B)
 *
 * Implements the dual consent gate for the device calendar sync feature.
 *
 *   syncEnabled = calendar_sync ∧ general_health ∧ featureToggleOn ∧ osPermissionGranted
 *
 * CAL-GATE-FRESH Option B (architecture §5.2, compliance §1.3 step 2):
 *   - OPEN on positively-CACHED `granted` for BOTH consents (works offline — AC-2.4).
 *   - FAIL-CLOSED on genuinely UNKNOWN/uncached (never fetched).
 *   - Opportunistic refresh (foreground + regaining connectivity); refresh failure
 *     does NOT block the write.
 *   - Refresh discovers withdrawal → triggers path-B cleanup callback (self-heal).
 *
 * Delete path (always-available, gate-exempt):
 *   - isDeleteEnabled() checks ONLY OS permission — not consent, not toggle.
 *   - Consent withdrawal must NEVER block deletion (compliance MUST-1).
 *
 * Trace: architecture §5.2, compliance §1.3, functional §2.1.
 * SECURITY: NEVER log appointment content — logs only consent status.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConsentStatus = 'granted' | 'withdrawn' | 'unknown';

export interface ConsentSnapshot {
  calendarSync:  { status: ConsentStatus };
  generalHealth: { status: ConsentStatus };
}

export type GateClock = () => number; // epoch ms; injectable for testing

export interface DeviceCalendarStateConfig {
  consentSnapshot:              ConsentSnapshot;
  featureToggleOn:              boolean;
  osPermissionGranted:          boolean;
  /** True if device is currently online. Defaults to true. */
  isOnline?:                    boolean;
  /** True if the last consent refresh failed (stale-granted is still open). Defaults to false. */
  lastRefreshFailed?:           boolean;
  /**
   * Callback invoked when an onRefreshResult() call discovers that one or both
   * consents changed from granted to withdrawn.
   * Receives the list of consent keys that were found withdrawn.
   * This is the trigger for path-B cleanup (CAL-SA-30/32).
   */
  onRefreshDiscoversWithdrawal?: (withdrawnKeys: Array<'calendar_sync' | 'general_health'>) => void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDeviceCalendarState(config: DeviceCalendarStateConfig) {
  let _snapshot: ConsentSnapshot = config.consentSnapshot;
  let _featureToggleOn: boolean  = config.featureToggleOn;
  let _osPermission: boolean     = config.osPermissionGranted;
  const _onWithdrawal = config.onRefreshDiscoversWithdrawal;

  /**
   * Path A gate (create/update) — dual-gate, CAL-GATE-FRESH Option B.
   *
   * Opens on:  both consents positively-CACHED `granted` + toggle on + OS permission.
   * Closes on: EITHER consent is `unknown` (never fetched) OR `withdrawn`, OR toggle off,
   *            OR OS permission denied.
   *
   * Offline is NOT a reason to close (AC-2.4, Option B).
   * A failed refresh is NOT a reason to close (stale-granted still opens).
   */
  function isSyncEnabled(): boolean {
    if (_snapshot.calendarSync.status  !== 'granted') return false;
    if (_snapshot.generalHealth.status !== 'granted') return false;
    if (!_featureToggleOn)  return false;
    if (!_osPermission)     return false;
    return true;
  }

  /**
   * Path B gate (delete/erasure-cleanup) — ALWAYS-AVAILABLE, consent-exempt.
   *
   * Only OS calendar permission gates deletion (the app needed permission when
   * it created the event; if permission was revoked since then, deletion is a no-op).
   * Consent state, toggle, and online state do NOT block deletion.
   *
   * "fail-safe = err TOWARD erasure" (compliance §1.3, architecture §5.2 delete carve-out).
   */
  function isDeleteEnabled(): boolean {
    // Only OS permission gates deletion — not consent, not toggle, not online state.
    return _osPermission;
  }

  /**
   * Called when a consent mirror refresh (`GET /account/consents`) completes.
   * Detects stale-granted → withdrawal transitions and invokes the self-heal callback.
   * Updates the internal snapshot.
   *
   * Trace: CAL-GATE-FRESH Option B, CAL-SA-30/31/32.
   */
  function onRefreshResult(freshSnapshot: ConsentSnapshot): void {
    const withdrawnKeys: Array<'calendar_sync' | 'general_health'> = [];

    // Detect withdrawal transitions (was granted, now NOT granted)
    if (
      _snapshot.calendarSync.status  === 'granted' &&
      freshSnapshot.calendarSync.status  !== 'granted'
    ) {
      withdrawnKeys.push('calendar_sync');
    }
    if (
      _snapshot.generalHealth.status === 'granted' &&
      freshSnapshot.generalHealth.status !== 'granted'
    ) {
      withdrawnKeys.push('general_health');
    }

    // Update snapshot
    _snapshot = freshSnapshot;

    // Trigger self-heal cleanup if withdrawal discovered
    if (withdrawnKeys.length > 0 && _onWithdrawal) {
      _onWithdrawal(withdrawnKeys);
    }
  }

  /**
   * Update the feature toggle (called when mother enables/disables in settings).
   */
  function setFeatureToggle(on: boolean): void {
    _featureToggleOn = on;
  }

  /**
   * Update OS calendar permission status (called on permission check / revoke detection).
   */
  function setOsPermission(granted: boolean): void {
    _osPermission = granted;
  }

  /**
   * Update the consent snapshot (called after a successful consent refresh
   * or after recording a local grant/withdrawal).
   */
  function setConsentSnapshot(snapshot: ConsentSnapshot): void {
    _snapshot = snapshot;
  }

  return {
    isSyncEnabled,
    isDeleteEnabled,
    onRefreshResult,
    setFeatureToggle,
    setOsPermission,
    setConsentSnapshot,
    /** Read-only access to current snapshot (for testing / debugging). */
    getSnapshot: (): ConsentSnapshot => _snapshot,
  };
}
