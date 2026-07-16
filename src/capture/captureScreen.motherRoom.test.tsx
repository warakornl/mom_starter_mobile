/**
 * captureScreen.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B2 reskin — CaptureScreen
 *
 * No loss gate (CaptureScreen is not a pregnancy-progress screen).
 * Tests: token migration only.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg', Svg: 'Svg', Path: 'Path', Circle: 'Circle', Rect: 'Rect',
  Line: 'Line', G: 'G', Ellipse: 'Ellipse',
}));

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', Modal: 'Modal', StyleSheet: { create: (o: unknown) => o },
  SafeAreaView: 'SafeAreaView', ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' }, Alert: { alert: jest.fn() },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    useState: jest.fn((i: unknown) => [i, jest.fn()]),
    useCallback: jest.fn((f: unknown) => f),
    useRef: jest.fn((v: unknown) => ({ current: v })),
  };
});

jest.mock('@react-navigation/native', () => ({
  useRoute: jest.fn(() => ({ params: {} })),
  useNavigation: jest.fn(() => ({ goBack: jest.fn() })),
}));

jest.mock('@react-navigation/native-stack', () => ({}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

jest.mock('../i18n/thaiDate', () => ({
  formatCaptureDate: jest.fn((d: string) => d),
}));

jest.mock('../selfLog/selfLogSyncStore', () => ({
  selfLogSyncStore: {
    addSelfLog: jest.fn(),
    reset: jest.fn(),
  },
}));

jest.mock('../medication/medicationLogSyncStore', () => ({
  medicationLogSyncStore: {
    addLog: jest.fn(),
    reset: jest.fn(),
  },
}));

jest.mock('../medication/medicationPlanSyncStore', () => ({
  medicationPlanSyncStore: {
    getActivePlans: jest.fn(() => []),
    getPlanById: jest.fn(() => null),
    reset: jest.fn(),
  },
}));

jest.mock('../consent/consentStore', () => ({
  consentStore: {
    hasConsented: jest.fn(() => true),
    getConsent: jest.fn(() => ({ granted: true })),
    reset: jest.fn(),
  },
}));

jest.mock('../consent/consentApiClient', () => ({
  createConsentApiClient: jest.fn(() => ({})),
}));

jest.mock('../consent/consentSync', () => ({
  consentQueue: {
    enqueue: jest.fn(),
    drain: jest.fn(),
  },
}));

jest.mock('../consent/ConsentNudgeModal', () => ({
  ConsentNudgeModal: 'ConsentNudgeModal',
}));

jest.mock('./captureValidation', () => ({
  validateWeight: jest.fn(() => ({ storable: false, hint: null })),
  validateBP: jest.fn(() => ({ storable: false, hint: null })),
  validateTime: jest.fn(() => ({ storable: true, hint: null })),
}));

jest.mock('./captureEcho', () => ({
  buildWeightEchoLine: jest.fn(() => '60 kg'),
  buildBpEchoLine: jest.fn(() => '120/80'),
  buildTextEchoLine: jest.fn(() => ''),
}));

jest.mock('./captureScreenLogic', () => ({
  getDefaultTime: jest.fn(() => '08:00'),
  isSaveEnabled: jest.fn(() => true),
  orchestrateSave: jest.fn(() => Promise.resolve({ ok: true })),
  decodeFieldFromBase64: jest.fn((s: string) => s),
}));

jest.mock('./medicationCaptureLogic', () => ({
  buildMedicationEchoLine: jest.fn(() => 'paracetamol ทาน'),
  orchestrateMedicationSave: jest.fn(() => Promise.resolve({ ok: true })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { CaptureScreen } from './CaptureScreen';
import { T } from '../theme/tokens';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

function flat(s: unknown): Record<string, unknown> {
  if (Array.isArray(s)) return Object.assign({}, ...s.map(flat));
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return {};
}

const mockTokenStorage = {
  load: jest.fn(() => Promise.resolve(null)),
  save: jest.fn(),
  clear: jest.fn(),
};

const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CaptureScreen — ห้องแม่ Phase 2 B2 reskin', () => {

  it('no style objects use IBMPlexSans or IBMPlexMono font families', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    });
    expect(hits).toHaveLength(0);
  });

  it('no placeholderTextColor uses banned #94818A', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.placeholderTextColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no style objects use banned ink/faint #94818A', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no style objects use old rose/600 #A8505A', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no input or chip bg uses white #FFFFFF (must use T.input.bg / T.color.surface.base)', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    });
    expect(hits).toHaveLength(0);
  });

  it('no element uses old rose/700 #8E3A44', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44';
    });
    expect(hits).toHaveLength(0);
  });

  it('no element uses old divider #EBE1D9 (must use T.color.surface.divider)', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.borderColor === '#EBE1D9' || s.borderBottomColor === '#EBE1D9' || s.backgroundColor === '#EBE1D9';
    });
    expect(hits).toHaveLength(0);
  });

  it('save button uses T.button.primary.bg (amber-700, not old rose)', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const btns = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      const s = flat(p.style);
      return (p.testID === 'capture-save-btn' || String(el.type).toLowerCase().includes('touchable')) &&
        s.backgroundColor === T.button.primary.bg;
    });
    expect(btns.length).toBeGreaterThan(0);
  });

  it('save button disabled state uses rgba(154,95,10,0.45) not old #DDA0A6', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    // #DDA0A6 must not appear anywhere
    const oldDisabled = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#DDA0A6';
    });
    expect(oldDisabled).toHaveLength(0);
  });

  it('echo container bg uses T.color.surface.subtle (ivory-200), not white', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const echoBg = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      const s = flat(p.style);
      return (p.testID === 'capture-echo-line' || String(el.type) === 'View') &&
        s.backgroundColor === T.color.surface.subtle;
    });
    expect(echoBg.length).toBeGreaterThan(0);
  });

  it('no old soft-ink #5F4A52 used — must be T.color.text.primary or T.color.text.secondary', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52';
    });
    expect(hits).toHaveLength(0);
  });

  it('old ink #3A2A30 is replaced with T.color.text.heading', () => {
    const tree = CaptureScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#3A2A30';
    });
    expect(hits).toHaveLength(0);
  });
});
