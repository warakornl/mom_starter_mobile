/**
 * loginSuccessToast — module-level cleared-on-read pending toast store.
 *
 * Used to pass the reset-password success message from RootNavigator's
 * performLogout onComplete handler to LoginScreen, which reads and clears
 * it on mount (via useEffect).
 *
 * Pattern (SD-9 "ref across component trees"):
 *   1. RootNavigator onComplete: setPendingLoginSuccessToast(t('reset.successToast'))
 *      → navigation.reset({ name: 'Login' })
 *   2. LoginScreen mounts: useEffect reads takePendingLoginSuccessToast()
 *      and sets local banner state (cleared-on-read → shown once).
 *
 * No security data passes through this store (it is a user-visible UI hint only).
 * The store never persists across app restarts — module-level memory only.
 */

// ─── Module-level pending message ─────────────────────────────────────────────

let _pendingMessage: string | undefined;

/**
 * Set a pending success message to be shown by LoginScreen on its next mount.
 * Overwrites any previously pending message (only one reset can succeed at a time).
 */
export function setPendingLoginSuccessToast(message: string): void {
  _pendingMessage = message;
}

/**
 * Read and clear the pending success message (cleared-on-read / one-shot).
 * Returns `undefined` if no message is pending.
 *
 * LoginScreen calls this in a `useEffect(() => { ... }, [])` on mount.
 * The cleared-on-read guarantee means the banner is shown exactly once,
 * even if the screen re-renders.
 */
export function takePendingLoginSuccessToast(): string | undefined {
  const msg = _pendingMessage;
  _pendingMessage = undefined;
  return msg;
}
