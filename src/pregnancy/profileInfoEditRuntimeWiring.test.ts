/**
 * profileInfoEditRuntimeWiring.test.ts — runtime wiring tests for
 * ProfileInfoEditScreen's async orchestration.
 *
 * COVERAGE NOTE (honest):
 *   The pure logic functions (resolveInfoEditGetOutcome, resolveInfoEditPutOutcome,
 *   validateNameInput, buildFormStateFromProfile, buildInfoEditPutInput) are
 *   unit-tested in profileInfoEditLogic.test.ts.
 *
 *   This file tests RUNTIME WIRING — the actual orchestration code extracted into
 *   profileInfoEditRuntimeWiring.ts that executes with injected spy deps. These
 *   are wiring tests, NOT component render tests.
 *
 *   Rows that were previously claimed as unit-covered but were only simulated in
 *   profileInfoEditConflict409.test.ts are now covered HERE by real execution:
 *     - DEF-001 (409 conflict message carry via pendingErrorRef) ← (a) below
 *     - SD-5 401 paths for both GET and PUT                      ← (d) below
 *     - If-Match = String(version) on PUT                        ← (e) below
 *
 * WHY THESE TESTS ARE NOT TAUTOLOGIES:
 *   Every test in this file calls the REAL runInfoEntryGet / runInfoSave functions
 *   imported from profileInfoEditRuntimeWiring.ts. There are no inline simulations.
 *   If the DEF-001 fix is reverted in the wiring module (i.e. setSaveError(null)
 *   is added back to the sync prefix of runInfoEntryGet, and the ref usage in
 *   runInfoSave is replaced by a direct setSaveError call), test (a) FAILS because
 *   the final setSaveError call would be null (pendingError=null from show-form),
 *   not the conflict message.
 *
 * No React, no React Native, no navigation — these are pure async function tests.
 */

import {
  runInfoEntryGet,
  runInfoSave,
} from './profileInfoEditRuntimeWiring';
import type {
  InfoEntryGetDeps,
  InfoSaveDeps,
  InfoScreenState,
} from './profileInfoEditRuntimeWiring';
import type { NameFormState } from './profileInfoEditLogic';
import type {
  GetProfileResult,
  PutProfileResult,
  PregnancyProfile,
  PregnancyProfileInput,
} from './types';
import type { AuthTokens } from '../auth/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p-wiring-01',
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

function makeTokenStorage(accessToken: string | null) {
  if (accessToken === null) {
    return { load: async (): Promise<AuthTokens | null> => null };
  }
  return {
    load: async (): Promise<AuthTokens | null> => ({
      accessToken,
      refreshToken: 'rt',
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 86400,
    }),
  };
}

const BLANK_FORM: NameFormState = {
  motherFirstName: '',
  motherLastName: '',
  babyName: '',
};

function makeEntryGetDeps(
  overrides: Partial<InfoEntryGetDeps> = {},
): InfoEntryGetDeps {
  return {
    tokenStorage: makeTokenStorage('tok'),
    apiBaseUrl: 'http://test',
    clientDate: '2026-07-07',
    pendingErrorRef: { current: null },
    loadErrorMessage: 'load-error-msg',
    onSessionExpired: jest.fn(),
    setScreenState: jest.fn(),
    setFormState: jest.fn(),
    setSaveError: jest.fn(),
    ...overrides,
  };
}

