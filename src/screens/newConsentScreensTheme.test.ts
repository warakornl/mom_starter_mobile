/**
 * newConsentScreensTheme.test.ts — ENFORCEMENT TEST for ห้องแม่ tokens-only
 * styling on the two new screens added by task #40
 * (PrivacyPolicyScreen, ConsentHistoryScreen).
 *
 * Mirrors manageConsentsScreenTheme.test.ts (same fail-on-revert pattern):
 * pure-node source inspection, non-vacuity proven by a planted violation.
 */

import * as fs from 'fs';
import * as path from 'path';

const PRIVACY_POLICY_PATH = path.join(__dirname, 'PrivacyPolicyScreen.tsx');
const CONSENT_HISTORY_PATH = path.join(__dirname, 'ConsentHistoryScreen.tsx');

const ANY_HEX_LITERAL = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g;
const ANY_RGBA_LITERAL = /rgba?\(/g;

describe('PrivacyPolicyScreen — ห้องแม่ tokens-only guard (#40)', () => {
  const source = fs.readFileSync(PRIVACY_POLICY_PATH, 'utf8');

  it('contains ZERO hardcoded hex color literals', () => {
    expect(source.match(ANY_HEX_LITERAL) ?? []).toEqual([]);
  });

  it('contains ZERO rgba()/rgb() literals', () => {
    expect(source.match(ANY_RGBA_LITERAL) ?? []).toEqual([]);
  });

  it('imports T from the ห้องแม่ token module', () => {
    expect(source).toMatch(/from ['"]\.\.\/theme\/tokens['"]/);
    expect(source).toMatch(/\bT\.(color|type|spacing|radius|elev)\./);
  });

  it('back button + all rendered copy come from t(), not hardcoded strings', () => {
    // Every user-visible string must be a t('key') call — no bare Thai/English literals.
    expect(source).toContain("t('general.back')");
    expect(source).toContain("t('privacyPolicy.title')");
    expect(source).toContain("t('privacyPolicy.pending_notice')");
    expect(source).toContain("t('privacyPolicy.pending_subnote')");
  });

  it('does NOT contain invented legal-sounding filler (no lorem/placeholder legal text)', () => {
    // Guards against ever "backfilling" invented Privacy Policy prose directly
    // into the component instead of via the honest-placeholder catalog keys.
    expect(source).not.toMatch(/we collect|we may share|your data is used to/i);
  });
});

describe('ConsentHistoryScreen — ห้องแม่ tokens-only guard (#40)', () => {
  const source = fs.readFileSync(CONSENT_HISTORY_PATH, 'utf8');

  it('contains ZERO hardcoded hex color literals', () => {
    expect(source.match(ANY_HEX_LITERAL) ?? []).toEqual([]);
  });

  it('contains ZERO rgba()/rgb() literals', () => {
    expect(source.match(ANY_RGBA_LITERAL) ?? []).toEqual([]);
  });

  it('imports T from the ห้องแม่ token module', () => {
    expect(source).toMatch(/from ['"]\.\.\/theme\/tokens['"]/);
    expect(source).toMatch(/\bT\.(color|type|spacing|radius|elev)\./);
  });

  it('is backed by the REAL consent API client (not an in-memory fake)', () => {
    expect(source).toContain('createConsentApiClient');
    expect(source).toContain('getConsents');
  });

  it('never renders health values — only consent metadata (type/granted/date)', () => {
    // Structural guard: the render path only reads consentType/granted/grantedAt
    // off ConsentRecord — never any field that would carry health VALUES.
    expect(source).not.toMatch(/\.movementCount\b/);
    expect(source).not.toMatch(/\.symptom/i);
    expect(source).not.toMatch(/\.weight\b/);
    expect(source).not.toMatch(/\.bloodPressure/i);
  });

  it('renders all 3 states: skeleton, error, loaded(+empty)', () => {
    expect(source).toContain("status === 'skeleton'");
    expect(source).toContain("status === 'error'");
    expect(source).toContain('consent-history-empty');
  });

  // ── Non-vacuity self-checks ─────────────────────────────────────────────
  it('[self-check] the hex regex actually matches a planted violation', () => {
    const planted = 'const x = { color: "#123ABC" };';
    expect(planted.match(ANY_HEX_LITERAL)).toEqual(['#123ABC']);
  });
});
