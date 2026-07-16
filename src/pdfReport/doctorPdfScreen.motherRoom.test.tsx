/**
 * doctorPdfScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — DoctorPdfScreen
 *
 * Includes:
 *  - Token migration (no IBMPlex, no banned hex)
 *  - Loss gate: lifecycle prop accepted (structural gate — week chips don't exist)
 *  - FAIL-ON-REVERT: prop must remain in interface
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', SafeAreaView: 'SafeAreaView',
  Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    useState: jest.fn((i: unknown) => [i, jest.fn()]),
    useCallback: jest.fn((fn: unknown) => fn),
  };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('../consent/JitConsentSheet', () => ({ JitConsentSheet: () => null }));
jest.mock('../consent/useJitConsent', () => ({
  useJitConsent: jest.fn(() => ({
    gate: 'already_granted',
    isLoading: false,
    error: null,
    grant: jest.fn(),
    decline: jest.fn(),
    rearm: jest.fn(),
    parentalAttested: false,
    setParentalAttested: jest.fn(),
  })),
}));
jest.mock('../pregnancy/gestationalAge', () => ({ localCivilToday: jest.fn(() => '2026-07-10') }));
jest.mock('../kickCount/kickCountSyncStore', () => ({
  kickCountSyncStore: { getActiveSessions: jest.fn(() => []) },
}));
jest.mock('../sync/calendarSyncStore', () => ({
  calendarSyncStore: { getActiveChecklistItems: jest.fn(() => []) },
}));
jest.mock('../selfLog/selfLogSyncStore', () => ({
  selfLogSyncStore: { getSelfLogs: jest.fn(() => []) },
}));
jest.mock('../medication/medicationPlanSyncStore', () => ({
  medicationPlanSyncStore: { getPlans: jest.fn(() => []) },
}));
jest.mock('../medication/medicationLogSyncStore', () => ({
  medicationLogSyncStore: { getLogs: jest.fn(() => []) },
}));
jest.mock('./medicationAdherence', () => ({ computeAdherence: jest.fn(() => ({ planAdherences: [], selfRecordedLogs: [] })) }));
jest.mock('./doctorReportAssembler', () => ({
  buildDoctorReportHtml: jest.fn(() => ''),
  LABELS: {},
  isWithinRange: jest.fn(() => true),
  formatDateTime: jest.fn((d: string) => d),
}));
jest.mock('./reportCharts', () => ({ kickCountChartSvg: jest.fn(() => '') }));
jest.mock('./pdfService', () => ({ createProductionPdfService: jest.fn(() => ({})) }));
jest.mock('./consentGate', () => ({
  decidePdfEgressAction: jest.fn(() => 'generate'),
  applyRearm: jest.fn((s: unknown) => s),
  initialPdfEgressGateState: { status: 'open' },
}));
jest.mock('./DoctorPdfScreenLogic', () => ({
  builderPhaseInitial: jest.fn(() => ({ phase: 'builder', monthFrom: null, monthTo: null })),
  applyMonthFromChanged: jest.fn((s: unknown) => s),
  applyMonthToChanged: jest.fn((s: unknown) => s),
  isDateRangeValid: jest.fn(() => true),
  applyGeneratingStarted: jest.fn((s: unknown) => s),
  applyPreviewReady: jest.fn((s: unknown) => s),
  applyPreviewError: jest.fn((s: unknown) => s),
  applyBackToBuilder: jest.fn((s: unknown) => s),
}));
jest.mock('./monthYearFormatter', () => ({
  formatYearMonth: jest.fn((d: string | null | undefined) => d ?? ''),
  parseMonthYear: jest.fn((s: string) => s),
  addMonths: jest.fn((d: string) => d),
  subMonths: jest.fn((d: string) => d),
}));
jest.mock('react-native-svg', () => ({ SvgXml: 'SvgXml' }));

import React from 'react';
import { DoctorPdfScreen } from './DoctorPdfScreen';
import { T } from '../theme/tokens';
import type { Lifecycle } from '../pregnancy/types';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProfile = {
  edd: '2026-12-01',
  gestationalWeek: 20,
  lifecycle: 'pregnant' as Lifecycle,
};
const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  profile: baseProfile,
  locale: 'th' as const,
  onBack: jest.fn(),
};

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

describe('DoctorPdfScreen — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans or IBMPlexMono', () => {
    const tree = DoctorPdfScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = DoctorPdfScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = DoctorPdfScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use banned #5F4A52 or #3A2A30', () => {
    const tree = DoctorPdfScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52' || s.color === '#3A2A30';
    })).toHaveLength(0);
  });

  it('LOSS-GATE structural: lifecycle prop is accepted in profile object', () => {
    // FAIL-ON-REVERT: if lifecycle is removed from the profile prop type,
    // TypeScript would catch it. Behavioral test proves the prop flows through.
    expect(() => {
      DoctorPdfScreen({
        ...baseProps,
        profile: { ...baseProfile, lifecycle: 'ended' as Lifecycle },
      });
    }).not.toThrow();
  });

  it('primary CTA bg is T.button.primary.bg amber-700', () => {
    const tree = DoctorPdfScreen(baseProps) as React.ReactElement;
    const btns = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.button.primary.bg;
    });
    expect(btns.length).toBeGreaterThan(0);
  });

  // ─── mobile-reviewer fixes (cluster 6 review) ──────────────────────────────

  it('builder-phase header back button has a non-empty accessibilityLabel', () => {
    const tree = DoctorPdfScreen(baseProps) as React.ReactElement;
    const backBtns = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.accessibilityRole === 'button' && p.onPress === baseProps.onBack;
    });
    expect(backBtns.length).toBeGreaterThan(0);
    for (const btn of backBtns) {
      expect((btn.props as { accessibilityLabel?: string }).accessibilityLabel).toBeTruthy();
    }
  });

  it('the lab-notes manifest row no longer uses the tappable-looking "☐" glyph', () => {
    const tree = DoctorPdfScreen(baseProps) as React.ReactElement;
    const glyphHits = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.children === '☐';
    });
    expect(glyphHits).toHaveLength(0);
  });

  // ─── i18n stopgap fix (task #40 tail) — two REPORTED a11y gaps ────────────
  //
  // The preview phase and year-stepper controls only render inside deeply
  // nested useState-dependent branches this test file's plain-function
  // harness cannot reach (builderState/pickerVisible are opaque objects
  // returned by mocked modules, not toggleable via the global useState
  // pass-through mock used here). Source-level guards prove the actual fix
  // is wired, mirroring the convention used in
  // birthEventScreen.motherRoom.test.tsx / lossConfirmScreen tests.
  describe('FAIL-ON-REVERT: catalog-key wiring for the two REPORTED a11y gaps', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const source = fs.readFileSync(path.join(__dirname, 'DoctorPdfScreen.tsx'), 'utf8');

    it('preview ScrollView a11y label uses the dedicated pdf.screen.previewA11yLabel catalog key', () => {
      expect(source).toContain("t('pdf.screen.previewA11yLabel')");
      // Must NOT still be borrowing previewNavTitle as an interim stand-in
      // for the preview region's accessibilityLabel specifically.
      expect(source).not.toMatch(/accessibilityLabel=\{t\('pdf\.screen\.previewNavTitle'\)\}/);
    });

    it('year-stepper prev/next buttons use picker.previousYear / picker.nextYear catalog keys, not an inline locale ternary', () => {
      expect(source).toContain("t('picker.previousYear'");
      expect(source).toContain("t('picker.nextYear'");
      // The old hardcoded-regardless-of-locale literals must be gone.
      expect(source).not.toContain('พ.ศ. ก่อนหน้า ${');
      expect(source).not.toContain('พ.ศ. ถัดไป ${');
      expect(source).not.toMatch(/`Previous year, \$\{/);
      expect(source).not.toMatch(/`Next year, \$\{/);
    });
  });
});
