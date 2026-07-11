/**
 * deviceCalendarState — master gate tests (CAL-GATE-FRESH Option B)
 *
 * HARD INVARIANTS (each must be a genuine fail-on-revert — removing the guard makes it RED):
 *
 *   (a) UNKNOWN/uncached consent → NO calendar write (fail-closed)
 *   (b) Offline + cached-granted → write SUCCEEDS (AC-2.4)
 *   (c) Refresh discovers withdrawal → path-B cleanup runs (self-heal)
 *   (d) DELETE always works even when consent withdrawn/offline (gate-exempt)
 *   (e) calendar_sync ∧ general_health both required (withdraw general_health → no write)
 *
 * Trace: architecture §5.2, compliance §1.3, functional §2.2.
 */

import { createDeviceCalendarState } from '../deviceCalendarState';
import type { ConsentSnapshot, GateClock } from '../deviceCalendarState';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function grantedSnapshot(): ConsentSnapshot {
  return {
    calendarSync:  { status: 'granted' },
    generalHealth: { status: 'granted' },
  };
}

function unknownSnapshot(): ConsentSnapshot {
  return {
    calendarSync:  { status: 'unknown' },
    generalHealth: { status: 'unknown' },
  };
}

function withdrawnCalSyncSnapshot(): ConsentSnapshot {
  return {
    calendarSync:  { status: 'withdrawn' },
    generalHealth: { status: 'granted' },
  };
}

function withdrawnGeneralHealthSnapshot(): ConsentSnapshot {
  return {
    calendarSync:  { status: 'granted' },
    generalHealth: { status: 'withdrawn' },
  };
}

// ─── (a) UNKNOWN/uncached → fail-closed NO WRITE ─────────────────────────────

describe('deviceCalendarState — (a) UNKNOWN/uncached → fail-closed', () => {
  it('isSyncEnabled returns false when both consents are unknown', () => {
    const state = createDeviceCalendarState({ consentSnapshot: unknownSnapshot(), featureToggleOn: true, osPermissionGranted: true });
    expect(state.isSyncEnabled()).toBe(false);
  });

  it('isSyncEnabled returns false when calendar_sync is unknown even if general_health granted', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: { calendarSync: { status: 'unknown' }, generalHealth: { status: 'granted' } },
      featureToggleOn: true,
      osPermissionGranted: true,
    });
    expect(state.isSyncEnabled()).toBe(false);
  });

  it('isSyncEnabled returns false when general_health is unknown even if calendar_sync granted', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: { calendarSync: { status: 'granted' }, generalHealth: { status: 'unknown' } },
      featureToggleOn: true,
      osPermissionGranted: true,
    });
    expect(state.isSyncEnabled()).toBe(false);
  });

  // FAIL-ON-REVERT: removing the unknown-check would flip these to true
  it('FAIL-ON-REVERT: if the guard were removed unknown would pass — guard is load-bearing', () => {
    // This test passes exactly because isSyncEnabled returns false for unknown.
    // If the implementation ignored the 'unknown' status and treated it as 'granted',
    // these tests would fail (RED), proving the guard is load-bearing.
    const state = createDeviceCalendarState({ consentSnapshot: unknownSnapshot(), featureToggleOn: true, osPermissionGranted: true });
    const result = state.isSyncEnabled();
    expect(result).toBe(false); // Must be false — never true on unknown
  });
});

// ─── (b) Offline + cached-granted → write SUCCEEDS (AC-2.4) ─────────────────

describe('deviceCalendarState — (b) offline + cached-granted → write succeeds', () => {
  it('isSyncEnabled returns true when both consents are cached-granted, even with no network', () => {
    // Offline = no network; cached-granted = we already know both are granted
    // The gate must open (write proceeds) — failing refresh does NOT block the write.
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      isOnline: false, // explicitly offline
    });
    expect(state.isSyncEnabled()).toBe(true);
  });

  it('isSyncEnabled returns true even when last refresh failed (stale-granted still open)', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      lastRefreshFailed: true, // refresh failure must NOT block
    });
    expect(state.isSyncEnabled()).toBe(true);
  });

  // FAIL-ON-REVERT: if offline blocked writes, AC-2.4 would be violated
  it('FAIL-ON-REVERT: offline-blocked gate would return false here — guard allows offline', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      isOnline: false,
    });
    // Must be true (offline write allowed); a guard that checked isOnline===true would fail this
    expect(state.isSyncEnabled()).toBe(true);
  });
});

// ─── (c) Stale-granted → refresh discovers withdrawal → cleanup callback fires ─

