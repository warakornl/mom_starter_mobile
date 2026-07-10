/**
 * PregnancySummaryScreen.test.ts — TDD tests for the pregnancy summary screen.
 *
 * Tests (no RNTL — pure-node, source-inspection + catalog checks):
 *
 * Group A: Module exports
 * Group B: Design token usage (ห้องแม่ Phase 2 B4 — T.radius.md, T.color.surface.divider, T.type.label.*)
 * Group C: Disclaimer i18n keys (VERBATIM — legal §3 G-summary-1)
 * Group D: Structural source guards (INV-PS1: no verdict/trend/badge copy in source)
 * Group E: ProfileHub prop contract (onPregnancySummary prop)
 * Group F: a11y — disclaimer link NOT trapped in accessibilityRole="text" parent
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  SafeAreaView: 'SafeAreaView',
  StyleSheet: { create: (o: unknown) => o, hairlineWidth: 0.5 },
  Alert: { alert: jest.fn() },
  Modal: 'Modal',
  Platform: { OS: 'ios' },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: jest.fn((key: string) => key),
    locale: 'th',
    setLocale: jest.fn(),
  })),
}));

// Mock the pregnancySummary pure fn
jest.mock('./pregnancySummary', () => ({
  buildPregnancySummary: jest.fn(() => ({
    needsEdd: false,
    T1: { kicks: null, medications: [] },
    T2: { kicks: null, medications: [] },
    T3: { kicks: null, medications: [] },
    delivery: null,
  })),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { catalog } from '../i18n/messages';
import { T } from '../theme/tokens';
import * as fs from 'fs';
import * as path from 'path';

// Source text for structural inspection (same pattern as pregnancySummaryLegal.test.ts)
const SCREEN_SRC = fs.readFileSync(
  path.join(__dirname, 'PregnancySummaryScreen.tsx'),
  'utf8',
);

// Strip comments before scanning (same technique as legal test K-8 check)
const stripComments = (src: string): string => {
  const noLine = src.replace(/\/\/[^\n]*/g, '');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
};
const SCREEN_SRC_NO_COMMENTS = stripComments(SCREEN_SRC);

// ─── Group A: Module exports ──────────────────────────────────────────────────

describe('PregnancySummaryScreen — module export', () => {
  it('exports PregnancySummaryScreen as a function', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./PregnancySummaryScreen') as Record<string, unknown>;
    expect(typeof mod['PregnancySummaryScreen']).toBe('function');
  });
});

// ─── Group B: Design token usage ─────────────────────────────────────────────

describe('PregnancySummaryScreen — design tokens (ห้องแม่ Phase 2 B4)', () => {
  it('uses T.radius.md=12 for card radius (B4: replaces deprecated T.cardRadius alias)', () => {
    expect(T.radius.md).toBe(12);
    // Source must reference T.radius.md (B4 replaced T.cardRadius with semantic token)
    expect(SCREEN_SRC).toContain('T.radius.md');
  });

  it('uses T.color.surface.divider for dividers/borders (B4: replaces deprecated T.hairline alias)', () => {
    expect(T.color.surface.divider).toBe('#E8DDD5');
    expect(SCREEN_SRC).toContain('T.color.surface.divider');
  });

  it('uses T.type.label.* for section label styling (B4: replaces deprecated T.sectionLabel* aliases)', () => {
    // B4 Phase 2 migrated T.sectionLabelFontFamily/Size/Color → T.type.label.fontFamily/size/lineHeight
    const usesLabelToken =
      SCREEN_SRC.includes('T.type.label.fontFamily') ||
      SCREEN_SRC.includes('T.type.label.size') ||
      SCREEN_SRC.includes('T.type.label.lineHeight');
    expect(usesLabelToken).toBe(true);
  });

  it('does not use hardcoded shadow props (elevation/shadowColor) — flat design', () => {
    // Clean redesign: no shadow props in the StyleSheet
    const noShadow =
      !SCREEN_SRC_NO_COMMENTS.includes('elevation:') &&
      !SCREEN_SRC_NO_COMMENTS.includes("shadowColor");
    expect(noShadow).toBe(true);
  });
});

// ─── Group C: Disclaimer i18n keys (VERBATIM — legal §3) ─────────────────────

describe('PregnancySummaryScreen — disclaimer keys (legal §3 G-summary-1)', () => {
  const TH = catalog.th;
  const EN = catalog.en;

  it('TH short disclaimer contains "คุณบันทึกไว้เอง" (own-data)', () => {
    expect(TH['pregnancySummary.disclaimer.short']).toContain('คุณบันทึกไว้เอง');
  });

  it('TH short disclaimer contains "ไม่ใช่การประเมิน" (not assessment)', () => {
    expect(TH['pregnancySummary.disclaimer.short']).toContain('ไม่ใช่การประเมิน');
  });

  it('TH full disclaimer contains "การวินิจฉัย" (diagnosis)', () => {
    expect(TH['pregnancySummary.disclaimer.full']).toContain('การวินิจฉัย');
  });

  it('TH full disclaimer contains "โปรดปรึกษาแพทย์" (consult doctor)', () => {
    expect(TH['pregnancySummary.disclaimer.full']).toContain('โปรดปรึกษาแพทย์');
  });

  it('EN short disclaimer contains "Your own recorded data"', () => {
    expect(EN['pregnancySummary.disclaimer.short']).toContain('Your own recorded data');
  });

  it('EN short disclaimer contains "not an assessment or medical advice"', () => {
    expect(EN['pregnancySummary.disclaimer.short']).toContain('not an assessment or medical advice');
  });

  it('EN full disclaimer contains "not an assessment, diagnosis, or medical advice"', () => {
    expect(EN['pregnancySummary.disclaimer.full']).toContain(
      'not an assessment, diagnosis, or medical advice',
    );
  });

  it('EN full disclaimer contains "please consult your doctor or healthcare provider"', () => {
    expect(EN['pregnancySummary.disclaimer.full']).toContain(
      'please consult your doctor or healthcare provider',
    );
  });

  it('EN full disclaimer does NOT use imperative "you should" (non-directive copy)', () => {
    expect(EN['pregnancySummary.disclaimer.full'].toLowerCase()).not.toContain('you should');
  });

  it('screen source references pregnancySummary.disclaimer.short key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.disclaimer.short');
  });

  it('screen source references pregnancySummary.disclaimer.full key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.disclaimer.full');
  });

  it('screen source references pregnancySummary.disclaimer.seeMore key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.disclaimer.seeMore');
  });
});

