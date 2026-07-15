/**
 * kickCountHomeRetry.rntl.test.tsx
 *
 * UX/UI review fix (Cluster 4): KickCountHomeScreen's error-state retry button
 * called setScreenState('loading') but the init effect's deps ([lifecycle,
 * syncPull]) never changed on retry — so the screen was stuck on the loading
 * skeleton forever after a real retry press. No test in the repo previously
 * rendered this screen with a REAL failing store call and pressed the REAL
 * retry button, so the dead-retry bug shipped silently (see
 * docs: green-tests-can-hide-a-shell).
 *
 * FIX: a retryCount state is bumped by the retry press and added to the init
 * effect's dependency array, so pressing retry actually re-invokes init().
 *
 * This test renders the REAL component (no react/react-native mocks), forces
 * loadDraft() to reject once (driving the screen into the error state), then
 * makes it resolve, presses the real retry button, and asserts the screen
 * recovers to the ready state — a fail-on-revert guard against the dead retry.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

import { KickCountHomeScreen } from './KickCountHomeScreen';
import { LanguageProvider } from '../i18n/LanguageContext';

jest.mock('./kickCountDraftStore', () => ({
  loadDraft: jest.fn(),
}));

jest.mock('./kickCountSyncStore', () => ({
  kickCountSyncStore: {
    getWatermark: jest.fn(() => undefined),
    reset: jest.fn(),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createKickCountSyncClient: jest.fn(() => ({ pull: jest.fn(), push: jest.fn() })),
}));

import { loadDraft } from './kickCountDraftStore';

const baseProps = {
  gestationalWeek: 34,
  lifecycle: 'pregnant' as const,
  generalHealthConsented: true,
  onRequestConsent: jest.fn(),
};

describe('KickCountHomeScreen — retry actually re-triggers init (fail-on-revert)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recovers from the error state to ready after pressing retry (REAL press, REAL re-fetch)', async () => {
    (loadDraft as jest.Mock).mockRejectedValueOnce(new Error('store unavailable'));

    render(
      <NavigationContainer>
        <LanguageProvider>
          <KickCountHomeScreen {...baseProps} />
        </LanguageProvider>
      </NavigationContainer>,
    );

    // First mount: loadDraft rejects → error state
    await waitFor(() => {
      expect(screen.getByTestId('kick-home-error')).toBeTruthy();
    });

    // Second call (post-retry) succeeds
    (loadDraft as jest.Mock).mockResolvedValueOnce(null);

    const retryBtn = await screen.findByRole('button', { name: /ลองอีกครั้ง|retry/i });
    fireEvent.press(retryBtn);

    // FAIL-ON-REVERT: without the retryCount-in-deps fix, this never resolves —
    // the screen stays on 'loading' forever because init() never re-runs.
    await waitFor(() => {
      expect(screen.getByTestId('kick-home-ready')).toBeTruthy();
    });

    // loadDraft must have been called again (real re-trigger, not a stale UI flip)
    expect((loadDraft as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
