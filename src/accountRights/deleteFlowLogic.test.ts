/**
 * deleteFlowLogic — unit tests (TDD, written BEFORE implementation).
 *
 * Tests the pure delete-gate state machine with all adapters mocked.
 * No device, no network, no native module — all deps injected.
 *
 * Spec references:
 *   account-rights-behavior.md §3 (state machine), §3.2 (transitions),
 *   §3.3 (invariants), §3.5 (enrolled-level routing), §3.7 (floor persistence),
 *   E-17..E-22, AR-AC-09..18, AR-AC-26..28.
 *   delete-account-reauth-ruling.md §2.5 (C-2), rules 2/2b/5.
 *
 * Every named invariant from §3.3 is exercised:
 *   (1) teardown ONLY after 202
 *   (2) every non-success exit = everything unchanged
 *   (3) success===true is the ONLY pass for step-up
 *   (4) anti double-fire: DELETE_IN_FLIGHT emitted before API call
 *   (5) step-up precedes DELETE whenever enrolled (unless stepUpDegraded)
 *   (8) THROW ≠ NONE ≠ non-success; THROW → retry → fail-open; non-success → cancel
 */

import { runDeleteGate } from './deleteFlowLogic';
import type { RunDeleteGateDeps, DeleteMachineState, DegradeTelemetryData } from './deleteFlowLogic';
import { createMockDeviceAuthAdapter, SECURITY_LEVEL_NONE } from './deviceAuthAdapter';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** No-op sleep — skips the 250 ms C-2 backoff in tests. */
const noSleep = async (_ms: number): Promise<void> => {};

/** Records all state transitions emitted via onStateChange. */
function captureStates(): { states: DeleteMachineState[]; cb: (s: DeleteMachineState) => void } {
  const states: DeleteMachineState[] = [];
  return { states, cb: (s) => states.push(s) };
}

/** Builds a deleteAccountApi mock that returns the given result. */
function makeDeleteApi(result: { ok: true } | { ok: false; code: string }) {
  const calls: string[] = [];
  const fn = async (token: string) => {
    calls.push(token);
    return result;
  };
  return { fn, calls };
}

/** Builds a deleteAccountApi mock that throws. */
function makeThrowingDeleteApi(error: string) {
  const fn = async (_token: string): Promise<{ ok: true } | { ok: false; code: string }> => {
    throw new Error(error);
  };
  return { fn };
}

/** Builds a performLogout spy. */
function makeLogoutSpy() {
  let called = false;
  const fn = async () => { called = true; };
  return { fn, wasCalled: () => called };
}

/** Builds a telemetry spy. */
function makeTelemetrySpy() {
  const calls: { event: string; data: DegradeTelemetryData }[] = [];
  const fn = (event: string, data: DegradeTelemetryData) => calls.push({ event, data });
  return { fn, calls };
}

/** Default base deps — enrolled device (BIOMETRIC_STRONG), auth succeeds, DELETE 202. */
function baseDeps(overrides: Partial<RunDeleteGateDeps> = {}): RunDeleteGateDeps {
  return {
    stepUpDegraded: false,
    deviceAuth: createMockDeviceAuthAdapter({ enrolledLevel: 3, authSuccess: true }),
    deleteAccountApi: async () => ({ ok: true }),
    performLogout: async () => {},
    telemetry: () => {},
    getToken: () => 'test-token',
    sleepMs: noSleep,
    ...overrides,
  };
}

// ─── §3.3 Invariant 1: teardown ONLY after 202 ───────────────────────────────

