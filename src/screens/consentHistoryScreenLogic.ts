/**
 * consentHistoryScreenLogic — pure helpers for ConsentHistoryScreen.
 *
 * Extracted here so they can be unit-tested without importing React Native.
 *
 * Design: task #40 Part 2. Backed by the real endpoint
 * `GET /v1/account/consents` (api-contract.md: "consent history — supports
 * s.19 management UI"), already wired via consentApiClient.getConsents.
 *
 * SECURITY: ConsentRecord carries no health VALUES — only consent metadata
 * (type, granted boolean, text version, timestamp).
 */

import type { ConsentType, ConsentRecord } from '../consent/types';
import type { MessageKey } from '../i18n/messages';

// ─── Screen status type (mirrors manageConsentsScreenLogic's ScreenStatus) ────

export type HistoryScreenStatus = 'skeleton' | 'loaded' | 'error';

// ─── Consent type → title i18n key (reuses the same keys ManageConsentsScreen
//     already renders, so the history list reads consistently with S8) ───────

export const CONSENT_TYPE_TITLE_KEY: Record<ConsentType, MessageKey> = {
  general_health:        'consent.general_health.title',
  cloud_storage:         'consent.cloud_storage.title',
  pdf_egress:            'consent.pdf_egress.title',
  sensitive_lab_results: 'consent.sensitive_lab.title',
  infant_feeding:        'consent.infant_feeding.title',
  child_health:          'consent.child_health.title',
  // NOTE: ManageConsentsScreen.tsx's ROW_TITLE_KEY uses the string literal
  // 'consent.calendar_sync.title', which does NOT exist in the catalog (a
  // pre-existing gap there, out of this task's file scope — ManageConsentsScreen.tsx
  // is not in the #40 file set). This module uses the REAL catalog key so the
  // history screen doesn't repeat that miss.
  calendar_sync:         'calendarSync.title',
};

// ─── Granted / withdrawn label key ────────────────────────────────────────────

export function historyItemLabelKey(granted: boolean): MessageKey {
  return granted ? 'consent.history.item.granted' : 'consent.history.item.withdrawn';
}

// ─── Sort — most recent first ─────────────────────────────────────────────────

/**
 * Returns a NEW array sorted by grantedAt descending (most recent first).
 * Does not mutate the input (the caller may hold this array in React state).
 */
export function sortHistoryDescending(items: ConsentRecord[]): ConsentRecord[] {
  return [...items].sort((a, b) => (a.grantedAt < b.grantedAt ? 1 : a.grantedAt > b.grantedAt ? -1 : 0));
}

// ─── Civil-date extraction ─────────────────────────────────────────────────────

/**
 * Extracts the YYYY-MM-DD civil-date portion from a full ISO 8601 UTC
 * timestamp (e.g. "2026-03-15T10:30:00Z" → "2026-03-15"), so it can be passed
 * to formatCivilDate (which does the manual +543 Buddhist-era conversion for
 * th — see thai-typography-findings.md: Intl th-TH buddhistEra is [VERIFY]-
 * unreliable, so this codebase's formatCivilDate does the +543 by hand).
 */
export function civilDateFromGrantedAt(grantedAt: string): string {
  return grantedAt.slice(0, 10);
}
