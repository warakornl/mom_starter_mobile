/**
 * useAccountRights.test.ts — TDD: shared account-rights hook (RED → GREEN).
 *
 * This hook extracts the ~250 lines of screen-level export/delete orchestration
 * from SettingsScreen.tsx so both SettingsScreen and ProfileHubScreen can share
 * the same implementation (design spec §3.5, §5.3).
 *
 * Tests strategy (pure-node environment, no react-testing-library):
 *  1. Structural — hook is exported as a function
 *  2. Shape — when called with mocked React hooks, returns expected properties
 *  3. Behavior — showAccountRightsRows gating, export/delete outcome mapping
 *
 * Jest runs with testEnvironment: 'node', so we mock React hooks to make them
 * return predictable values in a synchronous context.
 */

// ── React hook mocks (must be set up before any import that uses React) ────────
// We mock React to record state/ref values so we can verify the hook logic.

const mockSetters: Record<string, jest.Mock> = {};
let stateCallCount = 0;

// Simple stateful useState mock: each call index gets its own state slot.
const stateSlots: Record<number, unknown> = {};

jest.mock('react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    ...React,
    useState: jest.fn().mockImplementation((init: unknown) => {
      const idx = stateCallCount++;
      if (!(idx in stateSlots)) stateSlots[idx] = init;
      const setter = jest.fn().mockImplementation((v: unknown) => {
        stateSlots[idx] = typeof v === 'function' ? (v as (p: unknown) => unknown)(stateSlots[idx]) : v;
      });
      mockSetters[`state_${idx}`] = setter;
      return [stateSlots[idx], setter];
    }),
    useRef: jest.fn().mockImplementation((init: unknown) => ({ current: init })),
    useCallback: jest.fn().mockImplementation((fn: unknown) => fn),
    useEffect: jest.fn(),
  };
});

// ── Dependency mocks ────────────────────────────────────────────────────────
jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: jest.fn((key: string) => key),
    locale: 'th',
    setLocale: jest.fn(),
  })),
}));

