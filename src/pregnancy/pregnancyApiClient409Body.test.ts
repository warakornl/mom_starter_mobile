/**
 * pregnancyApiClient409Body.test.ts — TDD tests for G-4: 409 conflict body parsing.
 *
 * Spec §9 G-4: "PutProfileResult currently surfaces 409 as a bare PregnancyApiError
 * and does NOT parse the returned current-profile body. The client must also return
 * the conflict body on 409 (G-4)."
 *
 * The server already returns the current profile in the 409 body
 * (PregnancyProfileController.java L102-103: e.getCurrentProfile()).
 * This is a mobile-internal type change only — no wire-contract change needed.
 *
 * AC-10: on 409, the form must reload to the server's current profile and show
 * the conflict message. This requires the client to parse and surface the body.
 */

import { createPregnancyClient } from './pregnancyApiClient';
import type { FetchFn } from '../auth/authApiClient';
import type { PregnancyProfile } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'uuid-server',
    version: 5,
    edd: '2026-12-01',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    gestationalWeek: 20,
    gestationalDay: 0,
    daysRemaining: 148,
    progress: 0.5,
    currentStage: 'T2',
    deliveryWindowActive: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeFetch(status: number, body: unknown): FetchFn {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Conflict',
      json: async () => body,
    } as Response);
}

// ─── 409 body parsing tests ───────────────────────────────────────────────────

describe('createPregnancyClient.putProfile — G-4: 409 response body carries currentProfile', () => {
  it('409 with currentProfile in body: result.currentProfile equals the server profile', async () => {
    const serverProfile = makeProfile({ version: 5, edd: '2026-12-01' });
    const fetch = makeFetch(409, {
      code: 'stale_version',
      message: 'Version mismatch',
      currentProfile: serverProfile,
    });
    const client = createPregnancyClient('https://api.test', fetch);
    const result = await client.putProfile({ edd: '2026-11-20' }, 'token', '3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      // G-4: currentProfile must be parsed and exposed
      expect((result as { currentProfile?: PregnancyProfile }).currentProfile).toEqual(serverProfile);
    }
  });

  it('409 without currentProfile in body: result.currentProfile is null (graceful fallback)', async () => {
    // Server returns 409 but omits currentProfile (defensive — should not happen per contract)
    const fetch = makeFetch(409, {
      code: 'stale_version',
      message: 'Version mismatch',
      // no currentProfile field
    });
    const client = createPregnancyClient('https://api.test', fetch);
    const result = await client.putProfile({ edd: '2026-11-20' }, 'token', '3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      // Graceful: currentProfile is null when not present in body
      expect((result as { currentProfile?: PregnancyProfile | null }).currentProfile).toBeNull();
    }
  });

  it('409 code and message are still exposed (existing error shape preserved)', async () => {
    const fetch = makeFetch(409, { code: 'stale_version', message: 'Old version' });
    const client = createPregnancyClient('https://api.test', fetch);
    const result = await client.putProfile({ edd: '2026-11-20' }, 'token', '3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe('stale_version');
      expect(result.message).toBe('Old version');
    }
  });

  it('200 update is unaffected — still returns ok=true with profile', async () => {
    const profile = makeProfile();
    const fetch = makeFetch(200, profile);
    const client = createPregnancyClient('https://api.test', fetch);
    const result = await client.putProfile({ edd: '2026-12-01' }, 'token', '4');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile).toEqual(profile);
      expect(result.created).toBe(false);
    }
  });

  it('422 is unaffected (other error codes not given currentProfile)', async () => {
    const fetch = makeFetch(422, { code: 'validation_error', message: 'Bad EDD' });
    const client = createPregnancyClient('https://api.test', fetch);
    const result = await client.putProfile({ edd: '2020-01-01' }, 'token', '1');
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect((result as { currentProfile?: unknown }).currentProfile).toBeUndefined();
    }
  });
});
