/**
 * KickCountHistoryChartIntegration.test.ts — TDD integration tests for the
 * chart + date-range picker feature added to KickCountHistoryScreen.
 *
 * Scope (pure-node jest environment):
 *   1. Default range helper: fromDate = today−6, toDate = today.
 *   2. Range guard helpers: from ≤ to enforcement, max-span cap, toDate ≤ today.
 *   3. i18n keys for range picker (chartFrom, chartTo, chart7d/14d/30d, chartDateRange).
 *   4. KickCountHistoryScreen module is a function (structural smoke).
 *   5. K-8: KickCountHistoryScreen source has no console.* logging.
 *   6. SD-9: KickCountHistoryScreen source navigates with only sessionId (no health fields).
 *   7. List-filter helper: sessions outside fromDate..toDate are excluded.
 *
 * We do NOT render the component (no @testing-library/react-native in node env).
 */

// ─── Native module stubs (must come before any imports) ──────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  FlatList: 'FlatList',
  StyleSheet: { create: (o: unknown) => o },
  Platform: { OS: 'ios' },
}));

jest.mock('react-native-svg', () => ({
  default: 'Svg',
  Svg: 'Svg',
  Rect: 'Rect',
  Line: 'Line',
  Text: 'Text',
  G: 'G',
}));

