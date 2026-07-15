/**
 * kickCountHistoryErrorAndNotFound.rntl.test.tsx
 *
 * UX/UI review fixes (Cluster 4 — Tracking):
 *   1. KickCountHistoryScreen: getActiveSessions() was an UNGUARDED read — a
 *      genuine store failure threw during render with no error state to catch
 *      it. Now guarded; a retry button re-triggers the read (fail-on-revert).
 *   2. KickCountHistoryScreen: offline pill now renders from a real `isOffline`
 *      prop (mirrors KickCountHomeScreen's existing pattern).
 *   3. KickCountDetailScreen / KickCountSummaryScreen: a missing/invalid
 *      sessionId previously stayed on the 'loading' skeleton forever. Both
 *      screens now show a distinct not-found state instead.
 *
 * These are REAL renders (no react/react-native mocks) with a real press on
 * the real retry button, proving the fixes are wired end-to-end.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

import { KickCountHistoryScreen } from './KickCountHistoryScreen';
import { KickCountDetailScreen } from './KickCountDetailScreen';
import { KickCountSummaryScreen } from './KickCountSummaryScreen';
import { LanguageProvider } from '../i18n/LanguageContext';
import { kickCountSyncStore } from './kickCountSyncStore';

jest.mock('./kickCountSyncStore', () => ({
  kickCountSyncStore: {
    getActiveSessions: jest.fn(),
    getSession: jest.fn(),
    getWatermark: jest.fn(() => undefined),
    reset: jest.fn(),
  },
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: jest.fn(),
  };
});

import { useRoute } from '@react-navigation/native';

describe('KickCountHistoryScreen — error + offline states (fail-on-revert)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseProps = {
    gestationalWeek: 34,
    lifecycle: 'pregnant' as const,
    generalHealthConsented: true,
    onRequestConsent: jest.fn(),
  };

  it('shows the error panel (not a crash) when getActiveSessions() throws, and retry recovers', async () => {
    (kickCountSyncStore.getActiveSessions as jest.Mock)
      .mockImplementationOnce(() => { throw new Error('store unavailable'); })
      .mockImplementationOnce(() => []);

    render(
      <NavigationContainer>
        <LanguageProvider>
          <KickCountHistoryScreen {...baseProps} />
        </LanguageProvider>
      </NavigationContainer>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kick-history-error')).toBeTruthy();
    });

    const retryBtn = await screen.findByTestId('kick-history-retry-btn');
    fireEvent.press(retryBtn);

    // FAIL-ON-REVERT: without the guard + retry-count fix, the screen either
    // crashes on the throwing read or never recovers from the error state.
    await waitFor(() => {
      expect(screen.getByTestId('kick-history-empty')).toBeTruthy();
    });
  });

  it('renders the offline pill in the empty state when isOffline=true', async () => {
    (kickCountSyncStore.getActiveSessions as jest.Mock).mockReturnValue([]);

    render(
      <NavigationContainer>
        <LanguageProvider>
          <KickCountHistoryScreen {...baseProps} isOffline />
        </LanguageProvider>
      </NavigationContainer>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kick-history-offline-pill')).toBeTruthy();
    });
  });
});

describe('KickCountDetailScreen — not-found state (fail-on-revert)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRoute as jest.Mock).mockReturnValue({ params: { sessionId: 'does-not-exist' } });
  });

  it('shows a distinct not-found state instead of an eternal loading skeleton', async () => {
    (kickCountSyncStore.getSession as jest.Mock).mockReturnValue(undefined);

    render(
      <NavigationContainer>
        <LanguageProvider>
          <KickCountDetailScreen />
        </LanguageProvider>
      </NavigationContainer>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kick-detail-not-found')).toBeTruthy();
    });
    // FAIL-ON-REVERT: the eternal-loading bug would leave this present forever.
    expect(screen.queryByTestId('kick-detail-loading')).toBeNull();
  });
});

describe('KickCountSummaryScreen — not-found state (fail-on-revert)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRoute as jest.Mock).mockReturnValue({ params: { sessionId: 'does-not-exist' } });
  });

  it('shows a distinct not-found state instead of an eternal loading skeleton', async () => {
    (kickCountSyncStore.getSession as jest.Mock).mockReturnValue(undefined);

    render(
      <NavigationContainer>
        <LanguageProvider>
          <KickCountSummaryScreen />
        </LanguageProvider>
      </NavigationContainer>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kick-summary-not-found')).toBeTruthy();
    });
    expect(screen.queryByTestId('kick-summary-loading')).toBeNull();
  });
});
