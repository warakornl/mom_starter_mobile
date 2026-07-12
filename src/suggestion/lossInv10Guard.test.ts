/**
 * lossInv10Guard.test.ts — ENFORCEMENT TEST for LOSS-INV-10.
 *
 * Invariant (functional-spec §2 / data-model L516 / legal L-15.7 / DPIA §6.1(b) /
 * Z-8 permanent-lock): the pregnancy-loss signals — `loss_date`/`lossDate` and the
 * `lifecycle === 'ended'` loss state — MUST NEVER be read into any
 * advertising / product-selection / targeting / recommendation / suggestion DECISION.
 *
 * The Suggestion engine is the ONLY product-selection / recommendation surface in the
 * app (Milk-Code-compliant: no feeding ad/targeting). This test is a deterministic,
 * fail-on-revert STRUCTURAL guard over that surface. It replaces the code-comment-only
 * enforcement the DPIA flagged as insufficient (a launch-gate condition).
 *
 * What it enforces on the decision surface (suggestionEngine.ts + suggestionCatalog.ts +
 * the SuggestionContext engine input type):
 *
 *   R1  The engine decision logic MUST NOT reference `lossDate` / `loss_date` at all.
 *   R2  The engine INPUT type (SuggestionContext) MUST NOT carry a loss-date field.
 *   R3  The ONLY use of `lifecycle === 'ended'` in the engine is a SUPPRESS gate
 *       (`return []`) — it must NEVER select, include, filter-IN, prioritise, or
 *       branch a suggestion ON. i.e. loss state may turn suggestions OFF, never
 *       steer WHICH suggestion is shown.
 *   R4  The static catalog MUST NOT list 'ended' among any entry's applicableLifecycles
 *       (no suggestion is ever *targeted at* the loss state).
 *
 * Design: pure-node source inspection (same pattern as
 * pregnancySummaryCompletedSessionsGuard.test.ts). Non-vacuity self-checks below prove
 * each rule actually trips on a planted violation — so this goes RED if someone later
 * wires loss state into a suggestion decision.
 *
 * NOTE ON SCOPE: this guard deliberately scans the engine's DECISION files, not the
 * whole app. Display surfaces (e.g. HomeTabScreen's loss-state week-hero, which formats
 * a `lossDate` label from `profile.edd` for rendering) legitimately touch the word
 * "lossDate" for DISPLAY and are out of scope — LOSS-INV-10 forbids loss state in a
 * *decision*, not on screen. The call sites feed only `lifecycle` (as an OFF switch)
 * into getOfferable; that is asserted structurally via R3 on the engine itself.
 */

import * as fs from 'fs';
import * as path from 'path';

const ENGINE_PATH = path.join(__dirname, 'suggestionEngine.ts');
const CATALOG_PATH = path.join(__dirname, 'suggestionCatalog.ts');
const TYPES_PATH = path.join(__dirname, 'types.ts');

const ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
const CATALOG_SRC = fs.readFileSync(CATALOG_PATH, 'utf8');
const TYPES_SRC = fs.readFileSync(TYPES_PATH, 'utf8');

/** Strip line + block comments so JSDoc mentions of "lossDate" don't cause false trips. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, ''); // line comments
}

const ENGINE_CODE = stripComments(ENGINE_SRC);
const CATALOG_CODE = stripComments(CATALOG_SRC);
const TYPES_CODE = stripComments(TYPES_SRC);

// ── Reusable detectors (exported-in-spirit; also exercised by self-checks) ──────────

/** R1/R2: any reference to the loss-date field, case-insensitive, in real code. */
function referencesLossDate(code: string): boolean {
  return /loss[_]?date/i.test(code);
}

/**
 * R3: the loss lifecycle appears in a decision that INCLUDES / SELECTS a suggestion,
 * rather than the sole allowed use (return [] — a hard suppress). We flag any
 * `=== 'ended'` (or `== 'ended'`) comparison whose branch is NOT an immediate
 * empty-return. Deterministic heuristic: find each `'ended'` equality test and require
 * the nearest following statement to be `return [];`.
 */
