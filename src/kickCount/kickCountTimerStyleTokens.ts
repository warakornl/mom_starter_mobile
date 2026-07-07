/**
 * Timer style-token constants for KickCountCountingScreen.
 *
 * Kept in a separate pure-TS file (no React Native imports) so they can be
 * imported directly by Jest unit tests without triggering RN ESM parsing.
 *
 * Visual-hierarchy contract for the counting screen:
 *   1. countNumber  — 56 pt weight-700 #1A1A1A  (hero — primary element)
 *   2. timerText    — 32 pt monospace  #3D3D3D  (strong secondary)
 *   3. timerLabel   — 14 pt            #6B6B6B  (caption)
 *
 * The timer must be clearly readable without competing with the 56 pt hero count.
 */

export const timerStyleTokens = {
  /** timerText font size — prominent secondary stat. */
  timerFontSize: 32,
  /** timerText color — readable ink, darker than old faint #6B6B6B. */
  timerColor: '#3D3D3D',
  /** timerLabel font size — caption beneath the mm:ss value. */
  timerLabelFontSize: 14,
  /** timerLabel color — ink/soft, clearly less faint than old #9B9B9B. */
  timerLabelColor: '#6B6B6B',
  /**
   * countNumber hero font size — included so hierarchy invariants are
   * assertable in tests (timerFontSize must remain strictly less than this).
   */
  countHeroFontSize: 56,
} as const;
