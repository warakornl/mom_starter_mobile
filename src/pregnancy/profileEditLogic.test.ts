/**
 * profileEditLogic.test.ts — TDD tests for the edit-pregnancy-profile feature.
 *
 * Tests pure logic functions that drive the edit flow.  No React, no navigation,
 * no fetch — injectable deps only (same style as sessionExpiredRunner.test.ts).
 *
 * Acceptance criteria covered:
 *   AC-2  (lifecycle gating — row shown only for pregnant)
 *   AC-7  (PUT 200 → 'saved'; caller does goBack, not reset-to-Home)
 *   AC-10 (PUT 409 → 'conflict' outcome; form reloads to latest server profile)
 *   AC-13 BLOCKING — all four 401 paths return 'session-expired':
 *           GET no-token, GET server-401, PUT no-token, PUT server-401
 *   AC-14 (GET 404 → 'not-found'; GET 200+postpartum/ended → 'guard-not-editable')
 *   AC-18 (null result → 'loading' state during in-flight GET)
 *   AC-9  (no reanchor call — verified by absence of reanchor in PUT 200 path)
 *
 * SD-5 cross-account PHI-leak guard: the 'session-expired' outcome must be
 * handled by running performLogout teardown THEN navigating to Welcome.
 * The performLogout/buildSessionExpiredRunner teardown is already proven in
 * sessionExpiredRunner.test.ts and performLogout.test.ts — these tests prove
 * that all four 401 paths correctly surface 'session-expired', and by
 * transitivity the full teardown runs when that outcome is acted upon.
 */

import {
  shouldShowEditPregnancyRow,
  resolveEditGetOutcome,
  resolveEditPutOutcome,
  resolveEditNoTokenOutcome,
} from './profileEditLogic';
import type { GetProfileResult, PutProfileResult, PregnancyProfile } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'uuid-1',
    version: 3,
    edd: '2026-11-20',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    gestationalWeek: 24,
    gestationalDay: 3,
    daysRemaining: 120,
    progress: 0.6,
    currentStage: 'T2',
    deliveryWindowActive: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

// ─── AC-2: Settings row visibility (lifecycle gating) ────────────────────────

describe('shouldShowEditPregnancyRow — AC-2 lifecycle gating', () => {
  it('returns true when lifecycle is pregnant', () => {
    expect(shouldShowEditPregnancyRow('pregnant')).toBe(true);
  });

  it('returns false when lifecycle is postpartum (row hidden, not disabled)', () => {
    expect(shouldShowEditPregnancyRow('postpartum')).toBe(false);
  });

  it('returns false when lifecycle is ended (emotional harm guard)', () => {
    expect(shouldShowEditPregnancyRow('ended')).toBe(false);
  });

  it('returns false when lifecycle is null (no profile yet)', () => {
    expect(shouldShowEditPregnancyRow(null)).toBe(false);
  });

  it('returns false when lifecycle is undefined (not loaded / unknown — fail-closed)', () => {
    expect(shouldShowEditPregnancyRow(undefined)).toBe(false);
  });
});

// ─── AC-13 BLOCKING — GET 401 paths return 'session-expired' ─────────────────

describe('resolveEditGetOutcome — AC-13 GET 401 paths', () => {
  it('GET no-token: resolveEditNoTokenOutcome returns session-expired', () => {
    // The edit host checks for token BEFORE calling getProfile.
    // A missing token is semantically equivalent to a server 401: the session is dead.
    const outcome = resolveEditNoTokenOutcome();
    expect(outcome).toEqual({ type: 'session-expired' });
  });

  it('GET server-401: resolveEditGetOutcome returns session-expired', () => {
    // Server returned 401 (expired/invalid token) during the entry GET.
    const result: GetProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    };
    expect(resolveEditGetOutcome(result)).toEqual({ type: 'session-expired' });
  });
});

// ─── AC-13 BLOCKING — PUT 401 paths return 'session-expired' ─────────────────

describe('resolveEditPutOutcome — AC-13 PUT 401 paths', () => {
  it('PUT no-token: resolveEditNoTokenOutcome returns session-expired', () => {
    // No token at PUT time (token expired between entry-GET and user pressing Save).
    const outcome = resolveEditNoTokenOutcome();
    expect(outcome).toEqual({ type: 'session-expired' });
  });

  it('PUT server-401: resolveEditPutOutcome returns session-expired', () => {
    // Server returned 401 on the PUT (token expired while the user was editing).
    const result: PutProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    };
    expect(resolveEditPutOutcome(result)).toEqual({ type: 'session-expired' });
  });
});

// ─── AC-7: PUT 200 → 'saved' (goBack to Settings, not reset-to-Home) ─────────

describe('resolveEditPutOutcome — AC-7 PUT 200', () => {
  it('PUT 200 (update): returns saved with profile', () => {
    const profile = makeProfile();
    const result: PutProfileResult = { ok: true, profile, created: false };
    expect(resolveEditPutOutcome(result)).toEqual({ type: 'saved', profile });
  });

  it('PUT 201 (unexpected create — treat as saved): returns saved with profile', () => {
    const profile = makeProfile();
    const result: PutProfileResult = { ok: true, profile, created: true };
    expect(resolveEditPutOutcome(result)).toEqual({ type: 'saved', profile });
  });
});

// ─── AC-10: PUT 409 → 'conflict' (reload form to latest server profile) ──────

