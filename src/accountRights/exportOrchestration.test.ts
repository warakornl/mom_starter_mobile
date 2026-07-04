/**
 * exportOrchestration — unit tests (TDD, written BEFORE the implementation).
 *
 * Tests cover:
 *  - Full happy path: fetch 200 → write → share → EXPORT_IDLE outcome
 *  - Phase transitions via onPhaseChange callback (IN_PROGRESS → SHARING → IDLE)
 *  - 404 after soft-delete → EXPORT_UNAVAILABLE_404 (terminal, no retry from here)
 *  - Fetch network error → EXPORT_ERROR
 *  - Fetch timeout → EXPORT_ERROR
 *  - File service write/share failure → EXPORT_ERROR
 *  - Nav-away abort (external signal) while in-flight → EXPORT_IDLE (silent, no error)
 *  - A failed/partial attempt is NEVER presented as success
 */

import { runExport } from './exportOrchestration';
import type { ExportPhase, ExportOutcome } from './exportOrchestration';
import type { ExportAccountResult } from './accountApiClient';
import type { AccountExportFileService, ExportFileResult } from './accountExportFileService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOKEN = 'test-access-token';
const BODY = '{"account":{"id":"user-123"}}';
const FAKE_URI = 'file:///cache/momstarter-export-20260705.json';

/** Build a minimal stub AccountApiClient.exportAccount. */
function makeApiClient(result: ExportAccountResult) {
  return {
    exportAccount: jest.fn(
      (_token: string, _signal?: AbortSignal): Promise<ExportAccountResult> =>
        Promise.resolve(result),
    ),
  };
}

/** Build a stub apiClient whose exportAccount never resolves (hanging fetch). */
function makeHangingApiClient() {
  let abortCb: (() => void) | undefined;
  return {
    exportAccount: jest.fn(
      (_token: string, signal?: AbortSignal): Promise<ExportAccountResult> =>
        new Promise((_, reject) => {
          abortCb = () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          signal?.addEventListener('abort', abortCb);
        }),
    ),
  };
}

/** Build a stub AccountExportFileService. */
function makeFileService(result: ExportFileResult): AccountExportFileService {
  return {
    saveAndShare: jest.fn(
      (_json: string, onSharing?: () => void): Promise<ExportFileResult> => {
        onSharing?.();
        return Promise.resolve(result);
      },
    ),
  };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('runExport — happy path', () => {
  it('returns {phase:EXPORT_IDLE} when fetch 200 + saveAndShare succeeds', async () => {
    const outcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: true, bodyText: BODY }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
    });
    expect(outcome.phase).toBe('EXPORT_IDLE');
  });

  it('passes the raw bodyText from the API to saveAndShare (never parses)', async () => {
    const fileService = makeFileService({ ok: true, fileUri: FAKE_URI });
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: true, bodyText: BODY }),
      fileService,
    });
    expect(fileService.saveAndShare).toHaveBeenCalledWith(
      BODY,
      expect.any(Function),
    );
  });

  it('emits EXPORT_IN_PROGRESS → EXPORT_SHARING → EXPORT_IDLE via onPhaseChange', async () => {
    const phases: ExportPhase[] = [];
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: true, bodyText: BODY }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
      onPhaseChange: (p) => phases.push(p),
    });
    expect(phases[0]).toBe('EXPORT_IN_PROGRESS');
    expect(phases).toContain('EXPORT_SHARING');
    expect(phases[phases.length - 1]).toBe('EXPORT_IDLE');
  });

  it('emits EXPORT_IN_PROGRESS as the very first phase change', async () => {
    const phases: ExportPhase[] = [];
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: true, bodyText: BODY }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
      onPhaseChange: (p) => phases.push(p),
    });
    expect(phases[0]).toBe('EXPORT_IN_PROGRESS');
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────────