function makeInfoSaveDeps(
  overrides: Partial<InfoSaveDeps> = {},
): InfoSaveDeps {
  const profile = makeProfile({ version: 3 });
  return {
    tokenStorage: makeTokenStorage('tok'),
    apiBaseUrl: 'http://test',
    clientDate: '2026-07-07',
    screenState: { mode: 'show-form', profile },
    formState: BLANK_FORM,
    pendingErrorRef: { current: null },
    conflictMessage: 'conflict-msg',
    genericErrorMessage: 'generic-error',
    onSessionExpired: jest.fn(),
    onSaveComplete: jest.fn(),
    setScreenState: jest.fn(),
    setSaveError: jest.fn(),
    runEntryGet: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── (a) DEF-001: conflict message survives GET re-fetch ─────────────────────
//
// After a 409 PUT, the conflict message must be applied AFTER the GET re-fetch
// resolves to show-form. It must NOT be nulled by the loading-state transition.
//
// Proof this is NOT a tautology:
//   This test calls the REAL runInfoEntryGet and runInfoSave (no simulation).
//   If the DEF-001 fix is reverted by:
//     (1) removing ref usage: runInfoSave 409 calls setSaveError('conflict-msg') direct
//     (2) adding setSaveError(null) back to the sync prefix of runInfoEntryGet
//   then the chain becomes:
//     setSaveError('conflict-msg') [from runInfoSave direct call]
//     setSaveError(null)           [from runInfoEntryGet sync prefix — reverted]
//     setSaveError(null)           [from runInfoEntryGet show-form: pendingError=null]
//   The last call is null → expect(setSaveError).toHaveBeenLastCalledWith('conflict-msg') FAILS.

describe('runInfoSave + runInfoEntryGet — (a) DEF-001 conflict message carry', () => {
  it('after 409 PUT, conflict message is applied by show-form re-fetch (not cleared by loading)', async () => {
    const pendingErrorRef: { current: string | null } = { current: null };
    const setSaveError = jest.fn<void, [string | null]>();
    const setScreenState = jest.fn<void, [InfoScreenState]>();
    const setFormState = jest.fn<void, [NameFormState]>();
    const onSessionExpired = jest.fn();
    const profile = makeProfile({ version: 4 });
    const tokenStorage = makeTokenStorage('tok');

    const put409: PutProfileResult = {
      ok: false,
      status: 409,
      code: 'stale_version',
      message: 'Stale',
      currentProfile: profile,
    };

    // Entry-get deps: GET returns show-form
    const entryGetDeps: InfoEntryGetDeps = {
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      pendingErrorRef,
      loadErrorMessage: 'load-error',
      onSessionExpired,
      setScreenState,
      setFormState,
      setSaveError,
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue({ ok: true, profile }),
      }),
    };

    // Save deps: PUT returns 409; runEntryGet executes the REAL runInfoEntryGet
    await runInfoSave({
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      screenState: { mode: 'show-form', profile },
      formState: BLANK_FORM,
      pendingErrorRef,
      conflictMessage: 'conflict-msg',
      genericErrorMessage: 'generic-error',
      onSessionExpired,
      onSaveComplete: jest.fn(),
      setScreenState,
      setSaveError,
      runEntryGet: () => runInfoEntryGet(entryGetDeps),
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue(put409),
      }),
    });

    // Conflict message MUST be the last setSaveError call.
    // On revert (direct setSaveError + null in sync prefix), last call would be null.
    expect(setSaveError).toHaveBeenLastCalledWith('conflict-msg');

    // pendingErrorRef was consumed — cleared by runInfoEntryGet
    expect(pendingErrorRef.current).toBeNull();

    // The form was shown again (show-form transition)
    expect(setScreenState).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'show-form' }),
    );
  });

  it('(a-ordering) setSaveError is NOT called with conflict-msg in the saving/loading transition', async () => {
    // Verify that during the sync prefix of runInfoEntryGet (setScreenState loading),
    // setSaveError has NOT yet been called with the conflict message.
    // This proves the message arrives after the async GET boundary, not before.
    const pendingErrorRef: { current: string | null } = { current: null };
    const saveErrorLog: (string | null)[] = [];
    const screenStateLog: string[] = [];
    const setSaveError = (v: string | null) => saveErrorLog.push(v);
    const setScreenState = (s: InfoScreenState) => {
      screenStateLog.push(s.mode);
      // When loading mode is set, conflict-msg must NOT have been applied yet.
      if (s.mode === 'loading') {
        const conflictAppliedBeforeLoading = saveErrorLog.includes('conflict-msg');
        expect(conflictAppliedBeforeLoading).toBe(false);
      }
    };
    const profile = makeProfile({ version: 5 });
    const tokenStorage = makeTokenStorage('tok');

    const put409: PutProfileResult = {
      ok: false,
      status: 409,
      code: 'stale_version',
      message: 'Stale',
      currentProfile: profile,
    };

    const entryGetDeps: InfoEntryGetDeps = {
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      pendingErrorRef,
      loadErrorMessage: 'load-error',
      onSessionExpired: jest.fn(),
      setScreenState: setScreenState as InfoEntryGetDeps['setScreenState'],
      setFormState: jest.fn(),
      setSaveError: setSaveError as InfoEntryGetDeps['setSaveError'],
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue({ ok: true, profile }),
      }),
    };

    await runInfoSave({
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      screenState: { mode: 'show-form', profile },
      formState: BLANK_FORM,
      pendingErrorRef,
      conflictMessage: 'conflict-msg',
      genericErrorMessage: 'generic-error',
      onSessionExpired: jest.fn(),
      onSaveComplete: jest.fn(),
      setScreenState: setScreenState as InfoSaveDeps['setScreenState'],
      setSaveError: setSaveError as InfoSaveDeps['setSaveError'],
      runEntryGet: () => runInfoEntryGet(entryGetDeps),
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue(put409),
      }),
    });

    // Conflict message WAS applied eventually (after the GET await)
    expect(saveErrorLog).toContain('conflict-msg');
    // Screen went: saving → loading → show-form
    expect(screenStateLog).toEqual(['saving', 'loading', 'show-form']);
    // 'conflict-msg' appears AFTER the 'loading' transition (index of last null + conflict)
    const lastNullIdx = saveErrorLog.lastIndexOf(null);
    const conflictIdx = saveErrorLog.lastIndexOf('conflict-msg');
    // The null from save-init (setSaveError(null) in runInfoSave start) comes before conflict
    // The null from show-form on a fresh entry does not apply here (pendingError is conflict-msg)
    expect(conflictIdx).toBeGreaterThan(lastNullIdx);
  });
});

