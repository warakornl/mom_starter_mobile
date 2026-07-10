/**
 * fw1Scanner.ts — FW-1 Milk-Code firewall string scanner.
 *
 * FW-1 (HARD) from auto-stock-decrement-ui.md §7.1:
 *
 *   Every surface where formula-feed log / formula item / decrement / low cue /
 *   restock reminder renders MUST contain ONLY:
 *     - The mother's verbatim item name (SP-1: never parsed, never translated)
 *     - Integer quantities
 *     - Neutral Thai verbs (allowlist below)
 *
 *   The BLOCKLIST is comprehensive; any match is a violation.
 *
 * Uses:
 *   FW-1a: scanForFW1Violations(text) — returns found blocklist tokens.
 *          Call on every rendered string in the formula path (incl. push body).
 *   FW-1b: validateFW1Template(text, itemName) — after stripping the verbatim
 *          name and integers, only allowlist content should remain.
 *
 * This module is PURE — no side effects, no React, no native imports.
 * Import anywhere (CI test, unit test, runtime assertion).
 *
 * Security:
 *   This scanner operates on UI strings ONLY (copy compliance).
 *   Do NOT pass health values, supply quantities, or sync payloads to it —
 *   those must NEVER appear in UI text strings at all (K-8 / SD-5).
 */

// ─── Blocklist ────────────────────────────────────────────────────────────────

/**
 * FW-1 blocklist tokens. Any of these appearing in rendered formula-path text
 * is a violation. Exported for programmatic use (test tooling, lint rules).
 *
 * Matching is case-insensitive for ASCII tokens, case-sensitive for Thai
 * (Thai is already cased correctly in the user-visible strings).
 *
 * Source: auto-stock-decrement-ui.md §7.1 (authoritative list).
 */
export const FW1_BLOCKLIST_TOKENS: readonly string[] = [
  // Thai commerce verbs
  'ซื้อ',      // buy
  'สั่ง',      // order (Thai)
  'โปร',       // promo
  'ลด',        // discount / reduce
  '฿ราคา',     // price in baht (compound — prevents "฿" alone being too broad)

  // English commerce (matched case-insensitively)
  'reorder',
  'order',
  'cart',
  'shop',
  'discount',
  'coupon',

  // Health claims (Thai)
  'ดีต่อลูก',   // good for baby
  'ช่วยให้โต',  // helps grow
  'สูตรนี้',    // this formula (advertising/comparative claim)

  // Age-based targeting trigger word (Thai)
  'สำหรับลูก',  // for baby (combined with months/years = age-based recommendation)
] as const;

// Pre-compiled patterns for performance (compiled once at module load).
// Thai tokens: simple includes check (Thai script, already case-sensitive).
// ASCII tokens: lower-case comparison.
const THAI_BLOCKLIST = FW1_BLOCKLIST_TOKENS.filter((t) => /[ก-๙]/.test(t));
const ASCII_BLOCKLIST = FW1_BLOCKLIST_TOKENS
  .filter((t) => !/[ก-๙]/.test(t))
  .map((t) => t.toLowerCase());

// ─── Thai allowlist verbs ──────────────────────────────────────────────────────

/**
 * Neutral Thai verbs permitted on formula-facing surfaces.
 * Source: auto-stock-decrement-ui.md §7.1 allowlist.
 */
export const FW1_ALLOWLIST_THAI_VERBS: readonly string[] = [
  'บันทึก',       // save / record
  'เหลือ',        // remaining
  'ใกล้หมด',      // running low
  'เติมสต็อก',    // restock (neutral)
  'ตัดออก',       // deduct / draw from
  'กระป๋อง',      // container / tin / can
  'มื้อ',         // meal / feed
  'สกูป',         // scoop
  'บรรจุภัณฑ์',   // packaging (neutral)
  'ครั้ง',        // time(s) / occasion
  'นมผง',         // formula powder (generic noun — SP-4 safe)
  'นมผงของคุณ',   // your formula powder (generic possessive)
] as const;

// ─── FW-1a: scanForFW1Violations ─────────────────────────────────────────────

