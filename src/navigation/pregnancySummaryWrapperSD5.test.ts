/**
 * pregnancySummaryWrapperSD5.test.ts — unit test for PregnancySummaryWrapper SD-5 path.
 *
 * SD-5 security path (LOW gap, worth testing — security correctness):
 *   PregnancySummaryWrapper GETs the pregnancy profile on mount.
 *   If the GET returns 401 OR there is no access token, onSessionExpired() must
 *   be called.  In RootNavigator.tsx, onSessionExpired is wired to performLogout
 *   (full health-store teardown → navigate to Welcome), matching the ProfileEdit /
 *   ProfileInfoEdit pattern.
 *
 * INV-PS4 note:
 *   The own-data gap (only the token owner can see their data) is enforced
 *   server-side by the auth/ownership check on GET /v1/pregnancy-profile.
 *   Architectural / token-scoped — no client-side build needed.  Left as a
 *   noted follow-up per QA triage.
 *
 * Approach: pure-node source inspection (no RNTL).
 *   Mirrors pregnancySummaryReachability.test.ts.
 *   PregnancySummaryWrapper is not separately exported (it lives inside
 *   RootNavigator.tsx as a local component), so source inspection is the
 *   correct lightweight test strategy — identical to how this codebase tests
 *   other navigation-layer SD-5 wiring.
 *
 * Tests are non-vacuous: they inspect the actual source block and would FAIL
 * if the onSessionExpired() calls or the 401/no-token guards were removed.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Source under test ────────────────────────────────────────────────────────

const ROOT_NAVIGATOR_SRC = fs.readFileSync(
  path.join(__dirname, 'RootNavigator.tsx'),
  'utf8',
);

// ─── Extract PregnancySummaryWrapper component block ─────────────────────────

/**
 * Extracts the source text of the PregnancySummaryWrapper function from
 * RootNavigator.tsx.  Uses the next top-level function declaration as the
 * end boundary (same heuristic used in extractScreenBlock in other tests).
 */
function extractWrapperBlock(src: string): string {
  const startMarker = 'function PregnancySummaryWrapper(';
  const start = src.indexOf(startMarker);
  if (start === -1) return '';
  // Find the next top-level function declaration after the wrapper
  const nextFnIdx = src.indexOf('\nfunction ', start + startMarker.length);
  return nextFnIdx === -1 ? src.slice(start) : src.slice(start, nextFnIdx);
}

/**
 * Extracts the Stack.Screen block for the named route from RootNavigator.tsx.
 * Returns text from `name="<route>"` through the following `</Stack.Screen>`.
 */
function extractScreenBlock(src: string, routeName: string): string {
  const marker = `name="${routeName}"`;
  const start = src.indexOf(marker);
  if (start === -1) return '';
  const endMarker = '</Stack.Screen>';
  const end = src.indexOf(endMarker, start);
  return end === -1 ? src.slice(start) : src.slice(start, end + endMarker.length);
}

const WRAPPER_BLOCK = extractWrapperBlock(ROOT_NAVIGATOR_SRC);
const SUMMARY_SCREEN_BLOCK = extractScreenBlock(ROOT_NAVIGATOR_SRC, 'PregnancySummary');

// ─── Sanity: blocks were extracted (guard against test setup errors) ──────────

describe('[SD-5] PregnancySummaryWrapper — source extraction sanity', () => {
  it('PregnancySummaryWrapper function block is non-empty', () => {
    expect(WRAPPER_BLOCK.length).toBeGreaterThan(0);
  });

  it('PregnancySummary Stack.Screen block is non-empty', () => {
    expect(SUMMARY_SCREEN_BLOCK.length).toBeGreaterThan(0);
  });
});

// ─── A: Wrapper prop interface includes onSessionExpired ─────────────────────

describe('[SD-5] PregnancySummaryWrapper — onSessionExpired prop', () => {
  it('wrapper declares onSessionExpired in its props interface', () => {
    // PregnancySummaryWrapperProps must include onSessionExpired: () => void
    expect(ROOT_NAVIGATOR_SRC).toContain('onSessionExpired: () => void');
  });

  it('wrapper destructures / accepts onSessionExpired prop', () => {
    expect(WRAPPER_BLOCK).toContain('onSessionExpired');
  });
});

