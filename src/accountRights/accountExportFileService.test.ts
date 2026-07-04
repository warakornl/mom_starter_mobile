/**
 * accountExportFileService — unit tests (TDD, written BEFORE the implementation).
 *
 * All native calls (expo-file-system, expo-sharing) are mocked via the
 * injectable adapter pattern — no device, no native modules required.
 *
 * Tests cover:
 *  - saveAndShare happy path: write → onSharing callback → share → cleanup → {ok:true}
 *  - sharing unavailable → {ok:false, error:'sharing_unavailable'}
 *  - write failure → {ok:false, error}
 *  - share failure → {ok:false, error}
 *  - cleanup called AFTER share resolves (not before, not during EXPORT_SHARING)
 *  - cleanup failure is swallowed (never propagated to caller)
 *  - onSharing callback fires between write and share
 *  - share cancellation is success (share resolves = success of app's job, §2.4)
 *  - filename uses cacheDirectory + 'momstarter-export-<yyyyMMdd>.json' (no PII, AR-AC-25)
 *  - json content is never logged (AR-AC-22, AR-AC-24)
 */

import {
  createAccountExportFileService,
  formatExportDate,
} from './accountExportFileService';
import type { ExportWriteFn, ExportShareFn, ExportDeleteFn } from './accountExportFileService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_URI = 'file:///cache/momstarter-export-20260705.json';
const JSON_CONTENT = '{"account":{"email":"user@test.com","pregnancyProfile":{}}}';

function makeWriteFn(result: 'ok' | 'fail' = 'ok'): ExportWriteFn {
  if (result === 'fail') {
    return async () => {
      throw new Error('Write failed: disk full');
    };
  }
  return async () => FAKE_URI;
}

function makeShareFn(result: 'ok' | 'unavailable' | 'fail' = 'ok'): ExportShareFn {
  if (result === 'unavailable') {
    return async () => {
      throw new Error('sharing_unavailable');
    };
  }
  if (result === 'fail') {
    return async () => {
      throw new Error('Share sheet error');
    };
  }
  return async () => {};
}

function makeDeleteFn(spy?: jest.Mock): ExportDeleteFn {
  return async (_uri: string) => {
    spy?.(_uri);
  };
}

// ─── formatExportDate ─────────────────────────────────────────────────────────

describe('formatExportDate', () => {
  it('formats a date as yyyyMMdd', () => {
    const date = new Date('2026-07-05T12:34:56Z');
    expect(formatExportDate(date)).toBe('20260705');
  });

  it('zero-pads single-digit month and day', () => {
    const date = new Date('2026-01-03T00:00:00Z');
    expect(formatExportDate(date)).toBe('20260103');
  });
});

// ─── saveAndShare — happy path ─────────────────────────────────────────────────

describe('accountExportFileService.saveAndShare — happy path', () => {
  it('returns {ok:true, fileUri} when write and share both succeed', async () => {
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      makeShareFn('ok'),
    );
    const result = await service.saveAndShare(JSON_CONTENT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileUri).toBe(FAKE_URI);
    }
  });

  it('calls writeFn with the json content', async () => {
    const writes: string[] = [];
    const writeFn: ExportWriteFn = async (json) => {
      writes.push(json);
      return FAKE_URI;
    };
    const service = createAccountExportFileService(writeFn, makeShareFn('ok'));
    await service.saveAndShare(JSON_CONTENT);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(JSON_CONTENT);
  });

  it('calls shareFn with the fileUri returned by writeFn', async () => {
    const sharedUris: string[] = [];
    const shareFn: ExportShareFn = async (uri) => {
      sharedUris.push(uri);
    };
    const service = createAccountExportFileService(makeWriteFn('ok'), shareFn);
    await service.saveAndShare(JSON_CONTENT);
    expect(sharedUris).toHaveLength(1);
    expect(sharedUris[0]).toBe(FAKE_URI);
  });

  it('share cancel is success — share promise resolving (complete or cancel) = app job done (§2.4)', async () => {
    // shareAsync resolves on both complete AND cancel in expo-sharing
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      async () => { /* share resolves immediately, simulating cancel */ },
    );
    const result = await service.saveAndShare(JSON_CONTENT);
    expect(result.ok).toBe(true);
  });
});

// ─── saveAndShare — error paths ───────────────────────────────────────────────