describe('resolveEditPutOutcome — AC-10 PUT 409 conflict', () => {
  it('PUT 409 without currentProfile: returns conflict (re-GET will follow)', () => {
    const result: PutProfileResult = {
      ok: false,
      status: 409,
      code: 'stale_version',
      message: 'Stale version',
    };
    const outcome = resolveEditPutOutcome(result);
    expect(outcome.type).toBe('conflict');
  });

  it('PUT 409 with currentProfile in body: returns conflict with profile (R-3 reload)', () => {
    const currentProfile = makeProfile({ version: 5, edd: '2026-12-01' });
    // PutProfileResult extended by G-4: 409 now carries currentProfile
    const result = {
      ok: false as const,
      status: 409,
      code: 'stale_version',
      message: 'Stale version',
      currentProfile,
    };
    const outcome = resolveEditPutOutcome(result as PutProfileResult);
    expect(outcome).toEqual({ type: 'conflict', currentProfile });
  });

  it('immediate re-save against new version must succeed (loop prevention)', () => {
    // Simulate: first save gets 409 with currentProfile (version=5),
    // edit host reloads form with version=5, user re-saves → PUT 200 this time.
    const updatedProfile = makeProfile({ version: 5, edd: '2026-12-01' });
    const result: PutProfileResult = { ok: true, profile: updatedProfile, created: false };
    const outcome = resolveEditPutOutcome(result);
    expect(outcome).toEqual({ type: 'saved', profile: updatedProfile });
  });
});

// ─── AC-14: GET 404 / postpartum / ended ──────────────────────────────────────

describe('resolveEditGetOutcome — AC-14 GET non-pregnant outcomes', () => {
  it('GET 404: returns not-found (show notice + goBack to Settings)', () => {
    const result: GetProfileResult = {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Profile not found',
    };
    expect(resolveEditGetOutcome(result)).toEqual({ type: 'not-found' });
  });

  it('GET 200 + lifecycle=postpartum: returns guard-not-editable (backstop for leaked row)', () => {
    const result: GetProfileResult = {
      ok: true,
      profile: makeProfile({
        lifecycle: 'postpartum',
        gestationalWeek: null,
        gestationalDay: null,
        daysRemaining: null,
        progress: null,
        currentStage: 'postpartum',
        birthDate: '2026-06-15',
      }),
    };
    expect(resolveEditGetOutcome(result)).toEqual({ type: 'guard-not-editable' });
  });

  it('GET 200 + lifecycle=ended: returns guard-not-editable (emotional harm guard)', () => {
    const result: GetProfileResult = {
      ok: true,
      profile: makeProfile({ lifecycle: 'ended' }),
    };
    expect(resolveEditGetOutcome(result)).toEqual({ type: 'guard-not-editable' });
  });

  it('GET 5xx: returns retryable-error', () => {
    const result: GetProfileResult = {
      ok: false,
      status: 500,
      code: 'internal_error',
      message: 'Server error',
    };
    expect(resolveEditGetOutcome(result)).toEqual({ type: 'error', retryable: true });
  });
});

// ─── AC-18: null result → loading during GET ─────────────────────────────────

describe('resolveEditGetOutcome — AC-18 loading state', () => {
  it('null result (GET in flight): returns loading', () => {
    expect(resolveEditGetOutcome(null)).toEqual({ type: 'loading' });
  });
});

// ─── AC-18 happy path: GET 200 + pregnant → show-form ────────────────────────

describe('resolveEditGetOutcome — GET 200 pregnant', () => {
  it('GET 200 + lifecycle=pregnant: returns show-form with profile', () => {
    const profile = makeProfile();
    const result: GetProfileResult = { ok: true, profile };
    expect(resolveEditGetOutcome(result)).toEqual({ type: 'show-form', profile });
  });

  it('profile carries version and eddBasis needed by edit mode (G-2)', () => {
    const profile = makeProfile({ version: 7, eddBasis: 'current_week', gestationalWeek: 20 });
    const result: GetProfileResult = { ok: true, profile };
    const outcome = resolveEditGetOutcome(result);
    expect(outcome.type).toBe('show-form');
    if (outcome.type === 'show-form') {
      expect(outcome.profile.version).toBe(7);
      expect(outcome.profile.eddBasis).toBe('current_week');
    }
  });
});

// ─── Additional PUT outcome coverage ─────────────────────────────────────────

describe('resolveEditPutOutcome — other error paths', () => {
  it('PUT 422 returns validation', () => {
    const result: PutProfileResult = {
      ok: false, status: 422, code: 'validation_error', message: 'Invalid EDD',
    };
    expect(resolveEditPutOutcome(result)).toEqual({ type: 'validation' });
  });

  it('PUT 403 consent_required returns consent-required', () => {
    const result: PutProfileResult = {
      ok: false, status: 403, code: 'consent_required', message: 'Consent required',
    };
    expect(resolveEditPutOutcome(result)).toEqual({ type: 'consent-required' });
  });

  it('PUT 428 returns precondition (If-Match missing — should not occur in edit flow)', () => {
    const result: PutProfileResult = {
      ok: false, status: 428, code: 'precondition_required', message: 'If-Match missing',
    };
    expect(resolveEditPutOutcome(result)).toEqual({ type: 'precondition' });
  });

  it('PUT 500 returns generic-error', () => {
    const result: PutProfileResult = {
      ok: false, status: 500, code: 'server_error', message: 'Internal error',
    };
    expect(resolveEditPutOutcome(result)).toEqual({ type: 'generic-error' });
  });
});

// ─── AC-9: no reanchor — explicit NON-ripple rule ────────────────────────────

describe('AC-9 no reanchor on profile edit', () => {
  it('resolveEditPutOutcome does not return a reanchor action on PUT 200', () => {
    const profile = makeProfile();
    const result: PutProfileResult = { ok: true, profile, created: false };
    const outcome = resolveEditPutOutcome(result);
    // outcome must be { type: 'saved', profile } — no reanchor field
    expect((outcome as Record<string, unknown>).reanchor).toBeUndefined();
    expect((outcome as Record<string, unknown>).reschedule).toBeUndefined();
  });
});
