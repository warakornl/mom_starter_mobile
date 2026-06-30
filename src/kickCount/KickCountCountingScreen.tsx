/**
 * SC-K1: KickCountCountingScreen — the active counting screen.
 *
 * Key invariants (all testable):
 *   K-5b / INV-K2: the ONLY thing that changes between count=3 and count=10
 *     is the number displayed in the progress counter. No color, icon, animation,
 *     sound, or other UI element changes when reaching/passing 10.
 *   INV-K3: "จบเซสชัน" is ALWAYS enabled (B1) — never disabled, never hidden,
 *     never highlighted when count reaches 10.
 *   K-5d: safety strip text is static, generic, no "10" or time window.
 *   INV-K6: safety strip + disclaimer appear every render.
 *   −1 button: disabled at count=0 BUT visual appearance is IDENTICAL to count≥1
 *     (no dimming, no opacity change — only lack of press feedback — K-5b).
 *
 * SC-K1-LG leave-guard:
 *   Shown when X (close) or "ยกเลิก" is pressed with count ≥ 1.
 *   3 actions: finalize + save / continue / cancel + discard.
 *   No auto-dismiss (WCAG 2.2.1).
 *
 * Draft persistence (Y4):
 *   Every tap and undo persists the draft to expo-secure-store via saveDraft().
 *   If persist fails → save-error state shown (count NOT lost from memory).
 *
 * SC-K2 (draft resume sheet) is rendered here when hasDraft=true on mount.
 *
 * Security: never log movementCount or any draft field (K-8 MOTHER-health).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  AccessibilityInfo,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { saveDraft, loadDraft, clearDraft } from './kickCountDraftStore';
import { createSerialSaveQueue } from './serialSaveQueue';
import {
  tap,
  undo,
  finalizeSession,
  cancelSession,
  computeGestationalWeekAtStart,
  getProgressDisplay,
} from './kickCountLogic';
import { kickCountSyncStore } from './kickCountSyncStore';
import { createKickCountSyncClient } from '../sync/syncClient';
import { executePush } from '../sync/pushOrchestrator';
import type { KickCountDraft } from './kickCountTypes';
import type { TokenStorage } from '../auth/tokenStorage';
import { SafetyStrip } from './KickCountHomeScreen';

// ─── Props ────────────────────────────────────────────────────────────────────

interface KickCountCountingScreenProps {
  /** EDD from PregnancyProfile (YYYY-MM-DD) — used to derive gestational week. */
  edd: string;
  /** Device's local civil date "YYYY-MM-DD" for gestational week derivation. */
  todayCivil: string;
  /**
   * Returns "YYYY-MM-DDTHH:mm" floating-civil now for startedAt / endedAt.
   * Injected for testability (real impl: new Date()).
   */
  getCivilNow?: () => string;
  /**
   * Returns monotonic ms for duration computation (default: Date.now()).
   * Use performance.now() in production for DST safety (B.3).
   */
  getMonotonicMs?: () => number;
  /**
   * Y-6 / appsec-1.3: consent defense-in-depth.
   * The primary gate is in KickCountHomeScreen (B.2/K-8). This is a secondary
   * assertion — if the user somehow reaches this screen without consent granted
   * (e.g. deep link, race condition), the screen must NOT create/persist a draft.
   * Default true only when no navigator prop is provided (backwards-compat).
   *
   * IMPORTANT: do not default to true in production routing — always pass from
   * the navigator (which reads the consent store).
   */
  generalHealthConsented?: boolean;
  /**
   * Y-2: sync push after finalize.
   * Shared secure token storage — used to get the access token for push.
   * Optional: if not provided, push is skipped (no-op, data stays local).
   */
  tokenStorage?: TokenStorage;
  /**
   * Y-2: API base URL for sync push endpoint.
   * Optional: if not provided, push is skipped.
   */
  apiBaseUrl?: string;
}