describe('accountExportFileService.saveAndShare — error paths', () => {
  it('returns {ok:false, error} when sharing is unavailable', async () => {
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      makeShareFn('unavailable'),
    );
    const result = await service.saveAndShare(JSON_CONTENT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it('returns {ok:false, error} when writeFn throws (write failure)', async () => {
    const service = createAccountExportFileService(
      makeWriteFn('fail'),
      makeShareFn('ok'),
    );
    const result = await service.saveAndShare(JSON_CONTENT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Write failed');
    }
  });

  it('returns {ok:false, error} when shareFn throws (share failure)', async () => {
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      makeShareFn('fail'),
    );
    const result = await service.saveAndShare(JSON_CONTENT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it('does NOT call shareFn when writeFn fails (no partial success)', async () => {
    const shareCallCount = { n: 0 };
    const service = createAccountExportFileService(
      makeWriteFn('fail'),
      async () => { shareCallCount.n++; },
    );
    await service.saveAndShare(JSON_CONTENT);
    expect(shareCallCount.n).toBe(0);
  });
});

// ─── cleanup (best-effort delete after share) ─────────────────────────────────

describe('accountExportFileService.saveAndShare — cleanup', () => {
  it('does NOT call deleteFn while share is still in progress', async () => {
    const deleteSpy = jest.fn();
    let resolveShare!: () => void;

    const slowShare: ExportShareFn = (_uri) =>
      new Promise<void>((resolve) => {
        resolveShare = resolve;
      });

    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      slowShare,
      deleteSpy,
    );

    const promise = service.saveAndShare(JSON_CONTENT);

    // Allow write + share-pending to run
    await Promise.resolve();
    await Promise.resolve();

    // Delete must NOT have been called while share is pending
    expect(deleteSpy).not.toHaveBeenCalled();

    // Resolve the share
    resolveShare();
    await promise;
    // Flush the fire-and-forget deleteFn microtask
    await Promise.resolve();

    expect(deleteSpy).toHaveBeenCalledWith(FAKE_URI);
  });

  it('deleteFn is called with the fileUri after successful share', async () => {
    const deletedUris: string[] = [];
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      makeShareFn('ok'),
      async (uri: string) => { deletedUris.push(uri); },
    );
    await service.saveAndShare(JSON_CONTENT);
    // Flush fire-and-forget
    await Promise.resolve();
    expect(deletedUris).toEqual([FAKE_URI]);
  });

  it('swallows deleteFn errors — cleanup failure does not propagate to caller', async () => {
    const failingDelete: ExportDeleteFn = async () => {
      throw new Error('Delete failed: permission denied');
    };
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      makeShareFn('ok'),
      failingDelete,
    );
    const result = await service.saveAndShare(JSON_CONTENT);
    // The cleanup failure must NOT surface as an error
    expect(result.ok).toBe(true);
  });

  it('does NOT call deleteFn when writeFn fails (nothing written)', async () => {
    const deleteSpy = jest.fn();
    const service = createAccountExportFileService(
      makeWriteFn('fail'),
      makeShareFn('ok'),
      deleteSpy,
    );
    await service.saveAndShare(JSON_CONTENT);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

// ─── onSharing callback ───────────────────────────────────────────────────────

describe('accountExportFileService.saveAndShare — onSharing callback', () => {
  it('fires onSharing callback AFTER write but BEFORE share resolves', async () => {
    const order: string[] = [];
    let shareResolveFn!: () => void;

    const writeFn: ExportWriteFn = async (json) => {
      order.push(`write:${json.length}`);
      return FAKE_URI;
    };

    const shareFn: ExportShareFn = () =>
      new Promise<void>((resolve) => {
        order.push('share-start');
        shareResolveFn = () => {
          order.push('share-end');
          resolve();
        };
      });

    const service = createAccountExportFileService(writeFn, shareFn);

    const promise = service.saveAndShare(JSON_CONTENT, () => {
      order.push('onSharing');
    });

    // Let write + share-start run
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toContain('write:' + JSON_CONTENT.length);
    expect(order).toContain('share-start');
    expect(order).toContain('onSharing');
    // onSharing must have been called before share-end
    expect(order.indexOf('onSharing')).toBeLessThan(order.indexOf('share-end') === -1 ? Infinity : order.indexOf('share-end'));

    shareResolveFn();
    await promise;
    expect(order).toContain('share-end');
  });
});

// ─── security ────────────────────────────────────────────────────────────────

describe('accountExportFileService — security (AR-AC-22, AR-AC-24)', () => {
  it('does NOT log the json content to console.log', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      makeShareFn('ok'),
    );
    await service.saveAndShare(JSON_CONTENT);
    const logged = logSpy.mock.calls.flat().join('');
    expect(logged).not.toContain(JSON_CONTENT);
    logSpy.mockRestore();
  });

  it('does NOT log the json content to console.debug or console.warn', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = createAccountExportFileService(
      makeWriteFn('ok'),
      makeShareFn('ok'),
    );
    await service.saveAndShare(JSON_CONTENT);
    const logged = [...debugSpy.mock.calls.flat(), ...warnSpy.mock.calls.flat()].join('');
    expect(logged).not.toContain(JSON_CONTENT);
    debugSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
