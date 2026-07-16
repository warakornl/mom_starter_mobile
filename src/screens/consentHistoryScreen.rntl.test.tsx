/**
 * consentHistoryScreen.rntl.test.tsx — real render, real fetch mock (task #40).
 *
 * ConsentHistoryScreen was a dead footer link on ManageConsentsScreen. This
 * proves the REAL screen actually calls the REAL consent API client
 * (GET /v1/account/consents) and renders each state — loading, success (with
 * items sorted most-recent-first), EMPTY, and ERROR (+ retry) — per the
 * testing craft heuristic (loading/success/ERROR/EMPTY, not just happy-path).
 *
 * Mocks BOUNDARIES only (global.fetch) — never the component's own logic.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ConsentHistoryScreen } from './ConsentHistoryScreen';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { TokenStorage } from '../auth/tokenStorage';

const TOKEN_STORAGE: TokenStorage = {
  save: jest.fn().mockResolvedValue(undefined),
  load: jest.fn().mockResolvedValue({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
  }),
  clear: jest.fn().mockResolvedValue(undefined),
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  (TOKEN_STORAGE.load as jest.Mock).mockResolvedValue({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
  });
});

describe('ConsentHistoryScreen — loading state', () => {
  it('renders the skeleton while the GET is in flight', async () => {
    let resolveFetch: (v: Response) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    render(
      <LanguageProvider>
        <ConsentHistoryScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('consent-history-screen-skeleton')).toBeTruthy();

    // Resolve so the pending promise doesn't leak into the next test.
    resolveFetch(jsonResponse(200, { items: [], nextCursor: null }));
    await waitFor(() => {
      expect(screen.queryByTestId('consent-history-screen-skeleton')).toBeNull();
    });
  });
});

describe('ConsentHistoryScreen — success state (real GET, real render)', () => {
  it('calls the REAL endpoint GET /v1/account/consents with the Bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(200, { items: [], nextCursor: null }),
    );
    global.fetch = fetchMock;

    render(
      <LanguageProvider>
        <ConsentHistoryScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.test.invalid/v1/account/consents',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
        }),
      );
    });
  });

  it('renders items sorted most-recent-first with type/state/date', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: 'rec-1',
            consentType: 'general_health',
            granted: true,
            consentTextVersion: 'v1.0-th',
            grantedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'rec-2',
            consentType: 'cloud_storage',
            granted: false,
            consentTextVersion: 'v1.0-th',
            grantedAt: '2026-03-01T00:00:00Z',
          },
        ],
        nextCursor: null,
      }),
    );

    render(
      <LanguageProvider>
        <ConsentHistoryScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    const rows = await screen.findAllByTestId('consent-history-item');
    expect(rows).toHaveLength(2);
    // Most recent (2026-03-01, cloud_storage/withdrawn) must render FIRST.
    expect(rows[0].props.accessibilityLabel).toMatch(/ถอนความยินยอม/);
  });
});

describe('ConsentHistoryScreen — EMPTY state', () => {
  it('renders the empty message when the history has zero items', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, { items: [], nextCursor: null }),
    );

    render(
      <LanguageProvider>
        <ConsentHistoryScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consent-history-empty')).toBeTruthy();
    });
    expect(screen.getByText('ยังไม่มีประวัติความยินยอม')).toBeTruthy();
  });
});

describe('ConsentHistoryScreen — ERROR state + retry', () => {
  it('renders the error panel when the GET fails, and retry re-fetches successfully', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: 'server_error', message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [], nextCursor: null }));
    global.fetch = fetchMock;

    render(
      <LanguageProvider>
        <ConsentHistoryScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consent-history-screen-load-error')).toBeTruthy();
    });

    const retryBtn = screen.getByTestId('consent-history-screen-load-retry-btn');
    fireEvent.press(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('consent-history-screen-load-error')).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renders the error panel when the fetch itself throws (network_error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

    render(
      <LanguageProvider>
        <ConsentHistoryScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('consent-history-screen-load-error')).toBeTruthy();
    });
  });
});

describe('ConsentHistoryScreen — back navigation', () => {
  it('calls onBack when the back row is pressed', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, { items: [], nextCursor: null }),
    );
    const onBack = jest.fn();

    render(
      <LanguageProvider>
        <ConsentHistoryScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={onBack}
        />
      </LanguageProvider>,
    );

    // Wait for the screen to settle past the skeleton (avoids grabbing the
    // skeleton-state back button, which unmounts once the GET resolves).
    await waitFor(() => {
      expect(screen.getByTestId('consent-history-screen')).toBeTruthy();
    });

    const backBtn = screen.getByRole('button', { name: 'กลับ' });
    fireEvent.press(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
