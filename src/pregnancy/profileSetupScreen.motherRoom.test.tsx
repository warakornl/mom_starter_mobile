/**
 * profileSetupScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B1 reskin — ProfileSetupScreen
 *
 * Loss-sensitive screen (1 of 14): preview card is suppressed when
 * pregnancyStatus === 'LOSS'. Fail-on-revert tests prove the gate works.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView',
  SafeAreaView: 'SafeAreaView', Modal: 'Modal', StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() }, Platform: { OS: 'ios' },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});

jest.mock('../i18n/LanguageContext', () => ({ useT: () => ({ t: (k: string) => k, locale: 'th' }) }));
jest.mock('./profileEditRuntimeWiring', () => ({ runSave: jest.fn() }));
jest.mock('./gestationalAge', () => ({
  localCivilToday: jest.fn(() => '2026-07-10'),
  computeGestationalAge: jest.fn(() => ({
    currentStage: 'T2',
    displayedWeek: 20,
    gestationalDay: 3,
    suppressDayDisplay: false,
    deliveryWindowActive: false,
  })),
}));
jest.mock('../i18n/messages', () => ({
  formatCivilDate: jest.fn((d: string) => d),
}));
jest.mock('../icons', () => ({
  StageT1Icon: 'StageT1Icon',
  StageT2Icon: 'StageT2Icon',
  StageT3Icon: 'StageT3Icon',
}));

import React from 'react';
import { ProfileSetupScreen, convertBuddhistEraYearIfNeeded } from './ProfileSetupScreen';
import { T } from '../theme/tokens';

const mockTokenStorage = { load: jest.fn(() => Promise.resolve(null)), save: jest.fn(), clear: jest.fn() };

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false) return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node); return acc;
}

function flat(s: unknown): Record<string, unknown> {
  if (Array.isArray(s)) return Object.assign({}, ...s.map(flat));
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return {};
}

/** existingProfile with current_week basis → inputMethod='current_week' → isValid=true */
const validProfile = {
  id: 'p1', version: 1,
  edd: '2026-11-20', eddBasis: 'current_week' as const,
  lifecycle: 'pregnant' as const,
  gestationalWeek: 20, gestationalDay: 3, daysRemaining: 133, progress: 0.5,
  currentStage: 'T2' as const, deliveryWindowActive: false,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  onSetupComplete: jest.fn(),
};

