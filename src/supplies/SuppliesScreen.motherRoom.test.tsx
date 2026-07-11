/**
 * SuppliesScreen.motherRoom.test.tsx — TDD RED → GREEN
 *
 * Bug #3 (🟡): "หน้าของใช้ ตัวอักษรทับปุ่มไปหมด" (text overlaps buttons).
 * ROOT CAUSE: FlatList has no `style={{ flex: 1 }}`, and the auto-decrement-settings
 * button + feeding-log button are normal-flow children AFTER the list, colliding
 * with the absolutely-positioned FAB (bottom:24) and refreshBtn (bottom:80).
 *
 * FIX: FlatList gets style flex:1; auto-decrement entry moves into
 * ListFooterComponent (scrolls with content, never overlaps the pinned FAB).
 *
 * Bug #4 (🟢): feeding-log entry/button REMOVED from SuppliesScreen entirely
 * (moved to HomeTabScreen — see homeTabScreen.feedingLog.test.ts).
 *
 * Convention: this codebase has no @testing-library/react-native — components
 * are called as plain functions and the React element tree is traversed
 * (see AutoDecrementSettingsScreen.motherRoom.test.tsx for the established pattern).
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
  FlatList: 'FlatList',
  SafeAreaView: 'SafeAreaView',
  Modal: 'Modal',
  StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
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
    getSupplyItem: jest.fn(() => undefined),
    getWatermark: jest.fn(() => undefined),
    getPendingCount: jest.fn(() => 0),
    enqueueCreate: jest.fn(),
    enqueueUpdate: jest.fn(),
    enqueueDelete: jest.fn(),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createSyncClient: jest.fn(() => ({
    push: jest.fn(() => Promise.resolve({ ok: true, applied: [], conflicts: [], rejected: [] })),
    pull: jest.fn(() => Promise.resolve({ ok: true, watermark: '' })),
  })),
}));

jest.mock('../sync/pushOrchestrator', () => ({
  executePush: jest.fn(() => Promise.resolve({ ok: true, conflicts: [], rejected: [] })),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

// React hooks — plain-function call pattern (mirrors lossGateWiring.test.ts style).
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
import { SuppliesScreen } from './SuppliesScreen';

// ─── Helpers (same traversal pattern as AutoDecrementSettingsScreen tests) ────

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
    // Also descend into known render-prop-style fields that carry element trees
    // (FlatList's ListFooterComponent / ListEmptyComponent are elements, not fn-children).
    const props = el.props as Record<string, unknown>;
    if (props.ListFooterComponent) walk(props.ListFooterComponent);
    if (props.ListEmptyComponent) walk(props.ListEmptyComponent);
  }
  walk(node);
  return acc;
}

function flat(s: unknown): Record<string, unknown> {
  if (Array.isArray(s)) return Object.assign({}, ...s.map(flat));
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return {};
}

const baseProps = {
  tokenStorage: {
    load: jest.fn(() => Promise.resolve(null)),
    save: jest.fn(),
    clear: jest.fn(),
  },
  apiBaseUrl: 'https://api.example.com',
  onAutoDecrementSettings: jest.fn(),
};

describe('SuppliesScreen — Bug #3: FlatList/FAB overlap fix', () => {
  it('FlatList has style flex:1 (so it never grows into the absolutely-positioned FAB zone)', () => {
    const tree = SuppliesScreen(baseProps) as React.ReactElement;
    const lists = findAll(tree, (el) => el.type === 'FlatList');
    expect(lists.length).toBe(1);
    const s = flat((lists[0]!.props as Record<string, unknown>).style);
    expect(s.flex).toBe(1);
  });

  it('the auto-decrement-settings entry is rendered as the FlatList ListFooterComponent (scrolls with content)', () => {
    const tree = SuppliesScreen(baseProps) as React.ReactElement;
    const lists = findAll(tree, (el) => el.type === 'FlatList');
    expect(lists.length).toBe(1);
    const footer = (lists[0]!.props as Record<string, unknown>).ListFooterComponent;
    expect(footer).toBeTruthy();
    const footerButtons = findAll(footer as React.ReactElement, (el) =>
      (el.props as Record<string, unknown>).testID === 'supplies-auto-decrement-settings',
    );
    expect(footerButtons.length).toBe(1);
  });

  it('the auto-decrement-settings button is NOT a normal-flow sibling of the FAB anymore (no duplicate outside the footer)', () => {
    const tree = SuppliesScreen(baseProps) as React.ReactElement;
    // Any occurrence of the testID anywhere in the tree (footer included) must be exactly 1.
    const allHits = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'supplies-auto-decrement-settings',
    );
    expect(allHits.length).toBe(1);
  });

  it('FAB and the auto-decrement entry do not share the same absolute anchor', () => {
    const tree = SuppliesScreen(baseProps) as React.ReactElement;
    const fab = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supplies-add')[0]!;
    const fabStyle = flat((fab.props as Record<string, unknown>).style);
    expect(fabStyle.position).toBe('absolute');

    const lists = findAll(tree, (el) => el.type === 'FlatList');
    const footer = (lists[0]!.props as Record<string, unknown>).ListFooterComponent;
    const entryBtn = findAll(footer as React.ReactElement, (el) =>
      (el.props as Record<string, unknown>).testID === 'supplies-auto-decrement-settings',
    )[0]!;
    const entryStyle = flat((entryBtn.props as Record<string, unknown>).style);
    // The footer entry must NOT be absolutely positioned (it scrolls with content).
    expect(entryStyle.position).not.toBe('absolute');
  });
});

describe('SuppliesScreen — Bug #4: feeding-log entry REMOVED from this screen', () => {
  it('does not render a feeding-log button (testID supplies-feeding-log absent)', () => {
    const tree = SuppliesScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'supplies-feeding-log');
    expect(hits).toHaveLength(0);
  });

  it('no rendered text is the feeding-log i18n key (no dead affordance left behind)', () => {
    const tree = SuppliesScreen(baseProps) as React.ReactElement;
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
        const props = el.props as Record<string, unknown>;
        if (props.ListFooterComponent) walk(props.ListFooterComponent);
        if (props.ListEmptyComponent) walk(props.ListEmptyComponent);
      }
      walk(node);
      return texts;
    }
    const texts = collectText(tree);
    expect(texts).not.toContain('supplies.feedingLog');
  });

  it('SuppliesScreenProps no longer accepts onFeedingLog at the type level (source-grep guard)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'SuppliesScreen.tsx'), 'utf8');
    expect(src).not.toContain('onFeedingLog');
  });
});
