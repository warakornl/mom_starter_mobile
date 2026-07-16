/**
 * MedicationPlanListScreen — Medication Plan Management (Slice 2, Task 8).
 *
 * Entry: MedicationPlans route in RootNavigator (bottom-nav tab — ยา / Plans).
 *
 * Implements medication-plan-ui.md §2–§8:
 *  §2–§3  List anatomy: active band first, hairline divider, inactive band.
 *  §4     Empty state with illustration placeholder + "เพิ่มแผนยาแรก" CTA.
 *  §5–§6  Form sheet (add/edit via MedicationPlanFormSheet).
 *  §7.2   Consent posture:
 *           general_health → gates Save → warm nudge → held value → persists on Grant.
 *           cloud_storage only absent → local save + "not synced" toast.
 *  §8     Screen states: loading / empty / list / add / edit / consent-nudge /
 *           saving / error / offline.
 *
 * Consent-gate pattern (mirrors CaptureScreen):
 *   1. Save attempt → orchestrateMedSave → action=gate → pendingPayloadRef = payload,
 *      showConsentNudge=true (form stays open, values held).
 *   2. User taps "Enable logging ›" → navigate ManageConsents.
 *   3. useFocusEffect on return: if pendingPayloadRef.current && consent is now granted
 *      → execute the pending save → clear ref → show saved toast.
 *   Stale-callback-safe: pendingPayloadRef holds the fully-built payload;
 *   no closure over stale form state.
 *
 * Security:
 *   - NEVER log plan.name or plan.dose (opaque base64 ciphertext — SD-2/SD-5).
 *   - Display uses decodeFieldFromBase64 (display-only; result must not be logged).
 *   - NEVER log scheduleRule (drug timing inference risk — SD-5).
 *   - No health data in route params (PDPA SD-9).
 *   - reset() on logout is wired in RootNavigator (PDPA 1.1).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Switch,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import type { Locale } from '../auth/types';
import type { TokenStorage } from '../auth/tokenStorage';
import type { MedicationPlan, MedicationPlanInput } from '../sync/syncTypes';

import { medicationPlanSyncStore } from './medicationPlanSyncStore';
import { consentStore } from '../consent/consentStore';
import { decodeFieldFromBase64 } from '../capture/captureScreenLogic';
import {
  orchestrateMedSave,
  resolvePendingSave,
  buildScheduleRuleFromPicker,
  type SchedulePickerState,
  type ToastVariant,
} from './medicationPlanFormLogic';
import { MedicationPlanFormSheet } from './MedicationPlanFormSheet';
import { shouldShowLogDose } from './logDoseParams';
import { T } from '../theme/tokens';
import { TabPillIcon } from '../icons/TabPillIcon';
import { LockIcon } from '../icons/LockIcon';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MedicationPlanListScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  onManageConsents: () => void;
  /**
   * Navigate to Capture pre-linked to a specific plan (Task 11).
   * Called with the plan's UUID — never with name/dose (PDPA SD-9).
   * When omitted (legacy tests / snapshots) the affordance is hidden.
   */
  onLogDose?: (planId: string) => void;
}

// ToastVariant is re-exported from medicationPlanFormLogic

// ─── Inline Toast component (replaces Alert — §5.6/§4.4 polite live region) ──

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

function InlineToast({ message, onDismiss }: ToastProps): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <View
      style={toastStyles.container}
      accessibilityLiveRegion="polite"
      importantForAccessibility="yes"
      testID="med-toast"
    >
      <Text style={toastStyles.text}>{message}</Text>
    </View>
  );
}

const toastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    backgroundColor: T.color.text.heading,        // #4A2230 roselle-900 (from #3A2A30)
    borderRadius: T.radius.md,                    // 12dp (from 10dp)
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 100,
    elevation: 8,
  },
  text: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                   // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,           // 25
    color: T.color.text.onDark,                   // #FFFFFF
    textAlign: 'center',
  },
});

// ─── Loading skeleton row ─────────────────────────────────────────────────────