function findEndedComparisons(code: string): string[] {
  // Match: lifecycle (any receiver) === 'ended'  /  === "ended"
  const re = /===?\s*['"]ended['"]/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // Capture a 40-char window AFTER the comparison to inspect the branch target.
    hits.push(code.slice(m.index, m.index + 60).replace(/\s+/g, ' ').trim());
  }
  return hits;
}

function endedComparisonIsSuppressOnly(windowAfter: string): boolean {
  // Allowed shape: `=== 'ended') return [];`  (a hard suppress / empty result)
  return /return\s*\[\s*\]/.test(windowAfter);
}

// ── R1: engine decision logic must not reference loss_date/lossDate ────────────────

describe('[LOSS-INV-10] Suggestion engine must not read the loss date', () => {
  it('suggestionEngine.ts contains no loss_date / lossDate reference in real code', () => {
    expect(referencesLossDate(ENGINE_CODE)).toBe(false);
  });

  it('suggestionCatalog.ts contains no loss_date / lossDate reference in real code', () => {
    expect(referencesLossDate(CATALOG_CODE)).toBe(false);
  });
});

// ── R2: the engine INPUT type must not carry a loss-date field ─────────────────────

describe('[LOSS-INV-10] SuggestionContext (engine input) must not carry a loss date', () => {
  it('types.ts SuggestionContext interface declares no lossDate field', () => {
    const start = TYPES_CODE.indexOf('interface SuggestionContext');
    expect(start).toBeGreaterThan(-1);
    const braceStart = TYPES_CODE.indexOf('{', start);
    const braceEnd = TYPES_CODE.indexOf('}', braceStart);
    const body = TYPES_CODE.slice(braceStart, braceEnd);
    expect(referencesLossDate(body)).toBe(false);
  });
});

// ── R3: loss lifecycle may only SUPPRESS (return []), never select/include ─────────

describe("[LOSS-INV-10] lifecycle==='ended' in the engine is suppress-only, never a targeting branch", () => {
  it('every ended-comparison in suggestionEngine.ts leads to an empty-result suppress', () => {
    const hits = findEndedComparisons(ENGINE_CODE);
    // There must be at least the one known suppress gate (non-vacuity within the file).
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(endedComparisonIsSuppressOnly(h)).toBe(true);
    }
  });
});

// ── R4: no catalog entry is TARGETED AT the loss state ─────────────────────────────

describe('[LOSS-INV-10] No suggestion is applicable to the ended (loss) lifecycle', () => {
  it("suggestionCatalog.ts lists no 'ended' in any applicableLifecycles", () => {
    // Any occurrence of the 'ended' literal in the catalog code would mean a suggestion
    // is being offered *into* loss state — forbidden.
    expect(/['"]ended['"]/.test(CATALOG_CODE)).toBe(false);
  });
});

// ── Non-vacuity self-checks: prove each rule TRIPS on a planted violation ───────────

describe('[LOSS-INV-10] Self-check: guard is non-vacuous (goes RED on a planted leak)', () => {
  it('R1 detector flags loss_date and lossDate leaks', () => {
    expect(referencesLossDate(`if (ctx.lossDate) return picks;`)).toBe(true);
    expect(referencesLossDate(`query.where(loss_date)`)).toBe(true);
    expect(referencesLossDate(`const week = ctx.gestationalWeek;`)).toBe(false);
  });

  it("R3 detector flags an ended-branch that SELECTS instead of suppressing", () => {
    // Planted leak: loss state steers WHICH suggestion is returned (targeting).
    const leak = `if (ctx.lifecycle === 'ended') return griefProductPicks;`;
    const hits = findEndedComparisons(leak);
    expect(hits.length).toBe(1);
    expect(endedComparisonIsSuppressOnly(hits[0])).toBe(false); // → guard RED
  });

  it('R3 detector passes the real suppress-only shape', () => {
    const ok = `if (ctx.lifecycle === 'ended') return [];`;
    const hits = findEndedComparisons(ok);
    expect(hits.length).toBe(1);
    expect(endedComparisonIsSuppressOnly(hits[0])).toBe(true); // → guard GREEN
  });

  it("R4 detector flags a catalog entry targeted at 'ended'", () => {
    const badCatalog = `applicableLifecycles: ['ended'],`;
    expect(/['"]ended['"]/.test(badCatalog)).toBe(true); // → guard RED
  });
});
