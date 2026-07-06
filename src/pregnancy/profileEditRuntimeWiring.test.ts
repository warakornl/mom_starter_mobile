/**
 * profileEditRuntimeWiring.test.ts — runtime wiring tests for AC-13.
 *
 * Covers the cross-account PHI-leak guard (SD-5) at runtime, verifying that
 * the actual wiring — not just the pure resolver functions — calls
 * onSessionExpired on all four AC-13 401 paths:
 *
 *   ProfileEditScreen GET paths (via runEntryGet):
 *     - GET no-token   → onSessionExpired called
 *     - GET server-401 → onSessionExpired called
 *
 *   ProfileSetupScreen PUT paths (via runSave):
 *     - PUT no-token   → onNoTokenAction called  (edit: sessionExpired)
 *     - PUT server-401 → onServerAuthAction called (edit: sessionExpired)
 *
 * The resolver functions (resolveEditGetOutcome, resolveEditNoTokenOutcome,
 * resolveEditPutOutcome) are already tested in profileEditLogic.test.ts.
 * These tests confirm that the *wiring* — the code that acts on the resolver
 * outcome and calls the right callback — is correct at runtime with mock deps.
 *
 * No React, no React Native, no navigation — these are pure async function tests.
 */

import { runEntryGet, runSave } from './profileEditRuntimeWiring';
import type { SaveDeps } from './profileEditRuntimeWiring';
import type { GetProfileResult, PutProfileResult, PregnancyProfile } from './types';
import type { AuthTokens } from '../auth/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(): PregnancyProfile {
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

// ─── runEntryGet — ProfileEditScreen GET 401 paths ───────────────────────────

describe('runEntryGet — AC-13 GET session-expiry paths (ProfileEditScreen)', () => {
  it('GET no-token → onSessionExpired called', async () => {
    const onSessionExpired = jest.fn();
    const onOutcome = jest.fn();

    await runEntryGet({
      tokenStorage: makeTokenStorage(null),
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-06',
      onSessionExpired,
      onOutcome,
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('GET server-401 → onSessionExpired called', async () => {
    const onSessionExpired = jest.fn();
    const onOutcome = jest.fn();
    const get401: GetProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    };

    await runEntryGet({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-06',
      createClient: () => ({ getProfile: async () => get401 }),
      onSessionExpired,
      onOutcome,
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('GET 200 + pregnant → onOutcome show-form, onSessionExpired NOT called', async () => {
    const profile = makeProfile();
    const onSessionExpired = jest.fn();
    const onOutcome = jest.fn();

    await runEntryGet({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-06',
      createClient: () => ({
        getProfile: async (): Promise<GetProfileResult> => ({ ok: true, profile }),
      }),
      onSessionExpired,
      onOutcome,
    });

    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(onOutcome).toHaveBeenCalledWith({ type: 'show-form', profile });
  });

  it('GET 404 → onOutcome not-found, onSessionExpired NOT called', async () => {
    const onSessionExpired = jest.fn();
    const onOutcome = jest.fn();
    const get404: GetProfileResult = {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Not found',
    };

    await runEntryGet({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      clientDate: '2026-07-06',
      createClient: () => ({ getProfile: async () => get404 }),
      onSessionExpired,
      onOutcome,
    });

    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(onOutcome).toHaveBeenCalledWith({ type: 'not-found' });
  });
});

// ─── runSave — ProfileSetupScreen PUT 401 paths ───────────────────────────────

describe('runSave — AC-13 PUT session-expiry paths (ProfileSetupScreen)', () => {
  function makeBaseDeps(
    tokenOverride: ReturnType<typeof makeTokenStorage> = makeTokenStorage('tok'),
    createClientOverride?: SaveDeps['createClient'],
  ): SaveDeps {
    return {
      tokenStorage: tokenOverride,
      createClient: createClientOverride,
      apiBaseUrl: 'http://test',
      body: { edd: '2026-11-20' },
      ifMatch: '3',
      clientDate: '2026-07-06',
      onNoTokenAction: jest.fn(),
      onServerAuthAction: jest.fn(),
      onSuccess: jest.fn(),
      onConflict: jest.fn(),
      onValidationError: jest.fn(),
      onConsentRequired: jest.fn(),
      onPreconditionFailed: jest.fn(),
      onGenericError: jest.fn(),
      onOfflineError: jest.fn(),
      setSaving: jest.fn(),
    };
  }

  it('PUT no-token → onNoTokenAction called (edit flow: this IS onSessionExpired)', async () => {
    const deps = makeBaseDeps(makeTokenStorage(null));

    await runSave(deps);

    expect(deps.onNoTokenAction).toHaveBeenCalledTimes(1);
    expect(deps.onServerAuthAction).not.toHaveBeenCalled();
    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it('PUT server-401 → onServerAuthAction called (edit flow: this IS onSessionExpired)', async () => {
    const put401: PutProfileResult = {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Token expired',
    };
    const deps = makeBaseDeps(
      makeTokenStorage('tok'),
      () => ({ putProfile: async () => put401 }),
    );

    await runSave(deps);

    expect(deps.onServerAuthAction).toHaveBeenCalledTimes(1);
    expect(deps.onNoTokenAction).not.toHaveBeenCalled();
    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it('PUT 200 → onSuccess called, no session-expiry action', async () => {
    const profile = makeProfile();
    const deps = makeBaseDeps(
      makeTokenStorage('tok'),
      () => ({
        putProfile: async (): Promise<PutProfileResult> => ({
          ok: true,
          profile,
          created: false,
        }),
      }),
    );

    await runSave(deps);

    expect(deps.onSuccess).toHaveBeenCalledWith(profile);
    expect(deps.onNoTokenAction).not.toHaveBeenCalled();
    expect(deps.onServerAuthAction).not.toHaveBeenCalled();
  });

  it('PUT 409 → onConflict called (not onServerAuthAction)', async () => {
    const profile = makeProfile();
    const put409 = {
      ok: false as const,
      status: 409,
      code: 'stale_version',
      message: 'Stale',
      currentProfile: profile,
    };
    const deps = makeBaseDeps(
      makeTokenStorage('tok'),
      () => ({ putProfile: async () => put409 as PutProfileResult }),
    );

    await runSave(deps);

    expect(deps.onConflict).toHaveBeenCalledWith(profile);
    expect(deps.onServerAuthAction).not.toHaveBeenCalled();
  });

  it('setSaving is called with true then false on success', async () => {
    const profile = makeProfile();
    const savingLog: boolean[] = [];
    const deps = makeBaseDeps(
      makeTokenStorage('tok'),
      () => ({
        putProfile: async (): Promise<PutProfileResult> => ({ ok: true, profile, created: false }),
      }),
    );
    (deps.setSaving as jest.Mock).mockImplementation((v: boolean) => { savingLog.push(v); });

    await runSave(deps);

    expect(savingLog).toEqual([true, false]);
  });
});
