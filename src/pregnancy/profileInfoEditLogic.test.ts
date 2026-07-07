/**
 * profileInfoEditLogic.test.ts — TDD: pure logic for ProfileInfoEditScreen.
 *
 * Tests:
 *   1. resolveInfoEditGetOutcome — GET result → screen state machine
 *   2. resolveInfoEditPutOutcome — PUT result → screen outcome
 *   3. validateNameInput — ≤100-char validation
 *   4. buildFormStateFromProfile — decode Base64 names into form strings
 *   5. buildInfoEditPutInput — form strings → PUT request body (null-vs-absent)
 *
 * Security/lifecycle:
 *   - ProfileInfoEditScreen is LIFECYCLE-AGNOSTIC (unlike ProfileEditScreen).
 *   - GET 401 / PUT 401 → session-expired → performLogout (SD-5).
 *   - No EDD validation (this screen only edits names).
 *   - PDPA: form state holds DECODED plaintext — NEVER log (ensured by callers).
 */

import type { GetProfileResult, PutProfileResult, PregnancyProfile } from './types';
import {
  resolveInfoEditGetOutcome,
  resolveInfoEditPutOutcome,
  validateNameInput,
  buildFormStateFromProfile,
  buildInfoEditPutInput,
} from './profileInfoEditLogic';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-001',
    edd: '2026-02-10',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    birthDate: null,
    version: 3,
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
    gestationalWeek: 34,
    gestationalDay: 0,
    daysRemaining: 42,
    progress: 0.85,
    currentStage: 'T3',
    deliveryWindowActive: false,
    ...overrides,
  };
}

const ALICE_B64 = Buffer.from('Alice', 'utf8').toString('base64');
const SMITH_B64 = Buffer.from('Smith', 'utf8').toString('base64');
const BOB_B64   = Buffer.from('Bob', 'utf8').toString('base64');

// ─── 1. resolveInfoEditGetOutcome ─────────────────────────────────────────────

describe('resolveInfoEditGetOutcome — GET result → screen state', () => {
  it('returns loading for null result (GET in flight)', () => {
    const outcome = resolveInfoEditGetOutcome(null);
    expect(outcome.type).toBe('loading');
  });

  it('returns show-form for 200 pregnant profile', () => {
    const result: GetProfileResult = {
      ok: true,
      profile: makeProfile({ lifecycle: 'pregnant' }),
    };
    const outcome = resolveInfoEditGetOutcome(result);
    expect(outcome.type).toBe('show-form');
    if (outcome.type === 'show-form') {
      expect(outcome.profile.lifecycle).toBe('pregnant');
    }
  });

  it('returns show-form for 200 POSTPARTUM profile (lifecycle-agnostic)', () => {
    // ProfileInfoEditScreen works for BOTH pregnant and postpartum — key design difference
    const result: GetProfileResult = {
      ok: true,
      profile: makeProfile({ lifecycle: 'postpartum', birthDate: '2026-01-20' }),
    };
    const outcome = resolveInfoEditGetOutcome(result);
    expect(outcome.type).toBe('show-form');
  });

  it('returns session-expired for 401', () => {
    const result: GetProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized',
    };
    const outcome = resolveInfoEditGetOutcome(result);
    expect(outcome.type).toBe('session-expired');
  });

  it('returns not-found for 404', () => {
    const result: GetProfileResult = {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Not found',
    };
    const outcome = resolveInfoEditGetOutcome(result);
    expect(outcome.type).toBe('not-found');
  });

  it('returns error for 500', () => {
    const result: GetProfileResult = {
      ok: false,
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    };
    const outcome = resolveInfoEditGetOutcome(result);
    expect(outcome.type).toBe('error');
    if (outcome.type === 'error') {
      expect(outcome.retryable).toBe(true);
    }
  });
});

// ─── 2. resolveInfoEditPutOutcome ─────────────────────────────────────────────

describe('resolveInfoEditPutOutcome — PUT result → screen outcome', () => {
  it('returns saved for 200 (update)', () => {
    const result: PutProfileResult = {
      ok: true,
      profile: makeProfile(),
      created: false,
    };
    const outcome = resolveInfoEditPutOutcome(result);
    expect(outcome.type).toBe('saved');
    if (outcome.type === 'saved') {
      expect(outcome.profile.id).toBe('p-001');
    }
  });

  it('returns saved for 201 (first creation edge case)', () => {
    const result: PutProfileResult = {
      ok: true,
      profile: makeProfile(),
      created: true,
    };
    const outcome = resolveInfoEditPutOutcome(result);
    expect(outcome.type).toBe('saved');
  });

  it('returns session-expired for 401', () => {
    const result: PutProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized',
    };
    const outcome = resolveInfoEditPutOutcome(result);
    expect(outcome.type).toBe('session-expired');
  });

  it('returns conflict for 409', () => {
    const result: PutProfileResult = {
      ok: false,
      status: 409,
      code: 'optimistic_lock_failure',
      message: 'Conflict',
      currentProfile: makeProfile({ version: 5 }),
    };
    const outcome = resolveInfoEditPutOutcome(result);
    expect(outcome.type).toBe('conflict');
  });

  it('returns precondition for 428', () => {
    const result: PutProfileResult = {
      ok: false,
      status: 428,
      code: 'precondition_required',
      message: 'If-Match required',
    };
    const outcome = resolveInfoEditPutOutcome(result);
    expect(outcome.type).toBe('precondition');
  });

  it('returns generic-error for 500', () => {
    const result: PutProfileResult = {
      ok: false,
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    };
    const outcome = resolveInfoEditPutOutcome(result);
    expect(outcome.type).toBe('generic-error');
  });

  it('returns generic-error for 403 (consent_required — not expected but handled)', () => {
    const result: PutProfileResult = {
      ok: false,
      status: 403,
      code: 'consent_required',
      message: 'Consent required',
    };
    const outcome = resolveInfoEditPutOutcome(result);
    expect(outcome.type).toBe('generic-error');
  });
});

