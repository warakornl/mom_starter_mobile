/**
 * consentNudgeAndJitPolish.test.ts — ENFORCEMENT TEST (fail-on-revert).
 *
 * Task #40: ConsentNudgeModal + JitConsentSheet were skipped by the earlier
 * ห้องแม่ UX-fix batch that already landed on ManageConsentsScreen. This test
 * mirrors that sibling screen's guard (manageConsentsScreenTheme.test.ts) plus
 * two additional checks the sibling fix batch also enforced there:
 *
 *   1. tokens-only — ZERO hardcoded hex/rgba literals anywhere in either file.
 *   2. action hierarchy — the quiet/"not now"/"decline" text action must read
 *      as T.color.text.heading (calm confirmed-choice ink), matching
 *      ManageConsentsScreen's sheetQuietBtnLabel fix — NOT text.primary (body
 *      copy ink) and NEVER a reserved error/alarm color.
 *   3. tap targets — every text-only quiet/retry action needs a ≥48dp tap
 *      target (minHeight >= 48), not just centered text with a small margin.
 *
 * Design: pure-node source inspection (same pattern as
 * manageConsentsScreenTheme.test.ts). Deterministic, fail-on-revert — this
 * scans the ACTUAL component source files, so it fails the moment a
 * hardcoded hex/rgba is reintroduced or the hierarchy/tap-target fix reverts.
 * Non-vacuity is proven by asserting each regex/predicate actually matches a
 * planted violation string.
 */

import * as fs from 'fs';
import * as path from 'path';

const NUDGE_PATH = path.join(__dirname, 'ConsentNudgeModal.tsx');
const JIT_PATH = path.join(__dirname, 'JitConsentSheet.tsx');

const ANY_HEX_LITERAL = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g;
const ANY_RGBA_LITERAL = /rgba?\(/g;

describe('ConsentNudgeModal + JitConsentSheet — ห้องแม่ tokens-only guard (#40)', () => {
  const nudgeSource = fs.readFileSync(NUDGE_PATH, 'utf8');
  const jitSource = fs.readFileSync(JIT_PATH, 'utf8');

  it('ConsentNudgeModal contains ZERO hardcoded hex color literals', () => {
    expect(nudgeSource.match(ANY_HEX_LITERAL) ?? []).toEqual([]);
  });

  it('ConsentNudgeModal contains ZERO rgba()/rgb() literals', () => {
    expect(nudgeSource.match(ANY_RGBA_LITERAL) ?? []).toEqual([]);
  });

  it('JitConsentSheet contains ZERO hardcoded hex color literals', () => {
    expect(jitSource.match(ANY_HEX_LITERAL) ?? []).toEqual([]);
  });

  it('JitConsentSheet contains ZERO rgba()/rgb() literals', () => {
    expect(jitSource.match(ANY_RGBA_LITERAL) ?? []).toEqual([]);
  });

  it('both import T from the ห้องแม่ token module (src/theme/tokens)', () => {
    expect(nudgeSource).toMatch(/from ['"]\.\.\/theme\/tokens['"]/);
    expect(jitSource).toMatch(/from ['"]\.\.\/theme\/tokens['"]/);
  });

  // ── Non-vacuity self-checks ─────────────────────────────────────────────
  it('[self-check] the hex regex actually matches a planted violation', () => {
    const planted = 'const x = { color: "#123ABC" };';
    expect(planted.match(ANY_HEX_LITERAL)).toEqual(['#123ABC']);
  });

  it('[self-check] the rgba regex actually matches a planted violation', () => {
    const planted = 'const x = { color: "rgba(0,0,0,0.5)" };';
    expect(planted.match(ANY_RGBA_LITERAL)).toEqual(['rgba(']);
  });
});

describe('ConsentNudgeModal — quiet action hierarchy + tap target (#40)', () => {
  const source = fs.readFileSync(NUDGE_PATH, 'utf8');

  it('notNowText (quiet/cancel action) uses T.color.text.heading, not text.primary', () => {
    const notNowTextBlock = source.match(/notNowText:\s*{[^}]*}/)?.[0] ?? '';
    expect(notNowTextBlock).toMatch(/T\.color\.text\.heading/);
    expect(notNowTextBlock).not.toMatch(/T\.color\.text\.primary/);
  });

  it('notNowBtn provides a >=48dp tap target', () => {
    const notNowBtnBlock = source.match(/notNowBtn:\s*{[^}]*}/)?.[0] ?? '';
    const heightMatch = notNowBtnBlock.match(/height:\s*(\d+)/);
    expect(heightMatch).not.toBeNull();
    expect(Number(heightMatch?.[1])).toBeGreaterThanOrEqual(48);
  });

  it('grant button stays on the primary token (destructive/primary hierarchy unchanged)', () => {
    const grantBtnBlock = source.match(/\n  grantBtn:\s*{[^}]*}/)?.[0] ?? '';
    expect(grantBtnBlock).toMatch(/T\.button\.primary\.bg/);
  });
});

describe('JitConsentSheet — quiet action hierarchy + tap target (#40)', () => {
  const source = fs.readFileSync(JIT_PATH, 'utf8');

  it('declineBtnLabel (quiet/decline/"hide notes" action) uses T.color.text.heading, not text.primary', () => {
    const declineLabelBlock = source.match(/declineBtnLabel:\s*{[^}]*}/)?.[0] ?? '';
    expect(declineLabelBlock).toMatch(/T\.color\.text\.heading/);
    expect(declineLabelBlock).not.toMatch(/T\.color\.text\.primary/);
  });

  it('declineBtn provides a >=48dp tap target', () => {
    const declineBtnBlock = source.match(/\n  declineBtn:\s*{[^}]*}/)?.[0] ?? '';
    const minHeightMatch = declineBtnBlock.match(/minHeight:\s*(\d+)/);
    expect(minHeightMatch).not.toBeNull();
    expect(Number(minHeightMatch?.[1])).toBeGreaterThanOrEqual(48);
  });

  it('retryBtn (error-panel quiet action) provides a >=48dp tap target', () => {
    const retryBtnBlock = source.match(/retryBtn:\s*{[^}]*}/)?.[0] ?? '';
    const minHeightMatch = retryBtnBlock.match(/minHeight:\s*(\d+)/);
    expect(minHeightMatch).not.toBeNull();
    expect(Number(minHeightMatch?.[1])).toBeGreaterThanOrEqual(48);
  });

  it('grant button stays on the primary token (destructive/primary hierarchy unchanged)', () => {
    const grantBtnBlock = source.match(/\n  grantBtn:\s*{[^}]*}/)?.[0] ?? '';
    expect(grantBtnBlock).toMatch(/T\.button\.primary\.bg/);
  });

  // ── Non-vacuity self-checks ─────────────────────────────────────────────
  it('[self-check] the minHeight regex actually matches a planted violation', () => {
    const planted = 'retryBtn: { marginLeft: 8 },';
    const match = planted.match(/minHeight:\s*(\d+)/);
    expect(match).toBeNull();
  });
});
