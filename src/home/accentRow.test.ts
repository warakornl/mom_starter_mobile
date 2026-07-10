/**
 * accentRow.test.ts — TDD for AccentRow component (§4.1 left-accent-bar rows)
 *
 * Spec: docs/design/mother-room-build-spec.md §4.1
 *
 * AccentRow is the shared list-row component used in HomeTabScreen:
 *   - Left 3dp vertical accent bar (color by row type)
 *   - Full row tappable (minHeight ≥56dp, full screen width)
 *   - Two row types:
 *       'pregnancy' → roselle-500 (#B85C78) — kick-count, symptoms
 *       'health'    → jade-800   (#2F5042)  — appointments, medications
 *
 * Pure-Node environment — react-native mocked.
 */

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (o: unknown) => o },
}));

import { AccentRow } from './AccentRow';
import { T } from '../theme/tokens';

// ─── 1. Component existence ────────────────────────────────────────────────────

describe('AccentRow — component existence (§4.1)', () => {
  it('AccentRow is exported from src/home/AccentRow', () => {
    expect(typeof AccentRow).toBe('function');
  });

  it('AccentRow is a function (React component)', () => {
    expect(typeof AccentRow).toBe('function');
  });
});

// ─── 2. Accent bar color tokens (§4.1 left-accent-bar spec) ──────────────────

describe('AccentRow — accent bar color tokens (§4.1)', () => {
  it('T.list.row.accentBar.pregnancy is roselle-500 #B85C78 (pregnancy row bar; §4.1)', () => {
    // pregnancy rows: ▌ = roselle-500 3dp accent bar
    expect(T.list.row.accentBar.pregnancy).toBe('#B85C78');
  });

  it('T.list.row.accentBar.health is jade-800 #2F5042 (health/appointment row bar; §4.1)', () => {
    // health rows: ▌ = jade-800 3dp accent bar
    expect(T.list.row.accentBar.health).toBe('#2F5042');
  });

  it('T.list.row.accentBar.width is 3 (3dp spec; §4.1)', () => {
    expect(T.list.row.accentBar.width).toBe(3);
  });

  it('T.list.row.minHeight is 56 (≥48dp tap target + vertical padding; §4.1)', () => {
    expect(T.list.row.minHeight).toBe(56);
  });
});

// ─── 3. CTA card tokens (§4.1 amber CTA — primary button) ────────────────────

describe('HomeTabScreen — amber CTA card tokens (§4.1)', () => {
  it('T.button.primary.bg is amber-700 #9A5F0A (sole interactive accent; §4.1)', () => {
    expect(T.button.primary.bg).toBe('#9A5F0A');
  });

  it('T.button.primary.height is 52dp (§4.1 CTA height spec)', () => {
    expect(T.button.primary.height).toBe(52);
  });

  it('T.button.primary.text is #FFFFFF (white on amber-700, sufficient contrast)', () => {
    expect(T.button.primary.text).toBe('#FFFFFF');
  });

  it('T.button.primary.radius is 12dp (radius.md; §4.1)', () => {
    expect(T.button.primary.radius).toBe(12);
  });
});

// ─── 4. Progress fill token (§4.1 progress line) ─────────────────────────────

describe('HomeTabScreen — progress line tokens (§4.1)', () => {
  it('T.progress.fill.color is amber-600 #B8720E (progress line fill; §4.1)', () => {
    expect(T.progress.fill.color).toBe('#B8720E');
  });

  it('T.progress.track.color is ivory-200 / divider #E8DDD5 (progress track; §4.1)', () => {
    expect(T.progress.track.color).toBe('#E8DDD5');
  });

  it('T.progress.height is 4 (4dp track; §4.1)', () => {
    expect(T.progress.height).toBe(4);
  });
});

// ─── 5. Week hero token (§4.1 display tier) ──────────────────────────────────

describe('HomeTabScreen — week hero tokens (§4.1)', () => {
  it('T.type.display.size is 32 (32sp week hero text; §4.1)', () => {
    expect(T.type.display.size).toBe(32);
  });

  it('T.type.display.lineHeight is 52 (52sp ≥1.6× Thai rule; §0 R2)', () => {
    expect(T.type.display.lineHeight).toBe(52);
  });

  it('T.type.display.fontFamily is Sarabun-SemiBold (§2 Sarabun for Thai text)', () => {
    expect(T.type.display.fontFamily).toBe('Sarabun-SemiBold');
  });

  it('T.color.text.heading is roselle-900 #4A2230 (week hero text color; §4.1)', () => {
    // "สัปดาห์ที่ 28" → color.text.heading roselle-900
    expect(T.color.text.heading).toBe('#4A2230');
  });
});

// ─── 6. Loss state — heading1 date token (§4.1 loss state matrix) ───────────

describe('HomeTabScreen — loss state tokens (§4.1 state matrix)', () => {
  it('T.type.heading1.size is 24 (loss date replaces week hero at 24sp; §4.1)', () => {
    // loss state: "10 กรกฎาคม 2569" Sarabun/600 24sp (type.heading1)
    expect(T.type.heading1.size).toBe(24);
  });

  it('T.type.heading1.lineHeight is 39 (24sp×1.625 Thai rule; §0 R2)', () => {
    expect(T.type.heading1.lineHeight).toBe(39);
  });

  it('T.type.heading1.fontFamily is Sarabun-SemiBold (loss date font)', () => {
    expect(T.type.heading1.fontFamily).toBe('Sarabun-SemiBold');
  });
});

// ─── 7. Surface token (§1.2 screen background) ───────────────────────────────

describe('HomeTabScreen — surface tokens (§1.2)', () => {
  it('T.color.surface.base is ivory-100 #FBF6F1 (screen background)', () => {
    expect(T.color.surface.base).toBe('#FBF6F1');
  });

  it('T.color.accent.identity is roselle-500 #B85C78 (cross-check for accent.botanical)', () => {
    expect(T.color.accent.identity).toBe('#B85C78');
  });
});
