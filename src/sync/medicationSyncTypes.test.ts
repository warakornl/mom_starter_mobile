/**
 * medicationSyncTypes.test.ts — TDD type-level + runtime assertions for
 * MedicationPlan / MedicationLog sync types (Slice 2, Task 6).
 *
 * RED-first: imports MedicationScheduleRule, MedicationPlanInput, MedicationPlan,
 * MedicationLogInput, MedicationLog from syncTypes.ts before those exports exist,
 * so `tsc --noEmit` MUST fail first — that is the desired RED state.
 *
 * Asserts (matching api-contract.md §682–683 + medication-behavior.md §1):
 *   1. MedicationScheduleRule covers FLAG-4 grammar with startAt anchor
 *      (freq, startAt, timesOfDay, interval ≥ 2, until) — RULING 7.1.
 *      Unlike RecurrenceRuleWire (reminders), freq has no 'weekly', no byDay,
 *      and interval ≥ 2 (interval=1 is canonicalized → 'daily' on push).
 *   2. MedicationPlanInput: name/dose are opaque base64 ciphertext (D4/ruling 4),
 *      scheduleRule optional/nullable (null = PRN/ad-hoc — M=0), active boolean,
 *      sourceSuggestionStateId optional nullable soft-ref (no FK — D7/RULING 2).
 *   3. MedicationPlan = input fields + id + <sync> block (version, createdAt,
 *      updatedAt, deletedAt?). Mutable LWW — version ≥ 1 after server apply.
 *   4. MedicationLogInput: medicationPlanId optional nullable, occurrenceTime
 *      floating-civil "YYYY-MM-DDTHH:mm" bucket key (FLAG-1/D5), status enum
 *      taken|missed, note optional base64 (never parsed — D4). loggedAt is NOT
 *      in MedicationLogInput (response-only — D5).
 *   5. MedicationLog = input fields + id + loggedAt (absolute UTC, response-only)
 *      + <sync> block. Immutable event (D3).
 *   6. SyncChangeSet.medicationPlans has LWW shape like expenses (created /
 *      updated / deleted) — mutable record, all three buckets live.
 *   7. SyncChangeSet.medicationLogs has immutable-event shape like selfLogs
 *      (created / updated / deleted) — updated is ALWAYS EMPTY (D3, no in-place
 *      rewrites). A correction is a new UUID + tombstone of old one.
 *   8. SyncPullPage.changes includes both keys with the same shapes.
 *
 * Security: name, dose, note are opaque base64 strings (MVP: plaintext-bytes-
 * as-base64). NEVER log them. General_health + cloud_storage gated (D6).
 */

import type {
  MedicationScheduleRule,
  MedicationPlanInput,
  MedicationPlan,
  MedicationLogInput,
  MedicationLog,
  SyncChangeSet,
  SyncPullPage,
} from './syncTypes';

// ─── Compile-time shape assertions ────────────────────────────────────────────

// 1. MedicationScheduleRule — all three freq variants
const _ruleOneOff: MedicationScheduleRule = {
  freq: 'one_off',
  startAt: '2026-07-04T08:00',
};
void _ruleOneOff;

const _ruleDaily: MedicationScheduleRule = {
  freq: 'daily',
  startAt: '2026-07-04T08:00',
  timesOfDay: ['08:00', '20:00'],
  until: '2026-08-04',
};
void _ruleDaily;

const _ruleEveryNDays: MedicationScheduleRule = {
  freq: 'every_n_days',
  startAt: '2026-07-04T08:00',
  timesOfDay: ['09:00'],
  interval: 3, // ≥ 2
  until: '2026-09-01',
};
void _ruleEveryNDays;

// 2. MedicationPlanInput — full construction
const _planInput: MedicationPlanInput = {
  name: 'Rm9saWMgQWNpZA==', // base64 opaque — never inspected
  dose: 'NTAwbWc=', // base64 opaque — optional
  scheduleRule: _ruleDaily,
  active: true,
  sourceSuggestionStateId: null,
};
void _planInput;

