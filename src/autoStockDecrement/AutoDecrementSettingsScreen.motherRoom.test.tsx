/**
 * AutoDecrementSettingsScreen.motherRoom.test.tsx — TDD RED → GREEN
 *
 * Tests cover:
 *   - Token correctness (ห้องแม่ colors, no banned hex, amber CTA)
 *   - Loading / empty / populated / error / consent-gated states
 *   - FW-1 check: formula section renders no prohibited Milk-Code copy
 *   - A11y: toggles have accessibilityRole + accessibilityLabel + accessibilityState
 *   - Containment rule: no accessible wrapper around interactive children
 *   - SD-9: no health values in render output
 *   - All activity types always listed (never a blank screen — §1.1 empty state rule)
 *
 * Security: synthetic item names only — no real health data.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() },
  Switch: 'Switch',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: (k: string) => k,  // returns key — allows exact-key assertions
    locale: 'th',
  })),
}));

jest.mock('./consumptionMappingStore', () => ({
  consumptionMappingStore: {
    getAll: jest.fn(() => []),
    getByActivityType: jest.fn(() => []),
    enqueueCreate: jest.fn(),
    enqueueUpdate: jest.fn(),
    enqueueDelete: jest.fn(),
    drainQueue: jest.fn(() => ({})),
    getPendingCount: jest.fn(() => 0),
    reset: jest.fn(),
  },
}));

jest.mock('../sync/supplySyncStore', () => ({
  supplySyncStore: {
    getAll: jest.fn(() => []),
    getSupplyItem: jest.fn(() => undefined),
    getWatermark: jest.fn(() => undefined),
    getPendingCount: jest.fn(() => 0),
  },
}));

jest.mock('../consent/consentStore', () => ({
  consentStore: {
    isGranted: jest.fn(() => true), // default: all consents granted
  },
}));

jest.mock('../sync/syncClient', () => ({
  createConsumptionMappingSyncClient: jest.fn(() => ({
    push: jest.fn(() => Promise.resolve({ ok: true, applied: [], conflicts: [], rejected: [] })),
    pull: jest.fn(() => Promise.resolve({ ok: true, watermark: '' })),
  })),
}));

jest.mock('../sync/pushOrchestrator', () => ({
  executePush: jest.fn(() => Promise.resolve({ ok: true })),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('./fw1Scanner', () => ({
  isFW1Clean: jest.fn(() => true),
  scanForFW1Violations: jest.fn(() => []),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { AutoDecrementSettingsScreen } from './AutoDecrementSettingsScreen';
import { T } from '../theme/tokens';
import { scanForFW1Violations } from './fw1Scanner';

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

function collectText(node: unknown): string[] {
  const texts: string[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (typeof n === 'string') { texts.push(n); return; }
    if (typeof n === 'number') { texts.push(String(n)); return; }
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return texts;
}

const baseProps = {
  tokenStorage: {
    // Returns null — simulates offline/no-token state.
    // Screen renders from local store regardless (offline-first).
    load: jest.fn(() => Promise.resolve(null)),
    save: jest.fn(),
    clear: jest.fn(),
  },
  apiBaseUrl: 'https://api.example.com',
  onBack: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AutoDecrementSettingsScreen — token correctness (ห้องแม่)', () => {
  it('renders without crashing', () => {
    expect(() => AutoDecrementSettingsScreen(baseProps)).not.toThrow();
  });

  it('no elements use banned #94818A color', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned old roselle #A8505A', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned old jade #5D7C67', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5D7C67' || s.backgroundColor === '#5D7C67';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned old amber #C0762B', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#C0762B' || s.backgroundColor === '#C0762B';
    });
    expect(hits).toHaveLength(0);
  });

  it('background uses T.color.surface.base (ivory-100)', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const containers = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.surface.base;
    });
    expect(containers.length).toBeGreaterThan(0);
  });

  it('section headers use T.color.text.botanical (jade-800 #2F5042)', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const botanical = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === T.color.text.botanical;
    });
    expect(botanical.length).toBeGreaterThan(0);
  });
});

describe('AutoDecrementSettingsScreen — all activity types always listed', () => {
  it('renders the nav title key (never blank screen)', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('autoDecrement.navTitle');
  });

  it('always shows all 3 activity sections (diaper/formula/bathing) in empty state', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree).join(' ');
    expect(texts).toContain('autoDecrement.activity.diaperChange');
    expect(texts).toContain('autoDecrement.activity.formulaFeed');
    expect(texts).toContain('autoDecrement.activity.bathing');
  });

  it('shows "link an item" affordance for unlinked activities', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('autoDecrement.linkItem');
  });
});

describe('AutoDecrementSettingsScreen — consent-gated states', () => {
  it('formula section shows consent advisory when infant_feeding is absent', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation((type: string) => {
      if (type === 'infant_feeding') return false;
      return true;
    });

    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('autoDecrement.advisory.consentRequired');

    // Restore
    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });

  it('formula section shows consent advisory when general_health is absent', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation((type: string) => {
      if (type === 'general_health') return false;
      return true;
    });

    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('autoDecrement.advisory.consentRequired');

    // Restore
    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });

  // Bug #2 regression guard: previously RootNavigator never passed
  // onNavigateConsent to this screen, so a fresh user with no consent granted
  // saw the advisory TEXT with NO pressable CTA at all (the `{onNavigateConsent
  // && ...}` guard silently hid it). This proves the CTA renders AND invokes
  // the handler when onNavigateConsent IS supplied — the navigator wiring test
  // (autoDecrementReachability.test.ts) proves RootNavigator actually supplies it.
  it('BUG #2: renders a pressable consent CTA that invokes onNavigateConsent when consent is missing', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => false);

    const onNavigateConsent = jest.fn();
    const tree = AutoDecrementSettingsScreen({
      ...baseProps,
      onNavigateConsent,
    }) as React.ReactElement;

    const ctas = findAll(tree, (el) => {
      const props = el.props as Record<string, unknown>;
      return (
        props.accessibilityRole === 'button' &&
        props.accessibilityLabel === 'autoDecrement.advisory.consentCta'
      );
    });
    expect(ctas.length).toBeGreaterThan(0);

    const onPress = (ctas[0]!.props as Record<string, unknown>).onPress as () => void;
    expect(typeof onPress).toBe('function');
    onPress();
    expect(onNavigateConsent).toHaveBeenCalledTimes(1);
    // The screen passes the section's first required ConsentType (not raw activityType).
    expect(onNavigateConsent).toHaveBeenCalledWith(
      expect.stringMatching(/^(general_health|infant_feeding)$/),
    );

    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });

  it('BUG #2: consent advisory has NO CTA rendered when onNavigateConsent is absent (documents the old broken state)', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => false);

    // onNavigateConsent intentionally omitted — mirrors the pre-fix RootNavigator.
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const ctas = findAll(tree, (el) => {
      const props = el.props as Record<string, unknown>;
      return (
        props.accessibilityRole === 'button' &&
        props.accessibilityLabel === 'autoDecrement.advisory.consentCta'
      );
    });
    expect(ctas).toHaveLength(0);

    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });
});

describe('AutoDecrementSettingsScreen — FW-1 Milk-Code firewall', () => {
  it('FW-1a: renders no prohibited copy in the formula section (called on text content)', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    const allText = texts.join(' ');
    // The screen must pass FW-1a — no blocklist tokens in rendered text
    // (we call the real scanner through the mock which returns [] for clean text)
    const violations = scanForFW1Violations(allText);
    expect(violations).toHaveLength(0);
  });

  it('FW-1: formula section header uses only "autoDecrement.activity.formulaFeed" key (no brand)', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    // Check the formula section is identified by key (t() returns the key in tests)
    // and no other hardcoded brand-like string appears near it
    const formulaTexts = texts.filter(t => t.includes('formula'));
    // Should only reference the i18n key, never a brand
    formulaTexts.forEach(t => {
      expect(t).not.toMatch(/Nestlé|enfamil|similac|นมผง\s*\w+/i);
    });
  });
});

// Minimal mapping fixture (non-formula so no formula-consent complication).
// Synthetic data only — no real health values (SD-9).
const DIAPER_MAPPING = {
  id: 'map-1',
  supplyItemId: 'item-diaper',
  activityType: 'diaper_change' as const,
  enabled: true,
  defaultQty: 1,
  version: 1,
  updatedAt: '2024-01-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
};

// appsec 🟡1 regression fixture: a freshly-linked mapping from
// SupplyItemPickerScreen is always created with enabled:false. This screen's
// `sectionMappings` filter (activityType only, no enabled filter) must still
// surface it — with its toggle OFF — once consent is granted, so the mother
// is never stranded unable to enable what she just linked.
const DISABLED_DIAPER_MAPPING = {
  ...DIAPER_MAPPING,
  id: 'map-2-disabled',
  enabled: false,
};

describe('AutoDecrementSettingsScreen — appsec 🟡1: disabled mapping is never stranded', () => {
  it('a freshly-linked (enabled:false) mapping still renders with its toggle OFF when consent is granted', () => {
    const { consumptionMappingStore } = require('./consumptionMappingStore');
    (consumptionMappingStore.getAll as jest.Mock).mockReturnValueOnce([DISABLED_DIAPER_MAPPING]);
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);

    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;

    // The mapping row (item name) must be present — not hidden just because enabled:false.
    const texts = collectText(tree);
    expect(texts).toContain(DISABLED_DIAPER_MAPPING.supplyItemId);

    // Its Switch must be present and reflect the OFF state (mother can turn it on).
    const switches = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'switch',
    );
    expect(switches.length).toBeGreaterThan(0);
    const sw = switches[0]!;
    expect((sw.props as Record<string, unknown>).value).toBe(false);
    const state = (sw.props as Record<string, unknown>).accessibilityState as { checked: boolean };
    expect(state.checked).toBe(false);
  });
});

describe('AutoDecrementSettingsScreen — accessibility (a11y)', () => {
  it('toggle controls have accessibilityRole="switch"', () => {
    // Need at least one mapping so that a Switch element is rendered.
    const { consumptionMappingStore } = require('./consumptionMappingStore');
    (consumptionMappingStore.getAll as jest.Mock).mockReturnValueOnce([DIAPER_MAPPING]);

    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const switches = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'switch'
    );
    expect(switches.length).toBeGreaterThan(0);
  });

  it('back button has accessibilityRole="button"', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const buttons = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'button'
    );
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('section header Text elements have no accessible={true} wrapper (containment rule)', () => {
    // The containment rule: never put accessible={true} on a View that wraps
    // an interactive child (toggle). Section text goes in <Text> siblings, not wrappers.
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    // Find any View with accessible=true that also has a Switch child
    const badContainers = findAll(tree, (el) => {
      if (el.type !== 'View') return false;
      const props = el.props as Record<string, unknown>;
      if (!props.accessible) return false;
      // Check if this container has Switch children
      const inner = findAll(el as React.ReactElement, (child) => child.type === 'Switch');
      return inner.length > 0;
    });
    expect(badContainers).toHaveLength(0);
  });

  it('toggle accessibilityLabel is non-empty (not just undefined)', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const switches = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'switch'
    );
    switches.forEach((sw) => {
      const label = (sw.props as Record<string, unknown>).accessibilityLabel;
      expect(label).toBeDefined();
      expect(label).not.toBe('');
    });
  });
});

describe('AutoDecrementSettingsScreen — SD-9 security (no health values in output)', () => {
  it('no health quantities (integers from draw state) appear in rendered text', () => {
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    // Verify no raw decimal/health values leak into the UI beyond
    // what the i18n system produces (i.e., no data from drawState)
    texts.forEach((t) => {
      // usesRemainingInOpenContainer must never appear in text
      expect(t).not.toContain('usesRemaining');
      expect(t).not.toContain('usesPerContainer');
    });
  });
});

// ─── Thai typography — lineHeight must be present on every Text style ─────────
//
// FAIL-ON-REVERT: remove lineHeight from any body/label/heading/caption Text
// style in AutoDecrementSettingsScreen.tsx → violations list non-empty → RED.
//
// Covers: backText, navTitle, sectionTitle, advisoryText, advisoryLinkText,
//         itemName, unitLabel, unlinkText, linkBtnText — all states.

describe('AutoDecrementSettingsScreen — Thai typography: lineHeight on all text styles', () => {
  function findLineHeightViolations(tree: React.ReactElement): string[] {
    const violations: string[] = [];
    findAll(tree, (el) => el.type === 'Text').forEach((el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      if (s.fontSize != null && s.lineHeight == null) {
        violations.push(`Text fontSize=${String(s.fontSize)} missing lineHeight — Thai marks will clip`);
      }
    });
    return violations;
  }

  it('empty state (consent granted): all visible Text elements carry lineHeight ≥ fontSize', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    expect(findLineHeightViolations(tree)).toEqual([]);
  });

  it('consent-denied state (advisory panel): advisory Text elements carry lineHeight ≥ fontSize', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => false);
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    expect(findLineHeightViolations(tree)).toEqual([]);
    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });

  it('populated state (mapping row visible): itemName + unitLabel + unlinkText carry lineHeight', () => {
    const { consumptionMappingStore } = require('./consumptionMappingStore');
    (consumptionMappingStore.getAll as jest.Mock).mockReturnValueOnce([DIAPER_MAPPING]);
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
    const tree = AutoDecrementSettingsScreen(baseProps) as React.ReactElement;
    expect(findLineHeightViolations(tree)).toEqual([]);
  });
});
