/**
 * reopenEntryRuntimeWiring.test.ts — runtime wiring tests for ReopenConfirmScreen's
 * GET-on-mount (mobile-reviewer BLOCKER-1 fix).
 *
 * Mirrors profileEditRuntimeWiring.test.ts's pattern: pure async function tests,
 * no React, no React Native. The pure resolver (resolveReopenEntryGetOutcome) is
 * already tested in lossEventLogic.test.ts; these tests confirm the *wiring* —
 * the code that calls getProfile, resolves the outcome, and invokes the right
 * callback (onSessionExpired vs setOutcome) — is correct at runtime.
 */

import { runReopenEntryGet, runReopenConfirm } from './reopenEntryRuntimeWiring';
import type { GetProfileResult, PregnancyProfile, ReopenResult } from './types';
import type { AuthTokens } from '../auth/types';

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'uuid-1',
    version: 9,
    edd: '2026-12-25',
    eddBasis: 'due_date',
    lifecycle: 'ended',
    gestationalWeek: 20,
    gestationalDay: 0,
    daysRemaining: 100,
    progress: 0.5,
    currentStage: 'T2',
    deliveryWindowActive: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
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

// ─── runReopenEntryGet ────────────────────────────────────────────────────────

describe('runReopenEntryGet — GET-on-mount wiring (BLOCKER-1 reachability)', () => {
  it('no token → onSessionExpired called, setOutcome NOT called', async () => {
    const onSessionExpired = jest.fn();
    const setOutcome = jest.fn();

    await runReopenEntryGet({
      tokenStorage: makeTokenStorage(null),
      apiBaseUrl: 'http://test',
      getProfile: async () => ({ ok: true, profile: makeProfile() }),
      onSessionExpired,
      setOutcome,
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(setOutcome).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'show-form' }));
  });

  it('200 + lifecycle=ended → setOutcome(show-form) with the real profile', async () => {
    const setOutcome = jest.fn();
    const profile = makeProfile();
    const getProfile = jest.fn(async (): Promise<GetProfileResult> => ({ ok: true, profile }));

    await runReopenEntryGet({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      getProfile,
      onSessionExpired: jest.fn(),
      setOutcome,
    });

    expect(getProfile).toHaveBeenCalledWith('tok', expect.any(String));
    expect(setOutcome).toHaveBeenCalledWith({ type: 'show-form', profile });
  });

  it('server 401 → onSessionExpired called', async () => {
    const onSessionExpired = jest.fn();
    const setOutcome = jest.fn();

    await runReopenEntryGet({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      getProfile: async () => ({ ok: false, status: 401, code: 'unauthorized', message: 'x' }),
      onSessionExpired,
      setOutcome,
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('lifecycle=pregnant (already reopened elsewhere) → setOutcome(guard-not-editable)', async () => {
    const setOutcome = jest.fn();

    await runReopenEntryGet({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      getProfile: async () => ({ ok: true, profile: makeProfile({ lifecycle: 'pregnant' }) }),
      onSessionExpired: jest.fn(),
      setOutcome,
    });

    expect(setOutcome).toHaveBeenCalledWith({ type: 'guard-not-editable' });
  });

  it('sets loading first, before the GET resolves', async () => {
    const calls: string[] = [];
    const setOutcome = jest.fn((o: { type: string }) => calls.push(o.type));

    await runReopenEntryGet({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      getProfile: async () => ({ ok: true, profile: makeProfile() }),
      onSessionExpired: jest.fn(),
      setOutcome,
    });

    expect(calls[0]).toBe('loading');
    expect(calls[calls.length - 1]).toBe('show-form');
  });
});

// ─── runReopenConfirm — confirm-time wiring (BLOCKER-2: no false-success) ────

describe('runReopenConfirm — confirm-time wiring (no false-success on network/5xx)', () => {
  it('200 success → onReopened called with the profile', async () => {
    const onReopened = jest.fn();
    const profile = makeProfile({ lifecycle: 'pregnant', version: 10 });

    await runReopenConfirm({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      profileVersion: 9,
      reopenPregnancy: async (): Promise<ReopenResult> => ({ ok: true, profile }),
      onReopened,
      onGoBack: jest.fn(),
      onSessionExpired: jest.fn(),
      onError: jest.fn(),
    });

    expect(onReopened).toHaveBeenCalledWith(profile);
  });

  it('409 already-pregnant → onReopened called (intent satisfied, §10.4)', async () => {
    const onReopened = jest.fn();
    const currentProfile = makeProfile({ lifecycle: 'pregnant', version: 11 });

    await runReopenConfirm({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      profileVersion: 9,
      reopenPregnancy: async () => ({
        ok: false, status: 409, code: 'version_conflict', message: 'stale', currentProfile,
      }),
      onReopened,
      onGoBack: jest.fn(),
      onSessionExpired: jest.fn(),
      onError: jest.fn(),
    });

    expect(onReopened).toHaveBeenCalledWith(currentProfile);
  });

  it('409 postpartum → onGoBack called, onReopened NOT called', async () => {
    const onReopened = jest.fn();
    const onGoBack = jest.fn();

    await runReopenConfirm({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      profileVersion: 9,
      reopenPregnancy: async () => ({
        ok: false, status: 409, code: 'invalid_lifecycle_state', message: 'postpartum',
        currentProfile: makeProfile({ lifecycle: 'postpartum' }),
      }),
      onReopened,
      onGoBack,
      onSessionExpired: jest.fn(),
      onError: jest.fn(),
    });

    expect(onReopened).not.toHaveBeenCalled();
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it('BLOCKER-2: network/throw → onError called, onReopened NEVER called (no false-success)', async () => {
    const onReopened = jest.fn();
    const onError = jest.fn();

    await runReopenConfirm({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      profileVersion: 9,
      reopenPregnancy: async () => {
        throw new Error('network down');
      },
      onReopened,
      onGoBack: jest.fn(),
      onSessionExpired: jest.fn(),
      onError,
    });

    expect(onReopened).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('BLOCKER-2: 500 server error → onError called, onReopened NEVER called', async () => {
    const onReopened = jest.fn();
    const onError = jest.fn();

    await runReopenConfirm({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      profileVersion: 9,
      reopenPregnancy: async () => ({ ok: false, status: 500, code: 'server_error', message: 'x' }),
      onReopened,
      onGoBack: jest.fn(),
      onSessionExpired: jest.fn(),
      onError,
    });

    expect(onReopened).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('401 at confirm-time → onSessionExpired called', async () => {
    const onSessionExpired = jest.fn();

    await runReopenConfirm({
      tokenStorage: makeTokenStorage('tok'),
      apiBaseUrl: 'http://test',
      profileVersion: 9,
      reopenPregnancy: async () => ({ ok: false, status: 401, code: 'unauthorized', message: 'x' }),
      onReopened: jest.fn(),
      onGoBack: jest.fn(),
      onSessionExpired,
      onError: jest.fn(),
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('no token at confirm-time → onSessionExpired called, reopenPregnancy NOT called', async () => {
    const onSessionExpired = jest.fn();
    const reopenPregnancy = jest.fn();

    await runReopenConfirm({
      tokenStorage: makeTokenStorage(null),
      apiBaseUrl: 'http://test',
      profileVersion: 9,
      reopenPregnancy,
      onReopened: jest.fn(),
      onGoBack: jest.fn(),
      onSessionExpired,
      onError: jest.fn(),
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(reopenPregnancy).not.toHaveBeenCalled();
  });
});
