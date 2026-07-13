/**
 * welcomeScreen.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B1 reskin — WelcomeScreen
 *
 * Pattern: call component as plain function → traverse returned React element tree.
 * All assertions verify token values directly from styleSheet props (no live render).
 *
 * Banned values (design-reviewer gate):
 *   #94818A (ink/faint), #A8505A (old rose/600), #3A2A30 raw (must use T.color.text.heading)
 *   #5F4A52 raw, #FFFFFF as nested surface bg, IBMPlexSans font family
 *   🌸 emoji illustration
 */

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  SafeAreaView: 'SafeAreaView',
  StatusBar: 'StatusBar',
  StyleSheet: { create: (o: unknown) => o },
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: (key: string) => key,
    locale: 'th',
    setLocale: jest.fn(),
  })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { WelcomeScreen } from './WelcomeScreen';
import { T } from '../theme/tokens';

// ─── Tree traversal helper ────────────────────────────────────────────────────

function findFirst(
  node: unknown,
  predicate: (el: React.ReactElement) => boolean,
): React.ReactElement | null {
  if (node === null || node === undefined || node === false) return null;
  if (Array.isArray(node)) {
    for (const child of node as unknown[]) {
      const found = findFirst(child, predicate);
      if (found !== null) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement;
  if (predicate(el)) return el;
  const { children } = el.props as { children?: unknown };
  return findFirst(children, predicate);
}

function findAll(
  node: unknown,
  predicate: (el: React.ReactElement) => boolean,
): React.ReactElement[] {
  const results: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n === null || n === undefined || n === false) return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (predicate(el)) results.push(el);
    const { children } = el.props as { children?: unknown };
    walk(children);
  }
  walk(node);
  return results;
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle));
  if (typeof style === 'object' && style !== null) return style as Record<string, unknown>;
  return {};
}

// ─── Shared navigation stub ───────────────────────────────────────────────────

const navigation = {
  navigate: jest.fn(),
  reset: jest.fn(),
  goBack: jest.fn(),
  dispatch: jest.fn(),
  isFocused: () => true,
  canGoBack: () => false,
  setOptions: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  removeListener: jest.fn(),
  getId: jest.fn(),
  getParent: jest.fn(),
  getState: jest.fn(() => ({ index: 0, routes: [] })),
} as any;