jest.mock('@react-native-community/datetimepicker', () => ({
  default: 'DateTimePicker',
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@react-navigation/native-stack', () => ({}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

jest.mock('./kickCountSyncStore', () => ({
  kickCountSyncStore: { getActiveSessions: () => [] },
}));

jest.mock('./kickCountLogic', () => ({
  isStartAllowedByWeek: () => true,
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  buildDefaultFromDate,
  buildDefaultToDate,
  clampToDate,
  clampFromDate,
  MAX_RANGE_DAYS,
  filterSessionsToRange,
} from './kickCountHistoryChartHelpers';
import { catalog } from '../i18n/messages';
import type { KickCountSessionRecord } from './kickCountTypes';

// ─── Session factory ──────────────────────────────────────────────────────────

let _seq = 0;
function makeSession(startedAt: string): KickCountSessionRecord {
  _seq += 1;
  return {
    id: `test-${_seq}`,
    startedAt,
    movementCount: 5,
    targetCount: 10,
    status: 'completed',
    version: 1,
    createdAt: '2026-07-01T00:00Z',
    updatedAt: '2026-07-01T00:00Z',
  };
}

// ─── 1. Default range: today−6 → today ───────────────────────────────────────

describe('kickCountHistoryChartHelpers — default date range', () => {
  it('buildDefaultToDate returns the supplied today date', () => {
    expect(buildDefaultToDate('2026-07-08')).toBe('2026-07-08');
  });

  it('buildDefaultFromDate returns 6 days before today (last 7 days inclusive)', () => {
    expect(buildDefaultFromDate('2026-07-08')).toBe('2026-07-02');
  });

  it('buildDefaultFromDate is always 6 days earlier than buildDefaultToDate', () => {
    const today = '2026-07-08';
    const from = buildDefaultFromDate(today);
    const to = buildDefaultToDate(today);
    // 6 days difference = 7 days inclusive range
    const fromMs = new Date(from + 'T00:00:00Z').getTime();
    const toMs = new Date(to + 'T00:00:00Z').getTime();
    const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(6);
  });

  it('default range spans a month boundary correctly', () => {
    // today = 2026-07-02, so from = 2026-06-26
    expect(buildDefaultFromDate('2026-07-02')).toBe('2026-06-26');
  });
});

// ─── 2. Range guards ─────────────────────────────────────────────────────────

describe('kickCountHistoryChartHelpers — range guards', () => {
  it('clampToDate does not allow toDate after today', () => {
    const today = '2026-07-08';
    expect(clampToDate('2026-07-10', today)).toBe(today);
  });

  it('clampToDate returns toDate when it is on or before today', () => {
    expect(clampToDate('2026-07-05', '2026-07-08')).toBe('2026-07-05');
  });

  it('clampFromDate prevents from > to (returns to when from would exceed to)', () => {
    expect(clampFromDate('2026-07-10', '2026-07-05')).toBe('2026-07-05');
  });

  it('clampFromDate returns fromDate when fromDate <= toDate', () => {
    expect(clampFromDate('2026-07-01', '2026-07-08')).toBe('2026-07-01');
  });

  it('MAX_RANGE_DAYS is exported and is at least 90', () => {
    expect(typeof MAX_RANGE_DAYS).toBe('number');
    expect(MAX_RANGE_DAYS).toBeGreaterThanOrEqual(90);
  });
});

// ─── 3. i18n key coverage for picker labels ──────────────────────────────────

describe('i18n keys — date range picker', () => {
  const pickerKeys = [
    'kick.chartDateRange',
    'kick.chartFrom',
    'kick.chartTo',
    'kick.chart7d',
    'kick.chart14d',
    'kick.chart30d',
    'kick.chartEmpty',
    'kick.chartTitle',
  ] as const;

  for (const key of pickerKeys) {
    it(`${key} has non-empty Thai value`, () => {
      expect(catalog.th[key]).toBeTruthy();
    });
    it(`${key} has non-empty English value`, () => {
      expect(catalog.en[key]).toBeTruthy();
    });
  }
});

// ─── 4. KickCountHistoryScreen is a function ─────────────────────────────────

describe('KickCountHistoryScreen — module smoke', () => {
  it('KickCountHistoryScreen is exported as a function', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountHistoryScreen') as Record<string, unknown>;
    expect(typeof mod['KickCountHistoryScreen']).toBe('function');
  });
});

// ─── 5. K-8: KickCountHistoryScreen source has no console.* calls ─────────────

describe('KickCountHistoryScreen — K-8 no health data logging', () => {
  it('KickCountHistoryScreen.tsx source contains no console.* calls', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'KickCountHistoryScreen.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/);
  });
});

// ─── 6. SD-9: navigation only passes sessionId ───────────────────────────────

describe('KickCountHistoryScreen — SD-9 route param hygiene', () => {
  it('navigates to KickCountDetail with only sessionId (no health fields)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'KickCountHistoryScreen.tsx'),
      'utf8',
    );
    // Must navigate with { sessionId: ... } only
    expect(src).toContain("navigate('KickCountDetail', { sessionId: session.id })");
    // Must NOT pass movementCount, startedAt, etc. as route params
    expect(src).not.toMatch(/navigate\('KickCountDetail'.*movementCount/);
    expect(src).not.toMatch(/navigate\('KickCountDetail'.*startedAt/);
  });
});

// ─── 7. filterSessionsToRange ────────────────────────────────────────────────

describe('kickCountHistoryChartHelpers — filterSessionsToRange', () => {
  it('returns sessions whose startedAt civil day is within [fromDate, toDate]', () => {
    const sessions = [
      makeSession('2026-07-01T08:00'),  // in range
      makeSession('2026-07-05T14:00'), // in range
      makeSession('2026-07-08T09:00'), // out of range
    ];
    const result = filterSessionsToRange(sessions, '2026-07-01', '2026-07-05');
    expect(result).toHaveLength(2);
  });

  it('includes sessions on the boundary dates (inclusive)', () => {
    const sessions = [
      makeSession('2026-07-01T00:00'), // on fromDate
      makeSession('2026-07-07T23:59'), // on toDate
    ];
    const result = filterSessionsToRange(sessions, '2026-07-01', '2026-07-07');
    expect(result).toHaveLength(2);
  });

  it('excludes sessions before fromDate', () => {
    const sessions = [
      makeSession('2026-06-30T23:59'), // before fromDate
      makeSession('2026-07-01T00:01'), // on fromDate
    ];
    const result = filterSessionsToRange(sessions, '2026-07-01', '2026-07-07');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no sessions in range', () => {
    const sessions = [makeSession('2026-06-01T10:00')];
    const result = filterSessionsToRange(sessions, '2026-07-01', '2026-07-07');
    expect(result).toHaveLength(0);
  });
});