// ─── 3. validateNameInput ─────────────────────────────────────────────────────

describe('validateNameInput — ≤100-char validation', () => {
  it('returns null for empty string (allowed — all names optional)', () => {
    expect(validateNameInput('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(validateNameInput(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(validateNameInput(undefined)).toBeNull();
  });

  it('returns null for name exactly 100 chars', () => {
    const name = 'A'.repeat(100);
    expect(validateNameInput(name)).toBeNull();
  });

  it('returns error key for name > 100 chars after trim', () => {
    const name = 'A'.repeat(101);
    const error = validateNameInput(name);
    expect(error).toBe('profileInfo.validation.nameTooLong');
  });

  it('trims whitespace before checking length — 100 trimmed chars is valid', () => {
    const name = '  ' + 'A'.repeat(100) + '  ';
    expect(validateNameInput(name)).toBeNull();
  });

  it('trims whitespace before checking length — 101 trimmed chars is invalid', () => {
    const name = '  ' + 'A'.repeat(101) + '  ';
    expect(validateNameInput(name)).toBe('profileInfo.validation.nameTooLong');
  });

  it('returns null for a normal Thai name', () => {
    expect(validateNameInput('สมหญิง')).toBeNull();
  });
});

// ─── 4. buildFormStateFromProfile ─────────────────────────────────────────────

describe('buildFormStateFromProfile — decode Base64 names to form strings', () => {
  it('decodes motherFirstName from profile to display string', () => {
    const profile = makeProfile({ motherFirstName: ALICE_B64 });
    const state = buildFormStateFromProfile(profile);
    expect(state.motherFirstName).toBe('Alice');
  });

  it('decodes motherLastName from profile', () => {
    const profile = makeProfile({ motherLastName: SMITH_B64 });
    const state = buildFormStateFromProfile(profile);
    expect(state.motherLastName).toBe('Smith');
  });

  it('decodes babyName from profile', () => {
    const profile = makeProfile({ babyName: BOB_B64 });
    const state = buildFormStateFromProfile(profile);
    expect(state.babyName).toBe('Bob');
  });

  it('uses empty string for null motherFirstName (no name set)', () => {
    const profile = makeProfile({ motherFirstName: null });
    const state = buildFormStateFromProfile(profile);
    expect(state.motherFirstName).toBe('');
  });

  it('uses empty string for undefined name fields (absent = not set yet)', () => {
    const profile = makeProfile();
    // makeProfile does not set name fields → they are undefined
    const state = buildFormStateFromProfile(profile);
    expect(state.motherFirstName).toBe('');
    expect(state.motherLastName).toBe('');
    expect(state.babyName).toBe('');
  });

  it('decodes all three fields simultaneously', () => {
    const profile = makeProfile({
      motherFirstName: ALICE_B64,
      motherLastName: SMITH_B64,
      babyName: BOB_B64,
    });
    const state = buildFormStateFromProfile(profile);
    expect(state.motherFirstName).toBe('Alice');
    expect(state.motherLastName).toBe('Smith');
    expect(state.babyName).toBe('Bob');
  });
});

// ─── 5. buildInfoEditPutInput ─────────────────────────────────────────────────

describe('buildInfoEditPutInput — form state → PUT request body', () => {
  const baseProfile = makeProfile({ edd: '2026-02-10' });

  it('includes edd from profile (required field for PUT — no-op-PUT pin)', () => {
    const input = buildInfoEditPutInput(baseProfile, {
      motherFirstName: '',
      motherLastName: '',
      babyName: '',
    });
    expect(input.edd).toBe('2026-02-10');
  });

  it('sends null for empty motherFirstName (empty = clear to NULL)', () => {
    const input = buildInfoEditPutInput(baseProfile, {
      motherFirstName: '',
      motherLastName: '',
      babyName: '',
    });
    expect(input.motherFirstName).toBeNull();
    expect(input.motherLastName).toBeNull();
    expect(input.babyName).toBeNull();
  });

  it('sends base64 for non-empty motherFirstName', () => {
    const input = buildInfoEditPutInput(baseProfile, {
      motherFirstName: 'Alice',
      motherLastName: '',
      babyName: '',
    });
    expect(input.motherFirstName).toBe(ALICE_B64);
    expect(input.motherLastName).toBeNull(); // empty → clear
  });

  it('sends all three fields encoded when all present', () => {
    const input = buildInfoEditPutInput(baseProfile, {
      motherFirstName: 'Alice',
      motherLastName: 'Smith',
      babyName: 'Bob',
    });
    expect(input.motherFirstName).toBe(ALICE_B64);
    expect(input.motherLastName).toBe(SMITH_B64);
    expect(input.babyName).toBe(BOB_B64);
  });

  it('trims whitespace before encoding names', () => {
    const input = buildInfoEditPutInput(baseProfile, {
      motherFirstName: '  Alice  ',
      motherLastName: '',
      babyName: '',
    });
    expect(input.motherFirstName).toBe(ALICE_B64);
  });

  it('does NOT include currentWeek (name-only edit has edd from profile)', () => {
    const input = buildInfoEditPutInput(baseProfile, {
      motherFirstName: 'Alice',
      motherLastName: '',
      babyName: '',
    });
    expect(input.currentWeek).toBeUndefined();
  });
});
