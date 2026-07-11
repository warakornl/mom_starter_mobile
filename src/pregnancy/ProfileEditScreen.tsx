/**
 * ProfileEditScreen — edit-pregnancy-profile host screen.
 *
 * Implements edit-pregnancy-profile-behavior.md §3, §4, §7 for the Settings entry.
 *
 * Entry: Settings > "แก้ไขข้อมูลการตั้งครรภ์" (lifecycle=pregnant only — AC-2).
 * On mount: GETs a fresh full profile (carries version+eddBasis absent from snapshot).
 *
 * States (§4.4):
 *   loading     — GET in flight: spinner, no inputs, back allowed (AC-18)
 *   show-form   — GET 200+pregnant: ProfileSetupScreen in edit mode
 *   not-found   — GET 404: notice + goBack (AC-14)
 *   guard       — GET 200+postpartum/ended: guard notice + goBack (AC-14)
 *   error       — GET 5xx/network: retryable error
 *
 * Security:
 *   AC-13 (BLOCKING, SD-5): GET 401 and PUT 401 (no-token and server) both call
 *   onSessionExpired(), which runs the full performLogout teardown (clearTokens +
 *   ALL health stores) then navigates to Welcome.  The fresh-GET result is held in
 *   local state — NEVER in route params (PDPA SD-9, AC-17).
 *
 * AC-7 / R-2: on PUT 200, calls onEditComplete (goBack to Settings), NOT reset-to-Home.
 * AC-8: after goBack, Home re-GETs via useFocusEffect (wired separately in HomeScreen).
 * AC-9: NO reanchor/notification reschedule on save.
 * AC-10 / R-3: PUT 409 → reload form with currentProfile + show conflict message.
 * AC-15: unsaved-changes guard — wired END-TO-END:
 *   1. ProfileSetupScreen.onDirty fires on every user-driven field change.
 *   2. handleDirty sets isDirtyRef.current = true.
 *   3. useEffect registers a beforeRemove listener on `navigation`.
 *   4. buildBeforeRemoveHandler intercepts back when dirty, shows discard Alert.
 *   5. Confirm-discard: clears dirty + dispatches the pending navigation action.
 *   6. Save success: isDirtyRef cleared BEFORE onEditComplete so goBack is silent.
 *   7. Session-expiry (GET or PUT): isDirtyRef cleared via handleSessionExpired
 *      BEFORE performLogout.reset runs, so the logout navigation is NOT trapped.
 * AC-18: loading state during entry GET — spinner, no inputs, back returns to Settings.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TokenStorage } from '../auth/tokenStorage';
import type { PregnancyProfile } from './types';
import { ProfileSetupScreen } from './ProfileSetupScreen';
import { runEntryGet } from './profileEditRuntimeWiring';
import { buildBeforeRemoveHandler } from './profileEditBeforeRemoveHandler';
import type { BeforeRemoveEvent } from './profileEditBeforeRemoveHandler';
import type { EditGetOutcome } from './profileEditLogic';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';

// ─── Navigation interface (minimal — only what AC-15 needs) ───────────────────

/**
 * Minimal navigation prop for AC-15's beforeRemove guard.
 * Matches the shape React Navigation's NativeStack navigation object provides
 * for those two methods; typed narrowly so tests can pass a simple mock.
 */
