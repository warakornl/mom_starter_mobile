/**
 * pregnancySummaryCompletedSessionsGuard.test.ts
 *
 * Gap-filler added by QA: exposes DEFECT-PS-1.
 *
 * Spec reference: docs/product/pregnancy-summary.md §3.2
 *   "ห้ามใช้ getActiveSessions()/status:'in_progress'"
 *   AC US-PS4: "active/in_progress draft ไม่ถูกนับ; มีเฉพาะ completed session เข้าสรุป"
 *
 * DEFECT-PS-1 (MEDIUM):
 *   PregnancySummaryScreen.tsx line 106 calls
 *     kickCountSyncStore.getActiveSessions()
 *   directly, then passes the result as `completedKickSessions`.
 *   The spec bans this method by name.  The correct source must either:
 *     (a) call a dedicated getCompletedSessions() accessor, OR
 *     (b) chain .filter(s => s.status === 'completed') on the result.
 *
 * Severity rationale:
 *   At TypeScript compile time, KickCountSessionStatus = 'completed' (union of one),
 *   so all KickCountSessionRecord objects are completed by type.  A purely runtime
 *   in-progress session lives in KickCountDraft (expo-secure-store), not in the
 *   session map, so getActiveSessions() cannot return a draft at runtime today.
 *   Severity is therefore MEDIUM (spec violation + forward-safety concern) rather
 *   than HIGH (no current runtime impact).
 *
 * These tests WILL FAIL until the fix is applied:
 *   - Add getCompletedSessions() to kickCountSyncStore, OR
 *   - Change PregnancySummaryScreen line 106 to:
 *       const sessions = kickCountSyncStore
 *         .getActiveSessions()
 *         .filter(s => s.status === 'completed');
 *
 * Tests use pure-node source inspection (same pattern as
 * pregnancySummaryReachability.test.ts).
 */

import * as fs from 'fs';
import * as path from 'path';

const SCREEN_SRC = fs.readFileSync(
  path.join(__dirname, 'PregnancySummaryScreen.tsx'),
  'utf8',
);

// Strip line comments but keep block comments intact (sufficient for these checks).
const SCREEN_SRC_NO_COMMENTS = SCREEN_SRC.replace(/\/\/[^\n]*/g, '');

const STORE_SRC = fs.readFileSync(
  path.join(__dirname, '../kickCount/kickCountSyncStore.ts'),
  'utf8',
);

// ─── Group A: Spec §3.2 — getActiveSessions() is forbidden in the summary screen ─

describe('[DEFECT-PS-1] PregnancySummaryScreen must not use getActiveSessions() directly', () => {
  it('screen source does NOT call getActiveSessions() without a completed-status filter', () => {
    // Pattern: getActiveSessions() is present but NOT followed by .filter(status)
    // Accept: no call at all, OR call immediately chained with .filter(s => s.status === 'completed')
    const raw = SCREEN_SRC_NO_COMMENTS;

    // Find each occurrence of getActiveSessions()
    const idx = raw.indexOf('getActiveSessions()');
    if (idx === -1) {
      // No call to getActiveSessions() — spec compliant (e.g. uses getCompletedSessions())
      expect(idx).toBe(-1);
      return;
    }

    // A call exists; it must be chained with a completed-status filter within 120 chars
    const after = raw.slice(idx, idx + 120);
    const hasStatusFilter =
      after.includes(".filter(s => s.status === 'completed')") ||
      after.includes('.filter((s) => s.status === \'completed\')') ||
      after.includes('getCompletedSessions()');

    expect(hasStatusFilter).toBe(true); // FAILS in current implementation
  });

  it('screen source uses getCompletedSessions() OR filters by status immediately after getActiveSessions()', () => {
    const usesCompletedMethod = SCREEN_SRC.includes('getCompletedSessions()');
    const usesFilteredActiveSessions =
      SCREEN_SRC.includes("getActiveSessions().filter(s => s.status === 'completed')") ||
      SCREEN_SRC.includes("getActiveSessions()\n") === false; // naive fallback check below

    if (usesCompletedMethod) {
      expect(usesCompletedMethod).toBe(true);
      return;
    }

    // If using getActiveSessions() it must have a status filter somewhere
    const hasFilter =
      SCREEN_SRC.includes(".filter(s => s.status === 'completed')") ||
      SCREEN_SRC.includes(".filter((s) => s.status === 'completed')");

    expect(hasFilter).toBe(true); // FAILS in current implementation
  });
});

// ─── Group B: Structural confirmation — store has completed-sessions accessor ─

describe('[DEFECT-PS-1] kickCountSyncStore should expose getCompletedSessions()', () => {
  it('kickCountSyncStore.ts exports getCompletedSessions()', () => {
    // The store should provide a dedicated accessor so callers do not need to
    // know the internal status model.  This FAILS until the accessor is added.
    expect(STORE_SRC).toContain('getCompletedSessions');
  });
});

// ─── Group C: Planted-violation self-check (non-vacuity proof) ───────────────

describe('[DEFECT-PS-1] Self-check: planted violation confirms tests are non-vacuous', () => {
  it('self-check: a source string with unfiltered getActiveSessions() DOES trigger the defect', () => {
    const badSrc = `const sessions = kickCountSyncStore.getActiveSessions();`;
    const idx = badSrc.indexOf('getActiveSessions()');
    expect(idx).not.toBe(-1); // confirms pattern is detectable

    const after = badSrc.slice(idx, idx + 120);
    const hasStatusFilter =
      after.includes(".filter(s => s.status === 'completed')") ||
      after.includes('.filter((s) => s.status === \'completed\')') ||
      after.includes('getCompletedSessions()');

    // Planted bad string should NOT pass the filter check
    expect(hasStatusFilter).toBe(false);
  });

  it('self-check: a compliant source string with .filter() passes the guard', () => {
    const goodSrc = `const sessions = kickCountSyncStore.getActiveSessions().filter(s => s.status === 'completed');`;
    const idx = goodSrc.indexOf('getActiveSessions()');
    expect(idx).not.toBe(-1);

    const after = goodSrc.slice(idx, idx + 120);
    const hasStatusFilter =
      after.includes(".filter(s => s.status === 'completed')") ||
      after.includes('.filter((s) => s.status === \'completed\')') ||
      after.includes('getCompletedSessions()');

    expect(hasStatusFilter).toBe(true);
  });

  it('self-check: a source using getCompletedSessions() is also compliant', () => {
    const goodSrc = `const sessions = kickCountSyncStore.getCompletedSessions();`;
    expect(goodSrc).toContain('getCompletedSessions()');
  });
});
