/**
 * loginSuccessToast — pending success-message store tests (TDD, RED first).
 *
 * The store is a cleared-on-read module-level flag used to pass the reset-
 * success toast message from RootNavigator's onSuccess handler to LoginScreen
 * (which reads + clears it on mount).  This is the same SD-9 ref pattern as
 * resetTokenStore / ancPrefillRef but scoped to a UI hint (no security data).
 *
 * Tests for:
 *  - setPendingLoginSuccessToast: writes the message
 *  - takePendingLoginSuccessToast: returns the message AND clears it (one-shot)
 *  - empty initial state
 *  - cleared-on-read: second call returns undefined
 *  - set → navigate → mount models the success-to-Login wiring (spec §3.3)
 */
import {
  setPendingLoginSuccessToast,
  takePendingLoginSuccessToast,
} from './loginSuccessToast';

describe('loginSuccessToast', () => {
  // ── Initial state ────────────────────────────────────────────────────────

  it('starts with no pending message (undefined)', () => {
    // Ensure clean state (takePendingLoginSuccessToast clears on read)
    takePendingLoginSuccessToast();
    expect(takePendingLoginSuccessToast()).toBeUndefined();
  });

  // ── set / take cycle ──────────────────────────────────────────────────────

  it('setPendingLoginSuccessToast stores the message', () => {
    takePendingLoginSuccessToast(); // clear any stale state
    setPendingLoginSuccessToast('ตั้งรหัสใหม่สำเร็จ · เข้าสู่ระบบด้วยรหัสใหม่');
    const msg = takePendingLoginSuccessToast();
    expect(msg).toBe('ตั้งรหัสใหม่สำเร็จ · เข้าสู่ระบบด้วยรหัสใหม่');
  });

  it('takePendingLoginSuccessToast clears on read — second call returns undefined', () => {
    setPendingLoginSuccessToast('some toast');
    takePendingLoginSuccessToast(); // first read clears it
    expect(takePendingLoginSuccessToast()).toBeUndefined();
  });

  it('setPendingLoginSuccessToast overwrites a previous pending message', () => {
    setPendingLoginSuccessToast('first');
    setPendingLoginSuccessToast('second');
    expect(takePendingLoginSuccessToast()).toBe('second');
  });

  // ── Spec §3.3 wiring scenario ─────────────────────────────────────────────

  it('models the reset-success → Login mount flow: set before navigate, take on mount', () => {
    // Simulate RootNavigator onComplete: set toast then reset stack to Login
    setPendingLoginSuccessToast('Password updated — sign in with your new password.');

    // LoginScreen mounts and takes the message on its useEffect
    const bannerText = takePendingLoginSuccessToast();
    expect(bannerText).toBe('Password updated — sign in with your new password.');

    // Subsequent renders / re-mounts see nothing (message consumed)
    expect(takePendingLoginSuccessToast()).toBeUndefined();
  });
});