/**
 * Scan a string for FW-1 Milk-Code violations.
 *
 * Returns an array of the blocklist token(s) found. Empty array = clean.
 * Does NOT throw. Safe to call at runtime for assertion logging (but NEVER
 * log the input `text` itself if it could contain health-adjacent data).
 *
 * Case-insensitive for ASCII tokens; case-sensitive for Thai.
 *
 * @param text  The rendered string to check (UI copy, push notification body, etc.)
 * @returns     Array of blocklist tokens found. Empty if clean.
 */
export function scanForFW1Violations(text: string): string[] {
  if (!text) return [];

  const violations: string[] = [];
  const lowerText = text.toLowerCase();

  // Check Thai blocklist tokens (case-sensitive; Thai characters are Unicode BMP)
  for (const token of THAI_BLOCKLIST) {
    if (text.includes(token)) {
      violations.push(token);
    }
  }

  // Check ASCII blocklist tokens (case-insensitive)
  for (const token of ASCII_BLOCKLIST) {
    if (lowerText.includes(token)) {
      // Push the original-case token from FW1_BLOCKLIST_TOKENS for readability
      const original = FW1_BLOCKLIST_TOKENS.find((t) => t.toLowerCase() === token);
      violations.push(original ?? token);
    }
  }

  return violations;
}

// ─── isFW1Clean ──────────────────────────────────────────────────────────────

/**
 * Convenience boolean: returns true if the text has zero FW-1 violations.
 *
 * @param text  The rendered string to check.
 * @returns     true if clean; false if any blocklist token found.
 */
export function isFW1Clean(text: string): boolean {
  return scanForFW1Violations(text).length === 0;
}

// Pre-sort allowlist by length descending to prevent partial-token stripping
// (e.g., "นมผง" must not be stripped before "นมผงของคุณ" is checked).
const FW1_ALLOWLIST_THAI_SORTED = [...FW1_ALLOWLIST_THAI_VERBS].sort(
  (a, b) => b.length - a.length,
);

// ─── FW-1b: validateFW1Template ──────────────────────────────────────────────

/**
 * FW-1b template validation: checks that a rendered text string contains only
 * allowed content after stripping:
 *   - The verbatim item name (SP-1; exact substring match)
 *   - Integers (digit sequences)
 *   - Thai allowlist verbs
 *   - Common punctuation and whitespace
 *
 * Use this in snapshot-style tests to assert that a component's rendered text
 * = {itemName} ∪ {integer} ∪ {allowlist verb} ∪ {safe punctuation} only.
 *
 * Returns false if:
 *   (a) any blocklist token is present (FW-1 violation), OR
 *   (b) any non-allowlist, non-integer residue remains after stripping
 *       (catches novel forms not yet in the blocklist).
 *
 * Note: The verbatim item name itself may contain any characters (SP-1).
 * It is stripped BEFORE checking residue, so its content is not itself
 * validated against the allowlist/blocklist (mother's choice is sacred).
 *
 * @param text            The fully rendered text (e.g., component .textContent).
 * @param verbatimItemName  The exact item name the mother typed (may be empty).
 * @returns               true = only allowlist content; false = violation or residue.
 */
export function validateFW1Template(text: string, verbatimItemName: string): boolean {
  // First: FW-1a check (blocklist scan is independent of template structure)
  if (!isFW1Clean(text)) {
    return false;
  }

  // Strip the verbatim item name (exact, not regex — SP-1 names may have special chars)
  let residue = text;
  if (verbatimItemName) {
    residue = residue.split(verbatimItemName).join('');
  }

  // Strip Thai allowlist verbs (longest first to avoid partial-token stripping,
  // e.g., "นมผง" must not match before "นมผงของคุณ" is attempted).
  for (const verb of FW1_ALLOWLIST_THAI_SORTED) {
    residue = residue.split(verb).join('');
  }

  // Strip digit sequences (integer quantities — spec allows integers)
  residue = residue.replace(/\d+/g, '');

  // Strip safe punctuation and whitespace
  // Includes: space, nbsp, /, (, ), ., :, ;, -, –, %, \n, \t, Thai ellipsis
  residue = residue.replace(/[\s/().:\-–;%\n\t…·,]+/g, '');

  // After stripping everything allowed, nothing should remain.
  return residue.length === 0;
}