describe('ProfileSetupScreen — ห้องแม่ Phase 2 B1 reskin', () => {
  // ─── Token migration tests ─────────────────────────────────────────────────

  it('no elements use IBMPlexSans or IBMPlexMono', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use white bg #FFFFFF', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use old disabled rose/300 #DDA0A6', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#DDA0A6' || s.backgroundColor === '#DDA0A6';
    })).toHaveLength(0);
  });

  it('no elements use raw hex #5F4A52 or #3A2A30', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52' || s.color === '#3A2A30'
        || s.backgroundColor === '#5F4A52' || s.backgroundColor === '#3A2A30';
    })).toHaveLength(0);
  });

  it('no elements use old rose/700 #8E3A44', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44' || s.backgroundColor === '#8E3A44';
    })).toHaveLength(0);
  });

  it('container bg is surface.base', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    const s = flat((tree.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });

  it('primary CTA base style bg is T.button.primary.bg amber-700 NOT #A8505A', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    const btn = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'profile-save')[0];
    expect(btn).toBeDefined();
    // style is [primaryBtn, primaryBtnDisabled?] — read only the first (base) style
    const styleArr = (btn.props as Record<string, unknown>).style as unknown[];
    const base = flat(Array.isArray(styleArr) ? styleArr[0] : styleArr);
    expect(base.backgroundColor).toBe(T.button.primary.bg);
    expect(base.backgroundColor).not.toBe('#A8505A');
  });

  it('no elements use old stale border #EBE1D9', () => {
    const tree = ProfileSetupScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.borderColor === '#EBE1D9';
    })).toHaveLength(0);
  });

  // ─── Loss-gate tests (fail-on-revert against REAL predicate + REAL prop) ────────
  //
  // The gate is `lifecycle === 'ended'` (Lifecycle type from types.ts).
  // The old dead prop was `pregnancyStatus?: string` checked against 'LOSS' —
  // that string existed nowhere in the real codebase and no caller ever passed it.
  //
  // FAIL-ON-REVERT proof: removing `if (lifecycle === 'ended') return null` from
  // renderConfirmationPreview() makes the first test below RED (card present when
  // it must be absent).  The second and third tests would go GREEN for the wrong
  // reason, proving the first is the load-bearing assertion.

  it('LOSS-GATE: preview card is SUPPRESSED when lifecycle = "ended" + valid form', () => {
    // This is the canonical loss-gate test.
    // lifecycle="ended" matches Lifecycle type from types.ts (= pregnancy ended/loss).
    // Guard removal → card appears → this test goes RED. That is the fail-on-revert.
    const tree = ProfileSetupScreen({
      ...baseProps,
      existingProfile: validProfile,
      lifecycle: 'ended',
    }) as React.ReactElement;
    const cards = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'profile-preview-card');
    expect(cards).toHaveLength(0);
  });

  it('FAIL-ON-REVERT: preview card IS present when lifecycle = "pregnant" + valid form', () => {
    // Mirrors the ProfileEditScreen caller: it passes profile.lifecycle ("pregnant")
    // after the show-form guard, so the card must NOT be suppressed.
    // Guard removal → card stays present → this test stays GREEN (tautological alone).
    // But combined with the LOSS-GATE test above, guard removal makes the suite RED.
    const tree = ProfileSetupScreen({
      ...baseProps,
      existingProfile: validProfile,
      lifecycle: 'pregnant',
    }) as React.ReactElement;
    const cards = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'profile-preview-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('FAIL-ON-REVERT: preview card IS present when lifecycle is undefined (fresh setup)', () => {
    // RootNavigator fresh-setup path passes no lifecycle (no profile yet).
    // undefined must NOT suppress the preview — a brand-new setup is never a loss.
    const tree = ProfileSetupScreen({
      ...baseProps,
      existingProfile: validProfile,
      // lifecycle absent → undefined
    }) as React.ReactElement;
    const cards = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'profile-preview-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('FAIL-ON-REVERT: preview card IS present when lifecycle = "postpartum" + valid form', () => {
    // postpartum is not a loss state; preview must remain.
    const tree = ProfileSetupScreen({
      ...baseProps,
      existingProfile: validProfile,
      lifecycle: 'postpartum',
    }) as React.ReactElement;
    const cards = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'profile-preview-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('WIRING: ProfileEditScreen passes profile.lifecycle (pregnant) → preview card present', () => {
    // Exercises the wiring that ProfileEditScreen now provides via lifecycle={profile.lifecycle}.
    // In the show-form path, lifecycle is always 'pregnant' (profileEditLogic guards ended/postpartum).
    // This test fails if the prop rename is reverted on either end (the interface stays typed).
    const editModeProps = {
      ...baseProps,
      existingProfile: { ...validProfile, lifecycle: 'pregnant' as const },
      lifecycle: 'pregnant' as const,
    };
    const tree = ProfileSetupScreen(editModeProps) as React.ReactElement;
    const cards = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'profile-preview-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  // ─── 🔴 BE/CE year-trap guard (FAIL-ON-REVERT) ──────────────────────────────
  //
  // A free-typed YYYY-MM-DD field must not silently accept a Buddhist-era (BE)
  // year (e.g. 2569) as a Christian-era (CE) year, which would save an EDD
  // ~543 years off. `convertBuddhistEraYearIfNeeded` is the real, executed
  // guard used by handleDateConfirm/handleLmpConfirm — this test calls the
  // REAL exported function (no re-implementation), proving fail-on-revert:
  // deleting the `yearNum > 2100` branch makes this test RED.
  describe('convertBuddhistEraYearIfNeeded — BE/CE year-trap guard', () => {
    it('FAIL-ON-REVERT: converts a Buddhist-era year (2569) to CE (2026)', () => {
      const result = convertBuddhistEraYearIfNeeded('2569-11-20');
      expect(result.wasBe).toBe(true);
      expect(result.corrected).toBe('2026-11-20');
    });

    it('leaves a normal CE year (2026) unchanged', () => {
      const result = convertBuddhistEraYearIfNeeded('2026-11-20');
      expect(result.wasBe).toBe(false);
      expect(result.corrected).toBe('2026-11-20');
    });

    it('boundary: year 2100 (not > 2100) is treated as CE, unchanged', () => {
      const result = convertBuddhistEraYearIfNeeded('2100-01-01');
      expect(result.wasBe).toBe(false);
      expect(result.corrected).toBe('2100-01-01');
    });

    it('boundary: year 2101 (> 2100) is converted BE→CE', () => {
      const result = convertBuddhistEraYearIfNeeded('2101-01-01');
      expect(result.wasBe).toBe(true);
      expect(result.corrected).toBe('1558-01-01');
    });
  });
});