export interface EditNavigationProp {
  addListener(
    event: 'beforeRemove',
    callback: (e: BeforeRemoveEvent) => void,
  ): () => void;
  dispatch(action: Readonly<{ type: string }>): void;
  /**
   * pregnancy-loss-recording-ui.md §2 / §4.1: navigates to LossConfirm
   * (Screen B) or ReopenConfirm (Screen C confirmation). Both routes take
   * only `profileVersion` (a number, not health data — SD-9).
   */
  navigate(
    screen: 'LossConfirm' | 'ReopenConfirm',
    params: { profileVersion: number },
  ): void;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ProfileEditScreenProps {
  /** Shared secure token storage. */
  tokenStorage: TokenStorage;
  /** API base URL from src/config.ts. */
  apiBaseUrl: string;
  /**
   * AC-15: Navigation object used to register the beforeRemove dirty guard.
   * In production this is the native-stack `navigation` prop from RootNavigator.
   * In tests pass a minimal mock with addListener/dispatch.
   */
  navigation: EditNavigationProp;
  /**
   * AC-7 / R-2: Called after PUT 200 — goBack to Settings.
   * The navigator implements this as `navigation.goBack()`.
   * NOT reset-to-Home (that is the create flow).
   */
  onEditComplete: (profile: PregnancyProfile) => void;
  /**
   * AC-13 (BLOCKING, SD-5): Called on ALL four 401 paths:
   *   - GET no-token
   *   - GET server-401
   *   - PUT no-token   (via onSessionExpired prop on ProfileSetupScreen)
   *   - PUT server-401 (via onSessionExpired prop on ProfileSetupScreen)
   * The navigator must wire this to the full performLogout teardown
   * (clearTokens + ALL health stores) THEN navigation.reset to Welcome.
   * Reuse the exact runner from RootNavigator L242-257.
   */
  onSessionExpired: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfileEditScreen({
  tokenStorage,
  apiBaseUrl,
  navigation,
  onEditComplete,
  onSessionExpired,
}: ProfileEditScreenProps): React.JSX.Element {
  const { t } = useT();

  // ── State machine ────────────────────────────────────────────────────────────
  const [outcome, setOutcome] = useState<EditGetOutcome>({ type: 'loading' });

  // ── Conflict message (AC-10 R-3) ─────────────────────────────────────────────
  // Shown at the top of the edit form when a 409 conflict was resolved.
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  // ── Dirty-state tracking for AC-15 unsaved-changes guard ─────────────────────
  // Set to true whenever ProfileSetupScreen notifies us of a field change.
  const isDirtyRef = useRef(false);

  // ── AC-13 SD-5: session-expiry wrapper ───────────────────────────────────────
  // Clears isDirtyRef BEFORE calling onSessionExpired so that the performLogout
  // navigation.reset (triggered inside onSessionExpired) does NOT get intercepted
  // by the beforeRemove guard — even if the user had started editing.
  const handleSessionExpired = useCallback(() => {
    isDirtyRef.current = false;
    onSessionExpired();
  }, [onSessionExpired]);

  // ── AC-15: register beforeRemove guard once navigation is available ───────────
  // buildBeforeRemoveHandler returns a listener that:
  //   - when dirty: prevents navigation + shows discard Alert
  //   - when clean: lets navigation proceed
  // The listener refs isDirtyRef so it always sees the current dirty state
  // without needing to be re-created.
  useEffect(() => {
    const unsubscribe = navigation.addListener(
      'beforeRemove',
      buildBeforeRemoveHandler(
        isDirtyRef,
        Alert.alert,
        (action) => navigation.dispatch(action),
        // Cast to the plain (key: string) => string signature that the pure
        // handler factory expects — the i18n t() is a superset that satisfies it.
        t as (key: string) => string,
      ),
    );
    return unsubscribe;
  }, [navigation, t]);

  // ── AC-15: called by ProfileSetupScreen on every user-driven field change ─────
  const handleDirty = useCallback(() => {
    isDirtyRef.current = true;
  }, []);

  // ── Entry GET ────────────────────────────────────────────────────────────────

  const doEntryGet = useCallback(async () => {
    setOutcome({ type: 'loading' });
    isDirtyRef.current = false;
    setConflictMsg(null);

    await runEntryGet({
      tokenStorage,
      apiBaseUrl,
      onSessionExpired: handleSessionExpired,
      onOutcome: setOutcome,
    });
  }, [tokenStorage, apiBaseUrl, handleSessionExpired]);

  useEffect(() => {
    void doEntryGet();
  }, [doEntryGet]);

  // ── AC-10 R-3: 409 conflict reload ───────────────────────────────────────────

  const handleConflict = useCallback((currentProfile: PregnancyProfile) => {
    setOutcome({ type: 'show-form', profile: currentProfile });
    setConflictMsg(t('profile.editConflictReloaded'));
    isDirtyRef.current = false; // form reloaded to latest — reset dirty
  }, [t]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  // AC-18: Loading state — spinner, no inputs, back allowed (header back is native)
  if (outcome.type === 'loading') {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <ActivityIndicator
          size="large"
          color={T.color.accent.interactive}
          testID="profile-edit-loading"
          accessibilityLabel={t('profile.editLoading')}
        />
        <Text style={styles.loadingText}>{t('profile.editLoading')}</Text>
      </SafeAreaView>
    );
  }

  // AC-14: 404 — profile not found
  if (outcome.type === 'not-found') {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <Text style={styles.noticeText}>{t('profile.editNotFound')}</Text>
      </SafeAreaView>
    );
  }

  // AC-14: Postpartum/ended guard
  if (outcome.type === 'guard-not-editable') {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <Text style={styles.noticeText}>{t('profile.editNotEditable')}</Text>
      </SafeAreaView>
    );
  }

  // Retryable GET error
  if (outcome.type === 'error') {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <Text style={styles.noticeText}>{t('profile.editLoadError')}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => void doEntryGet()}
          accessibilityRole="button"
          accessibilityLabel={t('profile.editLoadRetry')}
          testID="profile-edit-retry"
        >
          <Text style={styles.retryBtnText}>{t('profile.editLoadRetry')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // session-expired is handled in doEntryGet (onSessionExpired + return), so this
  // variant never reaches render. Guard here so TypeScript can narrow outcome.profile.
  if (outcome.type !== 'show-form') {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={T.color.accent.interactive} />
      </SafeAreaView>
    );
  }

  // Happy path: show-form
  const { profile } = outcome;

