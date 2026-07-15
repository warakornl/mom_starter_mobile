/**
 * accentRow.motherRoom.test.tsx
 * TDD: ห้องแม่ CLUSTER 2 UX/UI review fix — AccentRow Thai truncation.
 *
 * FAIL-ON-REVERT: title/value Text elements previously had numberOfLines={1},
 * silently clipping longer Thai health labels (e.g. "นัดฝากครรภ์ครั้งถัดไป")
 * with no way to recover the text. Now allow up to 2 lines with
 * adjustsFontSizeToFit as an auto-shrink fallback.
 */

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (o: unknown) => o },
}));

import React from 'react';
import { AccentRow } from './AccentRow';

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

describe('AccentRow — Thai truncation FIX (CLUSTER 2 review)', () => {
  it('FAIL-ON-REVERT: title Text allows up to 2 lines (was numberOfLines=1)', () => {
    const tree = AccentRow({
      type: 'pregnancy',
      title: 'นัดฝากครรภ์ครั้งถัดไปที่โรงพยาบาล',
      value: 'พรุ่งนี้',
    }) as React.ReactElement;
    const titleEl = findAll(tree, (el) => (el.props as Record<string, unknown>).children === 'นัดฝากครรภ์ครั้งถัดไปที่โรงพยาบาล')[0];
    expect(titleEl).toBeDefined();
    expect((titleEl!.props as Record<string, unknown>).numberOfLines).toBe(2);
    expect((titleEl!.props as Record<string, unknown>).adjustsFontSizeToFit).toBe(true);
  });

  it('FAIL-ON-REVERT: value Text allows up to 2 lines (was numberOfLines=1)', () => {
    const tree = AccentRow({
      type: 'health',
      title: 'ยา',
      value: 'รับประทานหลังอาหารเช้า กลางวัน และเย็น',
    }) as React.ReactElement;
    const valueEl = findAll(tree, (el) => (el.props as Record<string, unknown>).children === 'รับประทานหลังอาหารเช้า กลางวัน และเย็น')[0];
    expect(valueEl).toBeDefined();
    expect((valueEl!.props as Record<string, unknown>).numberOfLines).toBe(2);
    expect((valueEl!.props as Record<string, unknown>).adjustsFontSizeToFit).toBe(true);
  });

  it('row still uses minHeight (not fixed height) so 2-line content can grow the row', () => {
    const tree = AccentRow({ type: 'pregnancy', title: 'x', value: 'y', onPress: jest.fn() }) as React.ReactElement;
    const touchable = tree; // outer TouchableOpacity when onPress is provided
    const style = (touchable.props as Record<string, unknown>).style as Record<string, unknown>;
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.height).toBeUndefined();
  });
});
