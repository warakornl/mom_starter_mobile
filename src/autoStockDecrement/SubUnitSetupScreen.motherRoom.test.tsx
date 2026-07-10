/**
 * SubUnitSetupScreen.motherRoom.test.tsx — TDD RED → GREEN
 *
 * Screen 2: lets the mother configure usesPerContainer for a supply item,
 * with D-4 steer-to-pack advisory when usesPerContainer < 2.
 *
 * Tests cover:
 *   - Item-not-found state (invalid / deleted supplyItemId)
 *   - Populated state (item found: shows label keys, stepper)
 *   - D-4 steer-to-pack advisory present when usesPerContainer < 2
 *   - D-4 advisory absent when usesPerContainer >= 2
 *   - Token correctness (ห้องแม่ tokens, no banned hex, amber advisory uses wash.amber)
 *   - A11y: back, increment, decrement, confirm buttons all have role + label
 *   - Containment rule: no accessible={true} wrapper around interactive children
 *   - INV-ASD-8: usesRemainingInOpenContainer never in render text
 *
 * Security: synthetic item names only; no real health data in fixtures.
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
  Platform: { OS: 'ios' },
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: (k: string) => k,
    locale: 'th',
  })),
}));

jest.mock('../sync/supplySyncStore', () => ({
  supplySyncStore: {
    getSupplyItem: jest.fn(() => undefined),  // default: not found
    enqueueUpdate: jest.fn(),
    drainQueue: jest.fn(() => ({ created: [], updated: [], deleted: [] })),
    getWatermark: jest.fn(() => undefined),
    getSupplyItems: jest.fn(() => []),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createSyncClient: jest.fn(() => ({
    push: jest.fn(() => Promise.resolve({ ok: true, applied: [], conflicts: [], rejected: [] })),
    pull: jest.fn(() => Promise.resolve({ ok: true, watermark: '' })),
  })),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { SubUnitSetupScreen } from './SubUnitSetupScreen';
import { T } from '../theme/tokens';
import type { SupplyItemRecord } from '../sync/syncTypes';

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

/** Non-health supply item — usesPerContainer = 1 → triggers D-4 advisory */
const ITEM_UPC1: SupplyItemRecord = {
  id: 'item-diaper-1',
  name: 'ผ้าอ้อม',           // verbatim item name — non-health
  category: 'diapers',
  unit: 'ชิ้น',
  onHandQty: 5,              // supply count — non-health
  usesPerContainer: 1,       // < 2 → D-4 advisory expected
  version: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** Non-health supply item — usesPerContainer = 4 → D-4 advisory suppressed */
const ITEM_UPC4: SupplyItemRecord = {
  ...ITEM_UPC1,
  id: 'item-diaper-2',
  usesPerContainer: 4,       // >= 2 → no D-4 advisory
};

const baseProps = {
  supplyItemId: ITEM_UPC1.id,
  tokenStorage: {
    load: jest.fn(() => Promise.resolve(null)),
    save: jest.fn(),
    clear: jest.fn(),
  },
  apiBaseUrl: 'https://api.example.com',
  onBack: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SubUnitSetupScreen — item-not-found state', () => {
  it('renders without crashing (item not found)', () => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValueOnce(undefined);
    expect(() => SubUnitSetupScreen(baseProps)).not.toThrow();
  });

  it('shows itemNotFound key when item is absent', () => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValueOnce(undefined);
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('subUnitSetup.itemNotFound');
  });

  it('back button is still present in not-found state', () => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValueOnce(undefined);
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const buttons = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'button',
    );
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('SubUnitSetupScreen — populated state (item found)', () => {
  beforeEach(() => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValue(ITEM_UPC1);
  });

  afterEach(() => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReset();
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValue(undefined);
  });

  it('renders without crashing (item found)', () => {
    expect(() => SubUnitSetupScreen(baseProps)).not.toThrow();
  });

  it('shows sectionTitle key', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('subUnitSetup.sectionTitle');
  });

  it('shows usesPerContainerLabel key', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('subUnitSetup.usesPerContainerLabel');
  });

  it('shows steerToPack title key', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('subUnitSetup.steerToPack.title');
  });

  it('shows confirmBtn key', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('subUnitSetup.steerToPack.confirmBtn');
  });
});