// ─── (b) Normal entry clears stale saveError ─────────────────────────────────
//
// When pendingErrorRef.current is null (fresh mount, retry, no pending conflict),
// runInfoEntryGet's show-form case calls setSaveError(null), which clears any
// stale generic error left from a previous save attempt.

describe('runInfoEntryGet — (b) normal/fresh entry clears stale saveError', () => {
  it('show-form result with null pendingError calls setSaveError(null)', async () => {
    const profile = makeProfile();
    const deps = makeEntryGetDeps({
      pendingErrorRef: { current: null },  // no pending conflict
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue({ ok: true, profile }),
      }),
    });

    await runInfoEntryGet(deps);

    // setSaveError called with null (clears any stale error)
    expect(deps.setSaveError).toHaveBeenCalledWith(null);
    expect(deps.setScreenState).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'show-form' }),
    );
  });

  it('setSaveError(null) is called on show-form even when a stale generic error existed', async () => {
    // Simulates: user saved → got generic error → retried (GET) → form reloads
    const profile = makeProfile();
    const saveErrorLog: (string | null)[] = [];
    const deps = makeEntryGetDeps({
      pendingErrorRef: { current: null },
      setSaveError: (v: string | null) => saveErrorLog.push(v),
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue({ ok: true, profile }),
      }),
    });

    await runInfoEntryGet(deps);

    // Stale error is cleared by setSaveError(null) in show-form case
    expect(saveErrorLog[saveErrorLog.length - 1]).toBeNull();
  });
});

// ─── (c) Pending-error ref consumed once — no double-apply on retry ──────────
//
// After runInfoEntryGet consumes pendingErrorRef.current, the ref is null.
// A subsequent runInfoEntryGet (e.g. user taps Retry on a load error) sees null
// and calls setSaveError(null) — not the old conflict message.

describe('runInfoEntryGet — (c) pendingErrorRef consumed once, no double-apply', () => {
  it('after conflict re-fetch, pendingErrorRef.current is null', async () => {
    const pendingErrorRef: { current: string | null } = { current: 'conflict-msg' };
    const profile = makeProfile();
    const deps = makeEntryGetDeps({
      pendingErrorRef,
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue({ ok: true, profile }),
      }),
    });

    await runInfoEntryGet(deps);

    expect(pendingErrorRef.current).toBeNull();
  });

  it('second runInfoEntryGet after conflict re-fetch applies null, not the old conflict message', async () => {
    // First call: conflict message in ref → applied to setSaveError
    // Second call: ref is null → setSaveError(null) applied
    const pendingErrorRef: { current: string | null } = { current: 'conflict-msg' };
    const setSaveError = jest.fn<void, [string | null]>();
    const profile = makeProfile();
    const depsFn = () => makeEntryGetDeps({
      pendingErrorRef,
      setSaveError,
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue({ ok: true, profile }),
      }),
    });

    // First call — consumes the conflict message
    await runInfoEntryGet(depsFn());
    expect(setSaveError).toHaveBeenLastCalledWith('conflict-msg');

    // Second call — ref is null; should call setSaveError(null)
    await runInfoEntryGet(depsFn());
    expect(setSaveError).toHaveBeenLastCalledWith(null);
  });
});

