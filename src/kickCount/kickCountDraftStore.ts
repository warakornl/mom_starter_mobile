/**
 * kickCountDraftStore — encrypted at-rest storage for the local in-progress draft.
 *
 * K-8 compliance (PDPA kick-count-compliance.md §K-8):
 *   Draft data = structured health data (movement_count before finalize is as
 *   sensitive as after finalize). Must NOT be stored in plaintext AsyncStorage.
 *
 * Encryption mechanism:
 *   expo-secure-store (v13) is used as the encrypted store:
 *   - iOS: Keychain Services with kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
 *          (AES-256, hardware-backed on modern devices via Secure Enclave).
 *   - Android: EncryptedSharedPreferences (Jetpack Security, AES-256-GCM).
 *   This satisfies the "encrypted local store" requirement for K-8.
 *
 * FLAG for appsec-engineer:
 *   The current mechanism uses expo-secure-store which provides OS-level
 *   key management. If the project requires a specific key derivation scheme
 *   (e.g. per-account DEK from SQLCipher as mentioned in the spec) appsec-engineer
 *   should verify that expo-secure-store satisfies the compliance bar, or
 *   provide the encrypted SQLite mechanism to use instead.
 *
 * 1 draft per device:
 *   A single key `DRAFT_KEY` is used. saveDraft() always overwrites the
 *   previous draft — only one in-progress session per device at a time (B.1).
 *
 * Crypto-shred on cancel:
 *   clearDraft() calls SecureStore.deleteItemAsync() which removes the entry
 *   from the OS keychain / EncryptedSharedPreferences, leaving no plaintext
 *   residue (K-8 cancel requirement).
 *
 * Security: never log any draft field. The store serializes to JSON; the JSON
 * is encrypted by expo-secure-store before writing to disk.
 */

import * as SecureStore from 'expo-secure-store';
import type { KickCountDraft } from './kickCountTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The single keychain key used for the in-progress draft.
 * Fixed key = 1 draft per device (B.1: no draft stacking).
 */
const DRAFT_KEY = 'kick_count_draft';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist the in-progress draft to the encrypted store.
 *
 * Serializes the draft to JSON and writes it via expo-secure-store.
 * Always overwrites any existing draft (1 draft/device invariant).
 *
 * K-8: expo-secure-store encrypts the JSON before writing to disk.
 *
 * @throws If the secure store write fails (e.g. keychain unavailable).
 *   Caller MUST handle this and display SC-K1 save-error state.
 */
export async function saveDraft(draft: KickCountDraft): Promise<void> {
  const serialized = JSON.stringify(draft);
  await SecureStore.setItemAsync(DRAFT_KEY, serialized);
}

/**
 * Load the in-progress draft from the encrypted store.
 *
 * Returns null when no draft exists (first-ever session, or after clear/finalize).
 * Returns null when the stored value cannot be parsed (corrupt entry — treat as no draft).
 *
 * @throws If the secure store read fails unexpectedly (e.g. keychain locked).
 *   Caller MUST handle this and display SC-K0 store-error state.
 */
export async function loadDraft(): Promise<KickCountDraft | null> {
  const raw = await SecureStore.getItemAsync(DRAFT_KEY);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as KickCountDraft;
    return parsed;
  } catch {
    // Corrupt entry — treat as no draft (safe default: do not resume)
    return null;
  }
}

/**
 * Remove the in-progress draft from the encrypted store (crypto-shred).
 *
 * Called after:
 *   - finalize: draft committed to completed session (clear draft entry)
 *   - cancel: user chose to discard (K-8 crypto-shred)
 *
 * After clearDraft() the next loadDraft() returns null.
 * expo-secure-store.deleteItemAsync removes the key from the OS keychain,
 * leaving no plaintext residue.
 *
 * @throws If the delete fails. Caller SHOULD retry on next app open.
 */
export async function clearDraft(): Promise<void> {
  await SecureStore.deleteItemAsync(DRAFT_KEY);
}