describe('Invariant 1 — teardown only after 202', () => {
  it('performLogout is called when DELETE returns 202 (ok:true)', async () => {
    const logout = makeLogoutSpy();
    await runDeleteGate(baseDeps({ performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(true);
  });

  it('performLogout is NOT called when DELETE returns non-202 (ok:false)', async () => {
    const logout = makeLogoutSpy();
    const deleteApi = makeDeleteApi({ ok: false, code: 'server_error' });
    await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn, performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(false);
  });

  it('performLogout is NOT called when DELETE throws (offline / network error)', async () => {
    const logout = makeLogoutSpy();
    const deleteApi = makeThrowingDeleteApi('Network request failed');
    await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn, performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(false);
  });

  it('performLogout is NOT called when step-up returns non-success (auth cancelled)', async () => {
    const logout = makeLogoutSpy();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3, authSuccess: false });
    await runDeleteGate(baseDeps({ deviceAuth, performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(false);
  });

  it('performLogout is NOT called on NONE device when DELETE fails', async () => {
    const logout = makeLogoutSpy();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: SECURITY_LEVEL_NONE });
    const deleteApi = makeDeleteApi({ ok: false, code: 'network_error' });
    await runDeleteGate(baseDeps({ deviceAuth, deleteAccountApi: deleteApi.fn, performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(false);
  });

  it('performLogout is NOT called on tap (floor satisfied) — invariant confirmed pre-step-up', async () => {
    // This is tested by the auth_cancelled and stepup_degraded paths above;
    // here we verify explicitly that the TEARDOWN state is never emitted
    // unless 202 is received.
    const logout = makeLogoutSpy();
    const stateTracker = captureStates();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3, authSuccess: false });
    await runDeleteGate(baseDeps({ deviceAuth, performLogout: logout.fn, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).not.toContain('TEARDOWN');
    expect(logout.wasCalled()).toBe(false);
  });
});

// ─── §3.5 Enrolled-level routing: NONE vs non-NONE ───────────────────────────

describe('enrolled-level routing (§3.5, AR-AC-10, AR-AC-11, I-1)', () => {
  it('NONE device: authenticate() is NOT called; DELETE proceeds directly', async () => {
    const authenticateCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: SECURITY_LEVEL_NONE,
      authenticateImpl: async (msg) => {
        authenticateCalls.push(msg);
        return { success: true };
      },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(authenticateCalls).toHaveLength(0);
    expect(result.outcome).toBe('delete_success');
  });

  it('NONE device: onStateChange never emits STEPUP_IN_FLIGHT', async () => {
    const stateTracker = captureStates();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: SECURITY_LEVEL_NONE });
    await runDeleteGate(baseDeps({ deviceAuth, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).not.toContain('STEPUP_IN_FLIGHT');
  });

  it('enrolled device (SECRET=1): authenticate() IS called', async () => {
    const authenticateCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 1,
      authenticateImpl: async (msg) => {
        authenticateCalls.push(msg);
        return { success: true };
      },
    });
    await runDeleteGate(baseDeps({ deviceAuth }));
    expect(authenticateCalls).toHaveLength(1);
  });

  it('enrolled device (BIOMETRIC_WEAK=2): authenticate() IS called', async () => {
    const authenticateCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 2,
      authenticateImpl: async (msg) => {
        authenticateCalls.push(msg);
        return { success: true };
      },
    });
    await runDeleteGate(baseDeps({ deviceAuth }));
    expect(authenticateCalls).toHaveLength(1);
  });

  it('enrolled device (BIOMETRIC_STRONG=3): authenticate() IS called', async () => {
    const authenticateCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (msg) => {
        authenticateCalls.push(msg);
        return { success: true };
      },
    });
    await runDeleteGate(baseDeps({ deviceAuth }));
    expect(authenticateCalls).toHaveLength(1);
  });

  it('STEPUP_CHECK state emitted on enrolled device', async () => {
    const stateTracker = captureStates();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3, authSuccess: true });
    await runDeleteGate(baseDeps({ deviceAuth, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).toContain('STEPUP_CHECK');
  });

  it('STEPUP_IN_FLIGHT state emitted before authenticate() on enrolled device', async () => {
    const stateTracker = captureStates();
    let stepUpInFlightBeforeAuth = false;
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (msg) => {
        stepUpInFlightBeforeAuth = stateTracker.states.includes('STEPUP_IN_FLIGHT');
        return { success: true };
      },
    });
    await runDeleteGate(baseDeps({ deviceAuth, onStateChange: stateTracker.cb }));
    expect(stepUpInFlightBeforeAuth).toBe(true);
  });
});

