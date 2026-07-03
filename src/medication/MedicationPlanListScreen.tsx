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
  Alert,
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
  buildScheduleRuleFromPicker,
  type SchedulePickerState,
} from './medicationPlanFormLogic';
import { MedicationPlanFormSheet } from './MedicationPlanFormSheet';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MedicationPlanListScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  onManageConsents: () => void;
}

// ─── Toast helper (minimal — no native deps needed) ──────────────────────────

type ToastVariant = 'saved' | 'savedLocalOnly' | 'deactivated' | 'deleted' | 'error';

// ─── Display-safe plan name decoder ──────────────────────────────────────────
// Security: result is display-only. DO NOT log the decoded value (SD-2/SD-5).
function displayName(plan: MedicationPlan): string {
  return decodeFieldFromBase64(plan.name) ?? '—';
}

// ─── Build echo preview text for list item ────────────────────────────────────
function buildSchedulePreview(plan: MedicationPlan): string {
  const rule = plan.scheduleRule;
  if (!rule) return 'PRN';
  if (rule.freq === 'daily') {
    return `ทุกวัน · ${(rule.timesOfDay ?? []).sort().join(', ')}`;
  }
  if (rule.freq === 'every_n_days') {
    return `ทุก ${rule.interval} วัน · ${(rule.timesOfDay ?? []).sort().join(', ')}`;
  }
  return `ครั้งเดียว · ${rule.startAt.slice(11, 16)}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function MedicationPlanListScreen({
  onManageConsents,
}: MedicationPlanListScreenProps): React.JSX.Element {
  const { t } = useT();

  // ── Plans state ───────────────────────────────────────────────────────────
  const [plans, setPlans] = useState<MedicationPlan[]>([]);
  const [screenState, setScreenState] = useState<'loading' | 'list' | 'error'>('loading');

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
  // When user returns from ManageConsents with consent granted, auto-complete save.
  useFocusEffect(
    useCallback(() => {
      const pending = pendingPayloadRef.current;
      if (!pending) return;

      if (consentStore.isGranted('general_health')) {
        // Consent now granted — execute the pending save
        pendingPayloadRef.current = null;
        setShowConsentNudge(false);
        setIsSaving(true);
        try {
          const editId = pendingEditIdRef.current;
          pendingEditIdRef.current = null;
          if (editId) {
            medicationPlanSyncStore.updatePlan(editId, pending);
          } else {
            medicationPlanSyncStore.addPlan(pending);
          }
          refreshPlans();
          setShowForm(false);
          showToast('saved');
        } catch {
          showToast('error');
        } finally {
          setIsSaving(false);
        }
      }
    }, []),
  );

  // ── Toast helpers ─────────────────────────────────────────────────────────

  function showToast(variant: ToastVariant) {
    setToastKey(variant);
    // Auto-dismiss after 3 s (using Alert for MVP — replace with a toast lib post-MVP)
    const messages: Record<ToastVariant, string> = {
      saved: t('medication.saveToast'),
      savedLocalOnly: t('medication.savedLocalOnly'),
      deactivated: t('medication.deactivateToast'),
      deleted: t('medication.deleteToast'),
      error: t('medication.saveError'),
    };
    Alert.alert('', messages[variant], [{ text: 'OK', onPress: () => setToastKey(null) }]);
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
    // Keep pendingPayloadRef; it may still be resolved when user returns from ManageConsents
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

      {/* Top action row */}
      <View style={styles.topBar}>
        <TouchableOpacity
          testID="med-add-top"
          style={styles.topAddBtn}
          onPress={openAddForm}
          accessibilityRole="button"
          accessibilityLabel={t('medication.add')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.topAddBtnText}>{t('medication.add')}</Text>
        </TouchableOpacity>
      </View>

      {/* Error state */}
      {screenState === 'error' && (
        <View style={styles.errorState}>
          <Text style={styles.errorText}>{t('medication.loadError')}</Text>
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

      {/* List state */}
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
            const preview = buildSchedulePreview(plan);

            return (
              <TouchableOpacity
                testID={`med-plan-card-${plan.id}`}
                style={[styles.planCard, !plan.active ? styles.planCardInactive : null]}
                onPress={() => openEditForm(plan)}
                accessibilityRole="button"
                accessibilityLabel={`${planName}${!plan.active ? ` · ${t('medication.inactiveTag')}` : ''}`}
              >
                <View style={styles.planCardContent}>
                  <View style={styles.planCardMain}>
                    <Text style={styles.planName} numberOfLines={1}>{planName}</Text>
                    <Text style={styles.planPreview} numberOfLines={1}>{preview}</Text>
                  </View>
                  {!plan.active && (
                    <View style={styles.inactiveTag}>
                      <Text style={styles.inactiveTagText}>{t('medication.inactiveTag')}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
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

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },

  // ── Top bar ────────────────────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  topAddBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  topAddBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#A8505A',
  },

  // ── Error state ────────────────────────────────────────────────────────────
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#5F4A52',
    textAlign: 'center',
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
    backgroundColor: '#EBE1D9',
    marginBottom: 8,
  },
  emptyHeadline: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 20,
    color: '#3A2A30',
    textAlign: 'center',
    fontWeight: '700',
  },
  emptyBody: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#5F4A52',
    textAlign: 'center',
    lineHeight: 22,
  },
  addFirstBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 100,
    minHeight: 52,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  addFirstBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // ── List ───────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: 16,
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
    backgroundColor: '#EBE1D9',
  },
  dividerLabel: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 12,
    color: '#94818A',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // ── Plan card ──────────────────────────────────────────────────────────────
  planCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    minHeight: 64,
    justifyContent: 'center',
  },
  planCardInactive: {
    backgroundColor: '#FBF6F1',
    opacity: 0.75,
  },
  planCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  planCardMain: {
    flex: 1,
  },
  planName: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#3A2A30',
    fontWeight: '600',
  },
  planPreview: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#5F4A52',
    marginTop: 3,
  },

  // ── Inactive tag ───────────────────────────────────────────────────────────
  inactiveTag: {
    backgroundColor: '#EBE1D9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  inactiveTagText: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 11,
    color: '#5F4A52',
  },
});
