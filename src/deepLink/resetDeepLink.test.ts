/**
 * resetDeepLink — deep-link URL parser tests (TDD).
 *
 * Tests for:
 *  - parseResetTokenFromUrl: custom scheme + https; missing token; wrong path;
 *    blank token; URL-encoded token; malformed URL.
 *  - resetTokenStore: set / clear / read cycle.
 *
 * Security property verified:
 *  - Only returns a token for reset-password path with a non-empty token param.
 *  - Returns undefined for all other URLs (no crash, no false positives).
 */
import {
  parseResetTokenFromUrl,
  resetTokenStore,
  setResetToken,
  clearResetToken,
} from './resetDeepLink';

describe('parseResetTokenFromUrl', () => {
  // ── Happy paths ──────────────────────────────────────────────────────────

  it('parses token from custom scheme URL', () => {
    expect(parseResetTokenFromUrl('momstarter://reset-password?token=abc123XYZ'))
      .toBe('abc123XYZ');
  });

  it('parses token from HTTPS universal link', () => {
    expect(parseResetTokenFromUrl('https://app.example.com/reset-password?token=def456'))
      .toBe('def456');
  });

  it('parses token when there are multiple query params', () => {
    expect(parseResetTokenFromUrl('momstarter://reset-password?foo=bar&token=tok789&baz=qux'))
      .toBe('tok789');
  });

  it('URL-decodes percent-encoded token', () => {
    // Tokens may contain URL-safe base64 characters like + → %2B
    expect(parseResetTokenFromUrl('momstarter://reset-password?token=abc%2BxYZ'))
      .toBe('abc+xYZ');
  });

  // ── Missing / empty token ────────────────────────────────────────────────

  it('returns undefined when URL has no query string', () => {
    expect(parseResetTokenFromUrl('momstarter://reset-password')).toBeUndefined();
  });

  it('returns undefined when token param is empty', () => {
    expect(parseResetTokenFromUrl('momstarter://reset-password?token=')).toBeUndefined();
  });

  it('returns undefined when token param is whitespace only', () => {
    expect(parseResetTokenFromUrl('momstarter://reset-password?token=%20')).toBeUndefined();
  });

  // ── Wrong path ────────────────────────────────────────────────────────────

  it('returns undefined for verify URL (different path)', () => {
    expect(parseResetTokenFromUrl('momstarter://verify?token=abc123')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseResetTokenFromUrl('')).toBeUndefined();
  });

  it('returns undefined for a completely unrelated URL', () => {
    expect(parseResetTokenFromUrl('https://www.google.com')).toBeUndefined();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('trims whitespace from token value — whitespace-only returns undefined', () => {
    // Whitespace-only token (%20%20 = spaces only) → trimmed → empty → undefined
    expect(parseResetTokenFromUrl('momstarter://reset-password?token=%20%20')).toBeUndefined();
    // Token with trailing space trims to valid token
    expect(parseResetTokenFromUrl('momstarter://reset-password?token=abc%20')).toBe('abc');
    // Non-padded token → returned as-is
    expect(parseResetTokenFromUrl('momstarter://reset-password?token=abc123')).toBe('abc123');
  });

  it('returns the first token= param when duplicated', () => {
    // Spec: take the first match
    const result = parseResetTokenFromUrl('momstarter://reset-password?token=first&token=second');
    expect(result).toBe('first');
  });

  it('does not throw on malformed URL', () => {
    expect(() => parseResetTokenFromUrl('not-a-valid-url-at-all')).not.toThrow();
    expect(parseResetTokenFromUrl('not-a-valid-url-at-all')).toBeUndefined();
  });
});

describe('resetTokenStore', () => {
  beforeEach(() => {
    clearResetToken(); // ensure clean state between tests
  });

  it('starts with current = undefined', () => {
    expect(resetTokenStore.current).toBeUndefined();
  });

  it('setResetToken writes the token to resetTokenStore.current', () => {
    setResetToken('my-secure-token');
    expect(resetTokenStore.current).toBe('my-secure-token');
  });

  it('clearResetToken sets resetTokenStore.current to undefined', () => {
    setResetToken('tok');
    clearResetToken();
    expect(resetTokenStore.current).toBeUndefined();
  });

  it('resetTokenStore is the same object read by any importer (shared module state)', () => {
    setResetToken('shared-tok');
    expect(resetTokenStore.current).toBe('shared-tok');
    clearResetToken();
    expect(resetTokenStore.current).toBeUndefined();
  });
});