// MedicationPlanInput — minimal (only required fields)
const _planInputMinimal: MedicationPlanInput = {
  name: 'Rm9saWMgQWNpZA==',
  active: false,
};
void _planInputMinimal;

// MedicationPlanInput — PRN/ad-hoc (scheduleRule null = M=0)
const _planInputPrn: MedicationPlanInput = {
  name: 'UHJuPw==',
  scheduleRule: null,
  active: true,
};
void _planInputPrn;

// 3. MedicationPlan — input + id + <sync>
const _plan: MedicationPlan = {
  id: 'aaaaaaaa-0000-4000-8000-000000000010',
  name: 'Rm9saWMgQWNpZA==',
  dose: 'NTAwbWc=',
  scheduleRule: _ruleEveryNDays,
  active: true,
  sourceSuggestionStateId: null,
  version: 1,
  createdAt: '2026-07-04T01:00:00Z',
  updatedAt: '2026-07-04T01:00:00Z',
  deletedAt: null,
};
void _plan;

// MedicationPlan — create sentinel (version = 0)
const _planNew: MedicationPlan = {
  id: 'aaaaaaaa-0000-4000-8000-000000000011',
  name: 'QWNpZA==',
  active: true,
  version: 0,
  createdAt: '2026-07-04T01:00:00Z',
  updatedAt: '2026-07-04T01:00:00Z',
};
void _planNew;

// 4. MedicationLogInput — taken (with plan link)
const _logInputTaken: MedicationLogInput = {
  medicationPlanId: 'aaaaaaaa-0000-4000-8000-000000000010',
  occurrenceTime: '2026-07-04T08:00', // floating-civil, FLAG-1
  status: 'taken',
  note: null,
};
void _logInputTaken;

// MedicationLogInput — missed (ad-hoc, no plan link)
const _logInputMissed: MedicationLogInput = {
  occurrenceTime: '2026-07-04T20:00',
  status: 'missed',
  note: 'bm90ZQ==', // base64 opaque note
};
void _logInputMissed;

// MedicationLogInput — minimal (only required fields)
const _logInputMinimal: MedicationLogInput = {
  occurrenceTime: '2026-07-04T09:00',
  status: 'taken',
};
void _logInputMinimal;

// 5. MedicationLog — full record with loggedAt + <sync>
const _log: MedicationLog = {
  id: 'bbbbbbbb-0000-4000-8000-000000000020',
  medicationPlanId: 'aaaaaaaa-0000-4000-8000-000000000010',
  occurrenceTime: '2026-07-04T08:00',
  status: 'taken',
  note: null,
  loggedAt: '2026-07-04T01:02:03Z', // absolute UTC, response-only
  version: 1,
  createdAt: '2026-07-04T01:02:03Z',
  updatedAt: '2026-07-04T01:02:03Z',
  deletedAt: null,
};
void _log;

// MedicationLog — create sentinel (version = 0)
const _logNew: MedicationLog = {
  id: 'bbbbbbbb-0000-4000-8000-000000000021',
  occurrenceTime: '2026-07-04T20:00',
  status: 'missed',
  loggedAt: '2026-07-04T13:05:00Z',
  version: 0,
  createdAt: '2026-07-04T13:05:00Z',
  updatedAt: '2026-07-04T13:05:00Z',
};
void _logNew;

// 6. SyncChangeSet.medicationPlans — LWW shape (like expenses: all buckets live)
const _pushWithPlans: SyncChangeSet = {
  medicationPlans: {
    created: [_planNew],
    updated: [_plan],
    deleted: ['aaaaaaaa-0000-4000-8000-000000000099'],
  },
};
void _pushWithPlans;

// 7. SyncChangeSet.medicationLogs — immutable-event shape (like selfLogs: updated always empty)
const _pushWithLogs: SyncChangeSet = {
  medicationLogs: {
    created: [_logNew],
    updated: [], // always empty — immutable event (D3)
    deleted: ['bbbbbbbb-0000-4000-8000-000000000099'],
  },
};
void _pushWithLogs;

// 8. SyncPullPage.changes — both collections present
const _pullPage: SyncPullPage = {
  timestamp: '2026-07-04T01:00:00Z',
  changes: {
    medicationPlans: {
      created: [],
      updated: [_plan],
      deleted: [],
    },
    medicationLogs: {
      created: [],
      updated: [_log],
      deleted: [],
    },
  },
};
void _pullPage;

