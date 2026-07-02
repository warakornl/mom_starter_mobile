/**
 * Consent integration tests (S3) — pins behaviours that would have caught B1/B2.
 *
 * 1. B1 cold-start resilience:
 *    consent granted (cached) → cold start with a FAILING GET → consentStore
 *    still reports granted → HomeScreen is NOT in limited mode.
 *
 * 2. B2 queue drain on foreground:
 *    queued consent entry → drain called → entry POSTed, removed from queue.
 *
 * 3. performLogout resets the consent store (including durable storage).
 *
 * These tests use pure logic (store + queue + drain function) — no RN render.
 * They act as regression guards: if any of these fail the named blocker is live.
 */

import { createConsentStore } from './consentStore';
import type { ConsentPersistStorage } from './consentStore';
import { createConsentSync } from './consentSync';
import type { ConsentQueueStorage } from './consentQueue';
import type { TokenStorage } from '../auth/tokenStorage';
import type { AuthTokens } from '../auth/types';
import type { PostConsentResult } from './types';

// ─── In-memory helpers ────────────────────────────────────────────────────────

class InMemoryPersistStorage implements ConsentPersistStorage {
  data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

class InMemoryQueueStorage implements ConsentQueueStorage {
  data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

class InMemoryTokenStorage implements TokenStorage {
  private tokens: AuthTokens | null = null;
  async save(t: AuthTokens): Promise<void> { this.tokens = t; }
  async load(): Promise<AuthTokens | null> { return this.tokens; }
  async clear(): Promise<void> { this.tokens = null; }
}

function makeTokens(): AuthTokens {
  return {
    accessToken: 'at.test',
    refreshToken: 'rt.test',
    accessTokenExpiresIn: 900,
    refreshTokenExpiresIn: 1_209_600,
  };
}

function makeSuccessResult(): PostConsentResult {
  return {
    ok: true,
    record: {
      id: 'rec-s3',
      consentType: 'general_health',
      granted: true,
      consentTextVersion: 'v1.0-th',
      grantedAt: new Date().toISOString(),
    },
  };
}

// ─── B1 cold-start resilience ─────────────────────────────────────────────────

describe('B1 cold-start resilience — failing GET keeps cached consent (§4.5.4)', () => {
  it('returning consented user stays granted when GET /account/consents fails', async () => {
    // GIVEN: durable storage has a previously-granted consent record
    const storage = new InMemoryPersistStorage();
    const PREV_STATE = JSON.stringify({
      general_health: {
        granted: true,
        version: 'v1.0-th',
        grantedAt: '2026-07-01T09:00:00Z',
      },
    });
    await storage.save(PREV_STATE);

    // WHEN: cold start — create a fresh store (simulates new JS session after app-kill)
    const store = createConsentStore(storage);
    // State is empty on creation (in-memory, no data yet)
    expect(store.isGranted('general_health')).toBe(false); // confirms store starts empty

    // Load cache (this is what HomeScreen.loadProfile does before GET)
    await store.loadFromStorage();

    // AND: GET /account/consents fails (network error or 5xx — do NOT call hydrate)
    // (simulated by simply not calling store.hydrate())

    // THEN: consent store still reports granted — user is NOT dropped to limited mode
    expect(store.isGranted('general_health')).toBe(true);
  });

  it('new user (no cache, no server record) remains fail-closed → limited mode', async () => {
    // GIVEN: no durable storage (first install)
    const storage = new InMemoryPersistStorage(); // data = null

    // WHEN: cold start
    const store = createConsentStore(storage);
    await store.loadFromStorage(); // null → no-op
    // GET also fails
    // (hydrate not called)

    // THEN: fail-closed — no cache + no server record → limited mode (correct)
    expect(store.isGranted('general_health')).toBe(false);
  });

  it('successful GET overwrites stale cached state (later grantedAt wins)', async () => {
    const storage = new InMemoryPersistStorage();
    // Cache has an old grant
    await storage.save(JSON.stringify({
      general_health: {
        granted: true,
        version: 'v1.0-th',
        grantedAt: '2026-07-01T09:00:00Z',
      },
    }));

    const store = createConsentStore(storage);
    await store.loadFromStorage();
    expect(store.isGranted('general_health')).toBe(true); // cache loaded

    // Server returns a LATER withdrawal
    store.hydrate([{
      id: 'srv-1',
      consentType: 'general_health',
      granted: false,
      consentTextVersion: 'v1.0-th',
      grantedAt: '2026-07-03T12:00:00Z', // later than cache → this wins
    }]);

    expect(store.isGranted('general_health')).toBe(false); // server withdrawal applied
  });
});

// ─── B2 queue drain on foreground ─────────────────────────────────────────────

describe('B2 queue drain on foreground (§4.2.4)', () => {
  it('queued offline consent is POSTed and removed when drain is called', async () => {
    const qStorage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockResolvedValue(makeSuccessResult());
    const { queue, drain } = createConsentSync(qStorage, { postConsent } as never);

    // ConsentScreen queued a consent when offline
    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();
    expect(queue.getEntries()).toHaveLength(1);

    // App goes to foreground → drain
    await drain(tokenStorage, 'https://api.test');

    // The entry is gone — server received the POST
    expect(postConsent).toHaveBeenCalledWith('general_health', true, 'v1.0-th', 'at.test');
    expect(queue.getEntries()).toHaveLength(0);
  });

  it('queued consent survives simulated app-kill (restored from durable storage)', async () => {
    const qStorage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockResolvedValue(makeSuccessResult());

    // Session 1: ConsentScreen enqueues and persists
    const { queue: q1 } = createConsentSync(qStorage, { postConsent } as never);
    q1.enqueue('general_health', true, 'v1.0-th');
    await q1.persist();

    // Session 2: new sync instance (simulates app-kill + restart)
    const { queue: q2, drain: drain2 } = createConsentSync(qStorage, { postConsent } as never);
    await q2.restore(); // restore from durable storage
    expect(q2.getEntries()).toHaveLength(1); // survived

    // Drain on foreground
    await drain2(tokenStorage, 'https://api.test');
    expect(postConsent).toHaveBeenCalledTimes(1);
    expect(q2.getEntries()).toHaveLength(0);
  });

  it('failed drain sets backoff; second immediate drain does not retry not-yet-due entry', async () => {
    const qStorage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockResolvedValue({ ok: false, status: 503, code: 'down', message: '' });
    const { queue, drain } = createConsentSync(qStorage, { postConsent } as never);

    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();

    // First drain: POST fails → retryCount=1, nextRetryAt in the future
    await drain(tokenStorage, 'https://api.test');
    expect(postConsent).toHaveBeenCalledTimes(1);
    expect(queue.getEntries()[0].retryCount).toBe(1);

    // Second drain immediately: entry not yet due → skipped
    await drain(tokenStorage, 'https://api.test');
    expect(postConsent).toHaveBeenCalledTimes(1); // no additional POST
  });
});

// ─── performLogout resets consent store ──────────────────────────────────────

describe('performLogout resets consent store (§4.5 cross-user isolation)', () => {
  it('reset() clears all in-memory consent state', () => {
    const store = createConsentStore();
    store.setGranted('general_health', true, 'v1.0-th');
    store.setGranted('cloud_storage', true, 'v1.0-th');

    store.reset();

    expect(store.isGranted('general_health')).toBe(false);
    expect(store.isGranted('cloud_storage')).toBe(false);
  });

  it('reset() also clears durable storage (prevents next user inheriting previous state)', async () => {
    const storage = new InMemoryPersistStorage();
    const store = createConsentStore(storage);
    store.setGranted('general_health', true, 'v1.0-th');
    await Promise.resolve(); // let fire-and-forget persist settle

    store.reset();
    await Promise.resolve();

    // Durable storage now has an empty object — a fresh cold start finds no cached grants
    const saved = await storage.load();
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!) as Record<string, unknown>;
    expect(Object.keys(parsed)).toHaveLength(0);
  });

  it('after reset(), loadFromStorage() does not re-populate (next user starts fresh)', async () => {
    const storage = new InMemoryPersistStorage();
    const store = createConsentStore(storage);
    store.setGranted('general_health', true, 'v1.0-th');
    await Promise.resolve();

    store.reset();
    await Promise.resolve();

    // Simulate cold start for user B on the same device
    const store2 = createConsentStore(storage);
    await store2.loadFromStorage();
    expect(store2.isGranted('general_health')).toBe(false);
  });
});
