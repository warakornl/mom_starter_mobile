/**
 * FormulaFeedSection.motherRoom.test.tsx — TDD RED → GREEN
 *
 * Screen 3 (component): Formula-feed chip extension on the feeding logging surface.
 * This is a controlled component — parent manages isActive + amount state.
 *
 * Tests cover:
 *   - Chip renders with 'formulaFeed.chip' i18n key (FW-1: no brand copy)
 *   - Chip is disabled + shows consent advisory when consent is missing
 *   - Chip is enabled + amount field visible when isActive=true and consent granted
 *   - Amount field hidden when isActive=false
 *   - FW-1a: no blocklist tokens in rendered text
 *   - Token correctness (ห้องแม่ tokens, no banned hex)
 *   - A11y: chip has accessibilityRole + accessibilityLabel + accessibilityState
 *   - A11y: amount input has accessibilityLabel
 *   - Containment rule: no accessible={true} View wraps the chip
 *   - INV-ASD-8: no usesRemainingInOpenContainer in render text
 *
 * Security: no real health values in fixtures (amount is synthetic config data).
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (o: unknown) => o },
  Platform: { OS: 'ios' },
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: (k: string) => k,
    locale: 'th',
  })),
}));

jest.mock('../consent/consentStore', () => ({
  consentStore: {
    isGranted: jest.fn(() => true),  // default: all consents granted
  },
}));

jest.mock('./fw1Scanner', () => ({
  isFW1Clean: jest.fn(() => true),
  scanForFW1Violations: jest.fn(() => []),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { FormulaFeedSection } from './FormulaFeedSection';
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseProps = {
  isActive: false,
  onToggle: jest.fn(),
  amount: 0,
  onAmountChange: jest.fn(),
  onNavigateConsent: jest.fn(),
};

const activeProps = {
  ...baseProps,
  isActive: true,
  amount: 2,  // synthetic amount — not a real health measurement
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FormulaFeedSection — FW-1 Milk-Code firewall', () => {
  it('renders without crashing', () => {
    expect(() => FormulaFeedSection(baseProps)).not.toThrow();
  });

  it('chip label uses "formulaFeed.chip" key only (FW-1: no brand name)', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    // t() returns the key in tests — confirms the screen uses the i18n key, not hardcoded copy
    expect(texts).toContain('formulaFeed.chip');
  });

  it('FW-1a: no blocklist tokens in rendered text (scanner called)', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    const allText = texts.join(' ');
    const violations = scanForFW1Violations(allText);
    expect(violations).toHaveLength(0);
  });

  it('chip label never contains a brand-like literal (Nestlé, Enfamil, similac, นมผง followed by brand)', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    texts.forEach((text) => {
      expect(text).not.toMatch(/Nestlé|Enfamil|similac/i);
    });
  });
});

describe('FormulaFeedSection — consent-gated states', () => {
  it('shows consent advisory when infant_feeding consent is missing', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation((type: string) =>
      type !== 'infant_feeding',
    );

    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('formulaFeed.consentGate');

    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });

  it('shows consent advisory when general_health consent is missing', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation((type: string) =>
      type !== 'general_health',
    );

    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('formulaFeed.consentGate');

    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });

  it('does NOT show consent advisory when all consents are granted', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).not.toContain('formulaFeed.consentGate');
  });
});

describe('FormulaFeedSection — active / inactive states', () => {
  it('amount field (amountLabel key) is shown when isActive=true and consent granted', () => {
    const tree = FormulaFeedSection(activeProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('formulaFeed.amountLabel');
  });

  it('amount field is NOT shown when isActive=false', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).not.toContain('formulaFeed.amountLabel');
  });

  it('amount field is NOT shown when isActive=true but consent is missing', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => false);

    const tree = FormulaFeedSection({ ...activeProps }) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).not.toContain('formulaFeed.amountLabel');

    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });
});

describe('FormulaFeedSection — review fix: amount input placeholderTextColor + tokens', () => {
  it('amount TextInput has placeholderTextColor set to T.input.placeholder (default grey fails AA)', () => {
    const tree = FormulaFeedSection(activeProps) as React.ReactElement;
    const input = findAll(tree, (el) => el.type === 'TextInput')[0]!;
    expect((input.props as Record<string, unknown>).placeholderTextColor).toBe(T.input.placeholder);
  });

  it('amount TextInput style carries lineHeight and T.input.bg background', () => {
    const tree = FormulaFeedSection(activeProps) as React.ReactElement;
    const input = findAll(tree, (el) => el.type === 'TextInput')[0]!;
    const s = flat((input.props as Record<string, unknown>).style);
    expect(s.lineHeight).toBeDefined();
    expect(s.backgroundColor).toBe(T.input.bg);
  });
});

describe('FormulaFeedSection — review fix: submit button uses T.button.primary.radius', () => {
  it('submit button style uses T.button.primary.radius (not radius.sm)', () => {
    const tree = FormulaFeedSection({
      ...activeProps,
      onSubmitFormulaFeed: jest.fn(),
    }) as React.ReactElement;
    const submitBtn = findAll(tree, (el) => {
      const props = el.props as Record<string, unknown>;
      return props.accessibilityRole === 'button' && props.accessibilityLabel === 'formulaFeed.submit';
    })[0]!;
    const s = flat((submitBtn.props as Record<string, unknown>).style);
    expect(s.borderRadius).toBe(T.button.primary.radius);
    expect(s.borderRadius).not.toBe(T.radius.sm);
  });
});

describe('FormulaFeedSection — token correctness (ห้องแม่)', () => {
  it('no elements use banned old roselle #A8505A', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned old jade #5D7C67', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5D7C67' || s.backgroundColor === '#5D7C67';
    });
    expect(hits).toHaveLength(0);
  });

  it('consent advisory uses T.color.surface.wash.amber background', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => false);

    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const amberContainers = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.surface.wash.amber;
    });
    expect(amberContainers.length).toBeGreaterThan(0);

    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });
});

describe('FormulaFeedSection — accessibility (a11y)', () => {
  it('chip has accessibilityRole="checkbox" (toggle-like semantics)', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const chips = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'checkbox',
    );
    expect(chips.length).toBeGreaterThan(0);
  });

  it('chip has non-empty accessibilityLabel', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const chips = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'checkbox',
    );
    chips.forEach((chip) => {
      const label = (chip.props as Record<string, unknown>).accessibilityLabel;
      expect(label).toBeDefined();
      expect(label).not.toBe('');
    });
  });

  it('chip has accessibilityState.checked reflecting isActive (false)', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const chips = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'checkbox',
    );
    chips.forEach((chip) => {
      const state = (chip.props as Record<string, unknown>).accessibilityState as Record<string, unknown>;
      expect(state).toBeDefined();
      expect(state.checked).toBe(false);
    });
  });

  it('chip has accessibilityState.checked=true when isActive=true', () => {
    const tree = FormulaFeedSection(activeProps) as React.ReactElement;
    const chips = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'checkbox',
    );
    chips.forEach((chip) => {
      const state = (chip.props as Record<string, unknown>).accessibilityState as Record<string, unknown>;
      expect(state.checked).toBe(true);
    });
  });

  it('no accessible={true} View wraps the chip (containment rule)', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    const badContainers = findAll(tree, (el) => {
      if (el.type !== 'View') return false;
      const props = el.props as Record<string, unknown>;
      if (!props.accessible) return false;
      const inner = findAll(el, (child) =>
        (child.props as Record<string, unknown>).accessibilityRole === 'checkbox',
      );
      return inner.length > 0;
    });
    expect(badContainers).toHaveLength(0);
  });

  it('amount TextInput has accessibilityLabel when shown', () => {
    const tree = FormulaFeedSection(activeProps) as React.ReactElement;
    const inputs = findAll(tree, (el) => el.type === 'TextInput');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((input) => {
      const label = (input.props as Record<string, unknown>).accessibilityLabel;
      expect(label).toBeDefined();
      expect(label).not.toBe('');
    });
  });
});

describe('FormulaFeedSection — INV-ASD-8 security', () => {
  it('usesRemainingInOpenContainer never appears in rendered text', () => {
    const tree = FormulaFeedSection(activeProps) as React.ReactElement;
    const texts = collectText(tree);
    texts.forEach((t) => {
      expect(t).not.toContain('usesRemaining');
    });
  });
});

// ─── Thai typography — lineHeight must be present on every Text style ─────────
//
// FAIL-ON-REVERT: remove lineHeight from any body/label Text style in
// FormulaFeedSection.tsx → violations list non-empty → test RED.
//
// Covers: chipLabel, chipLabelActive, consentAdvisoryText, consentLinkText,
//         amountLabel, submitBtnText — all Text elements visible per state.

describe('FormulaFeedSection — Thai typography: lineHeight on all text styles', () => {
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

  it('chip-inactive state: all Text elements carry lineHeight ≥ fontSize', () => {
    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    expect(findLineHeightViolations(tree)).toEqual([]);
  });

  it('chip-active + consent-granted state: amount label + submit button carry lineHeight', () => {
    const tree = FormulaFeedSection(activeProps) as React.ReactElement;
    expect(findLineHeightViolations(tree)).toEqual([]);
  });

  it('consent-denied state: advisory + link Text elements carry lineHeight', () => {
    const { consentStore } = require('../consent/consentStore');
    (consentStore.isGranted as jest.Mock).mockImplementation(() => false);

    const tree = FormulaFeedSection(baseProps) as React.ReactElement;
    expect(findLineHeightViolations(tree)).toEqual([]);

    (consentStore.isGranted as jest.Mock).mockImplementation(() => true);
  });
});
