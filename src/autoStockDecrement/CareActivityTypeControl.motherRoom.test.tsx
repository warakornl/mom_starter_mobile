/**
 * CareActivityTypeControl.motherRoom.test.tsx — TDD RED → GREEN
 *
 * Screen 4 (component): careActivityType chip-group control for ReminderFormScreen.
 * Lets the mother tag a reminder as a care activity (diaper_change / bathing),
 * enabling the T-D auto-decrement trigger when the reminder fires.
 *
 * US-AS6: null value = "not a care activity" — no trigger, no marker.
 *
 * Tests cover:
 *   - Renders all 3 options: None, diaper_change, bathing
 *   - Shows field label key
 *   - Selected chip has accessibilityState.selected=true, others false
 *   - Each chip has accessibilityRole="button" + accessibilityLabel
 *   - No accessible={true} wrapper around chips (containment rule)
 *   - Token correctness (no banned hex)
 *   - US-AS6: null option is always present
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
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

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { CareActivityTypeControl } from './CareActivityTypeControl';
import { T } from '../theme/tokens';
import type { CareActivityType } from '../sync/syncTypes';

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
  value: null as CareActivityType | null,
  onChange: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CareActivityTypeControl — rendering', () => {
  it('renders without crashing', () => {
    expect(() => CareActivityTypeControl(baseProps)).not.toThrow();
  });

  it('shows field label key', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('reminder.careActivityType.fieldLabel');
  });

  it('shows none option key (US-AS6: null always available)', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('reminder.careActivityType.none');
  });

  it('shows diaperChange option key', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('reminder.careActivityType.diaperChange');
  });

  it('shows bathing option key', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('reminder.careActivityType.bathing');
  });
});

describe('CareActivityTypeControl — selected state', () => {
  it('none chip has accessibilityState.selected=true when value=null', () => {
    const tree = CareActivityTypeControl({ ...baseProps, value: null }) as React.ReactElement;
    const selectedChips = findAll(tree, (el) => {
      const state = (el.props as Record<string, unknown>).accessibilityState as Record<string, unknown> | undefined;
      return state?.selected === true;
    });
    expect(selectedChips.length).toBeGreaterThan(0);
  });

  it('diaper_change chip has accessibilityState.selected=true when value=diaper_change', () => {
    const tree = CareActivityTypeControl({ ...baseProps, value: 'diaper_change' }) as React.ReactElement;
    const selectedChips = findAll(tree, (el) => {
      const state = (el.props as Record<string, unknown>).accessibilityState as Record<string, unknown> | undefined;
      return state?.selected === true;
    });
    expect(selectedChips.length).toBeGreaterThan(0);
  });

  it('bathing chip has accessibilityState.selected=true when value=bathing', () => {
    const tree = CareActivityTypeControl({ ...baseProps, value: 'bathing' }) as React.ReactElement;
    const selectedChips = findAll(tree, (el) => {
      const state = (el.props as Record<string, unknown>).accessibilityState as Record<string, unknown> | undefined;
      return state?.selected === true;
    });
    expect(selectedChips.length).toBeGreaterThan(0);
  });

  it('none chip has accessibilityState.selected=false when value=diaper_change', () => {
    const tree = CareActivityTypeControl({ ...baseProps, value: 'diaper_change' }) as React.ReactElement;
    // Find the "none" chip by its text content matching the key
    const noneChips = findAll(tree, (el) => {
      const children = (el.props as Record<string, unknown>).children;
      // Direct text child or a Text element with the none key
      const textChildren = findAll(el, (child) => {
        const texts: string[] = [];
        function walkText(n: unknown): void {
          if (typeof n === 'string') texts.push(n);
          if (!React.isValidElement(n)) return;
          walkText((n.props as { children?: unknown }).children);
        }
        walkText(child);
        return texts.includes('reminder.careActivityType.none');
      });
      if (textChildren.length === 0) return false;
      const state = (el.props as Record<string, unknown>).accessibilityState as Record<string, unknown> | undefined;
      return state !== undefined;
    });
    // The none chip should exist and NOT be selected
    const nonSelectedNone = noneChips.filter((el) => {
      const state = (el.props as Record<string, unknown>).accessibilityState as Record<string, unknown> | undefined;
      return state?.selected === false;
    });
    expect(nonSelectedNone.length).toBeGreaterThan(0);
  });
});

describe('CareActivityTypeControl — accessibility (a11y)', () => {
  it('each option chip has accessibilityRole="button"', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const chips = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'button',
    );
    // 3 chips: none, diaper_change, bathing
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });

  it('each option chip has non-empty accessibilityLabel', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const chips = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'button',
    );
    chips.forEach((chip) => {
      const label = (chip.props as Record<string, unknown>).accessibilityLabel;
      expect(label).toBeDefined();
      expect(label).not.toBe('');
    });
  });

  it('no accessible={true} View wraps any chip (containment rule)', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const badContainers = findAll(tree, (el) => {
      if (el.type !== 'View') return false;
      const props = el.props as Record<string, unknown>;
      if (!props.accessible) return false;
      const inner = findAll(el, (child) =>
        (child.props as Record<string, unknown>).accessibilityRole === 'button',
      );
      return inner.length > 0;
    });
    expect(badContainers).toHaveLength(0);
  });
});

describe('CareActivityTypeControl — token correctness (ห้องแม่)', () => {
  it('no elements use banned old roselle #A8505A', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned old jade #5D7C67', () => {
    const tree = CareActivityTypeControl(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5D7C67' || s.backgroundColor === '#5D7C67';
    });
    expect(hits).toHaveLength(0);
  });
});

describe('CareActivityTypeControl — US-AS6 anti-double-count', () => {
  it('null option is always present (US-AS6: null = not a care activity = no trigger)', () => {
    // Even when a value is selected, "none" chip must always be rendered
    const tree = CareActivityTypeControl({ ...baseProps, value: 'bathing' }) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('reminder.careActivityType.none');
  });
});