// ─── Authenticate success → DELETE → teardown ─────────────────────────────────

describe('authenticate success → DELETE → delete_success', () => {
  it('outcome is delete_success on 202', async () => {
    const result = await runDeleteGate(baseDeps());
    expect(result.outcome).toBe('delete_success');
  });

  it('DELETE is called with the token from getToken()', async () => {
    const deleteApi = makeDeleteApi({ ok: true });
    await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn, getToken: () => 'myToken' }));
    expect(deleteApi.calls).toEqual(['myToken']);
  });

  it('state sequence: STEPUP_CHECK → STEPUP_IN_FLIGHT → DELETE_IN_FLIGHT → TEARDOWN', async () => {
    const stateTracker = captureStates();
    await runDeleteGate(baseDeps({ onStateChange: stateTracker.cb }));
    expect(stateTracker.states).toEqual(['STEPUP_CHECK', 'STEPUP_IN_FLIGHT', 'DELETE_IN_FLIGHT', 'TEARDOWN']);
  });

  it('NONE device state sequence: STEPUP_CHECK → DELETE_IN_FLIGHT → TEARDOWN', async () => {
    const stateTracker = captureStates();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: SECURITY_LEVEL_NONE });
    await runDeleteGate(baseDeps({ deviceAuth, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).toEqual(['STEPUP_CHECK', 'DELETE_IN_FLIGHT', 'TEARDOWN']);
  });

  it('promptMessage is passed to authenticate()', async () => {
    let capturedMsg = '';
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (msg) => {
        capturedMsg = msg;
        return { success: true };
      },
    });
    await runDeleteGate(baseDeps({ deviceAuth, promptMessage: 'Please confirm' }));
    expect(capturedMsg).toBe('Please confirm');
  });
});

// ─── §3.3 Invariant 3: non-success → auth_cancelled (NOT degraded) ───────────

describe('Invariant 3 — non-success → auth_cancelled, NEVER degraded (rule 5)', () => {
  const nonSuccessErrors = [
    'user_cancel',
    'system_cancel',
    'app_cancel',
    'user_fallback',
    'lockout',
    'authentication_failed',
  ];

  for (const errorCode of nonSuccessErrors) {
    it(`non-success '${errorCode}' → auth_cancelled (no delete, no logout)`, async () => {
      const logout = makeLogoutSpy();
      const deleteApiCalls: string[] = [];
      const deviceAuth = createMockDeviceAuthAdapter({
        enrolledLevel: 3,
        authError: errorCode,
        authSuccess: false,
      });
      const result = await runDeleteGate(baseDeps({
        deviceAuth,
        performLogout: logout.fn,
        deleteAccountApi: async (t) => { deleteApiCalls.push(t); return { ok: true }; },
      }));
      expect(result.outcome).toBe('auth_cancelled');
      expect(deleteApiCalls).toHaveLength(0); // DELETE must NOT be called
      expect(logout.wasCalled()).toBe(false);  // teardown must NOT run
    });
  }

  it('non-success outcome is auth_cancelled (not stepup_degraded — rule 5)', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3, authSuccess: false });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(result.outcome).toBe('auth_cancelled');
    expect(result.outcome).not.toBe('stepup_degraded');
  });
});

// ─── §3.2 / §3.3 Invariant 4: anti double-fire guard ────────────────────────

