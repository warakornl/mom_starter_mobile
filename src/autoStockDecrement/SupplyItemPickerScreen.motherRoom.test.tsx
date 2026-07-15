/**
 * SupplyItemPickerScreen.motherRoom.test.tsx — TDD RED → GREEN
 *
 * Bug #2 (🔴 PRIMARY) — item-picker screen for linking a supply item to an
 * auto-decrement activity type. Without this screen, "Link an item" in
 * AutoDecrementSettingsScreen is a permanent no-op and NO production code path
 * ever calls consumptionMappingStore.enqueueCreate — the decrement engine can
 * never be configured (dead shell).
 *
 * Coverage:
 *   - Token correctness (ห้องแม่ colors, no banned hex)
 *   - Empty state (no supply items yet) — calm invite to add a supply first
 *   - Populated state: suggested category surfaced first (diaper_change→'diapers',
 *     feeding_formula→'feeding', bathing→'hygiene'), any item linkable
 *   - Tap → enqueueCreate called ONCE with a well-formed ConsumptionMappingRecord
 *   - onPicked?.() / onBack() called after linking
 *   - FW-1: verbatim item name rendered only — no brand/promo copy
 *   - A11y: containment rule (rows are standalone TouchableOpacity, ≥48dp)
 *
 * Security: synthetic item names only — no real health data.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  FlatList: 'FlatList',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (o: unknown) => o },
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
    getSupplyItems: jest.fn(() => []),
  },
}));

jest.mock('./consumptionMappingStore', () => ({
  consumptionMappingStore: {
    enqueueCreate: jest.fn(),
    getAll: jest.fn(() => []),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createConsumptionMappingSyncClient: jest.fn(() => ({
    push: jest.fn(() => Promise.resolve({ ok: true, applied: [], conflicts: [], rejected: [] })),
    pull: jest.fn(() => Promise.resolve({ ok: true, watermark: '' })),
  })),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid-picker') }));

// React hooks — plain-function call pattern (mirrors AutoDecrementSettingsScreen tests).
jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: jest.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, jest.fn()]),
    useRef: jest.fn((init: unknown) => ({ current: init })),
    useCallback: jest.fn((fn: unknown) => fn),
    useEffect: jest.fn(),
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { SupplyItemPickerScreen } from './SupplyItemPickerScreen';
import { supplySyncStore } from '../sync/supplySyncStore';
import { consumptionMappingStore } from './consumptionMappingStore';
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
    const props = el.props as Record<string, unknown>;
    if (props.ListFooterComponent) walk(props.ListFooterComponent);
    if (props.ListEmptyComponent) walk(props.ListEmptyComponent);
    if (props.renderItem && props.data) {
      (props.data as unknown[]).forEach((item, index) => {
        const rendered = (props.renderItem as (info: { item: unknown; index: number }) => unknown)({ item, index });
        walk(rendered);
      });
    }
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
  return findAll(node, (el) => el.type === 'Text').flatMap((el) => {
    const children = (el.props as { children?: unknown }).children;
    if (typeof children === 'string') return [children];
    if (typeof children === 'number') return [String(children)];
    return [];
  });
}

const mockGetSupplyItems = supplySyncStore.getSupplyItems as jest.Mock;
const mockEnqueueCreate = consumptionMappingStore.enqueueCreate as jest.Mock;

const baseProps = {
  tokenStorage: {
    load: jest.fn(() => Promise.resolve(null)),
    save: jest.fn(),
    clear: jest.fn(),
  },
  apiBaseUrl: 'https://api.example.com',
  activityType: 'diaper_change' as const,
  onBack: jest.fn(),
};

const DIAPER_ITEM = {
  id: 'item-diaper-1',
  name: 'ผ้าอ้อมสำเร็จรูป size M',
  category: 'diapers' as const,
  onHandQty: 20,
  usesPerContainer: 40,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
};

const FEEDING_ITEM = {
  id: 'item-feeding-1',
  name: 'นมผงสูตร 1',
  category: 'feeding' as const,
  onHandQty: 3,
  usesPerContainer: 30,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSupplyItems.mockReturnValue([]);
});

describe('SupplyItemPickerScreen — token correctness (ห้องแม่)', () => {
  it('renders without crashing', () => {
    expect(() => SupplyItemPickerScreen(baseProps)).not.toThrow();
  });

  it('no elements use banned #94818A color', () => {
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('background uses T.color.surface.base', () => {
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const containers = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.surface.base;
    });
    expect(containers.length).toBeGreaterThan(0);
  });
});

describe('SupplyItemPickerScreen — empty state', () => {
  it('shows a calm invite-to-add-supply message when no items exist', () => {
    mockGetSupplyItems.mockReturnValue([]);
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain('supplyItemPicker.emptyState');
  });

  it('does not render any FlatList row when empty', () => {
    mockGetSupplyItems.mockReturnValue([]);
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-row');
    expect(rows).toHaveLength(0);
  });
});

describe('SupplyItemPickerScreen — populated state', () => {
  it('renders a row for each supply item (verbatim name only — FW-1)', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM, FEEDING_ITEM]);
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).toContain(DIAPER_ITEM.name);
    expect(texts).toContain(FEEDING_ITEM.name);
  });

  it('rows are standalone TouchableOpacity (containment rule) with accessibilityRole=button', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM]);
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-row');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect((row.props as Record<string, unknown>).accessibilityRole).toBe('button');
    });
  });
});

describe('SupplyItemPickerScreen — tap-to-link behavior (Bug #2 core fix)', () => {
  it('tapping an item row calls consumptionMappingStore.enqueueCreate exactly once with a well-formed record', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM]);
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-row');
    expect(rows.length).toBe(1);

    const onPress = (rows[0]!.props as Record<string, unknown>).onPress as () => void;
    onPress();

    expect(mockEnqueueCreate).toHaveBeenCalledTimes(1);
    const record = mockEnqueueCreate.mock.calls[0][0];
    expect(record.activityType).toBe('diaper_change');
    expect(record.supplyItemId).toBe(DIAPER_ITEM.id);
    expect(record.version).toBe(0);
    expect(typeof record.id).toBe('string');
    expect(record.id.length).toBeGreaterThan(0);
    expect(typeof record.defaultQty).toBe('number');
    expect(record.defaultQty).toBeGreaterThanOrEqual(0);
    expect(typeof record.createdAt).toBe('string');
    expect(typeof record.updatedAt).toBe('string');
    expect(record.deletedAt).toBeNull();
    // ISO-parseable
    expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(record.updatedAt))).toBe(false);
  });

  // appsec 🟡1: the picker must NEVER create a mapping pre-enabled. Enabling
  // is a separate, consent-gated action the mother takes explicitly from
  // AutoDecrementSettingsScreen's toggle (CONSENT-1 guard,
  // AutoDecrementSettingsScreen.tsx handleToggle). Creating with enabled:true
  // here would let an enabled=true mapping sync to the server before consent
  // is confirmed granted — a PDPA-audit inconsistency (the trigger engine
  // still re-gates consent at decrement time, so no wrong decrement occurs,
  // but the persisted mapping state would misrepresent what the mother
  // actually consented to).
  it('appsec 🟡1 FAIL-ON-REVERT: newly-linked mapping is always created with enabled:false', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM]);
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-row');
    const onPress = (rows[0]!.props as Record<string, unknown>).onPress as () => void;
    onPress();

    expect(mockEnqueueCreate).toHaveBeenCalledTimes(1);
    const record = mockEnqueueCreate.mock.calls[0][0];
    expect(record.enabled).toBe(false);
  });

  it('appsec 🟡1: enabled:false holds regardless of which activity type is being linked (feeding_formula)', () => {
    mockGetSupplyItems.mockReturnValue([FEEDING_ITEM]);
    const tree = SupplyItemPickerScreen({ ...baseProps, activityType: 'feeding_formula' }) as React.ReactElement;
    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-row');
    const onPress = (rows[0]!.props as Record<string, unknown>).onPress as () => void;
    onPress();

    const record = mockEnqueueCreate.mock.calls[0][0];
    expect(record.enabled).toBe(false);
  });

  it('calls onPicked?.() after linking when provided', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM]);
    const onPicked = jest.fn();
    const props = { ...baseProps, onPicked };
    const tree = SupplyItemPickerScreen(props) as React.ReactElement;
    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-row');
    const onPress = (rows[0]!.props as Record<string, unknown>).onPress as () => void;
    onPress();
    expect(onPicked).toHaveBeenCalledTimes(1);
  });

  it('falls back to onBack() after linking when onPicked is absent', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM]);
    const onBack = jest.fn();
    const props = { ...baseProps, onBack };
    const tree = SupplyItemPickerScreen(props) as React.ReactElement;
    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-row');
    const onPress = (rows[0]!.props as Record<string, unknown>).onPress as () => void;
    onPress();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SupplyItemPickerScreen — FW-1 (no brand/promo copy)', () => {
  it('renders no prohibited Milk-Code copy near feeding items', () => {
    mockGetSupplyItems.mockReturnValue([FEEDING_ITEM]);
    const tree = SupplyItemPickerScreen({ ...baseProps, activityType: 'feeding_formula' }) as React.ReactElement;
    const texts = collectText(tree);
    texts.forEach((t) => {
      expect(t).not.toMatch(/Nestlé|enfamil|similac/i);
    });
  });
});

// appsec 🟡2: the check above only tests 3 hand-picked brand regexes, not the
// real FW-1 blocklist (ซื้อ/สั่ง/โปร/ลด/฿ราคา/reorder/order/cart/shop/discount/
// coupon/health-claim tokens/age-targeting trigger — see fw1Scanner.ts). Run
// every NEW supplyItemPicker.* i18n key (both locales) through the REAL
// isFW1Clean / scanForFW1Violations scanner, not a hand-picked regex.
describe('SupplyItemPickerScreen — FW-1: new i18n copy scanned by the REAL fw1Scanner (appsec 🟡2)', () => {
  it('every supplyItemPicker.* key in BOTH th and en catalogs passes isFW1Clean', () => {
    const { catalog } = jest.requireActual<typeof import('../i18n/messages')>('../i18n/messages');
    const { isFW1Clean, scanForFW1Violations } = jest.requireActual<
      typeof import('./fw1Scanner')
    >('./fw1Scanner');

    (['th', 'en'] as const).forEach((locale) => {
      const localeCatalog = catalog[locale] as Record<string, unknown>;
      const supplyItemPickerKeys = Object.keys(localeCatalog).filter((k) =>
        k.startsWith('supplyItemPicker.'),
      );

      // Guard: the enumeration itself must find the 3 keys this screen added —
      // if the catalog shape ever changes and the filter silently matches
      // nothing, the loop below would vacuously pass. Fail loudly instead.
      expect(supplyItemPickerKeys.length).toBeGreaterThanOrEqual(3);
      expect(supplyItemPickerKeys).toEqual(
        expect.arrayContaining([
          'supplyItemPicker.navTitle',
          'supplyItemPicker.emptyState',
          'supplyItemPicker.backA11y',
        ]),
      );

      supplyItemPickerKeys.forEach((key) => {
        const text = localeCatalog[key];
        if (typeof text !== 'string') return; // skip non-string catalog entries, if any
        const violations = scanForFW1Violations(text);
        expect({ locale, key, text, violations }).toEqual({
          locale,
          key,
          text,
          violations: [],
        });
        expect(isFW1Clean(text)).toBe(true);
      });
    });
  });
});

describe('SupplyItemPickerScreen — review fix: "แนะนำ" (suggested) group label', () => {
  it('shows the suggested-group label when both a suggested item and a non-suggested item exist', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM, FEEDING_ITEM]); // diaper_change → 'diapers' suggested
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement; // activityType: diaper_change
    const texts = collectText(tree);
    expect(texts).toContain('แนะนำ');
  });

  it('does NOT show the label when every item is in the suggested category (label would be redundant)', () => {
    mockGetSupplyItems.mockReturnValue([DIAPER_ITEM]);
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).not.toContain('แนะนำ');
  });

  it('does NOT show the label when no item matches the suggested category', () => {
    mockGetSupplyItems.mockReturnValue([FEEDING_ITEM]); // activityType diaper_change suggests 'diapers'
    const tree = SupplyItemPickerScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).not.toContain('แนะนำ');
  });

  it('the fallback "แนะนำ" copy passes the real FW-1 scanner (no brand/promo)', () => {
    const { isFW1Clean, scanForFW1Violations } = jest.requireActual<
      typeof import('./fw1Scanner')
    >('./fw1Scanner');
    expect(scanForFW1Violations('แนะนำ')).toEqual([]);
    expect(isFW1Clean('แนะนำ')).toBe(true);
  });
});

describe('SupplyItemPickerScreen — back navigation', () => {
  it('back button invokes onBack', () => {
    const onBack = jest.fn();
    const tree = SupplyItemPickerScreen({ ...baseProps, onBack }) as React.ReactElement;
    const backButtons = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supply-item-picker-back');
    expect(backButtons.length).toBe(1);
    const onPress = (backButtons[0]!.props as Record<string, unknown>).onPress as () => void;
    onPress();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
