/**
 * TokenStorage — unit tests (TDD, written BEFORE the implementation).
 *
 * The interface contract under test:
 * - `save` persists AuthTokens (and replaces any previously saved set)
 * - `load` returns the persisted tokens, or null if never saved / after clear
 * - `clear` removes all stored tokens
 *
 * Only the in-memory implementation is tested here (the production
 * expo-secure-store binding is an integration step for a later slice — §A).
 */
import { InMemoryTokenStorage } from './tokenStorage';
import type { AuthTokens } from './types';

const TOKENS: AuthTokens = {
  accessToken: 'at.eyJhbGciOiJSUzI1NiJ9',
  refreshToken: 'rt.opaque-random-string',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 1_209_600,
};

describe('InMemoryTokenStorage', () => {
  it('returns null before any tokens are saved', async () => {
    const store = new InMemoryTokenStorage();
    expect(await store.load()).toBeNull();
  });

  it('saves and loads tokens', async () => {
    const store = new InMemoryTokenStorage();
    await store.save(TOKENS);
    expect(await store.load()).toEqual(TOKENS);
  });

  it('replaces the previously saved tokens on a second save', async () => {
    const store = new InMemoryTokenStorage();
    await store.save(TOKENS);
    const rotated: AuthTokens = { ...TOKENS, accessToken: 'at.rotated', refreshToken: 'rt.rotated' };
    await store.save(rotated);
    const loaded = await store.load();
    expect(loaded?.accessToken).toBe('at.rotated');
    expect(loaded?.refreshToken).toBe('rt.rotated');
  });

  it('clear removes stored tokens and subsequent load returns null', async () => {
    const store = new InMemoryTokenStorage();
    await store.save(TOKENS);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('stores a defensive copy — mutating the original object after save does not affect the stored value', async () => {
    const store = new InMemoryTokenStorage();
    const mutable = { ...TOKENS };
    await store.save(mutable);
    mutable.accessToken = 'MUTATED';
    const loaded = await store.load();
    // The stored value must be the original, not the mutated one
    expect(loaded?.accessToken).toBe(TOKENS.accessToken);
  });

  it('load returns a defensive copy — mutating the returned object does not affect the stored value', async () => {
    const store = new InMemoryTokenStorage();
    await store.save(TOKENS);
    const loaded = await store.load();
    if (!loaded) throw new Error('expected tokens');
    loaded.accessToken = 'MUTATED';
    // A second load must still return the original
    expect((await store.load())?.accessToken).toBe(TOKENS.accessToken);
  });

  it('can save after clearing', async () => {
    const store = new InMemoryTokenStorage();
    await store.save(TOKENS);
    await store.clear();
    const second: AuthTokens = { ...TOKENS, accessToken: 'at.second' };
    await store.save(second);
    expect((await store.load())?.accessToken).toBe('at.second');
  });

  it('is independent across instances (no shared state)', async () => {
    const storeA = new InMemoryTokenStorage();
    const storeB = new InMemoryTokenStorage();
    await storeA.save(TOKENS);
    expect(await storeB.load()).toBeNull();
  });
});
