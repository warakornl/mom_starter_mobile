/**
 * deviceAuthAdapter — unit tests (TDD, written BEFORE implementation).
 *
 * Only the mock adapter is tested here (the real adapter wraps native
 * expo-local-authentication — device-only, not runnable in Jest).
 *
 * Tests verify:
 *   - createMockDeviceAuthAdapter correctly implements the DeviceAuthAdapter interface
 *   - SECURITY_LEVEL_NONE constant = 0 (enum-agnostic step-up predicate)
 *   - Mock supports both enrolledLevel config and custom getEnrolledLevelImpl
 *   - Mock supports authSuccess, authError, and custom authenticateImpl
 *   - The step-up predicate (level !== NONE) routes correctly
 *
 * NOTE: createRealDeviceAuthAdapter() is NOT tested here (device-only).
 *       It is covered by the Phase-1 on-device launch-gate checklist.
 */

import {
  createMockDeviceAuthAdapter,
  SECURITY_LEVEL_NONE,
} from './deviceAuthAdapter';

// ─── SECURITY_LEVEL_NONE constant ────────────────────────────────────────────

describe('SECURITY_LEVEL_NONE', () => {
  it('equals 0 (matches SecurityLevel.NONE from expo-local-authentication)', () => {
    expect(SECURITY_LEVEL_NONE).toBe(0);
  });

  it('enum-agnostic predicate: level !== NONE routes enrolled devices to step-up', () => {
    // All non-zero levels trigger step-up (SECRET=1, BIOMETRIC_WEAK=2, BIOMETRIC_STRONG=3)
    const enrolledLevels = [1, 2, 3];
    for (const level of enrolledLevels) {
      expect(level !== SECURITY_LEVEL_NONE).toBe(true);
    }
  });

  it('enum-agnostic predicate: level === NONE skips step-up', () => {
    expect(SECURITY_LEVEL_NONE !== SECURITY_LEVEL_NONE).toBe(false);
    expect(0 !== SECURITY_LEVEL_NONE).toBe(false);
  });
});

// ─── createMockDeviceAuthAdapter ─────────────────────────────────────────────

describe('createMockDeviceAuthAdapter — getEnrolledLevel', () => {
  it('returns SECURITY_LEVEL_NONE (0) by default when no config given', async () => {
    const adapter = createMockDeviceAuthAdapter({});
    expect(await adapter.getEnrolledLevel()).toBe(SECURITY_LEVEL_NONE);
  });

  it('returns configured enrolledLevel (SECRET = 1)', async () => {
    const adapter = createMockDeviceAuthAdapter({ enrolledLevel: 1 });
    expect(await adapter.getEnrolledLevel()).toBe(1);
  });

  it('returns configured enrolledLevel (BIOMETRIC_WEAK = 2)', async () => {
    const adapter = createMockDeviceAuthAdapter({ enrolledLevel: 2 });
    expect(await adapter.getEnrolledLevel()).toBe(2);
  });

  it('returns configured enrolledLevel (BIOMETRIC_STRONG = 3)', async () => {
    const adapter = createMockDeviceAuthAdapter({ enrolledLevel: 3 });
    expect(await adapter.getEnrolledLevel()).toBe(3);
  });

  it('uses getEnrolledLevelImpl when provided (overrides enrolledLevel)', async () => {
    const adapter = createMockDeviceAuthAdapter({
      enrolledLevel: 3,
      getEnrolledLevelImpl: async () => 1,
    });
    expect(await adapter.getEnrolledLevel()).toBe(1);
  });

  it('getEnrolledLevelImpl can throw (simulating C-2 native error)', async () => {
    const adapter = createMockDeviceAuthAdapter({
      getEnrolledLevelImpl: async () => { throw new Error('native bridge error'); },
    });
    await expect(adapter.getEnrolledLevel()).rejects.toThrow('native bridge error');
  });
});

describe('createMockDeviceAuthAdapter — authenticate', () => {
  it('returns success: false (user_cancel) by default', async () => {
    const adapter = createMockDeviceAuthAdapter({});
    const result = await adapter.authenticate('Test prompt');
    expect(result.success).toBe(false);
    expect(result.error).toBe('user_cancel');
  });

  it('returns success: true when authSuccess=true', async () => {
    const adapter = createMockDeviceAuthAdapter({ authSuccess: true });
    const result = await adapter.authenticate('Test prompt');
    expect(result.success).toBe(true);
  });

  it('returns success: false with custom error when authError is set', async () => {
    const adapter = createMockDeviceAuthAdapter({ authError: 'lockout' });
    const result = await adapter.authenticate('Test prompt');
    expect(result.success).toBe(false);
    expect(result.error).toBe('lockout');
  });

  it('uses authenticateImpl when provided (full control)', async () => {
    let capturedPrompt = '';
    const adapter = createMockDeviceAuthAdapter({
      authenticateImpl: async (msg) => {
        capturedPrompt = msg;
        return { success: true };
      },
    });
    const result = await adapter.authenticate('Confirm delete');
    expect(result.success).toBe(true);
    expect(capturedPrompt).toBe('Confirm delete');
  });

  it('authenticateImpl can throw (simulating C-2 native error)', async () => {
    const adapter = createMockDeviceAuthAdapter({
      authenticateImpl: async () => { throw new TypeError('authenticateAsync failed'); },
    });
    await expect(adapter.authenticate('prompt')).rejects.toThrow('authenticateAsync failed');
  });
});

// ─── Step-up predicate correctness (enum-agnostic, I-1) ──────────────────────

describe('step-up predicate integration (level !== SECURITY_LEVEL_NONE)', () => {
  it('NONE device: no step-up taken', async () => {
    const adapter = createMockDeviceAuthAdapter({ enrolledLevel: SECURITY_LEVEL_NONE });
    const level = await adapter.getEnrolledLevel();
    expect(level !== SECURITY_LEVEL_NONE).toBe(false); // → floor-only path
  });

  it('SECRET device: step-up taken', async () => {
    const adapter = createMockDeviceAuthAdapter({ enrolledLevel: 1 }); // SECRET
    const level = await adapter.getEnrolledLevel();
    expect(level !== SECURITY_LEVEL_NONE).toBe(true); // → step-up path
  });

  it('BIOMETRIC_WEAK device: step-up taken', async () => {
    const adapter = createMockDeviceAuthAdapter({ enrolledLevel: 2 }); // BIOMETRIC_WEAK
    const level = await adapter.getEnrolledLevel();
    expect(level !== SECURITY_LEVEL_NONE).toBe(true);
  });

  it('BIOMETRIC_STRONG device: step-up taken', async () => {
    const adapter = createMockDeviceAuthAdapter({ enrolledLevel: 3 }); // BIOMETRIC_STRONG
    const level = await adapter.getEnrolledLevel();
    expect(level !== SECURITY_LEVEL_NONE).toBe(true);
  });
});