// ─── (d) SD-5: 401 paths → onSessionExpired ──────────────────────────────────
//
// All four SD-5 session-expiry paths must call onSessionExpired() and not proceed
// to any save/form state.

describe('runInfoEntryGet — (d) SD-5 GET no-token and server-401 → onSessionExpired', () => {
  it('GET no-token → onSessionExpired called, setScreenState not called with form', async () => {
    const deps = makeEntryGetDeps({
      tokenStorage: makeTokenStorage(null),
    });

    await runInfoEntryGet(deps);

    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(deps.setScreenState).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'show-form' }),
    );
  });

  it('GET server-401 → onSessionExpired called', async () => {
    const get401: GetProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    };
    const deps = makeEntryGetDeps({
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue(get401),
      }),
    });

    await runInfoEntryGet(deps);

    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(deps.setScreenState).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'show-form' }),
    );
  });

  it('GET 200 show-form → onSessionExpired NOT called', async () => {
    const profile = makeProfile();
    const deps = makeEntryGetDeps({
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue({ ok: true, profile }),
      }),
    });

    await runInfoEntryGet(deps);

    expect(deps.onSessionExpired).not.toHaveBeenCalled();
    expect(deps.setScreenState).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'show-form' }),
    );
  });

  it('GET 404 not-found → onSessionExpired NOT called, setScreenState not-found', async () => {
    const get404: GetProfileResult = {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Not found',
    };
    const deps = makeEntryGetDeps({
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue(get404),
      }),
    });

    await runInfoEntryGet(deps);

    expect(deps.onSessionExpired).not.toHaveBeenCalled();
    expect(deps.setScreenState).toHaveBeenCalledWith({ mode: 'not-found' });
  });
});

describe('runInfoSave — (d) SD-5 PUT no-token and server-401 → onSessionExpired', () => {
  it('PUT no-token → onSessionExpired called', async () => {
    const deps = makeInfoSaveDeps({
      tokenStorage: makeTokenStorage(null),
    });

    await runInfoSave(deps);

    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(deps.onSaveComplete).not.toHaveBeenCalled();
  });

  it('PUT server-401 → onSessionExpired called', async () => {
    const put401: PutProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    };
    const deps = makeInfoSaveDeps({
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue(put401),
      }),
    });

    await runInfoSave(deps);

    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(deps.onSaveComplete).not.toHaveBeenCalled();
  });

  it('PUT 200 success → onSaveComplete called, onSessionExpired NOT called', async () => {
    const saved = makeProfile({ version: 4 });
    const deps = makeInfoSaveDeps({
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue({ ok: true, profile: saved, created: false }),
      }),
    });

    await runInfoSave(deps);

    expect(deps.onSaveComplete).toHaveBeenCalledWith(saved);
    expect(deps.onSessionExpired).not.toHaveBeenCalled();
  });
});

// ─── (e) PUT sends If-Match = String(version) ────────────────────────────────
//
// The PUT request must carry If-Match: "<version>" where version comes from the
// loaded profile. This guards against optimistic-concurrency violations.

describe('runInfoSave — (e) PUT If-Match header = String(profile.version)', () => {
  it('sends If-Match = "3" when profile.version = 3', async () => {
    const putProfileMock = jest.fn<
      Promise<PutProfileResult>,
      [PregnancyProfileInput, string, string?, string?]
    >().mockResolvedValue({
      ok: true,
      profile: makeProfile({ version: 4 }),
      created: false,
    });
    const deps = makeInfoSaveDeps({
      screenState: { mode: 'show-form', profile: makeProfile({ version: 3 }) },
      createClient: () => ({ putProfile: putProfileMock }),
    });

    await runInfoSave(deps);

    // Third arg to putProfile is ifMatch
    expect(putProfileMock).toHaveBeenCalledWith(
      expect.anything(),   // body
      'tok',               // token
      '3',                 // ifMatch = String(3)
      expect.anything(),   // clientDate
    );
  });

  it('sends If-Match = "7" when profile.version = 7', async () => {
    const putProfileMock = jest.fn<
      Promise<PutProfileResult>,
      [PregnancyProfileInput, string, string?, string?]
    >().mockResolvedValue({
      ok: true,
      profile: makeProfile({ version: 8 }),
      created: false,
    });
    const deps = makeInfoSaveDeps({
      screenState: { mode: 'show-form', profile: makeProfile({ version: 7 }) },
      createClient: () => ({ putProfile: putProfileMock }),
    });

    await runInfoSave(deps);

    expect(putProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      'tok',
      '7',                 // If-Match = String(7)
      expect.anything(),
    );
  });
});

