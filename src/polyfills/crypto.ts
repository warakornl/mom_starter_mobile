/**
 * Polyfill `global.crypto.getRandomValues` using expo-crypto's CSPRNG.
 *
 * WHY: uuid@9's rng-browser throws "crypto.getRandomValues() not supported" on
 * Hermes/React Native because the global has no WebCrypto RNG. That throw fired as
 * the FIRST statement of every record-create handler — so adding a supply item,
 * saving an appointment/reminder, and creating a kick-count draft id all aborted
 * silently before enqueue/navigate. This restores a real (secure) RNG.
 *
 * MUST be imported before anything that calls uuid.v4() — import it FIRST in
 * App.tsx. expo-crypto is bundled in Expo Go, so this needs no native rebuild.
 * (Tests run under Node, which already has crypto.getRandomValues, so this file
 * is only referenced by the app entry and never loaded by Jest.)
 */
import { getRandomValues } from 'expo-crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = globalThis;

if (!g.crypto) {
  g.crypto = {};
}
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = getRandomValues;
}
