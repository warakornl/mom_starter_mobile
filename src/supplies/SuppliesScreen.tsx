/**
 * SuppliesScreen — offline-first list of birth-prep supply items.
 *
 * Implements: supplies-feature §2 (list + CRUD) + §6 (low-supply alert placeholder).
 *
 * Architecture:
 *   - Creates a module-scoped SyncStore and SyncClient once so items survive
 *     component re-mounts within the same JS session. Data is fresh on each
 *     app launch (in-memory store) and repopulated via syncClient.pull().
 *   - All mutations (create/update/delete) are:
 *       1. Applied optimistically to the store (store.enqueueCreate/Update/Delete)
 *       2. Immediately pushed to the server via syncClient.push(drainQueue())
 *       3. Store state re-read and screen setState for UI refresh
 *   - Pull runs on mount + foreground (AppState 'active').
 *   - Idempotency-Key (uuid v4) generated per push call.
 *   - accessToken retrieved from tokenStorage on each network call.
 *
 * Contract compliance:
 *   - push: uses store.drainQueue() to build SyncChangeSet; passes lastPulledAt
 *     from store.getWatermark() (zero string if never pulled).
 *   - pull: passes watermark from store so delta pulls are used after first sync.
 *   - applied[]: stamped on store by syncClient (no screen-side stamp needed).
 *   - conflicts[]: adopted by syncClient; screen detects count for user note.
 *   - rejected[]: shown as a brief inline note.
 *   - Idempotency-Key: uuid v4 per push for safe retry.
 *
 * testIDs:
 *   supplies-add          — FAB / add button
 *   supplies-item         — each supply row (supply item)
 *   supplies-refresh      — pull-to-sync button
 *   supplies-form-name    — name TextInput in add/edit form
 *   supplies-form-save    — save button in form
 *   supplies-sync-error   — sync error banner
 *
 * i18n: useT() from LanguageContext. All strings from catalog supplies.*.
 *
 * Security: NEVER log accessToken. supplyItems is NON-health (cloud_storage)
 * so no health fields are present in this screen.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Alert,
  Modal,
  ScrollView,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import type { TokenStorage } from '../auth/tokenStorage';
import { createSyncClient } from '../sync/syncClient';
import { supplySyncStore } from '../sync/supplySyncStore';
import { executePush } from '../sync/pushOrchestrator';
import type { SupplyItemRecord, SupplyCategory, RejectedRecord } from '../sync/syncTypes';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { T } from '../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SuppliesScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Called when user presses the back/close button. */
  onBack?: () => void;
  /**
   * Called when user taps the "Auto-decrement settings ›" button.
   * Entry point to Screen 1 (AutoDecrementSettingsScreen).
   * Wired in BottomTabNavigator → RootNavigator.
   */
  onAutoDecrementSettings?: () => void;
}

interface FormState {
  id?: string; // undefined = new item
  name: string;
  category: SupplyCategory;
  unit: string;
  onHandQty: string; // string for TextInput, parsed to int on save
  lowThreshold: string;
}

const EMPTY_FORM: FormState = {
  id: undefined,
  name: '',
  category: 'other',
  unit: '',
  onHandQty: '0',
  lowThreshold: '',
};

const CATEGORIES: SupplyCategory[] = [
  'diapers',
  'feeding',
  'hygiene',
  'health-supplies',
  'other',
];

// ─── Category selector ────────────────────────────────────────────────────────