// ─── (f) 409 where re-fetch resolves to error/not-found/session-expired ───────
//
// If the GET after a 409 conflict does NOT return show-form, the conflict message
// is NOT applied (it's only applied in the show-form branch of runInfoEntryGet).
// The message is consumed/cleared even so (ref is always cleared in sync prefix).

describe('runInfoSave + runInfoEntryGet — (f) 409 re-fetch to non-show-form drops conflict message', () => {
  it('409 + GET error: conflict message not applied (degraded gracefully)', async () => {
    const pendingErrorRef: { current: string | null } = { current: null };
    const setSaveError = jest.fn<void, [string | null]>();
    const profile = makeProfile({ version: 2 });
    const tokenStorage = makeTokenStorage('tok');

    const put409: PutProfileResult = {
      ok: false,
      status: 409,
      code: 'stale_version',
      message: 'Stale',
      currentProfile: profile,
    };
    const getError: GetProfileResult = {
      ok: false,
      status: 500,
      code: 'internal_error',
      message: 'Server error',
    };

    const entryGetDeps: InfoEntryGetDeps = {
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      pendingErrorRef,
      loadErrorMessage: 'load-error-msg',
      onSessionExpired: jest.fn(),
      setScreenState: jest.fn(),
      setFormState: jest.fn(),
      setSaveError,
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue(getError),
      }),
    };

    await runInfoSave({
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      screenState: { mode: 'show-form', profile },
      formState: BLANK_FORM,
      pendingErrorRef,
      conflictMessage: 'conflict-msg',
      genericErrorMessage: 'generic-error',
      onSessionExpired: jest.fn(),
      onSaveComplete: jest.fn(),
      setScreenState: jest.fn(),
      setSaveError,
      runEntryGet: () => runInfoEntryGet(entryGetDeps),
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue(put409),
      }),
    });

    // Conflict message was NOT applied (GET returned error, not show-form)
    expect(setSaveError).not.toHaveBeenCalledWith('conflict-msg');
    // pendingErrorRef consumed (cleared) even though GET failed
    expect(pendingErrorRef.current).toBeNull();
  });

  it('409 + GET 404 not-found: conflict message not applied, screen shows not-found', async () => {
    const pendingErrorRef: { current: string | null } = { current: null };
    const setSaveError = jest.fn<void, [string | null]>();
    const setScreenState = jest.fn<void, [InfoScreenState]>();
    const profile = makeProfile({ version: 2 });
    const tokenStorage = makeTokenStorage('tok');

    const put409: PutProfileResult = {
      ok: false,
      status: 409,
      code: 'stale_version',
      message: 'Stale',
      currentProfile: profile,
    };
    const get404: GetProfileResult = {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Not found',
    };

    const entryGetDeps: InfoEntryGetDeps = {
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      pendingErrorRef,
      loadErrorMessage: 'load-error-msg',
      onSessionExpired: jest.fn(),
      setScreenState,
      setFormState: jest.fn(),
      setSaveError,
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue(get404),
      }),
    };

    await runInfoSave({
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      screenState: { mode: 'show-form', profile },
      formState: BLANK_FORM,
      pendingErrorRef,
      conflictMessage: 'conflict-msg',
      genericErrorMessage: 'generic-error',
      onSessionExpired: jest.fn(),
      onSaveComplete: jest.fn(),
      setScreenState,
      setSaveError,
      runEntryGet: () => runInfoEntryGet(entryGetDeps),
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue(put409),
      }),
    });

    // Conflict message not applied — screen shows not-found instead
    expect(setSaveError).not.toHaveBeenCalledWith('conflict-msg');
    expect(setScreenState).toHaveBeenCalledWith({ mode: 'not-found' });
  });

  it('409 + GET server-401: conflict message not applied, onSessionExpired called', async () => {
    const pendingErrorRef: { current: string | null } = { current: null };
    const setSaveError = jest.fn<void, [string | null]>();
    const onSessionExpired = jest.fn();
    const profile = makeProfile({ version: 2 });
    const tokenStorage = makeTokenStorage('tok');

    const put409: PutProfileResult = {
      ok: false,
      status: 409,
      code: 'stale_version',
      message: 'Stale',
      currentProfile: profile,
    };
    const get401: GetProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    };

    const entryGetDeps: InfoEntryGetDeps = {
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      pendingErrorRef,
      loadErrorMessage: 'load-error-msg',
      onSessionExpired,
      setScreenState: jest.fn(),
      setFormState: jest.fn(),
      setSaveError,
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue(get401),
      }),
    };

    await runInfoSave({
      tokenStorage,
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-07',
      screenState: { mode: 'show-form', profile },
      formState: BLANK_FORM,
      pendingErrorRef,
      conflictMessage: 'conflict-msg',
      genericErrorMessage: 'generic-error',
      onSessionExpired,
      onSaveComplete: jest.fn(),
      setScreenState: jest.fn(),
      setSaveError,
      runEntryGet: () => runInfoEntryGet(entryGetDeps),
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue(put409),
      }),
    });

    // Conflict message not applied — session expired instead
    expect(setSaveError).not.toHaveBeenCalledWith('conflict-msg');
    // SD-5: onSessionExpired called by runInfoEntryGet (GET 401)
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

