/**
 * confirmWordMatch — unit tests (TDD, written BEFORE implementation).
 *
 * Spec: account-rights-behavior.md §3.7 (M-1 match semantics):
 *   - Trim leading/trailing whitespace only — NO internal normalization.
 *   - Case-insensitive.
 *   - Exact (not substring/partial).
 *   - Active-locale word: th → "ลบ", en → "DELETE".
 *
 * Covers AR-AC-28.
 */

import { matchesConfirmWord, CONFIRM_WORDS } from './confirmWordMatch';

// ─── CONFIRM_WORDS contract ───────────────────────────────────────────────────

describe('CONFIRM_WORDS', () => {
  it('exports the expected th confirm word', () => {
    expect(CONFIRM_WORDS['th']).toBe('ลบ');
  });

  it('exports the expected en confirm word', () => {
    expect(CONFIRM_WORDS['en']).toBe('DELETE');
  });
});

// ─── Thai locale ──────────────────────────────────────────────────────────────

describe('matchesConfirmWord — th locale', () => {
  it('matches exact typed word', () => {
    expect(matchesConfirmWord('ลบ', 'th')).toBe(true);
  });

  it('matches after trimming trailing whitespace', () => {
    expect(matchesConfirmWord('ลบ  ', 'th')).toBe(true);
  });

  it('matches after trimming leading whitespace', () => {
    expect(matchesConfirmWord('  ลบ', 'th')).toBe(true);
  });

  it('matches after trimming leading AND trailing whitespace', () => {
    expect(matchesConfirmWord('  ลบ  ', 'th')).toBe(true);
  });

  it('does NOT match internal whitespace (no internal normalization — §3.7)', () => {
    // "ล บ" ≠ "ลบ" — no internal-whitespace normalization
    expect(matchesConfirmWord('ล บ', 'th')).toBe(false);
  });

  it('does NOT match partial / substring input', () => {
    expect(matchesConfirmWord('ลบบ', 'th')).toBe(false);
  });

  it('does NOT match empty string', () => {
    expect(matchesConfirmWord('', 'th')).toBe(false);
  });

  it('does NOT match the en word in th locale', () => {
    expect(matchesConfirmWord('DELETE', 'th')).toBe(false);
  });

  it('does NOT match a whitespace-only string', () => {
    expect(matchesConfirmWord('   ', 'th')).toBe(false);
  });
});

// ─── English locale ───────────────────────────────────────────────────────────

describe('matchesConfirmWord — en locale', () => {
  it('matches exact typed word', () => {
    expect(matchesConfirmWord('DELETE', 'en')).toBe(true);
  });

  it('matches lowercase input (case-insensitive)', () => {
    expect(matchesConfirmWord('delete', 'en')).toBe(true);
  });

  it('matches mixed-case input', () => {
    expect(matchesConfirmWord('Delete', 'en')).toBe(true);
  });

  it('matches after trimming trailing whitespace', () => {
    expect(matchesConfirmWord('DELETE  ', 'en')).toBe(true);
  });

  it('matches after trimming leading whitespace', () => {
    expect(matchesConfirmWord('  DELETE', 'en')).toBe(true);
  });

  it('matches after trimming both sides', () => {
    expect(matchesConfirmWord('  delete  ', 'en')).toBe(true);
  });

  it('does NOT match internal whitespace (no internal normalization — §3.7)', () => {
    // "DEL ETE" ≠ "DELETE" — internal spaces are NOT normalized away
    expect(matchesConfirmWord('DEL ETE', 'en')).toBe(false);
  });

  it('does NOT match partial input', () => {
    expect(matchesConfirmWord('DELET', 'en')).toBe(false);
  });

  it('does NOT match superset input', () => {
    expect(matchesConfirmWord('DELETED', 'en')).toBe(false);
  });

  it('does NOT match empty string', () => {
    expect(matchesConfirmWord('', 'en')).toBe(false);
  });

  it('does NOT match the th word in en locale', () => {
    expect(matchesConfirmWord('ลบ', 'en')).toBe(false);
  });

  it('does NOT match whitespace-only string', () => {
    expect(matchesConfirmWord('   ', 'en')).toBe(false);
  });
});
