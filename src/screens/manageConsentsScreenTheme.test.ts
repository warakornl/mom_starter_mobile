/**
 * manageConsentsScreenTheme.test.ts — ENFORCEMENT TEST for ห้องแม่ tokens-only styling.
 *
 * Owner-reported bug #4 (2026-07): the "จัดการความยินยอม" (ManageConsentsScreen)
 * screen's theme did not match the rest of the app's menus.
 *
 * ROOT CAUSE: the screen's entire StyleSheet was hardcoded hex color literals
 * (e.g. #A8505A, #3A2A30, #94818A, #5F4A52, #8E3A44, #FBF6F1 — several of which
 * are the explicitly BANNED deprecated Clean-palette hexes), instead of
 * importing from the single typed ห้องแม่ token source `src/theme/tokens.ts`
 * (as SettingsScreen.tsx and other known-good menu screens do via `T.color.*`,
 * `T.type.*`, `T.spacing[*]`, `T.radius.*`).
 *
 * Design: pure-node source inspection (same pattern as
 * lossInv10Guard.test.ts / pregnancySummaryCompletedSessionsGuard.test.ts).
 * Deterministic, fail-on-revert — this test scans the ACTUAL screen source
 * file, so it fails the moment a new hardcoded hex is reintroduced, and it is
 * proven non-vacuous by asserting the regex actually matches a planted
 * violation string below.
 */

import * as fs from 'fs';
import * as path from 'path';

const SCREEN_PATH = path.join(__dirname, 'ManageConsentsScreen.tsx');

/** The explicitly banned deprecated Clean-palette hexes (never allowed anywhere). */
const BANNED_CLEAN_HEXES = [
  '#94818A',
  '#A8505A',
  '#8E3A44',
  '#B85C66',
  '#4C6B57',
  '#6E9079',
  '#B96A28',
  '#C0762B',
  '#3A2A30',
  '#5F4A52',
  '#FBF3EE',
  '#E4EBE4',
];

/** Any hex color literal at all (3 or 6 hex digits) — tokens-only means NONE outside tokens.ts. */
const ANY_HEX_LITERAL = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g;

describe('ManageConsentsScreen — ห้องแม่ tokens-only guard (bug #4)', () => {
  const source = fs.readFileSync(SCREEN_PATH, 'utf8');

  it('contains ZERO banned Clean-palette hex literals', () => {
    const hits = BANNED_CLEAN_HEXES.filter((hex) => source.includes(hex));
    expect(hits).toEqual([]);
  });

  it('contains ZERO hardcoded hex color literals anywhere (tokens-only — consume T.*, never inline)', () => {
    const matches = source.match(ANY_HEX_LITERAL) ?? [];
    expect(matches).toEqual([]);
  });

  it('imports T from the ห้องแม่ token module (src/theme/tokens)', () => {
    expect(source).toMatch(/from ['"]\.\.\/theme\/tokens['"]/);
    expect(source).toMatch(/\bT\.(color|type|spacing|radius|elev)\./);
  });

  // ── Non-vacuity self-check: prove the regex/list actually catches a violation ──
  it('[self-check] the banned-hex list actually matches a planted violation', () => {
    const planted = 'const x = { color: "#94818A" };';
    const hits = BANNED_CLEAN_HEXES.filter((hex) => planted.includes(hex));
    expect(hits).toEqual(['#94818A']);
  });

  it('[self-check] the any-hex regex actually matches a planted violation', () => {
    const planted = 'const x = { color: "#123ABC" };';
    expect(planted.match(ANY_HEX_LITERAL)).toEqual(['#123ABC']);
  });
});