// ─── Additional edge-case wiring tests ────────────────────────────────────────

describe('runInfoSave — screen mode guard', () => {
  it('returns immediately when screenState is not show-form (e.g. loading)', async () => {
    const deps = makeInfoSaveDeps({
      screenState: { mode: 'loading' },
    });

    await runInfoSave(deps);

    expect(deps.setSaveError).not.toHaveBeenCalled();
    expect(deps.setScreenState).not.toHaveBeenCalled();
    expect(deps.onSessionExpired).not.toHaveBeenCalled();
  });
});

describe('runInfoSave — generic error path', () => {
  it('PUT 422 → setSaveError(genericErrorMessage) + setScreenState show-form', async () => {
    const profile = makeProfile({ version: 3 });
    const put422: PutProfileResult = {
      ok: false,
      status: 422,
      code: 'validation_error',
      message: 'Invalid EDD',
    };
    const deps = makeInfoSaveDeps({
      screenState: { mode: 'show-form', profile },
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockResolvedValue(put422),
      }),
    });

    await runInfoSave(deps);

    expect(deps.setSaveError).toHaveBeenCalledWith('generic-error');
    expect(deps.setScreenState).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'show-form', profile }),
    );
  });

  it('PUT throws (network error) → setSaveError(genericErrorMessage) + setScreenState show-form', async () => {
    const profile = makeProfile({ version: 3 });
    const deps = makeInfoSaveDeps({
      screenState: { mode: 'show-form', profile },
      createClient: () => ({
        putProfile: jest.fn<
          Promise<PutProfileResult>,
          [PregnancyProfileInput, string, string?, string?]
        >().mockRejectedValue(new Error('Network error')),
      }),
    });

    await runInfoSave(deps);

    expect(deps.setSaveError).toHaveBeenCalledWith('generic-error');
    expect(deps.setScreenState).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'show-form', profile }),
    );
  });
});

describe('runInfoEntryGet — GET error / network error', () => {
  it('GET 500 → setScreenState error with loadErrorMessage', async () => {
    const get500: GetProfileResult = {
      ok: false,
      status: 500,
      code: 'internal_error',
      message: 'Server error',
    };
    const deps = makeEntryGetDeps({
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockResolvedValue(get500),
      }),
    });

    await runInfoEntryGet(deps);

    expect(deps.setScreenState).toHaveBeenCalledWith({
      mode: 'error',
      message: 'load-error-msg',
    });
    expect(deps.onSessionExpired).not.toHaveBeenCalled();
  });

  it('GET throws (network error) → setScreenState error', async () => {
    const deps = makeEntryGetDeps({
      createClient: () => ({
        getProfile: jest.fn<Promise<GetProfileResult>, [string, string?]>()
          .mockRejectedValue(new Error('Network error')),
      }),
    });

    await runInfoEntryGet(deps);

    expect(deps.setScreenState).toHaveBeenCalledWith({
      mode: 'error',
      message: 'load-error-msg',
    });
  });
});