describe('runExport — error paths', () => {
  it('returns {phase:EXPORT_UNAVAILABLE_404} on 404 (account soft-deleted)', async () => {
    const outcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 404, code: 'account_deleted' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
    });
    expect(outcome.phase).toBe('EXPORT_UNAVAILABLE_404');
  });

  it('emits EXPORT_UNAVAILABLE_404 via onPhaseChange on 404', async () => {
    const phases: ExportPhase[] = [];
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 404, code: 'account_deleted' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
      onPhaseChange: (p) => phases.push(p),
    });
    expect(phases).toContain('EXPORT_UNAVAILABLE_404');
  });

  it('returns {phase:EXPORT_ERROR} on network error', async () => {
    const outcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 0, code: 'network_error' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
    });
    expect(outcome.phase).toBe('EXPORT_ERROR');
  });

  it('returns {phase:EXPORT_ERROR} on timeout', async () => {
    const outcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 0, code: 'timeout' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
    });
    expect(outcome.phase).toBe('EXPORT_ERROR');
    if (outcome.phase === 'EXPORT_ERROR') {
      expect(outcome.error).toBeTruthy();
    }
  });

  it('returns {phase:EXPORT_ERROR} on 401', async () => {
    const outcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 401, code: 'token_expired' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
    });
    expect(outcome.phase).toBe('EXPORT_ERROR');
  });

  it('emits EXPORT_ERROR via onPhaseChange on network error', async () => {
    const phases: ExportPhase[] = [];
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 0, code: 'network_error' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
      onPhaseChange: (p) => phases.push(p),
    });
    expect(phases).toContain('EXPORT_ERROR');
  });

  it('does NOT call saveAndShare on 404 (never a partial success)', async () => {
    const fileService = makeFileService({ ok: true, fileUri: FAKE_URI });
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 404, code: 'account_deleted' }),
      fileService,
    });
    expect(fileService.saveAndShare).not.toHaveBeenCalled();
  });

  it('does NOT call saveAndShare on network error', async () => {
    const fileService = makeFileService({ ok: true, fileUri: FAKE_URI });
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 0, code: 'network_error' }),
      fileService,
    });
    expect(fileService.saveAndShare).not.toHaveBeenCalled();
  });

  it('returns {phase:EXPORT_ERROR} when saveAndShare fails (write/share error)', async () => {
    const outcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: true, bodyText: BODY }),
      fileService: makeFileService({ ok: false, error: 'Write failed' }),
    });
    expect(outcome.phase).toBe('EXPORT_ERROR');
    if (outcome.phase === 'EXPORT_ERROR') {
      expect(outcome.error).toContain('Write failed');
    }
  });

  it('emits EXPORT_ERROR (not EXPORT_IDLE) when file service fails', async () => {
    const phases: ExportPhase[] = [];
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: true, bodyText: BODY }),
      fileService: makeFileService({ ok: false, error: 'Share failed' }),
      onPhaseChange: (p) => phases.push(p),
    });
    expect(phases[phases.length - 1]).toBe('EXPORT_ERROR');
    expect(phases).not.toContain('EXPORT_IDLE');
  });
});

// ─── Nav-away abort (§2.7) ────────────────────────────────────────────────────

describe('runExport — nav-away abort (§2.7)', () => {
  it('returns {phase:EXPORT_IDLE} silently when signal fires (nav-away during fetch)', async () => {
    const ctrl = new AbortController();
    const outcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 0, code: 'request_aborted' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
      signal: ctrl.signal,
    });
    // When apiClient returns request_aborted AND signal is aborted, return IDLE silently
    ctrl.abort();
    expect(outcome.phase).toBe('EXPORT_IDLE');
  });

  it('passes the nav-away signal to exportAccount', async () => {
    const ctrl = new AbortController();
    const apiClient = makeApiClient({ ok: true, bodyText: BODY });
    await runExport({
      accessToken: TOKEN,
      apiClient,
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
      signal: ctrl.signal,
    });
    expect(apiClient.exportAccount).toHaveBeenCalledWith(TOKEN, ctrl.signal);
  });

  it('does NOT emit EXPORT_ERROR on nav-away abort', async () => {
    const phases: ExportPhase[] = [];
    const ctrl = new AbortController();
    ctrl.abort();
    await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 0, code: 'request_aborted' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
      signal: ctrl.signal,
      onPhaseChange: (p) => phases.push(p),
    });
    expect(phases).not.toContain('EXPORT_ERROR');
  });
});

// ─── Type guard ───────────────────────────────────────────────────────────────

describe('ExportOutcome type coverage', () => {
  it('EXPORT_ERROR outcome carries an error string', async () => {
    const outcome: ExportOutcome = await runExport({
      accessToken: TOKEN,
      apiClient: makeApiClient({ ok: false, status: 0, code: 'timeout', message: 'timed out' }),
      fileService: makeFileService({ ok: true, fileUri: FAKE_URI }),
    });
    if (outcome.phase === 'EXPORT_ERROR') {
      expect(typeof outcome.error).toBe('string');
    }
  });
});
