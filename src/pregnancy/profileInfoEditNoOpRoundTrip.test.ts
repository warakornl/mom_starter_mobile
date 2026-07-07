/**
 * profileInfoEditNoOpRoundTrip.test.ts
 *
 * QA tests for mobile-reviewer non-blocking item (a):
 *   "buildInfoEditPutInput re-sends all 3 name keys (untouched→re-sent, not omitted) —
 *   confirm a truly-untouched save does NOT corrupt an existing name and every save
 *   is idempotent/version-bumps (contract-safe per the no-op pin)."
 *
 * These tests prove:
 *   1. Round-trip safety: loading names from the server, leaving the form untouched,
 *      and saving produces a PUT body that preserves all 3 names exactly.
 *   2. All 3 name keys are ALWAYS present in the PUT body (value or null — never absent).
 *      This is intentional per name-fields-design.md §2b: any name key = real mutation
 *      that persists + bumps version, even when edd is unchanged.
 *   3. Thai multi-byte round-trip is lossless.
 *   4. Partial edit only changes the edited field; untouched fields are re-sent correctly.
 *   5. EDD is always echoed from the loaded profile (no-op-PUT pin).
 *   6. Two identical saves produce identical PUT bodies (pure function, no side effects).
 *
 * spec refs: name-fields-design.md §2b (no-op pin), api-contract.md L576
 */

import type { PregnancyProfile } from './types';
import {
  buildFormStateFromProfile,
  buildInfoEditPutInput,
} from './profileInfoEditLogic';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-001',
    edd: '2027-01-15',
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

const ALICE_B64  = Buffer.from('Alice',  'utf8').toString('base64');
const SMITH_B64  = Buffer.from('Smith',  'utf8').toString('base64');
const LILY_B64   = Buffer.from('Lily',   'utf8').toString('base64');
const CAROL_B64  = Buffer.from('Carol',  'utf8').toString('base64');
const THAI_B64   = Buffer.from('สมหญิง สายน้ำ', 'utf8').toString('base64');

// ─── Round-trip safety (mobile-reviewer item a) ───────────────────────────────
//
// Scenario: server has names set → form loads (decoded) → user makes NO edits →
// user taps Save → PUT body must preserve the original names (no corruption).

describe('buildInfoEditPutInput — untouched save preserves all names (round-trip safety)', () => {
  it('all 3 names are preserved after load → no-edit → save cycle', () => {
    const profile = makeProfile({
      motherFirstName: ALICE_B64,
      motherLastName:  SMITH_B64,
      babyName:        LILY_B64,
    });

    // Step 1: form loads — decode cipher bytes to display strings
    const formState = buildFormStateFromProfile(profile);
    expect(formState.motherFirstName).toBe('Alice'); // decoded correctly
    expect(formState.motherLastName).toBe('Smith');
    expect(formState.babyName).toBe('Lily');

    // Step 2: user makes NO changes — form state unchanged
    // Step 3: save — build the PUT body from the unchanged form state
    const input = buildInfoEditPutInput(profile, formState);

    // All 3 name fields present in PUT body (always sent — see "all 3 keys" test below)
    expect(input.motherFirstName).toBe(ALICE_B64); // same value as server
    expect(input.motherLastName).toBe(SMITH_B64);
    expect(input.babyName).toBe(LILY_B64);
    // EDD echoed from the profile (no-op-PUT pin — api-contract L576)
    expect(input.edd).toBe('2027-01-15');
  });

  it('Thai multi-byte name round-trip is lossless (encode → decode → encode identical)', () => {
    const profile = makeProfile({ motherFirstName: THAI_B64 });

    const formState = buildFormStateFromProfile(profile);
    expect(formState.motherFirstName).toBe('สมหญิง สายน้ำ'); // decoded Thai

    const input = buildInfoEditPutInput(profile, formState);

    // Re-encoded value is byte-identical to the original cipher from the server
    expect(input.motherFirstName).toBe(THAI_B64);
  });

  it('partial edit: changed field sends new value; untouched fields send original b64', () => {
    const profile = makeProfile({
      motherFirstName: ALICE_B64,
      motherLastName:  SMITH_B64,
      babyName:        LILY_B64,
    });

    const formState = buildFormStateFromProfile(profile);
    // User changes ONLY mother first name
    const modifiedFormState = { ...formState, motherFirstName: 'Carol' };

    const input = buildInfoEditPutInput(profile, modifiedFormState);

    expect(input.motherFirstName).toBe(CAROL_B64); // new value
    expect(input.motherLastName).toBe(SMITH_B64);  // original, preserved
    expect(input.babyName).toBe(LILY_B64);         // original, preserved
  });

  it('two identical saves of an unchanged form produce identical PUT bodies', () => {
    // Proves the function is pure and has no side effects that could corrupt names.
    const profile = makeProfile({
      motherFirstName: ALICE_B64,
      motherLastName:  SMITH_B64,
    });

    const formState = buildFormStateFromProfile(profile);
    const input1 = buildInfoEditPutInput(profile, formState);
    const input2 = buildInfoEditPutInput(profile, formState);

    expect(input1).toEqual(input2);
  });
});