function CategorySelector({
  value,
  onChange,
}: {
  value: SupplyCategory;
  onChange: (c: SupplyCategory) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={formStyles.categoryRow}>
      {CATEGORIES.map((cat) => (
        <TouchableOpacity
          key={cat}
          style={[formStyles.categoryChip, value === cat && formStyles.categoryChipSelected]}
          onPress={() => onChange(cat)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === cat }}
        >
          <Text
            style={[
              formStyles.categoryChipText,
              value === cat && formStyles.categoryChipTextSelected,
            ]}
          >
            {t(`supplies.category.${cat}` as
              | 'supplies.category.diapers'
              | 'supplies.category.feeding'
              | 'supplies.category.hygiene'
              | 'supplies.category.health-supplies'
              | 'supplies.category.other')}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── Add / edit form modal ────────────────────────────────────────────────────

function SupplyFormModal({
  visible,
  form,
  onChange,
  onSave,
  onCancel,
}: {
  visible: boolean;
  form: FormState;
  onChange: (f: Partial<FormState>) => void;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useT();
  const isEdit = Boolean(form.id);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={formStyles.container}>
        <View style={formStyles.header}>
          <Text style={formStyles.title}>
            {isEdit ? t('supplies.editTitle') : t('supplies.addTitle')}
          </Text>
          <TouchableOpacity onPress={onCancel} accessibilityRole="button" accessibilityLabel={t('general.cancel')}>
            <Text style={formStyles.cancelBtn}>{t('general.cancel')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={formStyles.body} contentContainerStyle={formStyles.bodyContent}>
          {/* Name */}
          <Text style={formStyles.label}>{t('supplies.fieldName')}</Text>
          <TextInput
            testID="supplies-form-name"
            style={formStyles.input}
            value={form.name}
            onChangeText={(v) => onChange({ name: v })}
            placeholder={t('supplies.namePlaceholder')}
            placeholderTextColor={T.input.placeholder}
            autoFocus={!isEdit}
            returnKeyType="next"
          />

          {/* Category */}
          <Text style={formStyles.label}>{t('supplies.fieldCategory')}</Text>
          <CategorySelector
            value={form.category}
            onChange={(c) => onChange({ category: c })}
          />

          {/* Unit */}
          <Text style={formStyles.label}>{t('supplies.fieldUnit')}</Text>
          <TextInput
            style={formStyles.input}
            value={form.unit}
            onChangeText={(v) => onChange({ unit: v })}
            placeholder={t('supplies.unitPlaceholder')}
            placeholderTextColor={T.input.placeholder}
            returnKeyType="next"
          />

          {/* Qty on hand */}
          <Text style={formStyles.label}>{t('supplies.fieldOnHandQty')}</Text>
          <TextInput
            style={formStyles.input}
            value={form.onHandQty}
            onChangeText={(v) => onChange({ onHandQty: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            returnKeyType="next"
          />

          {/* Low threshold */}
          <Text style={formStyles.label}>{t('supplies.fieldLowThreshold')}</Text>
          <TextInput
            style={formStyles.input}
            value={form.lowThreshold}
            onChangeText={(v) => onChange({ lowThreshold: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
        </ScrollView>

        <View style={formStyles.footer}>
          <TouchableOpacity
            testID="supplies-form-save"
            style={formStyles.saveBtn}
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel={t('supplies.save')}
          >
            <Text style={formStyles.saveBtnText}>{t('supplies.save')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const formStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.color.surface.base },          // #FBF6F1 (from #FBF6F1 literal)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: T.spacing[4],                                                  // 16dp
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,                             // #E8DDD5 (from #EBE1D9)
  },
  title: {
    fontFamily: T.type.heading2.fontFamily,                                 // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.heading2.size,                                         // 20sp (from 18sp — nearest heading token)
    lineHeight: T.type.heading2.lineHeight,                                 // 33
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #3A2A30)
  },
  cancelBtn: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #A8505A)
  },
  body: { flex: 1 },
  bodyContent: { padding: 20, gap: 12 },
  label: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp) — label text.primary
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  input: {
    borderWidth: 1,
    borderColor: T.input.border.default,                                    // #E8DDD5 (from #EBE1D9)
    borderRadius: T.radius.sm,                                              // 6dp (from 12dp)
    padding: 14,
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 16sp)
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.input.text,                                                    // #4A2230 roselle-900 (from #3A2A30)
    backgroundColor: T.input.bg,                                            // #F5EDE6 ivory-200 (from #FFFFFF)
  },
  categoryRow: { flexGrow: 0 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 48,                                                          // ≥48dp touch target (a11y) — was ~37dp
    justifyContent: 'center',
    borderRadius: T.radius.pill,                                            // 999
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
    marginRight: 8,
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 (from #FFFFFF)
  },
  categoryChipSelected: {
    backgroundColor: T.color.surface.wash.roselle,                          // #F2D0DC roselle-200 (from #FBEDEE)
    borderColor: T.color.accent.identity,                                   // #B85C78 roselle-500 (from #A8505A)
  },
  categoryChipText: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp (from 14sp) — text.primary (R4)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  categoryChipTextSelected: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #8E3A44)
  },
  footer: {
    padding: T.spacing[4],                                                  // 16dp
    borderTopWidth: 1,
    borderTopColor: T.color.surface.divider,                                // #E8DDD5 (from #EBE1D9)
  },
  saveBtn: {
    height: T.button.primary.height,                                        // 52dp ✓
    backgroundColor: T.button.primary.bg,                                   // #9A5F0A amber-700 (from #A8505A)
    borderRadius: T.button.primary.radius,                                  // 12dp (from 999/pill)
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.bodyLarge.size,                                        // 17sp ✓
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.color.text.onDark,                                             // #FFFFFF
  },
});

// ─── Supply item row ──────────────────────────────────────────────────────────

function SupplyRow({
  item,
  onEdit,
  onDelete,
}: {
  item: SupplyItemRecord;
  onEdit: (item: SupplyItemRecord) => void;
  onDelete: (item: SupplyItemRecord) => void;
}): React.JSX.Element {
  const { t } = useT();
  const catKey = `supplies.category.${item.category}` as
    | 'supplies.category.diapers'
    | 'supplies.category.feeding'
    | 'supplies.category.hygiene'
    | 'supplies.category.health-supplies'
    | 'supplies.category.other';

  return (
    <TouchableOpacity
      testID="supplies-item"
      style={rowStyles.row}
      onPress={() => onEdit(item)}
      accessibilityRole="button"
      accessibilityLabel={item.name}
    >
      <View style={rowStyles.info}>
        <Text style={rowStyles.name}>{item.name}</Text>
        <Text style={rowStyles.meta}>
          {t(catKey)}
          {item.unit ? ` · ${item.onHandQty} ${item.unit}` : ` · ${item.onHandQty}`}
        </Text>
      </View>
      <TouchableOpacity
        style={rowStyles.deleteBtn}
        onPress={() => onDelete(item)}
        accessibilityRole="button"
        accessibilityLabel={t('supplies.delete')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={rowStyles.deleteBtnText}>{'×'}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.input.bg,                                            // #F5EDE6 ivory-200 (from #FFFFFF — no white surfaces)
    borderRadius: T.radius.md,                                              // 12dp (from 16dp)
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
    // B3 spec: AccentRow — jade-800 3dp left accent bar for health/supplies rows
    borderLeftWidth: T.list.row.accentBar.width,                            // 3dp
    borderLeftColor: T.list.row.accentBar.health,                           // #2F5042 jade-800
    padding: T.spacing[4],                                                  // 16dp ✓
    gap: 12,
  },
  info: { flex: 1, gap: 2 },
  name: {
    // B3 spec: type.body.large text.primary 17sp
    fontFamily: T.type.bodyLarge.fontFamily,                                // Sarabun-Regular (from IBMPlexSans-SemiBold)
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 16sp)
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    fontWeight: '600',                                                      // bold name
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #3A2A30 — text.primary per spec)
  },
  meta: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp ✓ — text.primary (R4)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.color.surface.subtle,                                // #F5EDE6 ivory-200 (from #FBF3EE)
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 20,
    lineHeight: 24,
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #A8505A)
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function SuppliesScreen({
  tokenStorage,
  apiBaseUrl,
  onAutoDecrementSettings,
}: SuppliesScreenProps): React.JSX.Element {
  const { t } = useT();

  // Display state — refreshed from supplySyncStore after every sync operation
  const [items, setItems] = useState<SupplyItemRecord[]>(supplySyncStore.getSupplyItems());
  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [syncing, setSyncing] = useState(false);
  // syncError: non-null only for genuine server/client errors (not offline).
  // isOffline: true when the last pull or push failed with code='network_error'.
  // Split (review fix, matches ExpensesScreen §4.5): offline shows a calm pill,
  // real errors show the (still blameless-copy) error banner.
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);
  const [rejectedItems, setRejectedItems] = useState<RejectedRecord[]>([]);

  // Undo-delete toast state (review fix — gentler pattern, matches ExpensesScreen)
  const [deleteToastVisible, setDeleteToastVisible] = useState(false);
  const [undoItem, setUndoItem] = useState<SupplyItemRecord | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SyncClient is cheap to create per session (store is module-level singleton)
  const clientRef = useRef(createSyncClient(apiBaseUrl, supplySyncStore));

  // Refresh display from store
  const refreshFromStore = useCallback(() => {
    setItems([...supplySyncStore.getSupplyItems()]);
  }, []);

  // ── Sync pull ───────────────────────────────────────────────────────────────

  const syncPull = useCallback(async () => {
    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    setSyncing(true);
    setSyncError(null);
    setIsOffline(false);

    const result = await clientRef.current.pull(
      tokens.accessToken,
      supplySyncStore.getWatermark(),
    );

    setSyncing(false);
    refreshFromStore();

    if (!result.ok) {
      // 'network_error' = offline (fetch threw); all other codes are real errors.
      // 403 consent_required → sync gated; app works offline
      // 409 watermark_expired → carry-forward: trigger full-resync
      if (result.code === 'network_error') {
        setIsOffline(true);
      } else {
        setSyncError(t('supplies.syncError'));
      }
    }
  }, [tokenStorage, refreshFromStore, t]);

  // ── Sync push ───────────────────────────────────────────────────────────────

  const syncPush = useCallback(async () => {
    if (supplySyncStore.getPendingCount() === 0) return;

    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    setSyncing(true);
    setSyncError(null);
    setIsOffline(false);

    // executePush: drains the queue, pushes, and re-enqueues on fail or
    // rejection (contract §3 — mutations must never be silently lost).
    const result = await executePush(
      supplySyncStore,
      clientRef.current,
      tokens.accessToken,
      uuidv4(),
    );

    setSyncing(false);
    refreshFromStore();

    // Always set banner state unconditionally so a clean subsequent push
    // clears a previously-displayed conflict/rejected banner (🟡-1 fix).
    if (!result.ok) {
      // 'network_error' = offline (fetch threw); all other codes are real errors.
      if (result.code === 'network_error') {
        setIsOffline(true);
      } else {
        setSyncError(t('supplies.syncError'));
      }
      setConflictCount(0);
      setRejectedItems([]);
    } else {
      setConflictCount(result.conflicts.length);
      setRejectedItems(result.rejected);
    }
  }, [tokenStorage, refreshFromStore, t]);

  // ── Mount: pull on foreground ──────────────────────────────────────────────

  useEffect(() => {
    void syncPull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next === 'active') {
        void syncPull();
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [syncPull]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  function openAdd(): void {
    setForm(EMPTY_FORM);
    setFormVisible(true);
  }

  function openEdit(item: SupplyItemRecord): void {
    setForm({
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit ?? '',
      onHandQty: String(item.onHandQty),
      lowThreshold: item.lowThreshold != null ? String(item.lowThreshold) : '',
    });
    setFormVisible(true);
  }

  function updateForm(partial: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function validateForm(): boolean {
    if (!form.name.trim()) {
      Alert.alert('', t('supplies.errorNameRequired'));
      return false;
    }
    const qty = parseInt(form.onHandQty, 10);
    if (isNaN(qty) || qty < 0) {
      Alert.alert('', t('supplies.errorQtyInvalid'));
      return false;
    }
    return true;
  }

  function handleSave(): void {
    if (!validateForm()) return;

    const qty = Math.max(0, parseInt(form.onHandQty, 10) || 0);
    const threshold =
      form.lowThreshold.trim() !== ''
        ? Math.max(0, parseInt(form.lowThreshold, 10) || 0)
        : undefined;

    const now = new Date().toISOString();

    if (form.id) {
      // Update existing item
      const existing = supplySyncStore.getSupplyItem(form.id);
      if (!existing) return;
      const updated: SupplyItemRecord = {
        ...existing,
        name: form.name.trim(),
        category: form.category,
        unit: form.unit.trim() || undefined,
        onHandQty: qty,
        lowThreshold: threshold,
        updatedAt: now, // local estimate; server overrides on push
      };
      supplySyncStore.enqueueUpdate(updated);
    } else {
      // Create new item (client-gen uuid, version=0 sentinel)
      const newItem: SupplyItemRecord = {
        id: uuidv4(),
        name: form.name.trim(),
        category: form.category,
        unit: form.unit.trim() || undefined,
        onHandQty: qty,
        lowThreshold: threshold,
        version: 0,    // create sentinel per contract §5
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      supplySyncStore.enqueueCreate(newItem);
    }

    setFormVisible(false);
    refreshFromStore();
    void syncPush();
  }

  function handleDelete(item: SupplyItemRecord): void {
    Alert.alert(
      t('supplies.deleteConfirmTitle'),
      interpolate(t('supplies.deleteConfirmMsg'), { name: item.name }),
      [
        { text: t('supplies.deleteConfirmCancel'), style: 'cancel' },
        {
          text: t('supplies.deleteConfirmOk'),
          style: 'destructive',
          onPress: () => {
            // Gentler pattern (review fix, aligned with ExpensesScreen's
            // undo-toast): tombstone locally + queue delete immediately, but
            // defer the push + show an Undo toast so the mother has a
            // moment to reverse an accidental delete before it syncs away.
            supplySyncStore.enqueueDelete(item.id);
            refreshFromStore();

            setUndoItem({ ...item });
            setDeleteToastVisible(true);

            if (undoTimerRef.current !== null) {
              clearTimeout(undoTimerRef.current);
            }
            undoTimerRef.current = setTimeout(() => {
              setDeleteToastVisible(false);
              setUndoItem(null);
              undoTimerRef.current = null;
              void syncPush();
            }, 4000);
          },
        },
      ],
    );
  }

  function handleUndoDelete(): void {
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setDeleteToastVisible(false);

    if (!undoItem) return;
    // Re-insert with deletedAt: null — restores local state and queues an
    // update so the item is preserved on the server (LWW: update wins).
    supplySyncStore.enqueueUpdate({ ...undoItem, deletedAt: null });
    setUndoItem(null);
    refreshFromStore();
    void syncPush();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Sync status bar */}
      {syncing && (
        <View style={styles.syncBar}>
          <Text style={styles.syncBarText}>{t('supplies.loading')}</Text>
        </View>
      )}
      {/* Offline pill (review fix, matches ExpensesScreen §4.5): calm warm-neutral;
          list stays interactive. Shown for network_error only — NOT the error banner. */}
      {isOffline && !syncing && (
        <View testID="supplies-offline-pill" style={styles.offlinePill}>
          <Text style={styles.offlinePillText}>{t('supplies.offlinePill')}</Text>
        </View>
      )}
      {/* Error banner: genuine server/client errors only (not offline). */}
      {syncError && (
        <TouchableOpacity
          testID="supplies-sync-error"
          style={styles.errorBar}
          onPress={() => void syncPull()}
        >
          <Text style={styles.errorBarText}>{syncError}</Text>
        </TouchableOpacity>
      )}
      {conflictCount > 0 && (
        <View style={styles.infoBar}>
          <Text style={styles.infoBarText}>{t('supplies.conflictNote')}</Text>
        </View>
      )}
      {rejectedItems.length > 0 && (
        <View style={styles.warnBar}>
          <Text style={styles.warnBarText}>{t('supplies.rejectedNote')}</Text>
        </View>
      )}

      {/*
       * Item list — Bug #3 fix: style flex:1 constrains the FlatList to the
       * space above the pinned refresh/FAB controls (previously unstyled,
       * so its content could grow behind the absolutely-positioned buttons).
       * The auto-decrement-settings entry is now the ListFooterComponent so
       * it scrolls WITH the list content and never collides with the FAB
       * (bottom:24) or refreshBtn (bottom:80) anchors.
       */}
      <FlatList
        style={styles.listFlex}
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View testID="supplies-empty" style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('supplies.empty')}</Text>
            {/* "Add first item" CTA (review fix, matches ExpensesScreen's empty state). */}
            <TouchableOpacity
              testID="supplies-add-empty"
              style={styles.addFirstBtn}
              onPress={openAdd}
              accessibilityRole="button"
              accessibilityLabel={t('supplies.addFirst')}
            >
              <Text style={styles.addFirstBtnText}>{t('supplies.addFirst')}</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <SupplyRow item={item} onEdit={openEdit} onDelete={handleDelete} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          // Auto-decrement settings entry — SD-9: no params, screen fetches locally.
          // Rendered in-flow (footer) so it scrolls with content — never overlaps
          // the pinned FAB/refresh controls (Bug #3).
          onAutoDecrementSettings ? (
            <TouchableOpacity
              testID="supplies-auto-decrement-settings"
              style={styles.autoDecrementBtn}
              onPress={onAutoDecrementSettings}
              accessibilityRole="button"
              accessibilityLabel={t('supplies.autoDecrementSettings')}
            >
              <Text style={styles.autoDecrementBtnText}>
                {t('supplies.autoDecrementSettings')}
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />

      {/* Refresh button */}
      <TouchableOpacity
        testID="supplies-refresh"
        style={styles.refreshBtn}
        onPress={() => void syncPull()}
        accessibilityRole="button"
        accessibilityLabel={t('supplies.refresh')}
      >
        <Text style={styles.refreshBtnText}>{t('supplies.refresh')}</Text>
      </TouchableOpacity>

      {/* FAB — add item */}
      <TouchableOpacity
        testID="supplies-add"
        style={styles.fab}
        onPress={openAdd}
        accessibilityRole="button"
        accessibilityLabel={t('supplies.add')}
      >
        <Text style={styles.fabText}>{t('supplies.add')}</Text>
      </TouchableOpacity>

      {/* Add / edit form modal */}
      <SupplyFormModal
        visible={formVisible}
        form={form}
        onChange={updateForm}
        onSave={handleSave}
        onCancel={() => setFormVisible(false)}
      />

      {/* Undo-delete toast (review fix — gentler pattern, matches ExpensesScreen) */}
      {deleteToastVisible && (
        <View testID="supplies-delete-toast" style={styles.deleteToast}>
          <Text style={styles.deleteToastText}>{t('supplies.deleteToast')}</Text>
          <TouchableOpacity
            testID="supplies-delete-undo"
            onPress={handleUndoDelete}
            accessibilityRole="button"
            accessibilityLabel={t('supplies.deleteUndo')}
            style={styles.deleteToastUndoBtn}
          >
            <Text style={styles.deleteToastUndoText}>{t('supplies.deleteUndo')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 ivory-100 (from #FBF6F1 literal)
  },

  // Sync status banners — B3 spec: ivory-200 bg + text.primary 15sp blameless copy
  syncBar: {
    backgroundColor: T.color.surface.wash.jade,                             // #E4EDE7 jade-100 (from #EBF2EC — jade progress wash)
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  syncBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp — per spec blameless copy 15sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #4A7A56 — jade-600 at 15sp ok but spec says text.primary)
  },
  // Offline pill (review fix, matches ExpensesScreen §4.5 — calm warm-neutral,
  // list stays interactive).
  offlinePill: {
    backgroundColor: T.color.surface.wash.amber,                            // #FDF0D5 amber-100
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  offlinePillText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular
    fontSize: T.type.body.size,                                             // 15sp
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                           // #7A3A52 roselle-700
  },
  // Error banner (genuine server/client errors only — not offline)
  errorBar: {
    backgroundColor: T.color.surface.subtle,                                // #F5EDE6 ivory-200 (from #FBEDEE — per B3 spec: ivory-200 bg)
    paddingVertical: 8,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  errorBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp — per B3 spec 15sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #8E3A44 — blameless copy, not alarming red)
  },
  infoBar: {
    backgroundColor: T.color.surface.wash.jade,                             // #E4EDE7 jade-100 (from #EBF2EC)
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  infoBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #4A7A56)
  },
  warnBar: {
    backgroundColor: T.color.surface.wash.amber,                            // #FDF0D5 amber-100 (from #FFF8E8)
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  warnBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #7A5A10 — no amber text token at 15sp)
  },

  // List — Bug #3 fix: flex:1 constrains the FlatList to the space above the
  // pinned refresh/FAB controls so its (now in-flow) footer content never
  // renders behind them; paddingBottom still clears the FAB visually.
  listFlex: {
    flex: 1,
  },
  list: {
    padding: T.spacing[4],                                                  // 16dp
    // Row gap fix: container `gap` + a separately-sized separator doubled the
    // visible gap between rows (10 + 10 = 20dp). Rely on the separator alone
    // for inter-row spacing (matches ExpensesScreen's list/separator pattern).
    paddingBottom: 160, // space for FAB + refresh button
  },
  separator: {
    height: T.spacing[2],                                                    // 8dp — single source of row spacing
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp ✓ — PandanEmptyState copy spec
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
    textAlign: 'center',
  },
  // "Add first item" CTA (review fix, matches ExpensesScreen's empty state)
  addFirstBtn: {
    marginTop: 8,
    height: T.button.primary.height,                                        // 52dp ✓
    paddingHorizontal: 28,
    backgroundColor: T.button.primary.bg,                                   // #9A5F0A amber-700
    borderRadius: T.button.primary.radius,                                  // 12dp
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFirstBtnText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold
    fontSize: T.type.body.size,                                             // 15sp
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF
  },

  // Refresh button
  refreshBtn: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 (from #FFFFFF)
    borderRadius: T.radius.pill,                                            // 999
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
  },
  refreshBtnText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    height: T.button.primary.height,                                        // 52dp ✓
    paddingHorizontal: 28,
    backgroundColor: T.button.primary.bg,                                   // #9A5F0A amber-700 (from #A8505A)
    borderRadius: T.button.primary.radius,                                  // 12dp (from 999/pill — spec: CTA uses md radius)
    alignItems: 'center',
    justifyContent: 'center',
    // Warm-tinted shadow per token (T.elev.1)
    shadowColor: T.elev[1].shadowColor,                                     // 'rgba(74,34,48,0.07)' (from '#000')
    shadowOffset: T.elev[1].shadowOffset,                                   // { width:0, height:2 }
    shadowOpacity: T.elev[1].shadowOpacity,                                 // 1
    shadowRadius: T.elev[1].shadowRadius,                                   // 8
    elevation: T.elev[1].elevation,                                         // 2
  },
  fabText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                                             // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF
  },

  // Auto-decrement settings entry button
  autoDecrementBtn: {
    marginHorizontal: T.spacing[4],
    marginBottom: T.spacing[3],
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  autoDecrementBtnText: {
    color: T.color.accent.interactive,
    fontSize: T.type.body.size,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },

  // Undo-delete toast (review fix — matches ExpensesScreen)
  deleteToast: {
    position: 'absolute',
    bottom: 100,
    left: T.spacing[4],                                                     // 16dp
    right: T.spacing[4],                                                    // 16dp
    backgroundColor: T.color.text.heading,                                  // #4A2230 roselle-900
    borderRadius: T.radius.md,                                              // 12dp
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.spacing[4],                                        // 16dp
    paddingVertical: 12,
    shadowColor: T.elev[2].shadowColor,                                     // 'rgba(74,34,48,0.12)'
    shadowOffset: T.elev[2].shadowOffset,                                   // { width:0, height:8 }
    shadowOpacity: T.elev[2].shadowOpacity,                                 // 1
    shadowRadius: T.elev[2].shadowRadius,                                   // 24
    elevation: T.elev[2].elevation,                                         // 8
  },
  deleteToastText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular
    fontSize: T.type.body.size,                                             // 15sp
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF
    flex: 1,
  },
  deleteToastUndoBtn: {
    paddingLeft: T.spacing[4],                                              // 16dp
    paddingVertical: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  deleteToastUndoText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold
    fontSize: T.type.body.size,                                             // 15sp
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF
  },
});