// ─── Runtime assertions ────────────────────────────────────────────────────────

describe('MedicationScheduleRule — FLAG-4 grammar (RULING 7.1)', () => {
  it('accepts freq=one_off with only startAt', () => {
    const rule: MedicationScheduleRule = {
      freq: 'one_off',
      startAt: '2026-07-04T08:00',
    };
    expect(rule.freq).toBe('one_off');
    expect(rule.startAt).toBe('2026-07-04T08:00');
    expect(rule.timesOfDay).toBeUndefined();
    expect(rule.interval).toBeUndefined();
  });

  it('accepts freq=daily with timesOfDay + optional until', () => {
    const rule: MedicationScheduleRule = {
      freq: 'daily',
      startAt: '2026-07-04T08:00',
      timesOfDay: ['08:00', '20:00'],
      until: '2026-08-04',
    };
    expect(rule.freq).toBe('daily');
    expect(rule.timesOfDay).toEqual(['08:00', '20:00']);
    expect(rule.until).toBe('2026-08-04');
  });

  it('accepts freq=every_n_days with interval ≥ 2', () => {
    const rule: MedicationScheduleRule = {
      freq: 'every_n_days',
      startAt: '2026-07-04T08:00',
      timesOfDay: ['09:00'],
      interval: 3,
    };
    expect(rule.freq).toBe('every_n_days');
    expect(rule.interval).toBe(3);
  });
});

describe('MedicationPlanInput — construction (api-contract.md §682)', () => {
  it('accepts all fields including base64 name/dose and scheduleRule', () => {
    const input: MedicationPlanInput = {
      name: 'Rm9saWMgQWNpZA==',
      dose: 'NTAwbWc=',
      scheduleRule: { freq: 'daily', startAt: '2026-07-04T08:00', timesOfDay: ['08:00'] },
      active: true,
      sourceSuggestionStateId: 'cccccccc-0000-4000-8000-000000000030',
    };
    expect(input.active).toBe(true);
    expect(typeof input.name).toBe('string');
  });

  it('accepts null scheduleRule (PRN/ad-hoc — M=0, no denominator)', () => {
    const input: MedicationPlanInput = {
      name: 'UHJuPw==',
      scheduleRule: null,
      active: true,
    };
    expect(input.scheduleRule).toBeNull();
  });

  it('accepts minimal input: name + active only', () => {
    const input: MedicationPlanInput = {
      name: 'dGVzdA==',
      active: false,
    };
    expect(input.name).toBeDefined();
    expect(input.active).toBe(false);
    expect(input.dose).toBeUndefined();
    expect(input.scheduleRule).toBeUndefined();
  });
});

describe('MedicationPlan — full record with <sync> block', () => {
  it('has id + input fields + version + createdAt + updatedAt + optional deletedAt', () => {
    const plan: MedicationPlan = {
      id: 'aaaaaaaa-0000-4000-8000-000000000010',
      name: 'Rm9saWMgQWNpZA==',
      active: true,
      version: 1,
      createdAt: '2026-07-04T01:00:00Z',
      updatedAt: '2026-07-04T01:00:00Z',
    };
    expect(plan.id).toBeDefined();
    expect(plan.version).toBe(1);
    expect(plan.createdAt).toBeDefined();
    expect(plan.updatedAt).toBeDefined();
    expect(plan.deletedAt).toBeUndefined();
  });

  it('version=0 is the create sentinel before server apply', () => {
    const plan: MedicationPlan = {
      id: 'aaaaaaaa-0000-4000-8000-000000000011',
      name: 'dGVzdA==',
      active: true,
      version: 0,
      createdAt: '2026-07-04T01:00:00Z',
      updatedAt: '2026-07-04T01:00:00Z',
    };
    expect(plan.version).toBe(0);
  });
});

