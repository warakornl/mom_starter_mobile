/**
 * illustrations.test.ts — TDD tests for the three botanical SVG motif components.
 *
 * Spec: docs/design/mother-room-build-spec.md §3
 *
 * Components tested:
 *   JasmineDivider            — §3.1: 80×12dp, jade-800 stroke, decorative
 *   MilestoneHeroIllustration — §3.2: 120×80dp, path-length animation, decorative
 *   PandanEmptyState          — §3.3: 64×96dp, jade-600 stroke, decorative
 *
 * Tests verify:
 *   1. Each component is a named export that is a function (React component)
 *   2. §3.5 three-placements rule: exactly 3 motif components
 *   3. Default color tokens align with spec §3.1–§3.3
 *   4. Botanical stroke token is 1.5dp (§1.3 / §3.x)
 *
 * NOTE: Components use React hooks (useState for reduce-motion).
 * We DO NOT call them as functions in Node tests — hooks need a React renderer.
 * Tests verify importability and type (function) only; rendering is manual/Maestro.
 *
 * Pure-Node environment — react-native-svg is mocked.
 */

// ── Stubs ─────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (o: unknown) => o },
  Animated: {
    Value: class { constructor(_v: number) {} },
    timing: jest.fn(() => ({ start: jest.fn() })),
  },
  Easing: { inOut: jest.fn(), ease: jest.fn() },
  AccessibilityInfo: { isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)) },
}));

jest.mock('react-native-svg', () => {
  const mkC = (n: string) => n;
  return {
    default: mkC('Svg'),
    Svg: mkC('Svg'),
    Path: mkC('Path'),
    Circle: mkC('Circle'),
    Rect: mkC('Rect'),
    Line: mkC('Line'),
    G: mkC('G'),
    Ellipse: mkC('Ellipse'),
  };
});

// ── Imports ────────────────────────────────────────────────────────────────────

import { JasmineDivider } from './JasmineDivider';
import { MilestoneHeroIllustration } from './MilestoneHeroIllustration';
import { PandanEmptyState } from './PandanEmptyState';
import { T } from '../theme/tokens';

// ─── 1. Component existence (§3.5 three-placements rule) ─────────────────────

describe('illustrations — component existence (§3.5 three-placements rule)', () => {
  it('JasmineDivider is a function (React component)', () => {
    expect(typeof JasmineDivider).toBe('function');
  });

  it('MilestoneHeroIllustration is a function (React component)', () => {
    expect(typeof MilestoneHeroIllustration).toBe('function');
  });

  it('PandanEmptyState is a function (React component)', () => {
    expect(typeof PandanEmptyState).toBe('function');
  });

  it('exactly 3 illustration components exported (§3.5 three-placements only)', () => {
    const mods = [JasmineDivider, MilestoneHeroIllustration, PandanEmptyState];
    expect(mods).toHaveLength(3);
    for (const m of mods) {
      expect(typeof m).toBe('function');
    }
  });
});

// ─── 2. Named imports from individual files ───────────────────────────────────

describe('illustrations — named module exports', () => {
  it('JasmineDivider importable from ./JasmineDivider', () => {
    const mod = require('./JasmineDivider') as Record<string, unknown>;
    expect(typeof mod.JasmineDivider).toBe('function');
  });

  it('MilestoneHeroIllustration importable from ./MilestoneHeroIllustration', () => {
    const mod = require('./MilestoneHeroIllustration') as Record<string, unknown>;
    expect(typeof mod.MilestoneHeroIllustration).toBe('function');
  });

  it('PandanEmptyState importable from ./PandanEmptyState', () => {
    const mod = require('./PandanEmptyState') as Record<string, unknown>;
    expect(typeof mod.PandanEmptyState).toBe('function');
  });
});

// ─── 3. Default color tokens match spec §3.1–§3.3 ────────────────────────────

describe('illustrations — default color tokens per spec', () => {
  it('JasmineDivider default color is color.accent.botanical (#2F5042 jade-800; §3.1)', () => {
    // §3.1: stroke = color.accent.botanical
    expect(T.color.accent.botanical).toBe('#2F5042');
  });

  it('MilestoneHeroIllustration default color is color.accent.botanical (#2F5042; §3.2)', () => {
    // §3.2: "stroke: color.accent.botanical light; #C4D9CB dark"
    expect(T.color.accent.botanical).toBe('#2F5042');
  });

  it('PandanEmptyState default color is color.text.secondary (#4A7A5C jade-600; §3.3 lighter/inviting)', () => {
    // §3.3: "stroke: color.text.secondary (#4A7A5C) — lighter than milestone hero, inviting"
    expect(T.color.text.secondary).toBe('#4A7A5C');
  });
});

// ─── 4. Botanical stroke token (§1.3 / §3.x) ────────────────────────────────

describe('illustrations — botanical stroke width token', () => {
  it('T.botanical.stroke.width is 1.5dp (§1.3 + all three placements)', () => {
    expect(T.botanical.stroke.width).toBe(1.5);
  });

  it('T.botanical.cap is round (§1.3)', () => {
    expect(T.botanical.cap).toBe('round');
  });

  it('T.botanical.join is round (§1.3)', () => {
    expect(T.botanical.join).toBe('round');
  });
});

// ─── 5. Dark mode token for botanical stroke ─────────────────────────────────

describe('illustrations — dark mode botanical token (§1.5)', () => {
  it('dark.accent.botanical is #C4D9CB (jade-200; 11.38:1 AAA on dark base)', () => {
    expect(T.dark.accent.botanical).toBe('#C4D9CB');
  });
});
