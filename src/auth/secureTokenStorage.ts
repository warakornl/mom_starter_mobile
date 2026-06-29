/**
 * SecureTokenStorage — production TokenStorage implementation using expo-secure-store.
 *
 * Stores auth tokens in:
 *   iOS    → Keychain Services (WHEN_UNLOCKED_THIS_DEVICE_ONLY)
 *   Android → Android Keystore (EncryptedSharedPreferences)
 *
 * Security contract (appsec SEC-HOOK §A/C4):
 * - Tokens MUST NOT be stored in AsyncStorage, logs, or any unencrypted store.
 * - `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` prevents tokens from
 *   being included in iCloud backups or accessible when the device is locked.
 * - Both access and refresh tokens are stored together as a JSON blob to keep
 *   them atomic (no partial-save state between token pair).
 *
 * Testing note:
 * - Unit tests for this class require mocking expo-secure-store.
 *   A Jest mock can be placed at __mocks__/expo-secure-store.ts.
 *   The InMemoryTokenStorage in tokenStorage.ts is the test double used
 *   in all existing logic tests — use that for unit testing screen logic.
 *
 * Error handling:
 * - Errors from SecureStore are NOT swallowed; callers (VerifyEmailScreen,
 *   LoginScreen) already handle storage throws via try-catch and surface
 *   them to the user as 'server_error' / 'storage_error' outcomes.
 */

import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from './tokenStorage';
import type { AuthTokens } from './types';

const TOKENS_KEY = 'mom_starter_auth_tokens';

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Production implementation of {@link TokenStorage} backed by expo-secure-store.
 *
 * Drop-in replacement for {@link InMemoryTokenStorage}:
 *   const storage = new SecureTokenStorage();
 */
export class SecureTokenStorage implements TokenStorage {
  /**
   * Persist tokens in Keychain/Keystore as a JSON string.
   * Overwrites any previously saved set (tokens are always stored as a pair).
   */
  async save(tokens: AuthTokens): Promise<void> {
    await SecureStore.setItemAsync(
      TOKENS_KEY,
      JSON.stringify(tokens),
      KEYCHAIN_OPTIONS,
    );
  }

  /**
   * Load the stored tokens.
   * Returns `null` if no tokens have been saved yet or after `clear()`.
   * If the stored blob is corrupted/legacy and cannot be parsed, self-heals by
   * clearing it and returning `null` (app falls back to signed-out, never stuck).
   * Throws if SecureStore itself is unavailable (e.g. device lacks hardware security).
   */
  async load(): Promise<AuthTokens | null> {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY, KEYCHAIN_OPTIONS);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthTokens;
    } catch {
      await this.clear();
      return null;
    }
  }

  /**
   * Delete all stored tokens.
   * Called on sign-out, token-reuse-detected, and account deletion (§B/C1).
   */
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKENS_KEY, KEYCHAIN_OPTIONS);
  }
}