function SkeletonRow(): React.JSX.Element {
  return (
    <View style={skeletonStyles.row} accessibilityElementsHidden>
      <View style={skeletonStyles.textBlock} />
      <View style={skeletonStyles.toggleBone} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.skeleton.color,            // #F5EDE6 ivory-200 (from #F0E9E4)
    borderRadius: T.radius.md,                    // 12dp
    marginBottom: 10,
    height: 72,
    paddingHorizontal: 16,
  },
  textBlock: {
    width: 160,
    height: 16,
    backgroundColor: T.color.surface.divider,     // #E8DDD5 (from #E0D7D0)
    borderRadius: T.radius.sm,                    // 6dp
  },
  toggleBone: {
    width: 48,
    height: 28,
    backgroundColor: T.color.surface.divider,     // #E8DDD5 (from #E0D7D0)
    borderRadius: 14,
  },
});

// ─── Display-safe plan name decoder ──────────────────────────────────────────
// Security: result is display-only. DO NOT log the decoded value (SD-2/SD-5).
function displayName(plan: MedicationPlan): string {
  return decodeFieldFromBase64(plan.name) ?? '—';
}

// Security: dose is display-only. DO NOT log (SD-2/SD-5).
function displayDose(plan: MedicationPlan): string | null {
  if (!plan.dose) return null;
  return decodeFieldFromBase64(plan.dose) ?? null;
}

