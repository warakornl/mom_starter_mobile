/**
 * confirmWordMatch — type-to-confirm floor match semantics (§3.7).
 *
 * Match rule (M-1, AR-AC-28):
 *   The floor is satisfied iff the typed input, after trimming LEADING and
 *   TRAILING whitespace, is case-insensitively equal to the confirm word of
 *   the currently active locale.
 *
 *   - No internal-whitespace normalization ("DEL ETE" does NOT match "DELETE").
 *   - No partial / substring match ("DELET" does NOT match "DELETE").
 *   - Locale determines the reference word (th → "ลบ", en → "DELETE").
 *
 * The confirm WORD itself is a 0d/0e-owned copy slot; this module pins the
 * MATCH SEMANTICS only.  Illustrative values per spec §3.7 are used here.
 *
 * Floor persistence (M-4): callers are responsible for preserving the input
 * text across step-up cancel / throw-degrade / export-nudge returns so that
 * the floor stays satisfied without re-typing. This function is stateless and
 * can be re-evaluated on every keystroke and on every resume.
 *
 * @see account-rights-behavior.md §3.7, M-1, M-4; AR-AC-28
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Locales supported by the type-to-confirm floor. */
export type SupportedLocale = 'th' | 'en';

// ─── Confirm word map ─────────────────────────────────────────────────────────

/**
 * Active-locale confirm words.
 *
 * These are the reference strings the match runs against.  The COPY (what the
 * user sees on-screen, the prompt wording) is a 0d slot — this map contains
 * only the word the INPUT must equal.
 *
 * [verify-current-docs] Final copy strings are 0d/0e; update these values when
 * 0d delivers the confirmed locale words.
 */
export const CONFIRM_WORDS: Record<SupportedLocale, string> = {
  /** Thai confirm word — illustrative per spec §3.7 ("ลบ"). */
  th: 'ลบ',
  /** English confirm word — illustrative per spec §3.7 ("DELETE"). */
  en: 'DELETE',
};

// ─── Match function ───────────────────────────────────────────────────────────

/**
 * Returns true iff the typed input satisfies the type-to-confirm floor for the
 * given active locale (§3.7, M-1).
 *
 * @param input  - Raw text typed by the user (from the TextInput value).
 * @param locale - Currently active locale ('th' | 'en').
 *
 * @example
 *   matchesConfirmWord('delete', 'en')   // → true  (case-insensitive)
 *   matchesConfirmWord('  ลบ  ', 'th')   // → true  (surrounding whitespace trimmed)
 *   matchesConfirmWord('DEL ETE', 'en')  // → false (no internal normalization)
 *   matchesConfirmWord('DELET', 'en')    // → false (no partial match)
 */
export function matchesConfirmWord(input: string, locale: SupportedLocale): boolean {
  // Trim SURROUNDING whitespace only — spec explicitly forbids internal normalization.
  const trimmed = input.trim();
  const word = CONFIRM_WORDS[locale];
  // Case-insensitive comparison (toLowerCase on both sides).
  // Thai characters are case-insensitive by definition; toLowerCase is a no-op for them.
  return trimmed.toLowerCase() === word.toLowerCase();
}