describe('Invariant 4 — anti double-fire: DELETE_IN_FLIGHT emitted BEFORE API call', () => {
  it('DELETE_IN_FLIGHT is emitted before deleteAccountApi is called', async () => {
    const stateTracker = captureStates();
    let stateAtCallTime: DeleteMachineState[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: SECURITY_LEVEL_NONE });
    const deleteApi = async (_token: string) => {
      // Capture states at the moment DELETE is called
      stateAtCallTime = [...stateTracker.states];
      return { ok: true as const };
    };
    await runDeleteGate(baseDeps({ deviceAuth, deleteAccountApi: deleteApi, onStateChange: stateTracker.cb }));
    expect(stateAtCallTime).toContain('DELETE_IN_FLIGHT');
  });

  it('DELETE is called exactly once per runDeleteGate invocation', async () => {
    const deleteApi = makeDeleteApi({ ok: true });
    await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn }));
    expect(deleteApi.calls).toHaveLength(1);
  });
});

// ─── §3.2 DELETE errors (non-202, offline) ────────────────────────────────────

describe('DELETE error paths (AR-AC-13, E-8)', () => {
  it('non-202 response → delete_error outcome (stays signed in)', async () => {
    const deleteApi = makeDeleteApi({ ok: false, code: 'server_error' });
    const result = await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn }));
    expect(result.outcome).toBe('delete_error');
    expect((result as { outcome: string; code?: string }).code).toBe('server_error');
  });

  it('network throw from deleteAccountApi → delete_error', async () => {
    const deleteApi = makeThrowingDeleteApi('fetch failed');
    const result = await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn }));
    expect(result.outcome).toBe('delete_error');
  });

  it('non-202 → no logout (data intact, stays signed in)', async () => {
    const logout = makeLogoutSpy();
    const deleteApi = makeDeleteApi({ ok: false, code: 'timeout' });
    await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn, performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(false);
  });

  it('network error → no logout', async () => {
    const logout = makeLogoutSpy();
    const deleteApi = makeThrowingDeleteApi('offline');
    await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn, performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(false);
  });

  it('TEARDOWN state NOT emitted on non-202', async () => {
    const stateTracker = captureStates();
    const deleteApi = makeDeleteApi({ ok: false, code: 'server_error' });
    await runDeleteGate(baseDeps({ deleteAccountApi: deleteApi.fn, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).not.toContain('TEARDOWN');
  });
});

// ─── stepUpDegraded=true path (C-2 degrade re-tap) ───────────────────────────

describe('stepUpDegraded=true — skip step-up, go directly to DELETE (§3.2)', () => {
  it('authenticate() is NOT called when stepUpDegraded=true', async () => {
    const authenticateCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (msg) => { authenticateCalls.push(msg); return { success: true }; },
    });
    await runDeleteGate(baseDeps({ stepUpDegraded: true, deviceAuth }));
    expect(authenticateCalls).toHaveLength(0);
  });

  it('getEnrolledLevel() is NOT called when stepUpDegraded=true', async () => {
    const probeCalls: number[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { probeCalls.push(1); return 3; },
    });
    await runDeleteGate(baseDeps({ stepUpDegraded: true, deviceAuth }));
    expect(probeCalls).toHaveLength(0);
  });

  it('DELETE is called directly and outcome is delete_success on 202', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3 }); // enrolled but degraded
    const result = await runDeleteGate(baseDeps({ stepUpDegraded: true, deviceAuth }));
    expect(result.outcome).toBe('delete_success');
  });

  it('state sequence is DELETE_IN_FLIGHT → TEARDOWN (no STEPUP_ states)', async () => {
    const stateTracker = captureStates();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3 });
    await runDeleteGate(baseDeps({ stepUpDegraded: true, deviceAuth, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).not.toContain('STEPUP_CHECK');
    expect(stateTracker.states).not.toContain('STEPUP_IN_FLIGHT');
    expect(stateTracker.states).toContain('DELETE_IN_FLIGHT');
  });
});

// ─── C-2 Probe throw → retry → retry succeeds (blip cleared) ─────────────────

