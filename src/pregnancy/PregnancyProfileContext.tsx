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

import React, { createContext, useContext, useState, useCallback } from 'react';
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
  /**
   * Civil birth date "YYYY-MM-DD" — present and non-null when lifecycle is
   * 'postpartum' and the server returned a birthDate.  null for pregnant
   * profiles and for postpartum profiles where the server did not supply one.
   *
   * Security: civil date only — no PHI beyond what is already in the snapshot.
   * NEVER passed via route params (PDPA SD-9); stays inside context.
   */
  birthDate?: string | null;
}

// ─── Read-only context ────────────────────────────────────────────────────────

const PregnancyProfileContext = createContext<ProfileSnapshot | null>(null);

/**
 * Setter context — provides a dispatcher to update the snapshot.
 * Separated from the read context so that components that only read
 * (KickCount*, Settings, DoctorPdf, Suggestions) don't re-render when
 * the setter reference changes.
 */
const PregnancyProfileSetterContext = createContext<
  ((snapshot: ProfileSnapshot) => void) | null
>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Combined provider that manages both the snapshot value AND the setter.
 * Replaces the bare `PregnancyProfileContext.Provider` export so that
 * RootNavigator can wrap the whole tree in one provider and CalendarTabScreen
 * can update the snapshot without owning it as local state.
 *
 * Usage in RootNavigator:
 *   <PregnancyProfileProvider>
 *     <Stack.Navigator>...</Stack.Navigator>
 *   </PregnancyProfileProvider>
 *
 * Security: only civil dates and numeric values stored (no tokens, no raw health).
 */
export function PregnancyProfileProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const setter = useCallback((s: ProfileSnapshot) => setSnapshot(s), []);

  return (
    <PregnancyProfileSetterContext.Provider value={setter}>
      <PregnancyProfileContext.Provider value={snapshot}>
        {children}
      </PregnancyProfileContext.Provider>
    </PregnancyProfileSetterContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Read the current profile snapshot.
 * Returns null before CalendarTabScreen has loaded the profile (e.g. auth flow).
 */
export function useProfileSnapshot(): ProfileSnapshot | null {
  return useContext(PregnancyProfileContext);
}

/**
 * Get the setter to update the profile snapshot.
 * Used by CalendarTabScreen after GET /v1/pregnancy-profile succeeds.
 * Throws if called outside of PregnancyProfileProvider.
 */
export function useProfileSnapshotSetter(): (snapshot: ProfileSnapshot) => void {
  const setter = useContext(PregnancyProfileSetterContext);
  if (!setter) {
    throw new Error(
      'useProfileSnapshotSetter must be used within <PregnancyProfileProvider>',
    );
  }
  return setter;
}