describe('MedicationLogInput — construction (api-contract.md §683)', () => {
  it('accepts taken status with medicationPlanId', () => {
    const input: MedicationLogInput = {
      medicationPlanId: 'aaaaaaaa-0000-4000-8000-000000000010',
      occurrenceTime: '2026-07-04T08:00',
      status: 'taken',
    };
    expect(input.status).toBe('taken');
    expect(input.occurrenceTime).toBe('2026-07-04T08:00');
  });

  it('accepts missed status with no plan link (ad-hoc dose)', () => {
    const input: MedicationLogInput = {
      occurrenceTime: '2026-07-04T20:00',
      status: 'missed',
    };
    expect(input.status).toBe('missed');
    expect(input.medicationPlanId).toBeUndefined();
  });

  it('accepts base64 note (opaque ciphertext — never parsed)', () => {
    const input: MedicationLogInput = {
      occurrenceTime: '2026-07-04T09:00',
      status: 'taken',
      note: 'bm90ZQ==',
    };
    expect(typeof input.note).toBe('string');
  });

  it('does NOT have a loggedAt field (response-only per D5)', () => {
    const input: MedicationLogInput = {
      occurrenceTime: '2026-07-04T09:00',
      status: 'taken',
    };
    // @ts-expect-error — loggedAt is NOT in MedicationLogInput (D5, response-only)
    const _bad = input.loggedAt;
    void _bad;
    expect(true).toBe(true); // compile-time guard above is the real assertion
  });
});

describe('MedicationLog — full record (immutable event, D3)', () => {
  it('has id + input fields + loggedAt (response-only UTC) + <sync> block', () => {
    const log: MedicationLog = {
      id: 'bbbbbbbb-0000-4000-8000-000000000020',
      occurrenceTime: '2026-07-04T08:00',
      status: 'taken',
      loggedAt: '2026-07-04T01:02:03Z',
      version: 1,
      createdAt: '2026-07-04T01:02:03Z',
      updatedAt: '2026-07-04T01:02:03Z',
    };
    expect(log.loggedAt).toBe('2026-07-04T01:02:03Z');
    expect(log.version).toBe(1);
  });

  it('version=0 is the create sentinel', () => {
    const log: MedicationLog = {
      id: 'bbbbbbbb-0000-4000-8000-000000000021',
      occurrenceTime: '2026-07-04T20:00',
      status: 'missed',
      loggedAt: '2026-07-04T13:05:00Z',
      version: 0,
      createdAt: '2026-07-04T13:05:00Z',
      updatedAt: '2026-07-04T13:05:00Z',
    };
    expect(log.version).toBe(0);
  });
});

describe('SyncChangeSet — medicationPlans (LWW shape, like expenses)', () => {
  it('has created / updated / deleted buckets — all three are live (mutable record)', () => {
    const cs: SyncChangeSet = {
      medicationPlans: {
        created: [],
        updated: [],
        deleted: [],
      },
    };
    const mp = cs.medicationPlans!;
    expect(mp.created).toBeInstanceOf(Array);
    expect(mp.updated).toBeInstanceOf(Array);
    expect(mp.deleted).toBeInstanceOf(Array);
  });

  it('created[] accepts MedicationPlan records (create sentinel version=0)', () => {
    const plan: MedicationPlan = {
      id: 'aaaaaaaa-0000-4000-8000-000000000050',
      name: 'dGVzdA==',
      active: true,
      version: 0,
      createdAt: '2026-07-04T02:00:00Z',
      updatedAt: '2026-07-04T02:00:00Z',
    };
    const cs: SyncChangeSet = {
      medicationPlans: { created: [plan], updated: [], deleted: [] },
    };
    expect(cs.medicationPlans!.created[0].active).toBe(true);
  });

  it('updated[] accepts MedicationPlan records (LWW edit)', () => {
    const plan: MedicationPlan = {
      id: 'aaaaaaaa-0000-4000-8000-000000000051',
      name: 'dXBkYXRlZA==',
      active: false,
      version: 2,
      createdAt: '2026-07-04T02:00:00Z',
      updatedAt: '2026-07-04T03:00:00Z',
    };
    const cs: SyncChangeSet = {
      medicationPlans: { created: [], updated: [plan], deleted: [] },
    };
    expect(cs.medicationPlans!.updated[0].version).toBe(2);
  });

  it('deleted[] accepts bare uuids (tombstone-wins, soft-delete)', () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000099';
    const cs: SyncChangeSet = {
      medicationPlans: { created: [], updated: [], deleted: [id] },
    };
    expect(cs.medicationPlans!.deleted[0]).toBe(id);
  });
});