describe('C-2 probe throw → retry returns level (blip cleared, §3.2 STEPUP_PROBE_RETRY)', () => {
  it('probe throws once → retry returns BIOMETRIC_STRONG → authenticate called → delete_success', async () => {
    let probeCount = 0;
    const authenticateCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => {
        probeCount++;
        if (probeCount === 1) throw new Error('native bridge stall');
        return 3; // BIOMETRIC_STRONG on retry
      },
      authenticateImpl: async (msg) => { authenticateCalls.push(msg); return { success: true }; },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(probeCount).toBe(2);           // called twice (initial + retry)
    expect(authenticateCalls).toHaveLength(1); // authenticate was called
    expect(result.outcome).toBe('delete_success');
  });

  it('probe throws once → retry returns NONE → authenticate NOT called (floor only)', async () => {
    let probeCount = 0;
    const authenticateCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => {
        probeCount++;
        if (probeCount === 1) throw new Error('native error');
        return SECURITY_LEVEL_NONE; // returns NONE on retry
      },
      authenticateImpl: async (msg) => { authenticateCalls.push(msg); return { success: true }; },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(probeCount).toBe(2);
    expect(authenticateCalls).toHaveLength(0); // NONE → no step-up
    expect(result.outcome).toBe('delete_success');
  });

  it('STEPUP_PROBE_RETRY state is emitted during the retry (§3.2)', async () => {
    let probeCount = 0;
    const stateTracker = captureStates();
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => {
        probeCount++;
        if (probeCount === 1) throw new Error('native error');
        return 3;
      },
      authSuccess: true,
    });
    await runDeleteGate(baseDeps({ deviceAuth, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).toContain('STEPUP_PROBE_RETRY');
  });
});

// ─── C-2 Probe throw → retry throws again → fail-OPEN to floor ───────────────

describe('C-2 probe throws twice → stepup_degraded + telemetry (AR-AC-26, inv-8)', () => {
  it('outcome is stepup_degraded when probe throws twice', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new Error('native crash'); },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(result.outcome).toBe('stepup_degraded');
  });

  it('throwSite is "probe" on double probe throw', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new Error('native crash'); },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(result.outcome).toBe('stepup_degraded');
    if (result.outcome === 'stepup_degraded') {
      expect(result.throwSite).toBe('probe');
    }
  });

  it('telemetry is emitted with correct event name on probe double-throw', async () => {
    const telemetry = makeTelemetrySpy();
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new Error('native crash'); },
    });
    await runDeleteGate(baseDeps({ deviceAuth, telemetry: telemetry.fn }));
    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0]!.event).toBe('delete_stepup_probe_throw_degraded');
  });

  it('telemetry data contains errorClass (no PII, AR-AC-26)', async () => {
    const telemetry = makeTelemetrySpy();
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new TypeError('bridge failure'); },
    });
    await runDeleteGate(baseDeps({ deviceAuth, telemetry: telemetry.fn }));
    const data = telemetry.calls[0]!.data;
    expect(data.errorClass).toBe('TypeError');
    expect(data.throwSite).toBe('probe');
    // Verify no PII keys — telemetry has only errorClass, platform, throwSite
    const allowedKeys = new Set(['errorClass', 'platform', 'throwSite']);
    for (const key of Object.keys(data)) {
      expect(allowedKeys).toContain(key);
    }
  });

  it('DELETE is NOT called after probe double-throw (no delete until re-tap)', async () => {
    const deleteApiCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new Error('crash'); },
    });
    await runDeleteGate(baseDeps({
      deviceAuth,
      deleteAccountApi: async (t) => { deleteApiCalls.push(t); return { ok: true }; },
    }));
    expect(deleteApiCalls).toHaveLength(0);
  });

  it('performLogout NOT called after probe double-throw', async () => {
    const logout = makeLogoutSpy();
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new Error('crash'); },
    });
    await runDeleteGate(baseDeps({ deviceAuth, performLogout: logout.fn }));
    expect(logout.wasCalled()).toBe(false);
  });

  it('getEnrolledLevel called exactly twice (initial + one retry) on double throw', async () => {
    let probeCount = 0;
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { probeCount++; throw new Error('crash'); },
    });
    await runDeleteGate(baseDeps({ deviceAuth }));
    expect(probeCount).toBe(2);
  });
});