describe('deviceCalendarState — (c) self-heal on discovered withdrawal', () => {
  it('onRefreshDiscoversWithdrawal callback is invoked when refresh finds calendar_sync withdrawn', () => {
    const cleanupSpy = jest.fn();
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(), // cached as granted
      featureToggleOn: true,
      osPermissionGranted: true,
      onRefreshDiscoversWithdrawal: cleanupSpy,
    });

    // Simulate refresh response that shows calendar_sync withdrawn
    state.onRefreshResult(withdrawnCalSyncSnapshot());

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).toHaveBeenCalledWith(['calendar_sync']);
  });

  it('onRefreshDiscoversWithdrawal is invoked when general_health is withdrawn', () => {
    const cleanupSpy = jest.fn();
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      onRefreshDiscoversWithdrawal: cleanupSpy,
    });

    state.onRefreshResult(withdrawnGeneralHealthSnapshot());

    expect(cleanupSpy).toHaveBeenCalledWith(['general_health']);
  });

  it('after discovering withdrawal, isSyncEnabled returns false', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      onRefreshDiscoversWithdrawal: jest.fn(),
    });

    state.onRefreshResult(withdrawnCalSyncSnapshot());
    expect(state.isSyncEnabled()).toBe(false);
  });

  it('no cleanup when refresh confirms both consents still granted', () => {
    const cleanupSpy = jest.fn();
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      onRefreshDiscoversWithdrawal: cleanupSpy,
    });

    // Refresh confirms granted (no change)
    state.onRefreshResult(grantedSnapshot());

    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  // FAIL-ON-REVERT: removing the cleanup call would break this
  it('FAIL-ON-REVERT: without withdrawal detection, cleanup would not fire', () => {
    const cleanupSpy = jest.fn();
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      onRefreshDiscoversWithdrawal: cleanupSpy,
    });
    state.onRefreshResult(withdrawnCalSyncSnapshot());
    // If the guard were removed (no detection), cleanupSpy would NOT be called.
    // This assertion proves the guard is load-bearing.
    expect(cleanupSpy).toHaveBeenCalled();
  });
});

// ─── (d) DELETE always works gate-exempt ──────────────────────────────────────

describe('deviceCalendarState — (d) delete is always-available, gate-exempt', () => {
  it('isDeleteEnabled returns true when calendar_sync is withdrawn', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: withdrawnCalSyncSnapshot(),
      featureToggleOn: false,
      osPermissionGranted: true,
    });
    expect(state.isDeleteEnabled()).toBe(true);
  });

  it('isDeleteEnabled returns true when general_health is withdrawn', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: withdrawnGeneralHealthSnapshot(),
      featureToggleOn: false,
      osPermissionGranted: true,
    });
    expect(state.isDeleteEnabled()).toBe(true);
  });

  it('isDeleteEnabled returns true when both consents are unknown', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: unknownSnapshot(),
      featureToggleOn: false,
      osPermissionGranted: true,
    });
    expect(state.isDeleteEnabled()).toBe(true);
  });

  it('isDeleteEnabled returns true even when featureToggleOn is false', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: false,
      osPermissionGranted: true,
    });
    expect(state.isDeleteEnabled()).toBe(true);
  });

  it('isDeleteEnabled returns true even when offline', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
      isOnline: false,
    });
    expect(state.isDeleteEnabled()).toBe(true);
  });

  it('isDeleteEnabled is false only when OS permission is revoked (cannot touch calendar)', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: false, // OS permission is the ONLY gate for delete
    });
    expect(state.isDeleteEnabled()).toBe(false);
  });

  // FAIL-ON-REVERT: if delete went through the consent gate it would return false
  it('FAIL-ON-REVERT: routing delete through consent gate would block US-9 withdrawal cleanup', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: withdrawnCalSyncSnapshot(),
      featureToggleOn: false,
      osPermissionGranted: true,
    });
    // isDeleteEnabled must return TRUE (gate-exempt) — if it checked consent, it would be false
    expect(state.isDeleteEnabled()).toBe(true);
  });
});

// ─── (e) dual-gate: calendar_sync ∧ general_health both required ──────────────

describe('deviceCalendarState — (e) dual-gate both consents required', () => {
  it('isSyncEnabled = false when only calendar_sync granted (general_health unknown)', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: { calendarSync: { status: 'granted' }, generalHealth: { status: 'unknown' } },
      featureToggleOn: true,
      osPermissionGranted: true,
    });
    expect(state.isSyncEnabled()).toBe(false);
  });

  it('isSyncEnabled = false when only general_health granted (calendar_sync unknown)', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: { calendarSync: { status: 'unknown' }, generalHealth: { status: 'granted' } },
      featureToggleOn: true,
      osPermissionGranted: true,
    });
    expect(state.isSyncEnabled()).toBe(false);
  });

  it('isSyncEnabled = true only when BOTH are granted', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
    });
    expect(state.isSyncEnabled()).toBe(true);
  });

  it('isSyncEnabled = false when general_health is withdrawn (closes egress path)', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: withdrawnGeneralHealthSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: true,
    });
    expect(state.isSyncEnabled()).toBe(false);
  });

  // FAIL-ON-REVERT: removing the general_health check would let health data egress without consent
  it('FAIL-ON-REVERT: single-gate (calendar_sync only) would return true here — dual gate is load-bearing', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: { calendarSync: { status: 'granted' }, generalHealth: { status: 'withdrawn' } },
      featureToggleOn: true,
      osPermissionGranted: true,
    });
    // Must be false; a single-gate implementation would return true
    expect(state.isSyncEnabled()).toBe(false);
  });
});

// ─── Toggle + OS permission also gate ─────────────────────────────────────────

describe('deviceCalendarState — toggle + OS permission', () => {
  it('isSyncEnabled = false when featureToggleOn is false', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: false,
      osPermissionGranted: true,
    });
    expect(state.isSyncEnabled()).toBe(false);
  });

  it('isSyncEnabled = false when OS permission is denied', () => {
    const state = createDeviceCalendarState({
      consentSnapshot: grantedSnapshot(),
      featureToggleOn: true,
      osPermissionGranted: false,
    });
    expect(state.isSyncEnabled()).toBe(false);
  });
});
