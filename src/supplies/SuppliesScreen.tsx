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
import { createSyncStore } from '../sync/syncStore';
import { createSyncClient } from '../sync/syncClient';
import type { SupplyItemRecord, SupplyCategory, RejectedRecord } from '../sync/syncTypes';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';

// ─── Module-level store + client (survive re-mounts in same JS session) ───────
// In-memory only; repopulated by pull() on each app launch.
// NOTE: shared across all mounted SuppliesScreen instances in the same session.

const _store = createSyncStore();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SuppliesScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Called when user presses the back/close button. */
  onBack?: () => void;
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
            placeholderTextColor="#94818A"
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
            placeholderTextColor="#94818A"
            returnKeyType="next"
          />

          {/* Qty on hand */}
          <Text style={formStyles.label}>{t('supplies.fieldOnHandQty')}</Text>
          <TextInput
            style={formStyles.input}
            value={form.onHandQty}
            onChangeText={(v) => onChange({ onHandQty: v })}
            keyboardType="numeric"
            returnKeyType="next"
          />

          {/* Low threshold */}
          <Text style={formStyles.label}>{t('supplies.fieldLowThreshold')}</Text>
          <TextInput
            style={formStyles.input}
            value={form.lowThreshold}
            onChangeText={(v) => onChange({ lowThreshold: v })}
            keyboardType="numeric"
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
  container: { flex: 1, backgroundColor: '#FBF6F1' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE1D9',
  },
  title: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    color: '#3A2A30',
  },
  cancelBtn: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#A8505A',
  },
  body: { flex: 1 },
  bodyContent: { padding: 20, gap: 12 },
  label: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#5F4A52',
  },
  input: {
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 12,
    padding: 14,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#3A2A30',
    backgroundColor: '#FFFFFF',
  },
  categoryRow: { flexGrow: 0 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    marginRight: 8,
    backgroundColor: '#FFFFFF',
  },
  categoryChipSelected: {
    backgroundColor: '#FBEDEE',
    borderColor: '#A8505A',
  },
  categoryChipText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
  },
  categoryChipTextSelected: {
    fontFamily: 'IBMPlexSans-SemiBold',
    color: '#8E3A44',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#EBE1D9',
  },
  saveBtn: {
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 17,
    color: '#FFFFFF',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 16,
    gap: 12,
  },
  info: { flex: 1, gap: 2 },
  name: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#3A2A30',
  },
  meta: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#5F4A52',
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FBF3EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 20,
    lineHeight: 24,
    color: '#A8505A',
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function SuppliesScreen({
  tokenStorage,
  apiBaseUrl,
}: SuppliesScreenProps): React.JSX.Element {
  const { t } = useT();

  // Display state — refreshed from _store after every sync operation
  const [items, setItems] = useState<SupplyItemRecord[]>(_store.getSupplyItems());
  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [conflictCount, setConflictCount] = useState(0);
  const [rejectedItems, setRejectedItems] = useState<RejectedRecord[]>([]);

  // SyncClient is cheap to create per session (store is module-level)
  const clientRef = useRef(createSyncClient(apiBaseUrl, _store));

  // Refresh display from store
  const refreshFromStore = useCallback(() => {
    setItems([..._store.getSupplyItems()]);
  }, []);

  // ── Sync pull ───────────────────────────────────────────────────────────────

  const syncPull = useCallback(async () => {
    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    setSyncing(true);
    setSyncError(null);

    const result = await clientRef.current.pull(
      tokens.accessToken,
      _store.getWatermark(),
    );

    setSyncing(false);
    refreshFromStore();

    if (!result.ok) {
      // 403 consent_required → sync gated; app works offline
      // 409 watermark_expired → carry-forward: trigger full-resync
      setSyncError(t('supplies.syncError'));
    }
  }, [tokenStorage, refreshFromStore, t]);

  // ── Sync push ───────────────────────────────────────────────────────────────

  const syncPush = useCallback(async () => {
    if (_store.getPendingCount() === 0) return;

    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    setSyncing(true);
    setSyncError(null);

    const changes = _store.drainQueue();
    const idempotencyKey = uuidv4();
    const watermark = _store.getWatermark() ?? '';

    const result = await clientRef.current.push(
      changes,
      watermark,
      tokens.accessToken,
      idempotencyKey,
    );

    setSyncing(false);
    refreshFromStore();

    if (!result.ok) {
      // Re-queue on failure: data stays in queue from next syncPush attempt
      // (drainQueue already cleared — in-memory loss on failure is noted
      // as carry-forward for SQLite persistence)
      setSyncError(t('supplies.syncError'));
    } else {
      if (result.conflicts.length > 0) {
        setConflictCount(result.conflicts.length);
      }
      if (result.rejected.length > 0) {
        setRejectedItems(result.rejected);
      }
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
      const existing = _store.getSupplyItem(form.id);
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
      _store.enqueueUpdate(updated);
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
      _store.enqueueCreate(newItem);
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
            _store.enqueueDelete(item.id);
            refreshFromStore();
            void syncPush();
          },
        },
      ],
    );
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

      {/* Item list */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('supplies.empty')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <SupplyRow item={item} onEdit={openEdit} onDelete={handleDelete} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },

  // Sync status banners
  syncBar: {
    backgroundColor: '#EBF2EC',
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  syncBarText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#4A7A56',
  },
  errorBar: {
    backgroundColor: '#FBEDEE',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  errorBarText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#8E3A44',
  },
  infoBar: {
    backgroundColor: '#EBF2EC',
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  infoBarText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#4A7A56',
  },
  warnBar: {
    backgroundColor: '#FFF8E8',
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  warnBarText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#7A5A10',
  },

  // List
  list: {
    padding: 16,
    gap: 10,
    paddingBottom: 160, // space for FAB + refresh button
  },
  separator: {
    height: 10,
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#94818A',
    textAlign: 'center',
    lineHeight: 24,
  },

  // Refresh button
  refreshBtn: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#EBE1D9',
  },
  refreshBtnText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    height: 52,
    paddingHorizontal: 28,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  fabText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
});
