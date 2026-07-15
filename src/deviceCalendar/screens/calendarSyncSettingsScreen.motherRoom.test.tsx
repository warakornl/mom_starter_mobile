/**
 * calendarSyncSettingsScreen.motherRoom.test.tsx
 *
 * UX/UI review fix (CLUSTER 3 — Calendar + device-calendar sync):
 *   🔴 CS-6 "ไปที่การตั้งค่า" (open OS settings) button had NO onPress — a dead
 *   recovery button when OS calendar permission was denied. Fixed to call
 *   Linking.openSettings(). Also minHeight 36 → ≥48dp touch target.
 *
 * Pattern: call the screen component directly as a function (React hooks
 * mocked pass-through) and walk the returned element tree — mirrors
 * src/settings/settingsScreen.motherRoom.test.tsx / calendarScreen.motherRoom.test.tsx.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  Switch: 'Switch', ScrollView: 'ScrollView', Alert: { alert: jest.fn() },
  StyleSheet: { create: (o: unknown) => o },
  Linking: { openSettings: jest.fn(() => Promise.resolve()) },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});

jest.mock('./CalendarSyncConsentSheet', () => ({
  CalendarSyncConsentSheet: 'CalendarSyncConsentSheet',
}));

import React from 'react';
import { CalendarSyncSettingsScreen } from './CalendarSyncSettingsScreen';

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

const baseProps = {
  onNavigateToPrivacyLevel: jest.fn(),
  onBack: jest.fn(),
  featureEnabled: true,
  osPermissionGranted: false, // CS-6 banner only renders when denied
};

describe('CalendarSyncSettingsScreen — CS-6 OS-settings recovery button', () => {
  it('FAIL-ON-REVERT: os-settings button onPress calls Linking.openSettings()', () => {
    const tree = CalendarSyncSettingsScreen(baseProps) as React.ReactElement;
    const btns = findAll(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'calendar-sync-os-settings-btn',
    );
    expect(btns).toHaveLength(1);

    const onPress = (btns[0].props as { onPress?: () => void }).onPress;
    expect(typeof onPress).toBe('function');
    onPress!();

    const { Linking } = jest.requireMock('react-native') as { Linking: { openSettings: jest.Mock } };
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('FAIL-ON-REVERT: os-settings button meets the ≥48dp touch-target minimum', () => {
    const tree = CalendarSyncSettingsScreen(baseProps) as React.ReactElement;
    const btns = findAll(
      tree,
      (el) => (el.props as Record<string, unknown>).testID === 'calendar-sync-os-settings-btn',
    );
    expect(btns).toHaveLength(1);
    const s = flat((btns[0].props as Record<string, unknown>).style);
    expect((s.minHeight as number) ?? 0).toBeGreaterThanOrEqual(48);
  });
});
