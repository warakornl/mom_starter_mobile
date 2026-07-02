/**
 * useJitConsent — hook for feature screens that need JIT consent gating.
 *
 * Design ref: first-run-consent.md §3.2, §4.7
 *
 * Usage (example in FeedingLogScreen):
 *
 *   const jit = useJitConsent('infant_feeding', tokenStorage, apiBaseUrl);
 *
 *   if (jit.gate === 'general_health_needed') {
 *     return <GeneralHealthGateMessage />;
 *   }
 *   if (jit.gate === 'show_jit') {
 *     return (
 *       <JitConsentSheet
 *         type="infant_feeding"
 *         visible
 *         onGrant={jit.grant}
 *         onDecline={jit.decline}
 *         isLoading={jit.isLoading}
 *         error={jit.error}
 *         onRetry={jit.grant}
 *       />
 *     );
 *   }
 *   // gate === 'already_granted' — render the feature
 *
 * Return value:
 *   gate            — JitGateResult: 'already_granted' | 'general_health_needed' | 'show_jit'
 *   isLoading       — true while POST is in flight
 *   error           — non-null on POST failure
 *   grant()         — trigger consent POST granted:true; updates store + queue
 *   decline()       — record decline; no POST (ม.19: decline is not an error)
 *   parentalAttested     — current checkbox state (ม.20)
 *   setParentalAttested  — toggle the checkbox
 *   declined        — true after user tapped decline (show blocked inline)
 *
 * §4.7 dual-gate: for infant_feeding + child_health, if general_health is not
 * yet granted, gate returns 'general_health_needed'. Feature screen should show
 * the general_health JIT first.
 *
 * SECURITY: never logs accessToken; no health data in this hook.
 */

import { useState, useCallback } from 'react';

import type { TokenStorage } from '../auth/tokenStorage';
import type { Locale } from '../auth/types';
import { createConsentApiClient } from './consentApiClient';
import { consentStore } from './consentStore';
import { consentQueue } from './consentSync';
import { evaluateJitGate, type JitGateResult } from './jitConsentLogic';
import type { JitConsentType } from './jitConsentSheetLogic';
import {
  initialJitState,
  applyGrantSuccess,
  applyGrantError,
  applyDecline,
  applyPostStart,
} from './useJitConsentLogic';
import { useT } from '../i18n/LanguageContext';

// ─── Consent text version ─────────────────────────────────────────────────────

function consentTextVersion(locale: Locale): string {
  return locale === 'en' ? 'v1.0-en' : 'v1.0-th';
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseJitConsentReturn {
  /** Current gate evaluation result (re-computed on each render) */
  gate: JitGateResult;
  /** True while POST is in flight */
  isLoading: boolean;
  /** Non-null on POST failure */
  error: string | null;
  /** Call this to grant the consent (POST + optimistic store update) */
  grant: () => void;
  /** Call this when user declines (no POST — ม.19) */
  decline: () => void;
  /** Parental attestation checkbox state (ม.20; always starts false) */
  parentalAttested: boolean;
  /** Toggle the parental attestation checkbox */
  setParentalAttested: (v: boolean) => void;
  /** True after user declined — caller can show blocked inline message */
  declined: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useJitConsent(
  purpose: JitConsentType,
  tokenStorage: TokenStorage,
  apiBaseUrl: string,
): UseJitConsentReturn {
  const { locale } = useT();

  const [jitState, setJitState] = useState(initialJitState);

  // Re-evaluate gate on every render (store is synchronous, fail-closed)
  const gate = evaluateJitGate(purpose, (type) => consentStore.isGranted(type));

  // ── grant ──────────────────────────────────────────────────────────────────
  const grant = useCallback((): void => {
    const version = consentTextVersion(locale);

    // Optimistic update so gate re-evaluates to 'already_granted' immediately
    consentStore.setGranted(purpose, true, version);
    setJitState((prev) => applyPostStart(prev));

    void (async () => {
      try {
        const tokens = await tokenStorage.load();
        if (!tokens) throw new Error('no_tokens');
        const client = createConsentApiClient(apiBaseUrl);
        const result = await client.postConsent(purpose, true, version, tokens.accessToken);
        if (result.ok) {
          // Dequeue any queued entry for this grant so the badge clears and
          // drainConsentQueue does not re-POST a duplicate row (F1 fix).
          if (consentQueue.hasPendingEntry(purpose, true)) {
            consentQueue.removePending(purpose, true);
            void consentQueue.persist();
          }
          setJitState((prev) => applyGrantSuccess(prev));
        } else {
          // Queue for background retry; keep optimistic store state
          if (!consentQueue.hasPendingEntry(purpose, true)) {
            consentQueue.enqueue(purpose, true, version);
            void consentQueue.persist();
          }
          setJitState((prev) => applyGrantError(prev, 'save_failed'));
        }
      } catch {
        if (!consentQueue.hasPendingEntry(purpose, true)) {
          consentQueue.enqueue(purpose, true, version);
          void consentQueue.persist();
        }
        setJitState((prev) => applyGrantError(prev, 'save_failed'));
      }
    })();
  }, [purpose, locale, tokenStorage, apiBaseUrl]);

  // ── decline ────────────────────────────────────────────────────────────────
  const decline = useCallback((): void => {
    // No POST on decline (ม.19 — declining is not an error, not a network action)
    setJitState((prev) => applyDecline(prev));
  }, []);

  // ── setParentalAttested ────────────────────────────────────────────────────
  const setParentalAttested = useCallback((v: boolean): void => {
    setJitState((prev) => ({ ...prev, parentalAttested: v }));
  }, []);

  return {
    gate,
    isLoading:           jitState.isLoading,
    error:               jitState.error,
    grant,
    decline,
    parentalAttested:    jitState.parentalAttested,
    setParentalAttested,
    declined:            jitState.declined,
  };
}
