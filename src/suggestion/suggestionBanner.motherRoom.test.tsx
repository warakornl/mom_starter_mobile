/**
 * suggestionBanner.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — SuggestionBanner
 *
 * Includes:
 *  - Token migration (no IBMPlex, no banned hex, amber wash bg)
 *  - FAIL-ON-REVERT: loss gate at line 74 preserved (returns null when no topSuggestion)
 *
 * The existing loss gate is handled upstream by suggestionEngine (getOfferable returns
 * [] for lifecycle='ended') → SuggestionBanner receives null topSuggestion → returns
 * null. The fail-on-revert test verifies this behavior is NOT removed.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (o: unknown) => o }, Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

import React from 'react';
import { SuggestionBanner } from './SuggestionBanner';
import { T } from '../theme/tokens';
import type { OfferableSuggestion } from './types';

const mockSuggestion: OfferableSuggestion = {
  key: 'kick_count_start',
  captureTarget: 'kick_count',
  evidenceStrength: 'MODERATE',
  source: 'engine',
};

const baseProps = {
  topSuggestion: mockSuggestion,
  onAction: jest.fn(),
  onDismiss: jest.fn(),
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

describe('SuggestionBanner — ห้องแม่ Phase 2 B4 reskin', () => {
  // ─── Token migration tests ────────────────────────────────────────────────

  it('no elements use IBMPlexSans', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/50 #FBEDEE or rose/100 #F4D9DC', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FBEDEE' || s.backgroundColor === '#F4D9DC';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#A8505A' || s.color === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/700 #8E3A44', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44';
    })).toHaveLength(0);
  });

  it('no elements use banned #5F4A52 or #3A2A30', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52' || s.color === '#3A2A30';
    })).toHaveLength(0);
  });

  it('card bg is T.color.surface.wash.amber (amber-100)', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    const s = flat((tree as React.ReactElement).props.style);
    expect(s.backgroundColor).toBe(T.color.surface.wash.amber);
  });

  it('start button bg is T.button.primary.bg amber-700', () => {
    const tree = SuggestionBanner(baseProps) as React.ReactElement;
    const btn = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'suggestion-banner-action';
    })[0];
    expect(btn).toBeDefined();
    const s = flat((btn.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.button.primary.bg);
  });

  // ─── Loss gate: PRESERVED (fail-on-revert) ────────────────────────────────
  //
  // The existing gate: `if (!topSuggestion) return null`
  // The suggestionEngine gate: `if (ctx.lifecycle === 'ended') return []`
  // When engine returns [], parent passes null topSuggestion → banner returns null.
  //
  // FAIL-ON-REVERT: removing the `if (!topSuggestion) return null` guard causes
  // the banner to crash/render garbage when topSuggestion is null. This test
  // verifies the gate is preserved.

  it('LOSS-GATE PRESERVED: returns null when topSuggestion is null', () => {
    const result = SuggestionBanner({ ...baseProps, topSuggestion: null });
    expect(result).toBeNull();
  });

  it('LOSS-GATE PRESERVED: returns null when topSuggestion is undefined', () => {
    const result = SuggestionBanner({ ...baseProps, topSuggestion: undefined });
    expect(result).toBeNull();
  });

  it('FAIL-ON-REVERT: banner IS rendered when topSuggestion is provided', () => {
    const result = SuggestionBanner(baseProps);
    expect(result).not.toBeNull();
  });
});