// ─── All 3 keys always present (contract-safe for no-op-PUT pin) ──────────────
//
// name-fields-design.md §2b:
//   "any name key present (value or explicit null) = REAL mutation: persist + bump version"
//
// buildInfoEditPutInput always passes all 3 form fields (never undefined) to
// buildNamePutFields, so all 3 keys are always present in the PUT body.
// This is intentional: the server always bumps version on name saves, which is
// correct — every save reflects the user's explicit intent about all 3 fields.

describe('buildInfoEditPutInput — all 3 name keys always present in PUT body', () => {
  it('all 3 keys present when names are set (as base64 values)', () => {
    const profile = makeProfile({
      motherFirstName: ALICE_B64,
      motherLastName:  SMITH_B64,
      babyName:        LILY_B64,
    });
    const formState = buildFormStateFromProfile(profile);
    const input = buildInfoEditPutInput(profile, formState);

    expect('motherFirstName' in input).toBe(true);
    expect('motherLastName'  in input).toBe(true);
    expect('babyName'        in input).toBe(true);
  });

  it('all 3 keys present when no names are set (as null = clear intent)', () => {
    // Profile with no names → form shows empty strings → PUT body sends null for all 3.
    // Sending null is correct: it tells the server "clear these columns."
    // Every save is a real mutation (version bumps) — intended per spec §2b.
    const profile = makeProfile(); // no name fields
    const formState = buildFormStateFromProfile(profile);

    const input = buildInfoEditPutInput(profile, formState);

    expect('motherFirstName' in input).toBe(true);
    expect('motherLastName'  in input).toBe(true);
    expect('babyName'        in input).toBe(true);
    // All 3 are null (empty form = "clear" intent per null-vs-absent contract)
    expect(input.motherFirstName).toBeNull();
    expect(input.motherLastName).toBeNull();
    expect(input.babyName).toBeNull();
  });
});

// ─── EDD echo (no-op-PUT pin — prevents edd drift on name-only edit) ─────────
//
// api-contract.md L576 / name-fields-design.md §1 (BLOCKING PIN):
//   The name-edit surface MUST echo the stored explicit edd alongside the name fields.
//   This prevents the edd from being omitted (which would fail XOR validation) and
//   avoids edd back-computation from currentWeek (no ±1-day drift risk).

describe('buildInfoEditPutInput — edd is always echoed from the loaded profile', () => {
  it('includes edd from profile even on a name-only save', () => {
    const profile = makeProfile({ edd: '2026-12-25' });
    const input = buildInfoEditPutInput(profile, {
      motherFirstName: 'Alice',
      motherLastName:  '',
      babyName:        '',
    });

    expect(input.edd).toBe('2026-12-25');
    // currentWeek must NOT be included (would trigger back-computation → drift risk)
    expect(input.currentWeek).toBeUndefined();
  });

  it('edd is preserved across repeated saves (consistent with no-op-PUT pin)', () => {
    const profile = makeProfile({ edd: '2027-03-10' });
    const formState = buildFormStateFromProfile(profile);

    const input1 = buildInfoEditPutInput(profile, formState);
    const input2 = buildInfoEditPutInput(profile, formState);

    expect(input1.edd).toBe('2027-03-10');
    expect(input2.edd).toBe('2027-03-10'); // stable across calls
  });
});