describe('SubUnitSetupScreen — D-4 steer-to-pack advisory', () => {
  it('shows D-4 advisory (itemsPerPackError key) when usesPerContainer = 1 (< 2)', () => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValueOnce(ITEM_UPC1);
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('subUnitSetup.steerToPack.itemsPerPackError');
  });

  it('does NOT show D-4 advisory when usesPerContainer = 4 (>= 2)', () => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValueOnce(ITEM_UPC4);
    const tree = SubUnitSetupScreen({ ...baseProps, supplyItemId: ITEM_UPC4.id }) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).not.toContain('subUnitSetup.steerToPack.itemsPerPackError');
  });

  it('D-4 advisory container uses T.color.surface.wash.amber background', () => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValueOnce(ITEM_UPC1);
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const amberContainers = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.surface.wash.amber;
    });
    expect(amberContainers.length).toBeGreaterThan(0);
  });
});

describe('SubUnitSetupScreen — token correctness (ห้องแม่)', () => {
  beforeEach(() => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValue(ITEM_UPC1);
  });
  afterEach(() => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReset();
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValue(undefined);
  });

  it('no elements use banned old roselle #A8505A', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned old jade #5D7C67', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5D7C67' || s.backgroundColor === '#5D7C67';
    });
    expect(hits).toHaveLength(0);
  });

  it('background uses T.color.surface.base', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const baseBg = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.surface.base;
    });
    expect(baseBg.length).toBeGreaterThan(0);
  });

  it('section title uses T.color.text.botanical', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const botanical = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === T.color.text.botanical;
    });
    expect(botanical.length).toBeGreaterThan(0);
  });
});

describe('SubUnitSetupScreen — accessibility (a11y)', () => {
  beforeEach(() => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValue(ITEM_UPC1);
  });
  afterEach(() => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReset();
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValue(undefined);
  });

  it('back button has accessibilityRole="button"', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const buttons = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).accessibilityRole === 'button',
    );
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('increment button has accessibilityRole="button" and non-empty accessibilityLabel', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const incrementBtns = findAll(tree, (el) => {
      const props = el.props as Record<string, unknown>;
      return (
        props.accessibilityRole === 'button' &&
        typeof props.accessibilityLabel === 'string' &&
        (props.accessibilityLabel as string).includes('subUnitSetup.a11y.increment')
      );
    });
    expect(incrementBtns.length).toBeGreaterThan(0);
  });

  it('decrement button has accessibilityRole="button" and non-empty accessibilityLabel', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const decrementBtns = findAll(tree, (el) => {
      const props = el.props as Record<string, unknown>;
      return (
        props.accessibilityRole === 'button' &&
        typeof props.accessibilityLabel === 'string' &&
        (props.accessibilityLabel as string).includes('subUnitSetup.a11y.decrement')
      );
    });
    expect(decrementBtns.length).toBeGreaterThan(0);
  });

  it('confirm button has accessibilityRole="button"', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const confirms = findAll(tree, (el) => {
      const props = el.props as Record<string, unknown>;
      return (
        props.accessibilityRole === 'button' &&
        typeof props.accessibilityLabel === 'string' &&
        (props.accessibilityLabel as string).length > 0
      );
    });
    expect(confirms.length).toBeGreaterThan(0);
  });

  it('no View with accessible={true} wraps an interactive child (containment rule)', () => {
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
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

describe('SubUnitSetupScreen — INV-ASD-8 / SD-9 security', () => {
  it('usesRemainingInOpenContainer never appears in rendered text', () => {
    const { supplySyncStore } = require('../sync/supplySyncStore');
    (supplySyncStore.getSupplyItem as jest.Mock).mockReturnValueOnce({
      ...ITEM_UPC1,
      usesRemainingInOpenContainer: 3,   // mobile-local field — must NOT render
    });
    const tree = SubUnitSetupScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    texts.forEach((t) => {
      expect(t).not.toContain('usesRemaining');
      expect(t).not.toContain('3');  // the field value must not leak
    });
  });
});