type Nav = NativeStackNavigationProp<RootStackParamList, 'KickCountCounting'>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCivilNowDefault(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function generateUUIDv4(): string {
  // RFC 4122 version 4 UUID (random)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KickCountCountingScreen({
  edd,
  todayCivil,
  getCivilNow = getCivilNowDefault,
  getMonotonicMs = () => Date.now(),
  generalHealthConsented = true, // see prop comment — always pass from navigator
  tokenStorage,
  apiBaseUrl,
}: KickCountCountingScreenProps) {
  const { t } = useT();
  const navigation = useNavigation<Nav>();

  // ── State ────────────────────────────────────────────────────────────────────
  type InitPhase = 'loading' | 'draft-resume' | 'counting' | 'saving' | 'save-error';
  const [phase, setPhase] = useState<InitPhase>('loading');
  const [draft, setDraft] = useState<KickCountDraft | null>(null);
  const [showLeaveGuard, setShowLeaveGuard] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartMsRef = useRef<number>(0);

  // Y-5: single serial queue — all saveDraft() calls go through this to prevent
  // concurrent keychain writes from resolving out-of-order and overwriting a
  // newer count with an older one.
  const enqueueWrite = useRef(createSerialSaveQueue()).current;

  // ── Init (load or create draft) ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      // Y-6 / appsec-1.3: consent defense-in-depth.
      // Primary gate is in KickCountHomeScreen (B.2/K-8). This guard catches
      // any race condition or deep-link bypass — no draft must be created or
      // persisted without generalHealthConsented=true (PDPA health data).
      if (!generalHealthConsented) {
        if (!cancelled) {
          navigation.navigate('KickCountHome');
        }
        return;
      }
      try {
        const existing = await loadDraft();
        if (cancelled) return;
        if (existing) {
          // Y4: existing draft → show resume sheet (draft-resume phase)
          setDraft(existing);
          setPhase('draft-resume');
          // Compute elapsed from start monotonic (resumed session)
          const elapsed = Math.floor((getMonotonicMs() - existing.sessionStartMonotonicMs) / 1000);
          setElapsedSeconds(Math.max(0, elapsed));
        } else {
          // Create new draft
          const newDraft: KickCountDraft = {
            localDraftId: generateUUIDv4(),
            startedAt: getCivilNow(),
            movementCount: 0,
            targetCount: 10,
            gestationalWeekAtStart: computeGestationalWeekAtStart(edd, todayCivil),
            sessionStartMonotonicMs: getMonotonicMs(),
            note: null,
          };
          await saveDraft(newDraft);
          if (cancelled) return;
          setDraft(newDraft);
          sessionStartMsRef.current = newDraft.sessionStartMonotonicMs;
          setPhase('counting');
          startTimer();
        }
      } catch {
        // loadDraft / saveDraft failed — start in-memory without persistence
        // (the draft is lost on kill, but we still allow counting — SC-K1 save-error)
        const newDraft: KickCountDraft = {
          localDraftId: generateUUIDv4(),
          startedAt: getCivilNow(),
          movementCount: 0,
          targetCount: 10,
          gestationalWeekAtStart: computeGestationalWeekAtStart(edd, todayCivil),
          sessionStartMonotonicMs: getMonotonicMs(),
          note: null,
        };
        if (!cancelled) {
          setDraft(newDraft);
          sessionStartMsRef.current = newDraft.sessionStartMonotonicMs;
          setPhase('save-error'); // initial load failed
          startTimer();
        }
      }
    }
    init();
    return () => {
      cancelled = true;
      stopTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // ── SC-K2 resume actions ──────────────────────────────────────────────────────

  const handleResume = useCallback(() => {
    if (!draft) return;
    sessionStartMsRef.current = draft.sessionStartMonotonicMs;
    setPhase('counting');
    startTimer();
  }, [draft]);

  const handleDraftFinalize = useCallback(async () => {
    if (!draft) return;
    await handleFinalize(draft);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDraftDiscard = useCallback(async () => {
    cancelSession(draft!);
    try { await clearDraft(); } catch { /* best effort */ }
    navigation.navigate('KickCountHome');
  }, [draft, navigation]);

  // ── Tap (+1) ──────────────────────────────────────────────────────────────────

  const handleTap = useCallback(async () => {
    if (!draft) return;
    const updated = tap(draft);
    setDraft(updated); // immediate UI update — count increments without waiting for persist
    // Y-5: route through the serial queue so concurrent taps cannot interleave writes.
    // Y-3: phase transition is inside try/catch so stale `phase` closure is never read.
    try {
      await enqueueWrite(() => saveDraft(updated));
      setPhase('counting'); // success: explicitly set counting (not a stale-closure read)
    } catch {
      setPhase('save-error'); // failure: show error only in catch
    }
  }, [draft, enqueueWrite]);

  // ── Undo (−1, floor 0) ────────────────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    if (!draft || draft.movementCount === 0) return; // disabled at 0
    const updated = undo(draft);
    setDraft(updated);
    // Y-5: serialize undo writes through the same queue as tap writes.
    try {
      await enqueueWrite(() => saveDraft(updated));
      setPhase('counting');
    } catch {
      setPhase('save-error');
    }
  }, [draft, enqueueWrite]);

  // ── Finalize ──────────────────────────────────────────────────────────────────

  const handleFinalize = useCallback(async (currentDraft: KickCountDraft) => {
    stopTimer();
    setPhase('saving');
    const endMs = getMonotonicMs();
    const endedAt = getCivilNow();
    const session = finalizeSession(currentDraft, endMs, endedAt);
    try {
      // INSERT immutable completed row in local store
      // K-7 prod-gate: note is always null in MVP (no note UI).
      // DO NOT wire note input + push together until note_cipher AES-GCM encryption
      // is implemented (appsec-engineer, Backlog encryption). Pushing plaintext note
      // would violate K-7. The guard is also tested in syncClient.test.ts.
      kickCountSyncStore.enqueueCreate(session);
      // Clear draft from encrypted store (crypto-shred)
      await clearDraft();
      // Y-2: push to server immediately after finalize (fire-and-forget).
      // History is still visible from local store even if push fails
      // (kickCountSyncStore re-enqueues on failure — no silent data loss).
      if (tokenStorage && apiBaseUrl) {
        const tokens = await tokenStorage.load().catch(() => null);
        if (tokens?.accessToken) {
          const client = createKickCountSyncClient(apiBaseUrl, kickCountSyncStore);
          // executePush drains queue, pushes, re-enqueues on fail (no silent loss)
          await executePush(
            kickCountSyncStore,
            client,
            tokens.accessToken,
            // UUID-like idempotency key from session id (stable for retry)
            session.id,
          );
        }
      }
      navigation.navigate('KickCountSummary', { sessionId: session.id });
    } catch {
      setPhase('save-error');
    }
  }, [getCivilNow, getMonotonicMs, navigation, tokenStorage, apiBaseUrl]);

  const handleEndSessionPress = useCallback(() => {
    if (!draft) return;
    handleFinalize(draft);
  }, [draft, handleFinalize]);

  // ── Cancel / Leave Guard ──────────────────────────────────────────────────────

  const handleCancelPress = useCallback(() => {
    if (!draft) return;
    if (draft.movementCount === 0) {
      // count=0: cancel immediately, no guard (no data at risk)
      cancelSession(draft);
      clearDraft().catch(() => {});
      navigation.navigate('KickCountHome');
    } else {
      setShowLeaveGuard(true);
    }
  }, [draft, navigation]);

  const handleLeaveGuardSave = useCallback(() => {
    setShowLeaveGuard(false);
    if (!draft) return;
    handleFinalize(draft);
  }, [draft, handleFinalize]);

  const handleLeaveGuardContinue = useCallback(() => {
    setShowLeaveGuard(false);
  }, []);

  const handleLeaveGuardDiscard = useCallback(async () => {
    setShowLeaveGuard(false);
    stopTimer();
    cancelSession(draft!);
    try { await clearDraft(); } catch { /* best effort */ }
    navigation.navigate('KickCountHome');
  }, [draft, navigation]);

  // ── Draft resume sheet (SC-K2) ────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.container} testID="kick-counting-loading">
        <Text style={styles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  if (phase === 'draft-resume' && draft) {
    const mins = Math.floor(elapsedSeconds / 60);
    return (
      <View style={styles.draftResumeContainer} testID="kick-draft-resume-sheet">
        <Text style={styles.draftSheetTitle}>{t('kick.draftSheetTitle')}</Text>
        <Text style={styles.draftSummaryText}>
          {interpolate(t('kick.draftSummary'), { n: draft.movementCount, min: mins })}
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleResume}
          accessibilityRole="button"
          accessibilityLabel={t('kick.draftResume')}
          testID="kick-draft-resume-btn"
        >
          <Text style={styles.primaryBtnText}>{t('kick.draftResume')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleDraftFinalize}
          accessibilityRole="button"
          accessibilityLabel={t('kick.draftFinalize')}
          testID="kick-draft-finalize-btn"
        >
          <Text style={styles.secondaryBtnText}>{t('kick.draftFinalize')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quietBtn}
          onPress={handleDraftDiscard}
          accessibilityRole="button"
          accessibilityLabel={t('kick.draftDiscard')}
          testID="kick-draft-discard-btn"
        >
          <Text style={styles.quietBtnText}>{t('kick.draftDiscard')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Counting screen (SC-K1) ───────────────────────────────────────────────────

  const count = draft?.movementCount ?? 0;
  const progressData = getProgressDisplay(count, 10);
  const elapsedStr = formatElapsed(elapsedSeconds);
  const isUndoDisabled = count === 0;
  const isSaving = phase === 'saving';

  return (
    <View style={styles.container} testID="kick-counting-screen">
      {/* ── Timer ─────────────────────────────────────────────────────────────── */}
      <Text
        style={styles.timerText}
        accessibilityLabel={interpolate(t('kick.timerA11y'), { time: elapsedStr })}
        accessibilityLiveRegion="none" // timer not announced every second
      >
        {elapsedStr}
      </Text>
      <Text style={styles.timerLabel}>{t('kick.timeElapsed')}</Text>

      {/* ── Progress counter (K-5b: ONLY the number changes between count=3/10) ── */}
      <View style={styles.progressContainer}>
        {/*
          K-5b invariant: count=3 and count=10 produce identical view hierarchy
          and styling — only the text value of the count number differs.
          No ring, no dots, no bar, no status color.

          Y-1 / K-5b SR fix: the countNumber already carries the full SR label
          "นับได้ N ครั้ง" via progressA11y. The divider+targetNumber+countUnit
          are hidden from screen readers so SR hears ONLY "นับได้ N ครั้ง" and
          never the bare "/10 ครั้ง" fraction.
        */}
        <Text
          style={styles.countNumber}
          accessibilityLabel={interpolate(t('kick.progressA11y'), { n: count })}
          accessibilityRole="text"
          accessibilityLiveRegion="polite" // announce on count change (polite — not assertive)
        >
          {count}
        </Text>
        {/* Y-1: hidden from SR — divider is purely visual */}
        <View
          style={styles.divider}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
        />
        {/* Y-1: hidden from SR — "/10" is visual context, not an SR announcement */}
        <Text
          style={styles.targetNumber}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
        >
          {progressData.targetCount}
        </Text>
        {/* Y-1: hidden from SR — "ครั้ง" after targetNumber would be confusing duplicate */}
        <Text
          style={styles.countUnit}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
        >
          ครั้ง
        </Text>
      </View>

      {/* ── Tap button ─────────────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.tapArea, isSaving && styles.tapAreaDisabled]}
        onPress={isSaving ? undefined : handleTap}
        disabled={isSaving}
        accessibilityRole="button"
        accessibilityLabel={interpolate(t('kick.tapA11y'), { n: count })}
        testID="kick-tap-btn"
        activeOpacity={0.97}
      >
        <Text style={styles.tapLabel}>{t('kick.tapLabel')}</Text>
        <Text style={styles.tapSublabel}>{t('kick.tapSublabel')}</Text>
      </TouchableOpacity>

      {/* Save error inline */}
      {phase === 'save-error' && (
        <View style={styles.saveErrorPanel} testID="kick-save-error">
          <Text style={styles.saveErrorText}>{t('kick.saveError')}</Text>
        </View>
      )}

      {/* ── −1 undo button (disabled at count=0 — visual appearance IDENTICAL) ── */}
      {/*
        K-5b: count=0 → button is not interactive BUT its visual appearance
        (size, color rose/700, opacity) MUST be identical to count≥1.
        Users learn it's disabled from absence of press feedback only.
      */}
      <TouchableOpacity
        style={styles.undoBtn}
        onPress={isUndoDisabled ? undefined : handleUndo}
        disabled={isUndoDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('kick.undoA11y')}
        accessibilityState={{ disabled: isUndoDisabled }}
        testID="kick-undo-btn"
        activeOpacity={isUndoDisabled ? 1 : 0.7}
      >
        {/* K-5b: text color is IDENTICAL at count=0 and count≥1 (no dim) */}
        <Text style={styles.undoBtnText}>{t('kick.undoBtn')}</Text>
      </TouchableOpacity>

      {/* ── Safety strip (K-5d always-on) ──────────────────────────────────────── */}
      <SafetyStrip t={t} />

      {/* ── Bottom action bar (B1: "จบเซสชัน" always-on, always enabled) ───────── */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.cancelBottomBtn}
          onPress={handleCancelPress}
          accessibilityRole="button"
          accessibilityLabel={t('kick.cancelA11y')}
          testID="kick-cancel-btn"
        >
          <Text style={styles.cancelBottomBtnText}>{t('kick.cancelBtn')}</Text>
        </TouchableOpacity>

        {/*
          B1: "จบเซสชัน" ALWAYS enabled — never disabled, never hidden.
          Not highlighted/animated when count reaches 10 (INV-K3).
        */}
        <TouchableOpacity
          style={[styles.endSessionBtn, isSaving && styles.endSessionBtnSaving]}
          onPress={isSaving ? undefined : handleEndSessionPress}
          accessibilityRole="button"
          accessibilityLabel={t('kick.endSessionA11y')}
          testID="kick-end-session-btn"
          // B1: never disabled — accessible at all times
          accessibilityState={{ disabled: false }}
        >
          {isSaving ? (
            <Text style={styles.endSessionBtnText}>…</Text>
          ) : (
            <Text style={styles.endSessionBtnText}>{t('kick.endSessionBtn')}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── SC-K1-LG Leave Guard modal ──────────────────────────────────────────── */}
      <Modal
        visible={showLeaveGuard}
        transparent
        animationType="fade"
        onRequestClose={handleLeaveGuardContinue} // Android back = continue
        testID="kick-leave-guard-modal"
      >
        <View style={styles.leaveGuardOverlay}>
          <View style={styles.leaveGuardCard}>
            <Text style={styles.leaveGuardTitle}>{t('kick.leaveGuardTitle')}</Text>
            <Text style={styles.leaveGuardBody}>
              {interpolate(t('kick.leaveGuardBody'), {
                n: count,
                time: elapsedStr,
              })}
            </Text>
            {/* No auto-dismiss (WCAG 2.2.1) */}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleLeaveGuardSave}
              accessibilityRole="button"
              accessibilityLabel={t('kick.leaveGuardSave')}
              testID="kick-leave-guard-save-btn"
            >
              <Text style={styles.primaryBtnText}>{t('kick.leaveGuardSave')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleLeaveGuardContinue}
              accessibilityRole="button"
              accessibilityLabel={t('kick.leaveGuardContinue')}
              testID="kick-leave-guard-continue-btn"
            >
              <Text style={styles.secondaryBtnText}>{t('kick.leaveGuardContinue')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quietBtn}
              onPress={handleLeaveGuardDiscard}
              accessibilityRole="button"
              accessibilityLabel={t('kick.leaveGuardDiscard')}
              testID="kick-leave-guard-discard-btn"
            >
              <Text style={styles.quietBtnText}>{t('kick.leaveGuardDiscard')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  loadingText: {
    fontSize: 15,
    color: '#6B6B6B',
    textAlign: 'center',
    marginTop: 40,
  },
  // Timer
  timerText: {
    fontSize: 20,
    fontFamily: 'monospace', // IBM Plex Mono equivalent
    color: '#6B6B6B',
    textAlign: 'center',
    marginTop: 16,
  },
  timerLabel: {
    fontSize: 13,
    color: '#9B9B9B',
    textAlign: 'center',
    marginBottom: 16,
  },
  // Progress counter (K-5b: IDENTICAL styling regardless of count value)
  progressContainer: {
    alignItems: 'center',
    marginVertical: 8,
  },
  countNumber: {
    fontSize: 56,
    fontWeight: '700',
    color: '#1A1A1A', // ink
    lineHeight: 66,
  },
  divider: {
    width: 48,
    height: 1.5,
    backgroundColor: '#9B9B9B',
    marginVertical: 4,
  },
  targetNumber: {
    fontSize: 16,
    color: '#6B6B6B', // ink/soft
    lineHeight: 25,
  },
  countUnit: {
    fontSize: 13,
    color: '#9B9B9B', // ink/faint
  },
  // Tap area (min-height 200dp, full width)
  tapArea: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E5E5', // hairline
    borderRadius: 20,
    minHeight: 200,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  tapAreaDisabled: {
    backgroundColor: '#F5F5F5',
  },
  tapLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A', // ink
    textAlign: 'center',
    marginBottom: 4,
  },
  tapSublabel: {
    fontSize: 13,
    color: '#6B6B6B', // ink/soft
    textAlign: 'center',
  },
  // Save error
  saveErrorPanel: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  saveErrorText: {
    color: '#C0485F',
    fontSize: 13,
    textAlign: 'center',
  },
  // Undo button (K-5b: visual appearance IDENTICAL at count=0 and count≥1)
  undoBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  undoBtnText: {
    // K-5b: SAME color at count=0 and count≥1 — no dimming/opacity change
    color: '#9B1C35', // rose/700
    fontSize: 15,
  },
  // Bottom bar (B1: endSession always-on)
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    marginTop: 'auto',
  },
  cancelBottomBtn: {
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBottomBtnText: {
    color: '#9B1C35', // rose/700
    fontSize: 15,
  },
  endSessionBtn: {
    backgroundColor: '#C0485F', // rose/600
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    // B1: never disabled, never highlighted differently at count=10 (INV-K3)
  },
  endSessionBtnSaving: {
    opacity: 0.7,
  },
  endSessionBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Leave guard modal
  leaveGuardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  leaveGuardCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  leaveGuardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    textAlign: 'center',
  },
  leaveGuardBody: {
    fontSize: 15,
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 20,
  },
  // Draft resume sheet
  draftResumeContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 24,
    justifyContent: 'center',
  },
  draftSheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
    textAlign: 'center',
  },
  draftSummaryText: {
    fontSize: 15,
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 24,
  },
  // Shared button styles
  primaryBtn: {
    backgroundColor: '#C0485F', // rose/600
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#C0485F',
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  secondaryBtnText: {
    color: '#C0485F',
    fontSize: 15,
    fontWeight: '500',
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
});
