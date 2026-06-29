/**
 * Token storage abstraction.
 *
 * The `TokenStorage` interface decouples auth business logic from the
 * platform's secure credential store. This lets all screen logic and
 * the auth API client be tested without mocking expo-secure-store.
 *
 * Production binding (next slice):
 *   expo-secure-store with `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY`
 *   for both access and refresh tokens (appsec SEC-HOOK §A/C4).
 *   Tokens MUST NOT be stored in AsyncStorage, logs, or any
 *   unencrypted persistence. The interface enforces this boundary.
 *
 * Security contract:
 * - `accessToken`  — short-lived JWT (~15 min); used as `Authorization: Bearer`
 * - `refreshToken` — opaque random string; high-value, must be
 *   in Keychain (iOS) / Keystore (Android) only (§A)
 * - Both tokens are cleared on sign-out and on token-reuse-detected (§B/§C)
 */
import type { AuthTokens } from './types';

/** Persistent secure store for the session tokens. */
export interface TokenStorage {
  /**
   * Persist `tokens` in secure storage, replacing any previously saved set.
   * Called on successful login / email-verify / token-refresh.
   */
  save(tokens: AuthTokens): Promise<void>;

  /**
   * Load the stored tokens.
   * Returns `null` if no tokens have been saved yet or after `clear()`.
   */
  load(): Promise<AuthTokens | null>;

  /**
   * Remove all stored tokens.
   * Called on sign-out, token-reuse-detected, and account deletion.
   */
  clear(): Promise<void>;
}

/**
 * In-memory implementation for unit tests and initial app bootstrap.
 *
 * This implementation DOES NOT persist across app restarts.
 * The real on-device binding (expo-secure-store) is the integration step
 * for the next slice and is NOT imported here.
 */
export class InMemoryTokenStorage implements TokenStorage {
  private stored: AuthTokens | null = null;

  async save(tokens: AuthTokens): Promise<void> {
    // Defensive copy — callers must not be able to mutate the stored value
    this.stored = { ...tokens };
  }

  async load(): Promise<AuthTokens | null> {
    if (!this.stored) return null;
    // Defensive copy — callers must not be able to mutate the stored value
    return { ...this.stored };
  }

  async clear(): Promise<void> {
    this.stored = null;
  }
}
