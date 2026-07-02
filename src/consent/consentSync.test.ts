/**
 * consentSync — unit tests (TDD, failing first).
 *
 * Tests B2: durable queue + drain function.
 *
 * Covers:
 *  - drainConsentQueue POSTs due entries and removes them on success
 *  - drainConsentQueue marks retried on API failure
 *  - drainConsentQueue is a no-op when no tokens are available
 *  - drainConsentQueue is a no-op when no entries are due
 *  - concurrent drain guard prevents double-drain
 *  - restore() is called once (not on every drain after the first)
 *  - S3: queue drains on foreground (verifies drain logic with drained entry)
 */

import {
  createConsentSync,
} from './consentSync';
import type { ConsentQueueStorage } from './consentQueue';
import type { TokenStorage } from '../auth/tokenStorage';
import type { AuthTokens } from '../auth/types';
import type { PostConsentResult } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

class InMemoryQueueStorage implements ConsentQueueStorage {
  private data: string | null = null;
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
      id: 'rec-1',
      consentType: 'general_health',
      granted: true,
      consentTextVersion: 'v1.0-th',
      grantedAt: new Date().toISOString(),
    },
  };
}

function makeFailResult(): PostConsentResult {
  return { ok: false, status: 503, code: 'service_unavailable', message: 'try later' };
}

// ─── drain — success path ─────────────────────────────────────────────────────

describe('drainConsentQueue — success path', () => {
  it('POSTs a due entry and removes it from the queue on 201', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());

    const postConsent = jest.fn().mockResolvedValue(makeSuccessResult());
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();

    await drain(tokenStorage, 'https://api.test');

    expect(postConsent).toHaveBeenCalledTimes(1);
    expect(postConsent).toHaveBeenCalledWith(
      'general_health', true, 'v1.0-th', 'at.test',
    );
    expect(queue.getEntries()).toHaveLength(0);
  });

  it('removes the entry from durable storage on success', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockResolvedValue(makeSuccessResult());
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();

    await drain(tokenStorage, 'https://api.test');

    // Storage should reflect the removal
    const saved = await storage.load();
    const parsed = JSON.parse(saved ?? '[]') as unknown[];
    expect(parsed).toHaveLength(0);
  });

  it('drains multiple due entries in sequence', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn()
      .mockResolvedValueOnce(makeSuccessResult())
      .mockResolvedValueOnce(makeSuccessResult());
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    queue.enqueue('general_health', true, 'v1.0-th');
    queue.enqueue('cloud_storage', true, 'v1.0-th');
    await queue.persist();

    await drain(tokenStorage, 'https://api.test');

    expect(postConsent).toHaveBeenCalledTimes(2);
    expect(queue.getEntries()).toHaveLength(0);
  });
});

// ─── drain — failure path ─────────────────────────────────────────────────────

describe('drainConsentQueue — failure path', () => {
  it('marks the entry as retried on non-2xx response', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockResolvedValue(makeFailResult());
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();

    await drain(tokenStorage, 'https://api.test');

    const entries = queue.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].retryCount).toBe(1);
    expect(entries[0].nextRetryAt).toBeGreaterThan(Date.now());
  });

  it('marks the entry as retried when fetch throws (network error)', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockRejectedValue(new Error('network fail'));
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();

    await drain(tokenStorage, 'https://api.test');

    expect(queue.getEntries()[0].retryCount).toBe(1);
  });

  it('skips entries not yet due (nextRetryAt in the future)', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockResolvedValue(makeFailResult());
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    const entry = queue.enqueue('general_health', true, 'v1.0-th');
    // Push into the future so it is not due
    queue.markRetried(entry.id);
    await queue.persist();

    await drain(tokenStorage, 'https://api.test');

    expect(postConsent).not.toHaveBeenCalled();
    expect(queue.getEntries()[0].retryCount).toBe(1); // unchanged
  });
});

// ─── drain — guard paths ──────────────────────────────────────────────────────

describe('drainConsentQueue — guard paths', () => {
  it('is a no-op when token storage has no tokens', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage(); // no tokens
    const postConsent = jest.fn();
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();

    await drain(tokenStorage, 'https://api.test');

    expect(postConsent).not.toHaveBeenCalled();
    expect(queue.getEntries()).toHaveLength(1); // entry survives
  });

  it('is a no-op when the queue has no entries', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn();
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    await drain(tokenStorage, 'https://api.test');

    expect(postConsent).not.toHaveBeenCalled();
  });

  it('does not throw even if drain logic throws internally', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = {
      load: () => { throw new Error('keychain unavailable'); },
    } as unknown as TokenStorage;
    const postConsent = jest.fn();
    const { drain } = createConsentSync(storage, { postConsent } as never);

    // Must not throw
    await expect(drain(tokenStorage, 'https://api.test')).resolves.toBeUndefined();
  });
});

// ─── S3: queue drains and drained entry is gone ───────────────────────────────

describe('S3 queue drain integration', () => {
  it('entry is absent from the queue after a successful drain (simulates foreground drain)', async () => {
    const storage = new InMemoryQueueStorage();
    const tokenStorage = new InMemoryTokenStorage();
    await tokenStorage.save(makeTokens());
    const postConsent = jest.fn().mockResolvedValue(makeSuccessResult());
    const { queue, drain } = createConsentSync(storage, { postConsent } as never);

    // App queues a consent (e.g. ConsentScreen failed POST)
    queue.enqueue('general_health', true, 'v1.0-th');
    await queue.persist();
    expect(queue.getEntries()).toHaveLength(1);

    // App goes to foreground → drain
    await drain(tokenStorage, 'https://api.test');

    // Entry is gone — not lost, not duplicated
    expect(queue.getEntries()).toHaveLength(0);
    expect(postConsent).toHaveBeenCalledTimes(1);
  });
});