// ─── Build schedule preview text for list item — localized (F3) ──────────────
function buildSchedulePreview(
  plan: MedicationPlan,
  t: (key: import('../i18n/messages').MessageKey) => string,
): string {
  const rule = plan.scheduleRule;
  if (!rule) return t('medication.prnLabel');

  let preview: string;
  if (rule.freq === 'daily') {
    preview = `${t('medication.scheduleChip.daily')} · ${(rule.timesOfDay ?? []).sort().join(', ')}`;
  } else if (rule.freq === 'every_n_days') {
    const chip = t('medication.scheduleChip.every_n_days').replace('N', String(rule.interval));
    preview = `${chip} · ${(rule.timesOfDay ?? []).sort().join(', ')}`;
  } else {
    // one_off
    preview = `${t('medication.scheduleChip.one_off')} · ${rule.startAt.slice(11, 16)}`;
  }

  // F3: append inactive marker
  if (!plan.active) {
    preview += ` · ${t('medication.inactiveTag')}`;
  }
  return preview;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function MedicationPlanListScreen({
  onManageConsents,
  onLogDose,
}: MedicationPlanListScreenProps): React.JSX.Element {
  const { t } = useT();

  // ── Plans state ───────────────────────────────────────────────────────────
  const [plans, setPlans] = useState<MedicationPlan[]>([]);
  const [screenState, setScreenState] = useState<'loading' | 'list' | 'error'>('loading');

  // ── Connectivity (B3) ──────────────────────────────────────────────────────
  // Honest fix (design review): this was `const [isOffline] = useState(false)`
  // — a setter-less state that could NEVER become true, i.e. a dead pill that
  // always rendered nothing. No connectivity signal is wired into this screen
  // by the navigator (BottomTabNavigator.tsx — a shared file this cluster
  // cannot edit — does not pass an isOffline prop), so rather than keep a
  // branch that can never fire, the offline pill is removed here. Re-add it
  // once BottomTabNavigator threads a real connectivity signal through
  // (see report: shared-file change needed).

  // ── general_health consent state — B4 ─────────────────────────────────────
  const [healthConsentGranted, setHealthConsentGranted] = useState(
    () => consentStore.isGranted('general_health'),
  );

  // ── Form sheet state ──────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editPlan, setEditPlan] = useState<MedicationPlan | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  // ── Consent nudge (inside form sheet) ────────────────────────────────────
  const [showConsentNudge, setShowConsentNudge] = useState(false);

  // ── Toast state ───────────────────────────────────────────────────────────
  const [toastKey, setToastKey] = useState<ToastVariant | null>(null);

  // ── pendingPayloadRef — consent-gated save (mirrors CaptureScreen) ────────
  // Holds the freshly-built MedicationPlanInput while waiting for consent grant.
  // Stale-callback-safe: payload is built at gate time from LIVE form values.
  const pendingPayloadRef = useRef<MedicationPlanInput | null>(null);
  const pendingEditIdRef = useRef<string | null>(null);

  // ── Load plans ────────────────────────────────────────────────────────────

  function refreshPlans() {
    try {
      const all = medicationPlanSyncStore.getPlans();
      setPlans(all);
      setScreenState('list');
    } catch {
      // loadError — caught; not propagated (store is in-memory, low failure risk)
      setScreenState('error');
    }
  }

  useEffect(() => {
    refreshPlans();
  }, []);

  // ── useFocusEffect: execute pending consent-gated save on return ──────────
  // Uses resolvePendingSave (pure, unit-tested — mobile Blocker 2).
  // Mobile Blocker 1: toast now uses cloudGranted ? 'saved' : 'savedLocalOnly'.
  useFocusEffect(
    useCallback(() => {
      // Re-read consent on every focus (may have changed in ManageConsents)
      const consentNow = consentStore.isGranted('general_health');
      setHealthConsentGranted(consentNow);

      const resolution = resolvePendingSave(
        pendingPayloadRef.current,
        pendingEditIdRef.current,
        consentNow,
        consentStore.isGranted('cloud_storage'),
      );

      if (resolution.action === 'hold') return;

      // Consent granted — execute the pending save
      const payload = pendingPayloadRef.current!;
      const editId = pendingEditIdRef.current;
      pendingPayloadRef.current = null;
      pendingEditIdRef.current = null;
      setShowConsentNudge(false);
      setIsSaving(true);
      try {
        if (resolution.action === 'persist-edit' && editId) {
          medicationPlanSyncStore.updatePlan(editId, payload);
        } else {
          medicationPlanSyncStore.addPlan(payload);
        }
        refreshPlans();
        setShowForm(false);
        showToast(resolution.toast ?? 'saved');
      } catch {
        showToast('error');
      } finally {
        setIsSaving(false);
      }
    }, []),
  );

  // ── Toast state ── (inline polite live-region toast, B6) ─────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Toast helpers — B6 replaces Alert.alert with polite live region ───────
  function showToast(variant: ToastVariant) {
    setToastKey(variant);
    const messages: Record<ToastVariant, string> = {
      saved: t('medication.saveToast'),
      savedLocalOnly: t('medication.savedLocalOnly'),
      deactivated: t('medication.deactivateToast'),
      deleted: t('medication.deleteToast'),
      error: t('medication.saveError'),
    };
    setToastMessage(messages[variant]);
  }

  function dismissToast() {
    setToastKey(null);
    setToastMessage(null);
  }

  // ── Form open / close ─────────────────────────────────────────────────────

  function openAddForm() {
    setEditPlan(undefined);
    setShowConsentNudge(false);
    setShowForm(true);
  }

  function openEditForm(plan: MedicationPlan) {
    setEditPlan(plan);
    setShowConsentNudge(false);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditPlan(undefined);
    setShowConsentNudge(false);
    // GROUP E: clear pending refs on explicit form close (not consent-flow close)
    pendingPayloadRef.current = null;
    pendingEditIdRef.current = null;
  }

  // ── Save handler (consent-gated orchestration) ────────────────────────────

  function handleFormSave(
    name: string,
    dose: string,
    pickerState: SchedulePickerState,
    active: boolean,
  ) {
    const result = orchestrateMedSave({
      saveEnabled: true,
      consentGranted: consentStore.isGranted('general_health'),
      name,
      dose,
      pickerState,
      active,
    });

    if (result.action === 'skip') return;

    if (result.action === 'gate') {
      // general_health not granted — hold payload, show consent nudge.
      // Form stays open; values are held in MedicationPlanFormSheet's local state.
      pendingPayloadRef.current = result.payload;
      pendingEditIdRef.current = editPlan?.id ?? null;
      setShowConsentNudge(true);
      return;
    }

    // action === 'persist' — consent granted; local write is fast (<100ms)
    setIsSaving(true);
    try {
      const cloudGranted = consentStore.isGranted('cloud_storage');

      if (editPlan) {
        medicationPlanSyncStore.updatePlan(editPlan.id, result.payload);
      } else {
        medicationPlanSyncStore.addPlan(result.payload);
      }

      refreshPlans();
      setShowForm(false);

      // cloud_storage absent → local save succeeds + "not synced" toast (§7.2)
      showToast(cloudGranted ? 'saved' : 'savedLocalOnly');
    } catch {
      showToast('error');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Deactivate (1-tap, no dialog) ─────────────────────────────────────────

  function handleDeactivate(id: string) {
    try {
      medicationPlanSyncStore.updatePlan(id, { active: false });
      refreshPlans();
      setShowForm(false);
      showToast('deactivated');
    } catch {
      showToast('error');
    }
  }

  // ── Reactivate (1-tap) ────────────────────────────────────────────────────

  function handleReactivate(id: string) {
    try {
      medicationPlanSyncStore.updatePlan(id, { active: true });
      refreshPlans();
      setShowForm(false);
      showToast('saved');
    } catch {
      showToast('error');
    }
  }

  // ── Delete (2-step confirm; tombstone) ────────────────────────────────────

  function handleDelete(id: string) {
    try {
      medicationPlanSyncStore.tombstonePlan(id);
      refreshPlans();
      setShowForm(false);
      showToast('deleted');
    } catch {
      showToast('error');
    }
  }

  // ── Consent nudge → ManageConsents ───────────────────────────────────────

  function handleManageConsents() {
    // Keep form open (values held in MedicationPlanFormSheet's local state).
    // pendingPayloadRef holds the built payload for the focus-return path.
    onManageConsents();
  }

  // ── Derived: active vs inactive plans ────────────────────────────────────

  const activePlans = plans.filter((p) => p.active);
  const inactivePlans = plans.filter((p) => !p.active);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>

      {/* ── Top bar: title + Add (M4) ─────────────────────────────────────── */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle} accessibilityRole="header">
          {t('medication.navTitle')}
        </Text>
        <View style={styles.topBarRight}>
          {/*
            B3 offline pill removed here — it was dead (`useState(false)` with
            no setter, so it could never render). No connectivity signal is
            wired into this screen (see report). Re-add once one is threaded
            through from BottomTabNavigator.
          */}
          <TouchableOpacity
            testID="med-add-top"
            style={styles.topAddBtn}
            onPress={openAddForm}
            accessibilityRole="button"
            accessibilityLabel={t('medication.add')}
          >
            <Text style={styles.topAddBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* B4: general_health consent nudge banner (§7.1) */}
      {!healthConsentGranted && (
        <TouchableOpacity
          testID="consent-home-health-logging-nudge-banner"
          style={styles.consentBanner}
          onPress={handleManageConsents}
          accessibilityRole="button"
          accessibilityLabel={t('medication.consentBannerAction')}
        >
          <Text style={styles.consentBannerText}>{t('medication.consentBannerAction')}</Text>
        </TouchableOpacity>
      )}

      {/* B2: Loading skeleton (§8.1) */}
      {screenState === 'loading' && (
        <View
          style={styles.listContent}
          accessibilityLabel={t('medication.loadingSkeleton')}
          accessibilityLiveRegion="polite"
        >
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      )}

      {/* B5: Error state — calm panel + data-still-here + Retry (Primary) (§8.9) */}
      {screenState === 'error' && (
        <View
          style={styles.errorPanel}
          accessibilityLiveRegion="assertive"
          importantForAccessibility="yes"
        >
          <Text style={styles.errorHeadline}>{t('medication.loadError')}</Text>
          <Text style={styles.errorSubtitle}>{t('medication.dataStillHere')}</Text>
          <TouchableOpacity
            testID="med-error-retry"
            style={styles.retryBtn}
            onPress={refreshPlans}
            accessibilityRole="button"
            accessibilityLabel={t('general.retry')}
          >
            <Text style={styles.retryBtnText}>{t('general.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Empty state */}
      {screenState === 'list' && plans.length === 0 && (
        <View style={styles.emptyState} testID="med-empty-state">
          {/* Illustration placeholder (asset provided by design post-MVP) */}
          <View style={styles.emptyIllustration} />
          <Text style={styles.emptyHeadline}>{t('medication.emptyHeadline')}</Text>
          <Text style={styles.emptyBody}>{t('medication.emptyBody')}</Text>
          <TouchableOpacity
            testID="med-add-first"
            style={styles.addFirstBtn}
            onPress={openAddForm}
            accessibilityRole="button"
            accessibilityLabel={t('medication.addFirst')}
          >
            <Text style={styles.addFirstBtnText}>{t('medication.addFirst')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* List state (§8.3) */}
      {screenState === 'list' && plans.length > 0 && (
        <FlatList
          testID="med-plan-list"
          data={[
            // Active band
            ...activePlans.map((p) => ({ ...p, _band: 'active' as const })),
            // Divider (synthetic item — only when both bands have entries)
            ...(activePlans.length > 0 && inactivePlans.length > 0
              ? [{ _band: 'divider' as const, id: '__divider__', name: '', active: false, version: 0, createdAt: '', updatedAt: '', deletedAt: null }]
              : []),
            // Inactive band
            ...inactivePlans.map((p) => ({ ...p, _band: 'inactive' as const })),
          ]}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            // Divider row
            if (item._band === 'divider') {
              return (
                <View style={styles.dividerRow} accessibilityElementsHidden>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerLabel}>{t('medication.pausedDivider')}</Text>
                  <View style={styles.dividerLine} />
                </View>
              );
            }

            const plan = item as MedicationPlan & { _band: 'active' | 'inactive' };
            const planName = displayName(plan);
            const planDose = displayDose(plan);
            const preview = buildSchedulePreview(plan, t);

            // B9: Composed SR label (§10.4)
            const doseSegment = planDose ? ` ${t('medication.fieldDose').split(' ')[0]}: ${planDose}.` : '';
            const rowSrLabel = `${t('medication.navTitle')}: ${planName}.${doseSegment} ${t('medication.fieldSchedule')}: ${preview}. ${plan.active ? t('medication.fieldActive') : t('medication.inactiveTag')}. ${t('medication.encryptionNotice')}.`;
            const toggleSrLabel = plan.active
              ? `${t('medication.fieldActive')} · ${t('medication.deactivate')}`
              : `${t('medication.inactiveTag')} · ${t('medication.reactivate')}`;

            return (
              <View
                style={[styles.planCard, !plan.active ? styles.planCardInactive : null]}
              >
                {/* Plan row body + trailing switch */}
                <View style={styles.planCardRow}>
                  {/* Row body — opens Edit sheet */}
                  <TouchableOpacity
                    testID={`med-plan-card-${plan.id}`}
                    style={styles.planCardContent}
                    onPress={() => openEditForm(plan)}
                    accessibilityRole="button"
                    accessibilityLabel={rowSrLabel}
                    accessibilityHint={undefined}
                  >
                    {/* F2: Leading pill glyph */}
                    <View
                      style={!plan.active ? styles.pillGlyphInactive : undefined}
                      accessibilityElementsHidden
                    >
                      <TabPillIcon color={T.color.accent.interactive} size={20} />
                    </View>

                    <View style={styles.planCardMain}>
                      {/* Name */}
                      <Text
                        style={[styles.planName, !plan.active ? styles.planNameInactive : null]}
                        numberOfLines={1}
                      >
                        {planName}
                      </Text>
                      {/* F2: dose segment */}
                      {planDose ? (
                        <Text style={styles.planDose} numberOfLines={1}>{planDose}</Text>
                      ) : null}
                      {/* F3: schedule preview (localized, inactive appended) */}
                      <Text style={styles.planPreview} numberOfLines={1}>{preview}</Text>
                      {/* F2: encryption notice (§3) */}
                      <View style={styles.encryptionNoticeRow} accessibilityElementsHidden>
                        <LockIcon color={T.color.text.primary} size={11} />
                        <Text style={styles.encryptionNotice}>
                          {t('medication.encryptionNotice')}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* B1: trailing Switch — 1-tap deactivate/reactivate (§3/§6.1/§8.3) */}
                  <View style={styles.rowToggleZone}>
                    <Switch
                      testID={`med-plan-toggle-${plan.id}`}
                      value={plan.active}
                      onValueChange={(val) => {
                        if (val) {
                          handleReactivate(plan.id);
                        } else {
                          handleDeactivate(plan.id);
                        }
                      }}
                      trackColor={{ false: T.color.surface.divider, true: T.color.list.bar.pregnancy }}
                      thumbColor={T.color.text.onDark}
                      accessibilityRole="switch"
                      accessibilityLabel={toggleSrLabel}
                      accessibilityState={{ checked: plan.active }}
                    />
                  </View>
                </View>

                {/* Log a dose — quiet affordance (Task 11).
                    Only shown for active plans and when the onLogDose callback is wired.
                    Sits below the row body so it doesn't compete with the edit tap
                    (row body) or the active toggle (trailing Switch).
                    Visibility decided by shouldShowLogDose pure helper (TDD-tested). */}
                {shouldShowLogDose(plan, !!onLogDose) ? (
                  <TouchableOpacity
                    testID={`med-plan-log-btn-${plan.id}`}
                    style={styles.logDoseBtn}
                    onPress={() => onLogDose?.(plan.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('medication.logDose')} — ${planName}`}
                  >
                    <Text style={styles.logDoseBtnText}>{t('medication.logDose')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Form sheet (add/edit) */}
      <MedicationPlanFormSheet
        visible={showForm}
        existingPlan={editPlan}
        isSaving={isSaving}
        showConsentNudge={showConsentNudge}
        onSave={handleFormSave}
        onDeactivate={handleDeactivate}
        onReactivate={handleReactivate}
        onDelete={handleDelete}
        onManageConsents={handleManageConsents}
        onClose={closeForm}
      />

      {/* B6: Inline toast (polite live region — replaces Alert.alert) */}
      {toastMessage !== null && (
        <InlineToast message={toastMessage} onDismiss={dismissToast} />
      )}

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,        // #FBF6F1 ivory-100 (was #FBF6F1 literal)
  },

  // ── Top bar (M4: title + connectivity pill + Add) ─────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingVertical: 10,
  },
  topBarTitle: {
    fontFamily: T.type.heading2.fontFamily,        // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.heading2.size,                // 20sp
    lineHeight: T.type.heading2.lineHeight,        // 33
    color: T.color.text.heading,                   // #4A2230 roselle-900 (from #3A2A30)
    fontWeight: T.type.heading2.fontWeight,        // '600'
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topAddBtn: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topAddBtnText: {
    fontFamily: T.type.label.fontFamily,           // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: 22,
    color: T.color.accent.interactive,             // #9A5F0A amber-700 (from #A8505A)
  },

  // ── Consent nudge banner (B4 — §7.1) ──────────────────────────────────────
  consentBanner: {
    backgroundColor: T.color.surface.wash.roselle, // #F2D0DC roselle-200 (from #FBEDEE)
    marginHorizontal: T.spacing[4],               // 16dp
    marginBottom: 8,
    borderRadius: T.radius.sm,                    // 6dp (from 10dp)
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: 'center',
    borderLeftWidth: T.list.row.accentBar.width,  // 3dp
    borderLeftColor: T.color.accent.identity,     // #B85C78 roselle-500 (from #A8505A)
  },
  consentBannerText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular (from IBMPlexSans-Medium)
    fontSize: T.type.body.size,                    // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #A8505A)
  },

  // ── Error panel (B5 — §8.9: calm + data-still-here + Retry Primary) ───────
  errorPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorHeadline: {
    fontFamily: T.type.bodyLarge.fontFamily,       // Sarabun-Regular (from IBMPlexSans-SemiBold)
    fontSize: T.type.bodyLarge.size,               // 17sp
    lineHeight: T.type.bodyLarge.lineHeight,       // 28
    color: T.color.text.heading,                   // #4A2230 roselle-900 (from #3A2A30)
    textAlign: 'center',
    fontWeight: '600',
  },
  errorSubtitle: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #5F4A52)
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: T.button.primary.bg,         // #9A5F0A amber-700 (from #A8505A)
    borderRadius: T.button.primary.radius,         // 12dp (from 100/pill — spec: CTA uses md radius)
    minHeight: T.button.primary.height,            // 52dp
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  retryBtnText: {
    fontFamily: T.type.label.fontFamily,           // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                    // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.onDark,                    // #FFFFFF
    fontWeight: T.type.label.fontWeight,           // '600'
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 12,
  },
  emptyIllustration: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: T.color.surface.subtle,      // #F5EDE6 ivory-200 (from #EBE1D9)
    marginBottom: 8,
  },
  emptyHeadline: {
    fontFamily: T.type.heading2.fontFamily,        // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.heading2.size,                // 20sp
    lineHeight: T.type.heading2.lineHeight,        // 33
    color: T.color.text.heading,                   // #4A2230 roselle-900 (from #3A2A30)
    textAlign: 'center',
    fontWeight: T.type.heading2.fontWeight,        // '600'
  },
  emptyBody: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #5F4A52)
    textAlign: 'center',
  },
  addFirstBtn: {
    backgroundColor: T.button.primary.bg,         // #9A5F0A amber-700 (from #A8505A)
    borderRadius: T.button.primary.radius,         // 12dp (from 100/pill)
    minHeight: T.button.primary.height,            // 52dp
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  addFirstBtnText: {
    fontFamily: T.type.label.fontFamily,           // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                    // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.onDark,                    // #FFFFFF
    fontWeight: T.type.label.fontWeight,           // '600'
  },

  // ── List ───────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingBottom: 24,
  },

  // ── Divider (active/inactive band separator) ───────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: T.color.surface.divider,     // #E8DDD5 (from #EBE1D9)
  },
  dividerLabel: {
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular (from IBMPlexSans-Medium)
    fontSize: T.type.caption.size,                 // 13sp (from 12sp — text.primary R4 at 13sp)
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #94818A — not jade-600 at 13sp R4)
    // textTransform: 'uppercase' REMOVED — Thai typography rule (no uppercase Thai)
  },

  // ── Plan card (F2: leading glyph + dose + encryption notice; B1: Switch) ───
  planCard: {
    backgroundColor: T.input.bg,                  // #F5EDE6 ivory-200 (from #FFFFFF — no white surfaces)
    borderRadius: T.radius.md,                    // 12dp
    marginBottom: 10,
    borderWidth: 1,
    borderColor: T.color.surface.divider,          // #E8DDD5 (from #EBE1D9)
    // flexDirection changed to column so logDoseBtn sits below the row
    flexDirection: 'column',
  },
  // Inactive card: distinguished by a flatter surface (ivory-100 vs ivory-200)
  // only — NOT by a blanket `opacity` on the whole card. A whole-subtree
  // opacity dims caption text (13sp, text.primary 7.70:1 AAA on ivory-100)
  // down toward ~4.2:1, silently failing AA. The glyph carries the "inactive"
  // visual cue instead (pillGlyphInactive, decorative-only, hidden from SR).
  planCardInactive: {
    backgroundColor: T.color.surface.base,         // #FBF6F1 ivory-100 (from #FBF6F1 literal)
  },
  // Inner row: edit-body + trailing switch, side-by-side
  planCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
  },
  // Row body: occupies flex-1, opens Edit sheet
  planCardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingVertical: 14,
    gap: 10,
    minHeight: 72,
  },
  // F2: leading medication glyph
  pillGlyphInactive: {
    opacity: 0.4,
  },
  planCardMain: {
    flex: 1,
  },
  planName: {
    fontFamily: T.type.bodyLarge.fontFamily,       // Sarabun-Regular (from IBMPlexSans-SemiBold)
    fontSize: T.type.bodyLarge.size,               // 17sp (from 16sp — per spec "type.body.large 17sp")
    lineHeight: T.type.bodyLarge.lineHeight,       // 28
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #3A2A30)
    fontWeight: '600',
  },
  planNameInactive: {
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #5F4A52)
  },
  // F2: dose segment
  planDose: {
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                 // 13sp — text.primary (not jade-600 at 13sp R4)
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #5F4A52)
    marginTop: 1,
  },
  planPreview: {
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                 // 13sp — per spec "type.caption text.primary 13sp"
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #5F4A52)
    marginTop: 2,
  },
  // F2: encryption notice
  encryptionNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  encryptionNotice: {
    fontFamily: T.type.micro.fontFamily,           // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.micro.size,                   // 11sp (from 12sp)
    lineHeight: T.type.micro.lineHeight,           // 18
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #94818A)
  },

  // B1: trailing Switch zone — ≥48×48dp, ≥12dp clear of row body
  rowToggleZone: {
    paddingHorizontal: 12,
    minWidth: 72,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Log a dose affordance (Task 11) ───────────────────────────────────────
  // Quiet link inside each active plan card; sits below the row body so it
  // never competes with the edit tap (row body) or the active toggle.
  // Styled as a small underlined text link (design-system "quiet affordance").
  //
  // A11y fixes (design-reviewer blockers):
  //   1. minHeight raised from 36 → 48 to meet the ≥48×48dp touch-target floor.
  //      paddingTop/paddingBottom ensure the tap area fills the full 48dp even
  //      though the visible text is smaller.
  //   2. marginTop: 8 provides ≥8dp vertical separation from the planCardRow
  //      edit target so a mis-tap at the bottom of the row body cannot land on
  //      the log-dose link.
  logDoseBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingBottom: 12,
    paddingTop: 4,
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  logDoseBtnText: {
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular (from IBMPlexSans-Medium)
    fontSize: T.type.caption.size,                 // 13sp (from 13sp — not jade-600 at 13sp R4)
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #8E3A44)
    textDecorationLine: 'underline',
  },
});
