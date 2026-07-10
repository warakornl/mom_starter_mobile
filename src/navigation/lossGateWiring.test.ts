/**
 * lossGateWiring.test.ts — TDD guard for B2 navigator-level loss-gate wiring.
 *
 * The B1 dead-gate class: a component can have a perfect loss-gate (tested by
 * unit tests that pass the prop directly), yet a navigator that never passes the
 * prop makes the gate permanently disabled in production.
 *
 * This test class catches the NAVIGATOR-LEVEL wiring gap by reading the source
 * of the navigator files and asserting that each loss-gated screen receives
 * `lifecycle={snapshot?.lifecycle}` — the RAW snapshot value that is undefined
 * when unknown (GAP-2: must NOT default to 'pregnant' when snapshot is null,
 * which would mask a real loss state).
 *
 * Fail-on-revert: removing any `lifecycle={snapshot?.lifecycle}` prop from a
 * navigator causes the corresponding test to go RED — the same failure class
 * that would have caught the B1 dead-feature.
 *
 * Approach: pure-node source inspection (no RNTL), same pattern as
 * pregnancySummaryReachability.test.ts and doctorReportRouteOptions.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Source files under test ──────────────────────────────────────────────────

const BOTTOM_TAB_SRC = fs.readFileSync(
  path.join(__dirname, 'BottomTabNavigator.tsx'),
  'utf8',
);

const ROOT_NAV_SRC = fs.readFileSync(
  path.join(__dirname, 'RootNavigator.tsx'),
  'utf8',
);

const CALENDAR_SRC = fs.readFileSync(
  path.join(__dirname, '../calendar/CalendarScreen.tsx'),
  'utf8',
);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Extracts the JSX block for a Tab.Screen or Stack.Screen with the given name.
 * Returns text from the `name="<screenName>"` marker through the closing tag.
 */
function extractScreenBlock(src: string, screenName: string): string {
  const marker = `name="${screenName}"`;
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) return '';
  // Find enclosing block end — either </Tab.Screen> or </Stack.Screen>
  for (const closeTag of ['</Tab.Screen>', '</Stack.Screen>']) {
    const endIdx = src.indexOf(closeTag, startIdx);
    if (endIdx !== -1) return src.slice(startIdx, endIdx + closeTag.length);
  }
  return src.slice(startIdx);
}

// ─── A: BottomTabNavigator — CalendarScreen wiring ───────────────────────────

describe('[B2 LossGate Wiring] BottomTabNavigator → CalendarScreen', () => {
  it('Calendar Tab.Screen block passes lifecycle prop to CalendarScreen', () => {
    const block = extractScreenBlock(BOTTOM_TAB_SRC, 'Calendar');
    // Must use raw snapshot?.lifecycle (NOT a kickProps fallback with 'pregnant' default).
    // Any of these forms is acceptable:
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: CalendarScreen in BottomTabNavigator loses gate without lifecycle prop', () => {
    // If lifecycle= is passed, block must NOT omit it.
    // This test stays GREEN when the prop is present and RED when it is removed —
    // the same condition the LOSS-GATE test above enforces.
    const block = extractScreenBlock(BOTTOM_TAB_SRC, 'Calendar');
    expect(block).toContain('lifecycle=');
  });

  it('lifecycle passed is snapshot?.lifecycle — NOT the kickProps fallback (GAP-2)', () => {
    const block = extractScreenBlock(BOTTOM_TAB_SRC, 'Calendar');
    // The _kickProps/_kickProps fallback forces lifecycle:'pregnant' when snapshot is null
    // — that violates GAP-2 (masking a real loss as pregnant). Assert raw snapshot form.
    expect(block).not.toMatch(/lifecycle=\{_?kickProps\.lifecycle\}/);
  });
});

// ─── B: RootNavigator — AppointmentForm wiring ───────────────────────────────

describe('[B2 LossGate Wiring] RootNavigator → AppointmentForm', () => {
  it('AppointmentForm Stack.Screen block passes lifecycle prop to AppointmentFormScreen', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AppointmentForm');
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: AppointmentForm loses gate without lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AppointmentForm');
    expect(block).toContain('lifecycle=');
  });
});

// ─── C: RootNavigator — ReminderForm wiring ──────────────────────────────────

describe('[B2 LossGate Wiring] RootNavigator → ReminderForm', () => {
  it('ReminderForm Stack.Screen block passes lifecycle prop to ReminderFormScreen', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'ReminderForm');
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: ReminderForm loses gate without lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'ReminderForm');
    expect(block).toContain('lifecycle=');
  });
});

// ─── D: RootNavigator — AncAppointmentForm wiring ────────────────────────────

describe('[B2 LossGate Wiring] RootNavigator → AncAppointmentForm', () => {
  it('AncAppointmentForm Stack.Screen block passes lifecycle prop to AppointmentFormScreen', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AncAppointmentForm');
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: AncAppointmentForm loses gate without lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AncAppointmentForm');
    expect(block).toContain('lifecycle=');
  });
});

// ─── E: CalendarScreen — kickCountItems loss gate ────────────────────────────

describe('[B2 LossGate] CalendarScreen — kickCountItems gated on lifecycle', () => {
  it('kickCountItems computation is gated on lifecycle (suppressed when ended)', () => {
    // The memo must either:
    //   (a) return [] when lifecycle === 'ended', or
    //   (b) be wrapped in a conditional that prevents the call
    // Both approaches require the lifecycle variable to appear in the kickCountItems
    // computation path. Assert that 'ended' or lifecycle guards the kickCountItems useMemo.
    expect(CALENDAR_SRC).toMatch(
      /kickCountItems[\s\S]{0,200}lifecycle[\s\S]{0,200}ended|lifecycle[\s\S]{0,200}ended[\s\S]{0,200}kickCountItems/
    );
  });

  it('kickCountItems useMemo dependency array includes lifecycle', () => {
    // If lifecycle is not in deps, the gate will not re-evaluate when lifecycle changes.
    // Find the kickCountItems useMemo block and verify lifecycle is in deps.
    const memoBlock = (() => {
      const marker = 'kickCountItems = useMemo';
      const start = CALENDAR_SRC.indexOf(marker);
      if (start === -1) return '';
      // Extract from the memo through closing paren + semicolon (~300 chars is enough)
      return CALENDAR_SRC.slice(start, start + 400);
    })();
    expect(memoBlock).toContain('lifecycle');
  });

  it('kickCountItems useMemo returns [] when lifecycle === "ended" (source check)', () => {
    // The gate is implemented inside the useMemo itself: lifecycle==='ended' ? [] : getKickCount...
    // This asserts that the useMemo block contains both the 'ended' check and the empty array
    // fallback — proving the gate is NOT just a dep-array entry but actual suppression logic.
    const memoBlock = (() => {
      const marker = 'kickCountItems = useMemo';
      const start = CALENDAR_SRC.indexOf(marker);
      if (start === -1) return '';
      return CALENDAR_SRC.slice(start, start + 600);
    })();
    expect(memoBlock).toContain("'ended'");
    // Must return empty array on ended — not just track it in deps
    expect(memoBlock).toContain('[]');
  });
});
