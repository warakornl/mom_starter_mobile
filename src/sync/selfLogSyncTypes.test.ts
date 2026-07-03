/**
 * selfLogSyncTypes.test.ts — TDD type-level + runtime assertions for the SelfLog
 * sync types (Slice 1, Task 6).
 *
 * Written RED-first: these import SelfLog, SelfLogInput, SelfLogMetricType from
 * syncTypes.ts before those exports exist, so `tsc --noEmit` must fail here first.
 *
 * Asserts (matching api-contract.md §687 + self-log-behavior.md §1/§B):
 *   1. SyncChangeSet.selfLogs has the immutable-event shape
 *      (created / updated / deleted) — mirroring kickCountSessions.
 *      updated[] is always empty (D2 — immutable event, no in-place rewrites).
 *   2. SelfLogInput can be constructed for all 5 metricTypes:
 *      weight | blood_pressure | swelling | lochia | symptom.
 *   3. SelfLog includes the <sync> block (id, version, createdAt, updatedAt, deletedAt).
 *   4. SyncPullPage.changes.selfLogs mirrors the push shape.
 *
 * Value/note fields are typed as string | null (opaque base64 on the wire;
 * mirrors KickCountSessionRecord.note — the same local-string posture, K-7).
 */

import type {
  SelfLog,
  SelfLogInput,
  SelfLogMetricType,
  SyncChangeSet,
  SyncPullPage,
} from './syncTypes';

// ─── Compile-time shape assertions (no test runner needed) ────────────────────

// All 5 metricType literals are valid members of the enum
const _allMetricTypes: SelfLogMetricType[] = [
  'weight',
  'blood_pressure',
  'swelling',
  'lochia',
  'symptom',
];
void _allMetricTypes;

// SelfLogInput — weight (valueNumeric + unit)
const _weightInput: SelfLogInput = {
  metricType: 'weight',
  valueNumeric: 'dGVzdA==', // base64
  unit: 'kg',
  loggedAt: '2026-07-03T13:00',
};
void _weightInput;

// SelfLogInput — blood_pressure (valueNumeric + valueNumericSecondary + unit)
const _bpInput: SelfLogInput = {
  metricType: 'blood_pressure',
  valueNumeric: 'dGVzdA==',
  valueNumericSecondary: 'dGVzdA==',
  unit: 'mmHg',
  loggedAt: '2026-07-03T13:00',
};
void _bpInput;

// SelfLogInput — swelling (valueText, no unit)
const _swellingInput: SelfLogInput = {
  metricType: 'swelling',
  valueText: 'dGVzdA==',
  loggedAt: '2026-07-03T13:00',
};
void _swellingInput;

// SelfLogInput — lochia (valueText, no unit)
const _lochiaInput: SelfLogInput = {
  metricType: 'lochia',
  valueText: 'dGVzdA==',
  loggedAt: '2026-07-03T13:00',
};
void _lochiaInput;

// SelfLogInput — symptom (valueText + optional note)
const _symptomInput: SelfLogInput = {
  metricType: 'symptom',
  valueText: 'dGVzdA==',
  note: 'bm90ZQ==',
  loggedAt: '2026-07-03T13:00',
};
void _symptomInput;

// SelfLog — full record with <sync> block
const _selfLog: SelfLog = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  metricType: 'weight',
  valueNumeric: 'dGVzdA==',
  unit: 'kg',
  loggedAt: '2026-07-03T13:00',
  version: 1,
  createdAt: '2026-07-03T06:00:00Z',
  updatedAt: '2026-07-03T06:00:00Z',
  deletedAt: null,
};
void _selfLog;

// SyncChangeSet — push half: selfLogs in immutable-event shape
const _pushChangeSet: SyncChangeSet = {
  selfLogs: {
    created: [_selfLog],
    updated: [], // always empty — immutable event (D2)
    deleted: ['aaaaaaaa-0000-4000-8000-000000000002'],
  },
};
void _pushChangeSet;

// SyncPullPage — pull half: selfLogs in changes
const _pullPage: SyncPullPage = {
  timestamp: '2026-07-03T06:00:00Z',
  changes: {
    selfLogs: {
      created: [],
      updated: [_selfLog],
      deleted: ['aaaaaaaa-0000-4000-8000-000000000002'],
    },
  },
};
void _pullPage;