// ─── C-2 Auth throw → retry succeeds ─────────────────────────────────────────

describe('C-2 auth throw → retry → success → delete_success (§3.2 STEPUP_AUTH_RETRY)', () => {
  it('auth throws once → retry succeeds → DELETE called → delete_success', async () => {
    let authCount = 0;
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => {
        authCount++;
        if (authCount === 1) throw new Error('native auth stall');
        return { success: true };
      },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(authCount).toBe(2);
    expect(result.outcome).toBe('delete_success');
  });

  it('STEPUP_AUTH_RETRY state is emitted during retry', async () => {
    let authCount = 0;
    const stateTracker = captureStates();
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => {
        authCount++;
        if (authCount === 1) throw new Error('auth error');
        return { success: true };
      },
    });
    await runDeleteGate(baseDeps({ deviceAuth, onStateChange: stateTracker.cb }));
    expect(stateTracker.states).toContain('STEPUP_AUTH_RETRY');
  });
});

// ─── C-2 Auth throw → retry returns non-success → auth_cancelled ─────────────

describe('C-2 auth throw → retry non-success → auth_cancelled (NOT degraded — rule 5)', () => {
  it('auth throws once → retry returns non-success → auth_cancelled (not stepup_degraded)', async () => {
    let authCount = 0;
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => {
        authCount++;
        if (authCount === 1) throw new Error('auth crash');
        return { success: false, error: 'user_cancel' }; // non-success on retry
      },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(result.outcome).toBe('auth_cancelled'); // NOT stepup_degraded
  });

  it('DELETE NOT called when auth throws once then returns non-success', async () => {
    let authCount = 0;
    const deleteApiCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => {
        authCount++;
        if (authCount === 1) throw new Error('crash');
        return { success: false, error: 'lockout' };
      },
    });
    await runDeleteGate(baseDeps({
      deviceAuth,
      deleteAccountApi: async (t) => { deleteApiCalls.push(t); return { ok: true }; },
    }));
    expect(deleteApiCalls).toHaveLength(0);
  });
});

// ─── C-2 Auth throw → retry throws again → fail-OPEN (stepup_degraded) ────────

describe('C-2 auth throws twice → stepup_degraded + telemetry (AR-AC-26, inv-8)', () => {
  it('outcome is stepup_degraded when auth throws twice', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => { throw new Error('auth native crash'); },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(result.outcome).toBe('stepup_degraded');
  });

  it('throwSite is "authenticate" on double auth throw', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => { throw new Error('crash'); },
    });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(result.outcome).toBe('stepup_degraded');
    if (result.outcome === 'stepup_degraded') {
      expect(result.throwSite).toBe('authenticate');
    }
  });

  it('telemetry event is delete_stepup_authenticate_throw_degraded on auth double-throw', async () => {
    const telemetry = makeTelemetrySpy();
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => { throw new TypeError('auth crash'); },
    });
    await runDeleteGate(baseDeps({ deviceAuth, telemetry: telemetry.fn }));
    expect(telemetry.calls[0]!.event).toBe('delete_stepup_authenticate_throw_degraded');
    expect(telemetry.calls[0]!.data.throwSite).toBe('authenticate');
    expect(telemetry.calls[0]!.data.errorClass).toBe('TypeError');
  });

  it('telemetry has NO PII on auth double-throw (AR-AC-26)', async () => {
    const telemetry = makeTelemetrySpy();
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => { throw new Error('sensitive:user@email.com crash'); },
    });
    await runDeleteGate(baseDeps({ deviceAuth, telemetry: telemetry.fn }));
    const data = telemetry.calls[0]!.data;
    // Only allowed keys; error message must NOT be in the payload
    const allowedKeys = new Set(['errorClass', 'platform', 'throwSite']);
    for (const key of Object.keys(data)) {
      expect(allowedKeys).toContain(key);
    }
    // The errorClass is the class name — Error — not the message
    expect(data.errorClass).toBe('Error');
  });

  it('DELETE NOT called after auth double-throw', async () => {
    const deleteApiCalls: string[] = [];
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => { throw new Error('crash'); },
    });
    await runDeleteGate(baseDeps({
      deviceAuth,
      deleteAccountApi: async (t) => { deleteApiCalls.push(t); return { ok: true }; },
    }));
    expect(deleteApiCalls).toHaveLength(0);
  });

  it('authenticate called exactly twice (initial + one retry) on double throw', async () => {
    let authCount = 0;
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => { authCount++; throw new Error('crash'); },
    });
    await runDeleteGate(baseDeps({ deviceAuth }));
    expect(authCount).toBe(2);
  });
});