  return (
    <View style={styles.formContainer}>
      {/* AC-10: Conflict notice shown above the form after a 409 reload */}
      {conflictMsg !== null && (
        <View
          style={styles.conflictBanner}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID="profile-edit-conflict-banner"
        >
          <Text style={styles.conflictBannerText}>{conflictMsg}</Text>
        </View>
      )}

      {/* AC-4/AC-5/AC-6: ProfileSetupScreen in edit mode */}
      <ProfileSetupScreen
        tokenStorage={tokenStorage}
        apiBaseUrl={apiBaseUrl}
        existingProfile={profile}
        // Loss-state gate (Phase 2 B1): pass the real lifecycle from the
        // freshly-GETted profile so the confirmation preview is correctly
        // suppressed when lifecycle === 'ended'.
        // Note: resolveEditGetOutcome() already guards lifecycle !== 'pregnant'
        // → 'guard-not-editable', so in practice this will always be 'pregnant'
        // here. Passing the explicit value closes the wiring gap class: if the
        // guard ever weakens, the UI still shows the honest state.
        lifecycle={profile.lifecycle}
        // AC-7 / R-2: goBack to Settings on 200 (NOT reset-to-Home).
        // isDirtyRef cleared BEFORE calling onEditComplete so the subsequent
        // navigation.goBack() is not intercepted by the beforeRemove guard.
        onSetupComplete={(savedProfile) => {
          isDirtyRef.current = false;
          onEditComplete(savedProfile);
        }}
        // AC-13 (BLOCKING, SD-5): PUT 401 (no-token or server) → full teardown + Welcome.
        // handleSessionExpired clears isDirtyRef first so the logout navigation.reset
        // is NOT trapped by the beforeRemove guard.
        onSessionExpired={handleSessionExpired}
        // AC-10 R-3: PUT 409 → reload form to latest server profile
        onConflict={handleConflict}
        // AC-15: user changed a field → mark form dirty → beforeRemove guard activates
        onDirty={handleDirty}
      />

      {/* pregnancy-loss-recording-ui.md §2 (Screen A entry) / §4.1 (Screen C
       * entry) — quiet text link, bottom of screen, below Save. INV-ENTRY-2:
       * loss entry shown ONLY when lifecycle === 'pregnant' (raw profile
       * value from the fresh GET — never defaulted). Reopen entry shown
       * ONLY when lifecycle === 'ended', occupying the exact same slot 1:1
       * (mutually exclusive — never both visible, §4.1).
       */}
      {profile.lifecycle === 'pregnant' && (
        <TouchableOpacity
          testID="loss-entry-link"
          style={styles.lossEntryLink}
          onPress={() =>
            navigation.navigate('LossConfirm', { profileVersion: profile.version })
          }
          accessibilityRole="link"
          accessibilityLabel={t('loss.entry.link')}
        >
          <Text testID="loss-entry-link-text" style={styles.lossEntryLinkText}>
            {t('loss.entry.link')}
          </Text>
          <Text style={styles.lossEntryChevron} accessibilityElementsHidden={true}>
            {' ›'}
          </Text>
        </TouchableOpacity>
      )}
      {profile.lifecycle === 'ended' && (
        <TouchableOpacity
          testID="reopen-entry-link"
          style={styles.lossEntryLink}
          onPress={() =>
            navigation.navigate('ReopenConfirm', { profileVersion: profile.version })
          }
          accessibilityRole="link"
          accessibilityLabel={t('loss.reopen.entry')}
        >
          <Text testID="reopen-entry-link-text" style={styles.lossEntryLinkText}>
            {t('loss.reopen.entry')}
          </Text>
          <Text style={styles.lossEntryChevron} accessibilityElementsHidden={true}>
            {' ›'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// ห้องแม่ Phase 2 B4: all token references migrated to semantic T.* namespace.
const styles = StyleSheet.create({
  centeredContainer: {
    flex: 1,
    backgroundColor: T.color.surface.base,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  loadingText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
    marginTop: 12,
  },
  noticeText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
  },
  retryBtn: {
    minHeight: T.button.primary.height,
    paddingHorizontal: 24,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  retryBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
  },
  formContainer: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },
  // AC-10: Conflict banner — warm amber (not alarming red), calm tone
  conflictBanner: {
    backgroundColor: T.color.surface.wash.amber,
    borderColor: T.color.surface.divider,
    borderWidth: 1,
    borderRadius: T.radius.md,
    padding: 12,
    margin: 16,
    marginBottom: 0,
  },
  conflictBannerText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  // pregnancy-loss-recording-ui.md §2.2 — quiet entry link (Screen A / Screen C).
  // Plain text only, no fill, no icon, no badge (INV-ENTRY-3). ≥48dp tap target
  // via padding; visual text stays caption-size (13sp equivalent).
  lossEntryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
    marginTop: T.spacing[6], // 24dp — keeps it visually distant from the Save CTA
  },
  lossEntryLinkText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary, // roselle-700, 7.70:1 AAA — quiet via size/placement, not under-contrast
  },
  lossEntryChevron: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.secondary, // jade-600 — decorative chevron only
  },
});
