/**
 * PregnancyProfileContext — lightweight context for sharing the loaded
 * pregnancy profile snapshot across the kick-count (and future) screens.
 *
 * Design decision:
 *   HomeScreen loads the profile and calls onProfileLoaded (injected by the
 *   navigator). The navigator holds the snapshot in React state and passes it
 *   as props to KickCount screens via render-prop children (consistent with
 *   how all other screens receive props today — no "magic" context reads).
 *
 *   This context is provided by RootNavigator as the single source-of-truth
 *   for the current profile and consent state for the current session.
 *
 * Why not pass via route params?
 *   KickCountHome is paramless (types.ts). Route params would require
 *   serializable data and break the existing navigation type contract.
 *
 * Security: only civil dates and numeric values are stored here.
 *   No tokens, no raw health measurements, no identifiers beyond EDD.
 */

import React, { createContext, useContext } from 'react';
import type { Lifecycle } from './types';

// ─── Snapshot shape ───────────────────────────────────────────────────────────

/**
 * Subset of the pregnancy profile needed by kick-count (and future) screens.
 * Derived from PregnancyProfile by RootNavigator after HomeScreen loads it.
 */
export interface ProfileSnapshot {
  /** Client-derived completed gestational weeks (Math.floor). */
  gestationalWeek: number;
  /** Civil EDD "YYYY-MM-DD" — used to derive week at session start. */
  edd: string;
  /** Device-local civil today "YYYY-MM-DD" when the snapshot was taken. */
  todayCivil: string;
  /** Lifecycle state ('pregnant' | 'postpartum'). */
  lifecycle: Lifecycle;
  /**
   * Whether the user has granted general_health consent.
   * TODO (carry-forward): wire to actual consent storage once the Consent
   * screen (between VerifyEmail and ProfileSetup) is built. Currently
   * defaults to true (feature is usable) with the gate logic preserved
   * inside each screen.
   */
  generalHealthConsented: boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PregnancyProfileContext = createContext<ProfileSnapshot | null>(null);

/** Provide the profile snapshot to all descendants. Used in RootNavigator. */
export const PregnancyProfileProvider = PregnancyProfileContext.Provider;

/**
 * Read the current profile snapshot.
 * Returns null before HomeScreen has loaded the profile (e.g. during auth flow).
 */
export function useProfileSnapshot(): ProfileSnapshot | null {
  return useContext(PregnancyProfileContext);
}