// ─── §2.5 Rule 5 — non-success NEVER degrades (AR-AC-27) ─────────────────────

describe('AR-AC-27 — non-success never degrades (rule 5)', () => {
  it('lockout result stays auth_cancelled (not stepup_degraded)', async () => {
    const telemetry = makeTelemetrySpy();
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3, authError: 'lockout' });
    const result = await runDeleteGate(baseDeps({ deviceAuth, telemetry: telemetry.fn }));
    expect(result.outcome).toBe('auth_cancelled');
    expect(result.outcome).not.toBe('stepup_degraded');
    expect(telemetry.calls).toHaveLength(0); // no telemetry for non-success
  });

  it('user_cancel result stays auth_cancelled (not stepup_degraded)', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: 3, authError: 'user_cancel' });
    const result = await runDeleteGate(baseDeps({ deviceAuth }));
    expect(result.outcome).toBe('auth_cancelled');
  });
});

// ─── §3.3 Invariant 8: THROW ≠ NONE ≠ non-success (critical, C-2 boundary) ──

describe('Invariant 8 — THROW ≠ NONE ≠ non-success — clear boundary (C-2)', () => {
  it('probe throw (C-2) produces stepup_degraded; NONE produces delete_success (floor only)', async () => {
    // Throw path
    const throwDevice = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new Error('crash'); },
    });
    const throwResult = await runDeleteGate(baseDeps({ deviceAuth: throwDevice }));
    expect(throwResult.outcome).toBe('stepup_degraded');

    // NONE path
    const noneDevice = createMockDeviceAuthAdapter({ enrolledLevel: SECURITY_LEVEL_NONE });
    const noneResult = await runDeleteGate(baseDeps({ deviceAuth: noneDevice }));
    expect(noneResult.outcome).toBe('delete_success');

    // These are DISTINCT outcomes — never collapse THROW into NONE
    expect(throwResult.outcome).not.toBe(noneResult.outcome);
  });

  it('non-success (cancel) produces auth_cancelled; THROW produces stepup_degraded', async () => {
    const cancelDevice = createMockDeviceAuthAdapter({ enrolledLevel: 3, authError: 'user_cancel' });
    const cancelResult = await runDeleteGate(baseDeps({ deviceAuth: cancelDevice }));
    expect(cancelResult.outcome).toBe('auth_cancelled');

    const throwDevice = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => { throw new Error('crash'); },
    });
    const throwResult = await runDeleteGate(baseDeps({ deviceAuth: throwDevice }));
    expect(throwResult.outcome).toBe('stepup_degraded');

    expect(cancelResult.outcome).not.toBe(throwResult.outcome);
  });
});