// ─── B: No-token path (SD-5 first branch) ────────────────────────────────────

describe('[SD-5] PregnancySummaryWrapper — no-token → onSessionExpired()', () => {
  it('wrapper loads accessToken from tokenStorage', () => {
    expect(WRAPPER_BLOCK).toContain('tokenStorage.load()');
    expect(WRAPPER_BLOCK).toContain('accessToken');
  });

  it('wrapper calls onSessionExpired() when accessToken is missing (no-token path)', () => {
    // Pattern: !accessToken → onSessionExpired()
    // Both the condition and the call must be present in the wrapper block.
    const hasNoTokenCondition =
      WRAPPER_BLOCK.includes('!accessToken') ||
      WRAPPER_BLOCK.includes('accessToken == null') ||
      WRAPPER_BLOCK.includes('accessToken === null') ||
      WRAPPER_BLOCK.includes('accessToken === undefined');
    expect(hasNoTokenCondition).toBe(true);
    expect(WRAPPER_BLOCK).toContain('onSessionExpired()');
  });

  it('wrapper returns early after onSessionExpired() on no-token (does not proceed to GET)', () => {
    // The no-token branch must return; it must not call getProfile without a token.
    // Heuristic: 'return;' appears after the !accessToken guard within the wrapper.
    const noTokenIdx = WRAPPER_BLOCK.indexOf('!accessToken');
    const returnAfterIdx = WRAPPER_BLOCK.indexOf('return;', noTokenIdx);
    expect(noTokenIdx).toBeGreaterThan(-1);
    expect(returnAfterIdx).toBeGreaterThan(noTokenIdx);
  });
});

// ─── C: 401 GET response path (SD-5 second branch) ───────────────────────────

describe('[SD-5] PregnancySummaryWrapper — GET 401 → onSessionExpired()', () => {
  it('wrapper checks for HTTP 401 status from getProfile result', () => {
    expect(WRAPPER_BLOCK).toContain('401');
  });

  it('wrapper calls onSessionExpired() on GET 401 (server-expired token path)', () => {
    // The 401 branch must also call onSessionExpired().
    const idx401 = WRAPPER_BLOCK.indexOf('401');
    const onSessionExpiredAfter = WRAPPER_BLOCK.indexOf('onSessionExpired()', idx401);
    expect(idx401).toBeGreaterThan(-1);
    expect(onSessionExpiredAfter).toBeGreaterThan(-1);
  });

  it('wrapper calls onSessionExpired() at least twice — one for no-token, one for 401', () => {
    // Non-vacuity: both paths must be present independently.
    const occurrences = (WRAPPER_BLOCK.match(/onSessionExpired\(\)/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

// ─── D: RootNavigator wires onSessionExpired → performLogout ─────────────────

describe('[SD-5] RootNavigator — PregnancySummary onSessionExpired wired to performLogout', () => {
  it('PregnancySummary Stack.Screen passes onSessionExpired to PregnancySummaryWrapper', () => {
    expect(SUMMARY_SCREEN_BLOCK).toContain('onSessionExpired');
  });

  it('PregnancySummary onSessionExpired is wired to performLogout (full teardown, not navigate-only)', () => {
    // SD-5 regression: navigate-only was the bug in SettingsScreen (sessionExpiredRunner).
    // Here too, onSessionExpired MUST invoke performLogout, which clears tokens +
    // all health stores before navigating to Welcome.
    expect(SUMMARY_SCREEN_BLOCK).toContain('performLogout');
  });

  it('PregnancySummary performLogout includes clearTokens (tokens cleared before navigate)', () => {
    // clearTokens must be among the deps passed to performLogout so that the
    // access + refresh tokens are wiped before the user reaches Welcome.
    expect(SUMMARY_SCREEN_BLOCK).toContain('clearTokens');
  });

  it('PregnancySummary performLogout includes resetKickCountStore (PHI cleared on 401)', () => {
    // Health stores must be cleared — kick count contains movement-count health data.
    expect(SUMMARY_SCREEN_BLOCK).toContain('resetKickCountStore');
  });
});