// ─── Runtime assertions ────────────────────────────────────────────────────────

describe('SelfLog sync types', () => {
  describe('SyncChangeSet.selfLogs shape', () => {
    it('has the immutable-event shape: created / updated / deleted', () => {
      const changes: SyncChangeSet = {
        selfLogs: {
          created: [],
          updated: [],
          deleted: [],
        },
      };
      const sl = changes.selfLogs!;
      expect(sl.created).toBeInstanceOf(Array);
      expect(sl.updated).toBeInstanceOf(Array);
      expect(sl.deleted).toBeInstanceOf(Array);
    });

    it('updated is always empty for immutable events (D2 invariant)', () => {
      const changes: SyncChangeSet = {
        selfLogs: {
          created: [],
          updated: [], // never populated — immutable log
          deleted: [],
        },
      };
      expect(changes.selfLogs!.updated).toHaveLength(0);
    });

    it('created[] accepts a SelfLog record', () => {
      const log: SelfLog = {
        id: 'bbbbbbbb-0000-4000-8000-000000000001',
        metricType: 'blood_pressure',
        valueNumeric: 'dGVzdA==',
        valueNumericSecondary: 'dGVzdA==',
        unit: 'mmHg',
        loggedAt: '2026-07-03T09:30',
        version: 0,
        createdAt: '2026-07-03T02:30:00Z',
        updatedAt: '2026-07-03T02:30:00Z',
      };
      const changes: SyncChangeSet = {
        selfLogs: { created: [log], updated: [], deleted: [] },
      };
      expect(changes.selfLogs!.created[0].metricType).toBe('blood_pressure');
    });

    it('deleted[] accepts bare uuids (tombstone-wins)', () => {
      const id = 'cccccccc-0000-4000-8000-000000000001';
      const changes: SyncChangeSet = {
        selfLogs: { created: [], updated: [], deleted: [id] },
      };
      expect(changes.selfLogs!.deleted[0]).toBe(id);
    });
  });

  describe('SelfLogInput — all 5 metricTypes', () => {
    const cases: Array<{ mt: SelfLogMetricType; extra: Partial<SelfLogInput> }> = [
      { mt: 'weight', extra: { valueNumeric: 'dGVzdA==', unit: 'kg' } },
      {
        mt: 'blood_pressure',
        extra: { valueNumeric: 'dGVzdA==', valueNumericSecondary: 'dGVzdA==', unit: 'mmHg' },
      },
      { mt: 'swelling', extra: { valueText: 'dGVzdA==' } },
      { mt: 'lochia', extra: { valueText: 'dGVzdA==' } },
      { mt: 'symptom', extra: { valueText: 'dGVzdA==', note: 'bm90ZQ==' } },
    ];

    cases.forEach(({ mt, extra }) => {
      it(`SelfLogInput accepts metricType="${mt}"`, () => {
        const input: SelfLogInput = { metricType: mt, loggedAt: '2026-07-03T13:00', ...extra };
        expect(input.metricType).toBe(mt);
        expect(input.loggedAt).toBe('2026-07-03T13:00');
      });
    });
  });

  describe('SelfLog — <sync> block present', () => {
    it('has id, version, createdAt, updatedAt, optional deletedAt', () => {
      const log: SelfLog = {
        id: 'dddddddd-0000-4000-8000-000000000001',
        metricType: 'symptom',
        valueText: 'dGVzdA==',
        loggedAt: '2026-07-03T08:00',
        version: 0,
        createdAt: '2026-07-03T01:00:00Z',
        updatedAt: '2026-07-03T01:00:00Z',
      };
      expect(log.id).toBeDefined();
      expect(log.version).toBe(0);
      expect(log.createdAt).toBeDefined();
      expect(log.updatedAt).toBeDefined();
      expect(log.deletedAt).toBeUndefined();
    });
  });

  describe('SyncPullPage.changes.selfLogs', () => {
    it('accepts selfLogs in the changes block', () => {
      const page: SyncPullPage = {
        timestamp: '2026-07-03T06:00:00Z',
        changes: {
          selfLogs: { created: [], updated: [], deleted: [] },
        },
      };
      expect(page.changes.selfLogs).toBeDefined();
    });
  });
});
