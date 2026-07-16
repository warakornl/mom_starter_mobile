/**
 * consentHistoryScreenLogic.test.ts — TDD (written BEFORE the screen).
 *
 * Task #40 Part 2: ConsentHistoryScreen — real, read-only history view backed
 * by GET /v1/account/consents (api-contract.md line 595: "consent history —
 * supports s.19 management UI"). This module holds the PURE helpers so they
 * are testable without importing React Native.
 *
 * SECURITY: ConsentRecord carries no health VALUES — only consent metadata
 * (type, granted boolean, text version, timestamp) — safe to render/log-free.
 */

import {
  CONSENT_TYPE_TITLE_KEY,
  historyItemLabelKey,
  sortHistoryDescending,
  civilDateFromGrantedAt,
} from './consentHistoryScreenLogic';
import type { ConsentRecord } from '../consent/types';

describe('CONSENT_TYPE_TITLE_KEY', () => {
  it('has an entry for all 7 consent types', () => {
    const types = [
      'general_health', 'cloud_storage', 'pdf_egress',
      'sensitive_lab_results', 'infant_feeding', 'child_health', 'calendar_sync',
    ] as const;
    for (const t of types) {
      expect(CONSENT_TYPE_TITLE_KEY[t]).toBeDefined();
      expect(typeof CONSENT_TYPE_TITLE_KEY[t]).toBe('string');
    }
  });
});

describe('historyItemLabelKey', () => {
  it('returns the granted key when granted=true', () => {
    expect(historyItemLabelKey(true)).toBe('consent.history.item.granted');
  });

  it('returns the withdrawn key when granted=false', () => {
    expect(historyItemLabelKey(false)).toBe('consent.history.item.withdrawn');
  });
});

describe('sortHistoryDescending', () => {
  function rec(id: string, grantedAt: string): ConsentRecord {
    return {
      id,
      consentType: 'general_health',
      granted: true,
      consentTextVersion: 'v1.0-th',
      grantedAt,
    };
  }

  it('sorts items by grantedAt descending (most recent first)', () => {
    const items = [
      rec('a', '2026-01-01T00:00:00Z'),
      rec('b', '2026-03-01T00:00:00Z'),
      rec('c', '2026-02-01T00:00:00Z'),
    ];
    const sorted = sortHistoryDescending(items);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const items = [rec('a', '2026-01-01T00:00:00Z'), rec('b', '2026-03-01T00:00:00Z')];
    const originalOrder = items.map((r) => r.id);
    sortHistoryDescending(items);
    expect(items.map((r) => r.id)).toEqual(originalOrder);
  });

  it('returns an empty array for empty input (EMPTY state support)', () => {
    expect(sortHistoryDescending([])).toEqual([]);
  });
});

describe('civilDateFromGrantedAt', () => {
  it('extracts the YYYY-MM-DD civil-date portion from a full ISO timestamp', () => {
    expect(civilDateFromGrantedAt('2026-03-15T10:30:00Z')).toBe('2026-03-15');
  });

  it('handles a timestamp with fractional seconds', () => {
    expect(civilDateFromGrantedAt('2026-03-15T10:30:00.123Z')).toBe('2026-03-15');
  });
});