describe('SyncChangeSet — medicationLogs (immutable-event shape, like selfLogs)', () => {
  it('has created / updated / deleted buckets', () => {
    const cs: SyncChangeSet = {
      medicationLogs: {
        created: [],
        updated: [],
        deleted: [],
      },
    };
    const ml = cs.medicationLogs!;
    expect(ml.created).toBeInstanceOf(Array);
    expect(ml.updated).toBeInstanceOf(Array);
    expect(ml.deleted).toBeInstanceOf(Array);
  });

  it('updated[] is always empty (immutable event — D3 invariant)', () => {
    const cs: SyncChangeSet = {
      medicationLogs: {
        created: [],
        updated: [], // never populated — immutable log
        deleted: [],
      },
    };
    expect(cs.medicationLogs!.updated).toHaveLength(0);
  });

  it('created[] accepts MedicationLog records', () => {
    const log: MedicationLog = {
      id: 'bbbbbbbb-0000-4000-8000-000000000050',
      occurrenceTime: '2026-07-04T08:00',
      status: 'taken',
      loggedAt: '2026-07-04T01:00:00Z',
      version: 0,
      createdAt: '2026-07-04T01:00:00Z',
      updatedAt: '2026-07-04T01:00:00Z',
    };
    const cs: SyncChangeSet = {
      medicationLogs: { created: [log], updated: [], deleted: [] },
    };
    expect(cs.medicationLogs!.created[0].status).toBe('taken');
  });

  it('deleted[] accepts bare uuids (tombstone-wins)', () => {
    const id = 'bbbbbbbb-0000-4000-8000-000000000099';
    const cs: SyncChangeSet = {
      medicationLogs: { created: [], updated: [], deleted: [id] },
    };
    expect(cs.medicationLogs!.deleted[0]).toBe(id);
  });
});

describe('SyncPullPage.changes — medicationPlans + medicationLogs', () => {
  it('accepts medicationPlans in the pull changes block', () => {
    const page: SyncPullPage = {
      timestamp: '2026-07-04T01:00:00Z',
      changes: {
        medicationPlans: { created: [], updated: [], deleted: [] },
      },
    };
    expect(page.changes.medicationPlans).toBeDefined();
  });

  it('accepts medicationLogs in the pull changes block', () => {
    const page: SyncPullPage = {
      timestamp: '2026-07-04T01:00:00Z',
      changes: {
        medicationLogs: { created: [], updated: [], deleted: [] },
      },
    };
    expect(page.changes.medicationLogs).toBeDefined();
  });

  it('pull page can carry both collections simultaneously', () => {
    const plan: MedicationPlan = {
      id: 'aaaaaaaa-0000-4000-8000-000000000070',
      name: 'cHVsbA==',
      active: true,
      version: 3,
      createdAt: '2026-07-04T01:00:00Z',
      updatedAt: '2026-07-04T04:00:00Z',
    };
    const log: MedicationLog = {
      id: 'bbbbbbbb-0000-4000-8000-000000000070',
      occurrenceTime: '2026-07-04T08:00',
      status: 'taken',
      loggedAt: '2026-07-04T01:00:00Z',
      version: 1,
      createdAt: '2026-07-04T01:00:00Z',
      updatedAt: '2026-07-04T01:00:00Z',
    };
    const page: SyncPullPage = {
      timestamp: '2026-07-04T04:00:00Z',
      changes: {
        medicationPlans: { created: [], updated: [plan], deleted: [] },
        medicationLogs: { created: [], updated: [log], deleted: [] },
      },
    };
    expect(page.changes.medicationPlans!.updated[0].id).toBe(plan.id);
    expect(page.changes.medicationLogs!.updated[0].loggedAt).toBe('2026-07-04T01:00:00Z');
  });
});