// ─── AR-AC-17: composed retry-after-ambiguous-timeout ────────────────────────
//
// Spec: after a delete_error (non-202, e.g. timeout), the user may tap Retry.
// The second runDeleteGate invocation is a fresh, independent call. This test
// verifies that:
//   (a) the FIRST call returns delete_error and does NOT call performLogout;
//   (b) the SECOND call (simulating the user's Retry) returns delete_success;
//   (c) performLogout is called exactly once — on the 202 from the second call,
//       and NOT on the first (non-202) call.
//
// runDeleteGate is pure (no shared mutable state between calls); the "retry"
// is modelled as two independent invocations with separate dep instances.

describe('AR-AC-17 — composed retry after ambiguous timeout', () => {
  it('first call (timeout → delete_error) does not logout; second call (202) → delete_success + logout once', async () => {
    const deviceAuth = createMockDeviceAuthAdapter({ enrolledLevel: SECURITY_LEVEL_NONE });

    // ── First invocation: DELETE returns non-202 (timeout) ──
    const firstLogout = makeLogoutSpy();
    const firstDelete = makeDeleteApi({ ok: false, code: 'timeout' });

    const firstResult = await runDeleteGate(baseDeps({
      deviceAuth,
      deleteAccountApi: firstDelete.fn,
      performLogout: firstLogout.fn,
    }));

    expect(firstResult.outcome).toBe('delete_error');
    expect((firstResult as { outcome: string; code?: string }).code).toBe('timeout');
    expect(firstLogout.wasCalled()).toBe(false); // no teardown on non-202
    expect(firstDelete.calls).toHaveLength(1);   // DELETE was called exactly once

    // ── Second invocation: user taps Retry; DELETE returns 202 ──
    const secondLogout = makeLogoutSpy();
    const secondDelete = makeDeleteApi({ ok: true });

    const secondResult = await runDeleteGate(baseDeps({
      deviceAuth,
      deleteAccountApi: secondDelete.fn,
      performLogout: secondLogout.fn,
    }));

    expect(secondResult.outcome).toBe('delete_success');
    expect(secondLogout.wasCalled()).toBe(true);  // logout fires on 202
    expect(secondDelete.calls).toHaveLength(1);   // DELETE called once in second invocation
    expect(firstLogout.wasCalled()).toBe(false);   // first-call logout still NOT called
  });
});

// ─── E-18: performLogout throws mid-teardown → still delete_success ───────────

describe('E-18 — performLogout throws mid-teardown → still delete_success', () => {
  it('returns delete_success even when performLogout throws', async () => {
    const result = await runDeleteGate(baseDeps({
      performLogout: async () => { throw new Error('logout storage failure'); },
    }));
    expect(result.outcome).toBe('delete_success');
  });
});

// ─── C-2 sleepMs is called with correct backoff ───────────────────────────────

describe('C-2 backoff — sleepMs called on probe/auth throw', () => {
  it('sleepMs called once on probe first throw (before retry)', async () => {
    let sleepCount = 0;
    let probeCount = 0;
    const deviceAuth = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => {
        probeCount++;
        if (probeCount === 1) throw new Error('crash');
        return 3;
      },
      authSuccess: true,
    });
    await runDeleteGate(baseDeps({
      deviceAuth,
      sleepMs: async (ms) => { sleepCount++; expect(ms).toBe(250); },
    }));
    expect(sleepCount).toBe(1);
  });

  it('sleepMs called once on auth first throw (before retry)', async () => {
    let sleepCount = 0;
    let authCount = 0;
    const deviceAuth = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      authenticateImpl: async (_msg) => {
        authCount++;
        if (authCount === 1) throw new Error('crash');
        return { success: true };
      },
    });
    await runDeleteGate(baseDeps({
      deviceAuth,
      sleepMs: async (ms) => { sleepCount++; expect(ms).toBe(250); },
    }));
    expect(sleepCount).toBe(1);
  });
});
