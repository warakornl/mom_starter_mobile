/**
 * manageConsentsToggle.rntl.test.tsx
 *
 * Owner-reported bug #3 (2026-07, HIGHEST PRIORITY): toggling a consent ON
 * in "จัดการความยินยอม" (ManageConsentsScreen) errored EVERY time — uniformly,
 * across every consent type.
 *
 * ROOT CAUSE (systematic-debugging Phase 1):
 *   ManageConsentsScreen's own toggle handler (postConsentChange) is correct.
 *   The bug is one level down, in consentApiClient.ts's `postConsent`: it
 *   gated success on the EXACT literal `res.status === 201`, instead of
 *   `res.ok` (the full 2xx range) — the convention every OTHER mutating
 *   client in this codebase uses (pregnancyApiClient's PUT /v1/pregnancy-profile
 *   gates on `res.ok` and only uses `res.status === 201` as a secondary
 *   `created` flag; accountApiClient does the same). Any real backend
 *   response that is a legitimate 2xx but not exactly 201 (e.g. 200 OK) made
 *   the client treat EVERY successful POST as a failure — for every consent
 *   type, uniformly, exactly matching the report.
 *
 *   NO test in the repo previously rendered this screen, pressed a real
 *   toggle, and asserted the resulting UI state against a mocked HTTP
 *   response — "manageConsentsScreen.test.ts" only exercises pure helper
 *   functions (ROW_TOGGLE_TESTID, consentTextVersion, etc.), never the
 *   component's actual onPress handler or the real fetch call it makes.
 *
 * FIX: consentApiClient.postConsent now gates success on `res.ok`
 *   (src/consent/consentApiClient.ts) — see consentApiClient.test.ts for the
 *   client-level fail-on-revert test. This file proves the SAME fix at the
 *   full component level: a real render, a real press on the real <Switch>,
 *   against a mocked 200-OK response, must succeed (no error row) — this is
 *   the exact end-to-end reproduction of what the owner saw.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ManageConsentsScreen } from './ManageConsentsScreen';
import { consentStore } from '../consent/consentStore';
import { consentQueue } from '../consent/consentSync';
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

describe('ManageConsentsScreen — toggle ON', () => {
  beforeEach(() => {
    consentStore.reset();
    // Seed local store so the screen renders 'loaded' immediately (no skeleton GET).
    consentStore.setGranted('general_health', false, 'v1.0-th');
    jest.clearAllMocks();
    (TOKEN_STORAGE.load as jest.Mock).mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    });
  });

  it('SUCCEEDS (no error row) when the real toggle handler runs against a mocked-success API', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(201, {
        id: 'rec-1',
        consentType: 'general_health',
        granted: true,
        consentTextVersion: 'v1.0-th',
        grantedAt: new Date().toISOString(),
      }),
    );
    global.fetch = fetchMock;

    render(
      <LanguageProvider>
        <ManageConsentsScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    // The Switch itself is accessibilityElementsHidden (the parent row carries
    // the a11y label/role instead), so it must be queried with
    // includeHiddenElements — this is still the REAL <Switch> host element and
    // fireEvent still dispatches its real onValueChange handler.
    const toggle = await screen.findByTestId('consent-manage-toggle-general-health', {
      includeHiddenElements: true,
    });
    fireEvent(toggle, 'valueChange', true);

    // Real POST must actually have been dispatched to the real endpoint.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.test.invalid/v1/account/consents',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // The row must settle back to idle with NO error panel — this is the
    // exact assertion that was missing and would have caught bug #3.
    await waitFor(() => {
      expect(screen.queryByTestId('consent-manage-row-error-general-health')).toBeNull();
    });
    expect(consentStore.isGranted('general_health')).toBe(true);
  });

  it('SUCCEEDS on a real backend 200 OK response (not just 201) — the exact bug #3 reproduction', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'rec-2',
        consentType: 'general_health',
        granted: true,
        consentTextVersion: 'v1.0-th',
        grantedAt: new Date().toISOString(),
      }),
    );
    global.fetch = fetchMock;

    render(
      <LanguageProvider>
        <ManageConsentsScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    const toggle = await screen.findByTestId('consent-manage-toggle-general-health', {
      includeHiddenElements: true,
    });
    fireEvent(toggle, 'valueChange', true);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Before the fix: a 200 response was wrongly treated as a failure and
    // this error row would appear even though the server actually succeeded.
    await waitFor(() => {
      expect(screen.queryByTestId('consent-manage-row-error-general-health')).toBeNull();
    });
    expect(consentStore.isGranted('general_health')).toBe(true);
  });

  it('shows the row error state on a genuine API failure (5xx) — not swallowed as a false success', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(500, { code: 'internal_error', message: 'boom' }),
    );
    global.fetch = fetchMock;

    render(
      <LanguageProvider>
        <ManageConsentsScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    // The Switch itself is accessibilityElementsHidden (the parent row carries
    // the a11y label/role instead), so it must be queried with
    // includeHiddenElements — this is still the REAL <Switch> host element and
    // fireEvent still dispatches its real onValueChange handler.
    const toggle = await screen.findByTestId('consent-manage-toggle-general-health', {
      includeHiddenElements: true,
    });
    fireEvent(toggle, 'valueChange', true);

    await waitFor(() => {
      expect(screen.getByTestId('consent-manage-row-error-general-health')).toBeTruthy();
    });

    // Queued for background retry (offline-first contract) — NOT silently dropped.
    expect(consentQueue.hasPendingEntry('general_health', true)).toBe(true);
  });
});

// ─── mobile-reviewer fix (cluster 6 review): footer policy/history rows ──────
//
// consent-manage-policy-link and consent-manage-history-link previously had
// accessibilityRole="link" with no onPress and no navigable target — a dead,
// misleading affordance for screen-reader users. They must now render as
// plain, non-interactive text (no "link" role) until the PrivacyPolicy /
// ConsentHistory routes exist (see report).
describe('ManageConsentsScreen — footer policy/history rows (no dead link role)', () => {
  it('renders the policy and history rows as plain text — NOT accessibilityRole="link"', async () => {
    render(
      <LanguageProvider>
        <ManageConsentsScreen
          tokenStorage={TOKEN_STORAGE}
          apiBaseUrl="https://api.test.invalid"
          onBack={jest.fn()}
        />
      </LanguageProvider>,
    );

    const policyRow = await screen.findByTestId('consent-manage-policy-link');
    const historyRow = await screen.findByTestId('consent-manage-history-link');

    expect(policyRow.props.accessibilityRole).not.toBe('link');
    expect(historyRow.props.accessibilityRole).not.toBe('link');
    // Also must not be reachable via getByRole('link') — proves no dead
    // link-role affordance is exposed to assistive tech.
    expect(screen.queryByRole('link')).toBeNull();
  });
});