const route = { key: 'Welcome', name: 'Welcome' as const, params: undefined } as any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WelcomeScreen — ห้องแม่ Phase 2 B1 reskin', () => {
  let tree: React.ReactElement;

  beforeEach(() => {
    tree = WelcomeScreen({ navigation, route }) as React.ReactElement;
  });

  // ── Emoji removal ──────────────────────────────────────────────────────────

  it('🌸 emoji is NOT rendered (replaced by typographic lockup)', () => {
    const emojiText = findFirst(
      tree,
      (el) => el.type === 'Text' && (el.props as { children?: unknown }).children === '🌸',
    );
    expect(emojiText).toBeNull();
  });

  // ── Primary button ─────────────────────────────────────────────────────────

  it('primary CTA button uses amber-700 (#9A5F0A) — NOT old rose #A8505A', () => {
    // Find the testID="welcome-register-btn" button
    const btn = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'welcome-register-btn',
    );
    expect(btn).not.toBeNull();
    const s = flatStyle((btn!.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.button.primary.bg); // #9A5F0A
    expect(s.backgroundColor).not.toBe('#A8505A');
  });

  it('primary CTA button height is 52dp', () => {
    const btn = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'welcome-register-btn',
    );
    const s = flatStyle((btn!.props as Record<string, unknown>).style);
    expect(s.height).toBe(52);
  });

  it('primary CTA button radius is T.radius.md (12dp)', () => {
    const btn = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'welcome-register-btn',
    );
    const s = flatStyle((btn!.props as Record<string, unknown>).style);
    expect(s.borderRadius).toBe(T.radius.md);
  });

  // ── Secondary button ───────────────────────────────────────────────────────

  it('secondary sign-in button bg is ivory-200 (surface.subtle #F5EDE6) — NOT #FFFFFF', () => {
    const btn = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'welcome-login-btn',
    );
    expect(btn).not.toBeNull();
    const s = flatStyle((btn!.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.subtle); // #F5EDE6
    expect(s.backgroundColor).not.toBe('#FFFFFF');
  });

  it('secondary button border color is surface.divider (#E8DDD5)', () => {
    const btn = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'welcome-login-btn',
    );
    const s = flatStyle((btn!.props as Record<string, unknown>).style);
    expect(s.borderColor).toBe(T.color.surface.divider);
  });

  // ── Lang toggle ────────────────────────────────────────────────────────────

  it('lang toggle bg is ivory-200 — NOT white #FFFFFF', () => {
    const toggle = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'lang-toggle',
    );
    expect(toggle).not.toBeNull();
    const s = flatStyle((toggle!.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.subtle);
    expect(s.backgroundColor).not.toBe('#FFFFFF');
  });

  it('lang toggle border is surface.divider', () => {
    const toggle = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'lang-toggle',
    );
    const s = flatStyle((toggle!.props as Record<string, unknown>).style);
    expect(s.borderColor).toBe(T.color.surface.divider);
  });

  it('lang toggle border-radius is T.radius.pill (999)', () => {
    const toggle = findFirst(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'lang-toggle',
    );
    const s = flatStyle((toggle!.props as Record<string, unknown>).style);
    expect(s.borderRadius).toBe(T.radius.pill);
  });

  // ── Typography — no IBM Plex, no banned hex ────────────────────────────────

  it('no Text elements use IBMPlexSans font family', () => {
    const ibmTexts = findAll(
      tree,
      (el) => {
        if (el.type !== 'Text') return false;
        const s = flatStyle((el.props as Record<string, unknown>).style);
        return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
      },
    );
    expect(ibmTexts).toHaveLength(0);
  });

  it('no elements use banned placeholder color #94818A', () => {
    const banned = findAll(
      tree,
      (el) => {
        const s = flatStyle((el.props as Record<string, unknown>).style);
        return s.color === '#94818A';
      },
    );
    expect(banned).toHaveLength(0);
  });

  it('disclaimer color is text.primary (roselle-700 #7A3A52) NOT #94818A', () => {
    // Find disclaimer (last Text in the tree that contains 'welcome.disclaimer')
    const disc = findFirst(
      tree,
      (el) =>
        el.type === 'Text' &&
        (el.props as Record<string, unknown>).children === 'welcome.disclaimer',
    );
    expect(disc).not.toBeNull();
    const s = flatStyle((disc!.props as Record<string, unknown>).style);
    expect(s.color).toBe(T.color.text.primary); // #7A3A52
    expect(s.color).not.toBe('#94818A');
  });

  // ── App name line-height fix (F-3 from spec §7) ────────────────────────────

  it('app name lineHeight is 52 (Thai ≥1.6× rule: 32sp × 1.625 = 52)', () => {
    // The app name text — either 'ห้องแม่' or styled appName
    const appNameText = findFirst(
      tree,
      (el) => {
        if (el.type !== 'Text') return false;
        const s = flatStyle((el.props as Record<string, unknown>).style);
        return s.fontSize === 32;
      },
    );
    expect(appNameText).not.toBeNull();
    const s = flatStyle((appNameText!.props as Record<string, unknown>).style);
    expect(s.lineHeight).toBe(52);
  });

  it('app name fontFamily is Sarabun-SemiBold (not IBMPlexSans)', () => {
    const appNameText = findFirst(
      tree,
      (el) => {
        if (el.type !== 'Text') return false;
        const s = flatStyle((el.props as Record<string, unknown>).style);
        return s.fontSize === 32;
      },
    );
    const s = flatStyle((appNameText!.props as Record<string, unknown>).style);
    expect(s.fontFamily).toBe('Sarabun-SemiBold');
    expect(s.fontFamily).not.toMatch(/IBMPlex/);
  });

  // ── Screen bg ──────────────────────────────────────────────────────────────

  it('container bg is surface.base #FBF6F1', () => {
    const s = flatStyle((tree.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });

  // ── Headline inset (owner live-test fix: "ตกขอบซ้าย") ──────────────────────
  // The headline block (the flex-start lockup that holds appName + tagline) must
  // carry an extra horizontal inset on top of the container gutter so the text
  // sits further from the left edge. Fail-on-revert: removing the inset breaks it.

  it('headline block has a +12dp horizontal inset (owner "ตกขอบซ้าย" fix)', () => {
    const headline = findFirst(
      tree,
      (el) => {
        if (el.type !== 'View') return false;
        const s = flatStyle((el.props as Record<string, unknown>).style);
        return s.alignItems === 'flex-start';
      },
    );
    expect(headline).not.toBeNull();
    const s = flatStyle((headline!.props as Record<string, unknown>).style);
    expect(s.paddingHorizontal).toBe(T.spacing[3]); // 12dp headline-only inset
    // and it must be additive to the container's own gutter (both present)
    const container = flatStyle((tree.props as Record<string, unknown>).style);
    expect(container.paddingHorizontal).toBe(T.spacing[6]); // 24dp gutter unchanged
  });
});