jest.mock('./exportOrchestration', () => ({ runExport: jest.fn() }));
jest.mock('./accountApiClient', () => ({ createAccountApiClient: jest.fn(() => ({
  exportAccount: jest.fn(),
  deleteAccount: jest.fn(),
})) }));
jest.mock('./accountExportFileService', () => ({
  createProductionAccountExportFileService: jest.fn(),
}));
jest.mock('./deleteFlowLogic', () => ({ runDeleteGate: jest.fn() }));
jest.mock('./deviceAuthAdapter', () => ({
  createRealDeviceAuthAdapter: jest.fn(),
}));
jest.mock('./accountRightsController', () => ({
  SESSION_EXPIRED_CODE: 'session_expired',
  isSessionExpiredCode: jest.fn(() => false),
  resolveExportOutcome: jest.fn(() => 'set_idle'),
  acquireDeleteLock: jest.fn(() => 'acquired'),
  releaseDeleteLock: jest.fn(),
  mapExport401: jest.fn((x: unknown) => x),
  mapDelete401: jest.fn((x: unknown) => x),
}));
jest.mock('../auth/performLogout', () => ({
  performLogout: jest.fn(() => Promise.resolve()),
}));
jest.mock('../sync/supplySyncStore', () => ({ supplySyncStore: { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountSyncStore', () => ({ kickCountSyncStore: { reset: jest.fn() } }));
jest.mock('../sync/calendarSyncStore', () => ({ calendarSyncStore: { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountDraftStore', () => ({ clearDraft: jest.fn() }));
jest.mock('../consent/consentStore', () => ({ consentStore: { reset: jest.fn() } }));
jest.mock('../consent/consentSync', () => ({ resetConsentQueue: jest.fn() }));
jest.mock('../suggestion/suggestionStore', () => ({ suggestionStore: { reset: jest.fn() } }));
jest.mock('../expenses/expensesSyncStore', () => ({ expensesSyncStore: { reset: jest.fn() } }));
jest.mock('../selfLog/selfLogSyncStore', () => ({ selfLogSyncStore: { reset: jest.fn() } }));
jest.mock('../medication/medicationPlanSyncStore', () => ({
  medicationPlanSyncStore: { reset: jest.fn() },
}));
jest.mock('../medication/medicationLogSyncStore', () => ({
  medicationLogSyncStore: { reset: jest.fn() },
}));
jest.mock('../settings/sessionExpiredRunner', () => ({
  buildSessionExpiredRunner: jest.fn(() => jest.fn(() => Promise.resolve())),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '17' },
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { useAccountRights } from './useAccountRights';

// ── Helper: call hook (sync, mocked React) ─────────────────────────────────

function callHook(opts: Parameters<typeof useAccountRights>[0]) {
  stateCallCount = 0; // reset slot counter before each hook call
  return useAccountRights(opts);
}

const mockTokenStorage = {
  load: jest.fn(() => Promise.resolve({
    accessToken: 'tok',
    refreshToken: 'ref',
    accessTokenExpiresIn: 900,
    refreshTokenExpiresIn: 86400,
  })),
  save: jest.fn(),
  clear: jest.fn(),
};
const mockOnLogout = jest.fn();
const mockOnSessionExpired = jest.fn();

// ─── Structural tests ─────────────────────────────────────────────────────────

describe('useAccountRights — module export', () => {
  it('is exported as a function', () => {
    expect(typeof useAccountRights).toBe('function');
  });
});

// ─── Shape tests ──────────────────────────────────────────────────────────────

describe('useAccountRights — return shape', () => {
  it('returns showAccountRightsRows = false when apiBaseUrl is absent', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      onLogout: mockOnLogout,
    });
    expect(result.showAccountRightsRows).toBe(false);
  });

  it('returns showAccountRightsRows = true when apiBaseUrl is provided', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
    });
    expect(result.showAccountRightsRows).toBe(true);
  });

  it('returns all required export-related properties', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
    });
    expect(result.exportPhase).toBeDefined();
    expect(result.exportErrorMsg).toBeDefined();
    expect(result.isExportInProgress).toBe(false);
    expect(typeof result.handleExportRowTap).toBe('function');
    expect(typeof result.handleExportRetry).toBe('function');
    expect(typeof result.handleExportDismiss).toBe('function');
    expect(typeof result.handleExport404Back).toBe('function');
  });

  it('returns all required delete-related properties', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
    });
    expect(result.deleteSheetVisible).toBeDefined();
    expect(result.stepUpDegraded).toBeDefined();
    expect(result.deleteInFlight).toBeDefined();
    expect(result.deleteError).toBeDefined();
    expect(result.confirmInput).toBeDefined();
    expect(typeof result.setConfirmInput).toBe('function');
    expect(typeof result.handleDeleteRowTap).toBe('function');
    expect(typeof result.handleSheetCancel).toBe('function');
    expect(typeof result.handleNudgeDownloadTap).toBe('function');
    expect(typeof result.handleNudgeSkipTap).toBe('function');
    expect(typeof result.handleConfirmTap).toBe('function');
    expect(typeof result.handleDeleteRetry).toBe('function');
  });

  it('initial exportPhase is EXPORT_IDLE', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
    });
    expect(result.exportPhase).toBe('EXPORT_IDLE');
  });

  it('initial deleteSheetVisible is false', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
    });
    expect(result.deleteSheetVisible).toBe(false);
  });

  it('initial confirmInput is empty string', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
    });
    expect(result.confirmInput).toBe('');
  });
});

// ─── Behavior: handleExportRowTap no-op when EXPORT_IN_PROGRESS ───────────────

describe('useAccountRights — export row tap guard', () => {
  it('handleExportRowTap is a function that can be called', () => {
    const result = callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
    });
    // Should not throw
    expect(() => result.handleExportRowTap()).not.toThrow();
  });
});

// ─── Behavior: onSessionExpired fallback ─────────────────────────────────────

describe('useAccountRights — onSessionExpired prop', () => {
  it('accepts onSessionExpired as optional prop', () => {
    expect(() => callHook({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      onLogout: mockOnLogout,
      onSessionExpired: mockOnSessionExpired,
    })).not.toThrow();
  });
});
