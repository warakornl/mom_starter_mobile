/**
 * calendarSyncPrivacyLevelScreen.i18n.test.tsx
 *
 * i18n stopgap fix (task #40 tail — same anti-pattern as
 * CalendarSyncSettingsScreen's now-fixed Thai-only `C` object):
 *   🔴 CalendarSyncPrivacyLevelScreen used to build all copy from a local
 *   Thai-only `C` object instead of the shared i18n catalog. Fixed to route
 *   every string through useT()'s t('calendarSyncPrivacyLevel.*' |
 *   'calendarSync.*') so the screen actually respects locale=en.
 *
 * FAIL-ON-REVERT: mocks t() as an IDENTITY function returning the key
 * itself, then asserts the rendered title/labels equal the catalog KEYS
 * (not the old hardcoded Thai literals). If the component reverts to the
 * literal `C` object, the assertions on catalog-key equality fail.
 *
 * Pattern mirrors calendarSyncSettingsScreen.motherRoom.test.tsx (call the
 * component as a plain function; hooks mocked pass-through).
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (o: unknown) => o },
  ScrollView: 'ScrollView', Modal: 'Modal',
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});

jest.mock('../../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th', setLocale: jest.fn() }),
}));

import React from 'react';
import { CalendarSyncPrivacyLevelScreen } from './CalendarSyncPrivacyLevelScreen';

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

const baseProps = {
  currentLevel: 'generic' as const,
  onLevelSelected: jest.fn(),
  onBack: jest.fn(),
};

describe('CalendarSyncPrivacyLevelScreen — i18n catalog wiring', () => {
  it('FAIL-ON-REVERT: title/back/generic-label render catalog KEYS, not hardcoded Thai literals', () => {
    const tree = CalendarSyncPrivacyLevelScreen(baseProps) as React.ReactElement;

    const title = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'privacy-level-title')[0];
    expect((title.props as { children?: unknown }).children).toBe('calendarSyncPrivacyLevel.title');

    const backBtn = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'privacy-level-back-btn')[0];
    expect((backBtn.props as Record<string, unknown>).accessibilityLabel).toBe('calendarSync.back');

    const genericOption = findAll(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'privacy-level-generic-option',
    )[0];
    expect((genericOption.props as Record<string, unknown>).accessibilityLabel).toBe('calendarSync.privacyGeneric');
    expect((genericOption.props as Record<string, unknown>).accessibilityHint).toBe(
      'calendarSyncPrivacyLevel.genericA11yHint',
    );

    const descOption = findAll(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'privacy-level-descriptive-option',
    )[0];
    expect((descOption.props as Record<string, unknown>).accessibilityLabel).toBe('calendarSync.privacyDescriptive');

    // Old hardcoded Thai literals must NOT appear anywhere in the label/hint props.
    const bannedLiterals = ['ระดับความเป็นส่วนตัว', 'ซ่อนชื่อนัด (ปลอดภัยกว่า)', 'ย้อนกลับ'];
    const allLabeled = findAll(
      tree,
      (el) => typeof (el.props as Record<string, unknown>).accessibilityLabel === 'string',
    );
    for (const el of allLabeled) {
      const label = (el.props as Record<string, unknown>).accessibilityLabel as string;
      expect(bannedLiterals).not.toContain(label);
    }
  });
});
