/**
 * SC-K0: KickCountHomeScreen — Module entry point.
 *
 * Rules from spec:
 *   - D6/SC-K6a: module NOT rendered before wk32 (shouldShowModule returns false → caller guards)
 *   - SC-K6b: postpartum → no "เริ่มนับ" button; show link to history only
 *   - B.2/K-8: consent gate — general_health must be granted BEFORE creating draft
 *   - Y4: if draft exists → show SC-K2 draft resume sheet instead of home
 *   - Safety strip (K-5d): always-on generic text, no "10"/time window
 *   - Disclaimer: always-on
 *
 * State table (frontend-spec §SC-K0):
 *   loading    → skeleton (stage disc bone + 2 button bones)
 *   ready      → "เริ่มนับ" + "ดูประวัติทั้งหมด"
 *   draft      → navigate to KickCountCounting (draft resume sheet shown from there)
 *   offline    → pill + "เริ่มนับ" still functional (local)
 *   postpartum → no "เริ่มนับ"; link to history only
 *   error      → error panel + retry; no "เริ่มนับ"
 *   consent-gate → "เริ่มนับ" disabled (rose/300); caption + route to consent flow
 *
 * Security: never log draft content or session data (K-8 MOTHER-health).
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AccessibilityInfo,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n/LanguageContext';
import { interpolate, type MessageKey } from '../i18n/messages';
import { loadDraft } from './kickCountDraftStore';
import { shouldShowModule, isStartAllowedByWeek } from './kickCountLogic';
import { kickCountSyncStore } from './kickCountSyncStore';
import { createKickCountSyncClient } from '../sync/syncClient';
import type { Lifecycle } from '../pregnancy/types';
import type { TokenStorage } from '../auth/tokenStorage';

type Nav = NativeStackNavigationProp<RootStackParamList, 'KickCountHome'>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface KickCountHomeScreenProps {
  /**
   * Gestational week (client-derived living value from PregnancyProfile.edd).
   * Used for the wk32 gate and display label.
   */
  gestationalWeek: number;
  lifecycle: Lifecycle;
  /** Whether the local general_health consent is granted. */
  generalHealthConsented: boolean;
  /** True when the device has no network connection. */
  isOffline?: boolean;
  /** Called when the user needs to grant general_health consent. */
  onRequestConsent: () => void;
  /**
   * Y-2: Shared secure token storage — used for sync pull on mount/foreground.
   * Optional: if not provided, pull is skipped (data stays local-only).
   */
  tokenStorage?: TokenStorage;
  /**
   * Y-2: API base URL for sync pull endpoint.
   * Optional: if not provided, pull is skipped.
   */
  apiBaseUrl?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KickCountHomeScreen({
  gestationalWeek,
  lifecycle,
  generalHealthConsented,
  isOffline = false,
  onRequestConsent,
  tokenStorage,
  apiBaseUrl,
}: KickCountHomeScreenProps) {
  const { t } = useT();
  const navigation = useNavigation<Nav>();

  type ScreenState = 'loading' | 'ready' | 'error' | 'postpartum';
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [hasDraft, setHasDraft] = useState(false);

  // D6 / SC-K6a: module must NOT render before wk32
  const moduleVisible = shouldShowModule(gestationalWeek, lifecycle);
  const canStart = isStartAllowedByWeek(gestationalWeek, lifecycle);

  // Y-2: sync client ref (bound once per mount)
  const clientRef = useRef(
    tokenStorage && apiBaseUrl
      ? createKickCountSyncClient(apiBaseUrl, kickCountSyncStore)
      : null,
  );

  // Y-2: pull from server to hydrate history (mirror calendar pattern)
  const syncPull = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !tokenStorage) return;
    const tokens = await tokenStorage.load().catch(() => null);
    if (!tokens?.accessToken) return;
    // Pull is fire-and-forget — offline/failure is non-fatal; history still shows from local store
    await client.pull(tokens.accessToken, kickCountSyncStore.getWatermark()).catch(() => {});
  }, [tokenStorage]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        // Y-2: pull on mount to hydrate history store
        await syncPull();
        const draft = await loadDraft();
        if (cancelled) return;
        setHasDraft(draft !== null);
        setScreenState(lifecycle === 'postpartum' ? 'postpartum' : 'ready');
      } catch {
        if (!cancelled) setScreenState('error');
      }
    }
    init();
    return () => { cancelled = true; };
  }, [lifecycle, syncPull]);

  // Y-2: pull on foreground (repopulate history when returning from background)
  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next === 'active') {
        void syncPull();
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [syncPull]);

  const handleStartPress = useCallback(() => {
    // B.2 / K-8: consent gate — check general_health before creating draft
    if (!generalHealthConsented) {
      onRequestConsent();
      return;
    }
    if (hasDraft) {
      // Y4: existing draft → navigate to counting (draft resume sheet shown there)
      navigation.navigate('KickCountCounting');
    } else {
      navigation.navigate('KickCountCounting');
    }
  }, [generalHealthConsented, hasDraft, navigation, onRequestConsent]);

  const handleHistoryPress = useCallback(() => {
    navigation.navigate('KickCountHistory');
  }, [navigation]);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (screenState === 'loading') {
    return (
      <View style={styles.container} testID="kick-home-loading">
        {/* Skeleton placeholder — stage disc bone + 2 button bones */}
        <View style={styles.skeletonDisc} accessibilityLabel={t('home.loading')} />
        <View style={styles.skeletonBtn} />
        <View style={styles.skeletonBtn} />
        {/* Safety strip is static — never skeleton */}
        <SafetyStrip t={t} />
      </View>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────

  if (screenState === 'error') {
    return (
      <View style={styles.container} testID="kick-home-error">
        <Text style={styles.errorText}>{t('kick.storeError')}</Text>
        <TouchableOpacity
          onPress={() => setScreenState('loading')}
          style={styles.retryBtn}
          accessibilityRole="button"
          accessibilityLabel={t('general.retry')}
        >
          <Text style={styles.retryBtnText}>{t('general.retry')}</Text>
        </TouchableOpacity>
        <SafetyStrip t={t} />
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const isConsentGate = !generalHealthConsented && canStart;
  const displayWeek = Math.max(0, gestationalWeek);

  return (
    <View style={styles.container} testID="kick-home-ready">
      {/* Offline pill */}
      {isOffline && (
        <View style={styles.offlinePill} testID="kick-offline-pill">
          <Text style={styles.offlinePillText}>{t('kick.offlinePill')}</Text>
        </View>
      )}

      {/* Stage week label */}
      <Text style={styles.weekLabel} accessibilityElementsHidden>
        {interpolate(t('kick.weekLabel'), { n: displayWeek })}
      </Text>

      {/* Start button — only when canStart */}
      {canStart && (
        <TouchableOpacity
          style={[styles.primaryBtn, isConsentGate && styles.primaryBtnDisabled]}
          onPress={handleStartPress}
          accessibilityRole="button"
          accessibilityLabel={t('kick.startBtn')}
          accessibilityState={{ disabled: false }} // always pressable (routes to consent if needed)
          testID="kick-start-btn"
        >
          <Text style={[styles.primaryBtnText, isConsentGate && styles.primaryBtnTextDisabled]}>
            {t('kick.startBtn')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Consent gate caption */}
      {isConsentGate && (
        <Text style={styles.consentCaption} testID="kick-consent-caption">
          {t('kick.consentGateCaption')}
        </Text>
      )}

      {/* Postpartum read-only banner */}
      {lifecycle === 'postpartum' && (
        <View style={styles.postpartumBanner} testID="kick-postpartum-banner">
          <Text style={styles.postpartumBannerText}>{t('kick.postpartumBanner')}</Text>
        </View>
      )}

      {/* View history link — always available when module is visible */}
      <TouchableOpacity
        style={styles.quietBtn}
        onPress={handleHistoryPress}
        accessibilityRole="button"
        accessibilityLabel={t('kick.viewHistory')}
        testID="kick-view-history-btn"
      >
        <Text style={styles.quietBtnText}>{t('kick.viewHistory')} ›</Text>
      </TouchableOpacity>

      {/* Safety strip (K-5d) + disclaimer — always-on */}
      <SafetyStrip t={t} />
    </View>
  );
}

// ─── Safety Strip (K-5d always-on) ────────────────────────────────────────────

/**
 * K-5d: safety strip — always rendered, never triggered by count/value.
 * Generic text — no "10", no time window, no verdict language.
 * INV-K6: appears on SC-K0, K1, K3, K5 every render.
 */
function SafetyStrip({ t }: { t: (key: MessageKey, params?: Record<string, string | number>) => string }) {
  return (
    <View style={styles.safetyStrip} testID="kick-safety-strip">
      <Text style={styles.safetyText}>{t('kick.safetyStrip')}</Text>
      <Text style={styles.safetySource}>{t('kick.safetySource')}</Text>
      <Text style={styles.disclaimerText}>{t('kick.disclaimer')}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  skeletonDisc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F5F5F5',
    marginBottom: 24,
    alignSelf: 'center',
  },
  skeletonBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    marginBottom: 12,
  },
  weekLabel: {
    fontSize: 14,
    color: '#6B6B6B',
    marginBottom: 24,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: '#C0485F', // rose/600
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 52,
  },
  primaryBtnDisabled: {
    backgroundColor: '#E8A0AD', // rose/300 (consent-gate state)
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryBtnTextDisabled: {
    color: '#FFFFFF',
  },
  consentCaption: {
    fontSize: 13,
    color: '#6B6B6B',
    textAlign: 'center',
    marginBottom: 8,
  },
  quietBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  quietBtnText: {
    color: '#9B1C35', // rose/700
    fontSize: 15,
  },
  postpartumBanner: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  postpartumBannerText: {
    fontSize: 13,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  offlinePill: {
    backgroundColor: '#FEF3F5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'center',
    marginBottom: 12,
  },
  offlinePillText: {
    fontSize: 12,
    color: '#6B6B6B',
  },
  safetyStrip: {
    backgroundColor: '#FEF9F9',
    borderRadius: 8,
    padding: 16,
    marginTop: 24,
  },
  safetyText: {
    fontSize: 13,
    color: '#6B6B6B',
    marginBottom: 4,
  },
  safetySource: {
    fontSize: 12,
    color: '#9B9B9B',
    textDecorationLine: 'underline',
    marginBottom: 8,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#9B9B9B',
  },
  errorText: {
    fontSize: 15,
    color: '#6B6B6B',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#C0485F',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignSelf: 'center',
    marginBottom: 16,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

export { SafetyStrip };
