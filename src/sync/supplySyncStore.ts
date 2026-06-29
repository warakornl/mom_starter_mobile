/**
 * supplySyncStore — module-level singleton SyncStore for supply items.
 *
 * Kept at module scope so the store survives component re-mounts within the
 * same JS session.  Data is in-memory only; repopulated by syncClient.pull()
 * on each app launch.
 *
 * Imported by:
 *   - SuppliesScreen  — reads/writes items and the mutation queue
 *   - HomeScreen      — calls reset() on logout (PDPA: no data leakage
 *                       between users in the same session)
 *
 * Security: no tokens or health data stored here (supplyItems is
 * NON-health, cloud_storage only).
 */

import { createSyncStore } from './syncStore';

export const supplySyncStore = createSyncStore();