// ─── Group D: Structural source guards (INV-PS1 — no verdict/trend copy) ─────

describe('PregnancySummaryScreen — INV-PS1 structural source guards', () => {
  // These tests scan the *content string keys* used in the screen (not the disclaimer).
  // The disclaimer is exempt from G-PS-b per legal §2.

  it('[INV-PS1] screen does not reference any banned verdict key', () => {
    // Hard-code a sample of verdict/trend key substrings that must never appear
    // in the screen content (outside disclaimer).
    const bannedSubstrings = [
      'normal',
      'abnormal',
      'ปกติ',
      'ผิดปกติ',
      'on track',
      'decreasing',
      'increasing',
      'trend',
      'แนวโน้ม',
    ];
    for (const banned of bannedSubstrings) {
      // Only check outside of the disclaimer section keys and comments
      // by scanning without comments for non-disclaimer content strings.
      // The disclaimer key references are intentional exemptions.
      const srcWithoutDisclaimer = SCREEN_SRC_NO_COMMENTS
        .replace(/pregnancySummary\.disclaimer\.[^'"]*/g, '__DISCLAIMER__');
      expect(srcWithoutDisclaimer.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('[G-PS-c] screen uses both kicks.avgPerDay AND kicks.daysWithData keys', () => {
    // Both must be present to satisfy the "always adjacent" requirement (G-PS-c)
    expect(SCREEN_SRC).toContain('pregnancySummary.kicks.avgPerDay');
    expect(SCREEN_SRC).toContain('pregnancySummary.kicks.daysWithData');
  });

  it('[G-PS-d] screen has no cross-trimester arrow or trend glyphs in source', () => {
    // No ↑↓→ characters in the screen source (trend arrows forbidden by G-PS-d)
    expect(SCREEN_SRC_NO_COMMENTS).not.toContain('↑');
    expect(SCREEN_SRC_NO_COMMENTS).not.toContain('↓');
    expect(SCREEN_SRC_NO_COMMENTS).not.toContain('→');
  });

  it('[INV-PS3] screen does not call any store write/set method', () => {
    // This is a read-only screen — no dispatch/set/write calls to stores
    const noStoreWrites =
      !SCREEN_SRC_NO_COMMENTS.includes('.dispatch(') &&
      !SCREEN_SRC_NO_COMMENTS.includes('syncStore.set') &&
      !SCREEN_SRC_NO_COMMENTS.includes('AsyncStorage.setItem');
    expect(noStoreWrites).toBe(true);
  });
});

// ─── Group E: Trimester section keys ─────────────────────────────────────────

describe('PregnancySummaryScreen — trimester key references', () => {
  it('references T1 trimester label key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.t1');
  });

  it('references T2 trimester label key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.t2');
  });

  it('references T3 trimester label key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.t3');
  });

  it('references delivery section key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.delivery.sectionLabel');
  });

  it('references delivery noData empty state key', () => {
    expect(SCREEN_SRC).toContain('pregnancySummary.delivery.noData');
  });
});

// ─── Group F: a11y — disclaimer link NOT in accessibilityRole="text" parent ───

describe('PregnancySummaryScreen — disclaimer a11y (link not trapped in text parent)', () => {
  it('disclaimer link is NOT nested inside accessibilityRole="text"', () => {
    // Same bug as baby-size fix: link must be independently tappable.
    // Strategy: the "seeMore" link must be a TouchableOpacity (or Pressable)
    // that is NOT a child of an accessibilityRole="text" element.
    //
    // We scan the comment-stripped source so that comments mentioning
    // accessibilityRole="text" (e.g. "must NOT be inside ...") do not
    // trigger false positives.
    const srcLines = SCREEN_SRC_NO_COMMENTS.split('\n');
    let insideTextRole = false;
    let seenSeeMore = false;
    let seenSeeMoreInsideTextRole = false;

    for (const line of srcLines) {
      if (line.includes('accessibilityRole="text"')) {
        insideTextRole = true;
      }
      if (insideTextRole && line.includes('seeMore')) {
        seenSeeMoreInsideTextRole = true;
      }
      // Simple heuristic: closing View/Text ends the block
      if (insideTextRole && (line.includes('</View>') || line.includes('</Text>'))) {
        insideTextRole = false;
      }
      if (line.includes('seeMore')) {
        seenSeeMore = true;
      }
    }

    expect(seenSeeMore).toBe(true); // seeMore must exist
    expect(seenSeeMoreInsideTextRole).toBe(false); // must NOT be inside text role
  });
});
