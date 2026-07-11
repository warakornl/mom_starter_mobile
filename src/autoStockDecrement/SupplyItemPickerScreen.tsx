/**
 * SupplyItemPickerScreen — "Link an item" destination for AutoDecrementSettingsScreen.
 *
 * Purpose: lets the mother pick which existing supply item should be linked to
 * an auto-decrement activity type (diaper_change | feeding_formula | bathing).
 * Tapping an item enqueues a new ConsumptionMappingRecord via
 * consumptionMappingStore.enqueueCreate — this is the ONLY production code path
 * that creates a mapping (Bug #2 root-cause fix: previously no such caller existed,
 * so the decrement engine could never be configured).
 *
 * Entry: AutoDecrementSettingsScreen.onNavigateItemPicker(activityType).
 *
 * SD-9: route params carry only `activityType` (a closed string enum) — no
 * health values, no supply item data. This screen reads supply items from the
 * local store synchronously (offline-first, same pattern as AutoDecrementSettingsScreen).
 *
 * Suggested category surfaced first (informational grouping, not a hard filter —
 * any item may be linked to any activity type):
 *   diaper_change   → 'diapers'
 *   feeding_formula → 'feeding'
 *   bathing         → 'hygiene'
 *
 * FW-1 HARD: only the verbatim supply item name + i18n neutral copy is ever
 * rendered — zero brand/promo/buy/health-claim copy.
 *
 * A11y (containment rule): each item row is a standalone TouchableOpacity
 * sibling (never wrapped in accessible={true}); ≥48dp hit target.
 *
 * Security: NEVER log item names or ids (K-8). No health quantities rendered.
 *
 * Source: auto-stock-decrement-ui.md §2 (Link an item), Bug #2 fix spec.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import type { TokenStorage } from '../auth/tokenStorage';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { supplySyncStore } from '../sync/supplySyncStore';
import { consumptionMappingStore } from './consumptionMappingStore';
import { createConsumptionMappingSyncClient } from '../sync/syncClient';
import type {
  ConsumptionMappingRecord,
  MappingActivityType,
  SupplyCategory,
  SupplyItemRecord,
} from '../sync/syncTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SupplyItemPickerScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Which activity type the picked item will be linked to. */
  activityType: MappingActivityType;
  /** Called when the user presses back without picking (or after picking, if onPicked absent). */
  onBack?: () => void;
  /** Called after a successful pick (preferred over onBack when both are given). */
  onPicked?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Suggested (not enforced) category per activity type — informational grouping only. */
const SUGGESTED_CATEGORY: Record<MappingActivityType, SupplyCategory> = {
  diaper_change: 'diapers',
  feeding_formula: 'feeding',
  bathing: 'hygiene',
};

/** New mapping default per-use quantity (mother can change on Screen 1 later). */
const DEFAULT_QTY = 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sort supply items so the suggested category for this activity type appears
 * first; all other live items follow (any item is linkable — informational
 * grouping only, never a hard filter — arch §4).
 */
function sortBySuggestedCategory(
  items: SupplyItemRecord[],
  activityType: MappingActivityType,
): SupplyItemRecord[] {
  const suggested = SUGGESTED_CATEGORY[activityType];
  const first: SupplyItemRecord[] = [];
  const rest: SupplyItemRecord[] = [];
  for (const item of items) {
    if (item.category === suggested) first.push(item);
    else rest.push(item);
  }
  return [...first, ...rest];
}

/**
 * Fire-and-forget background push of the queued mapping mutation.
 * Errors are swallowed — mutation remains in the queue for the next sync cycle.
 * K-8: NEVER log item names, ids, or quantity values.
 */
function backgroundPush(props: SupplyItemPickerScreenProps): void {
  void (async () => {
    try {
      const tokens = await props.tokenStorage.load();
      if (tokens?.accessToken) {
        const client = createConsumptionMappingSyncClient(
          props.apiBaseUrl,
          consumptionMappingStore,
        );
        const cs = consumptionMappingStore.drainQueue();
        await client.push(
          cs,
          consumptionMappingStore.getWatermark() ?? '',
          tokens.accessToken,
          uuidv4(),
        );
      }
    } catch {
      // Silent — will retry on next sync cycle (K-8: no health data in logs)
    }
  })();
}

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * Stateless (hook-free) screen — reads supplySyncStore synchronously on every
 * render (offline-first, no loading state — matches AutoDecrementSettingsScreen).
 */
export function SupplyItemPickerScreen(
  props: SupplyItemPickerScreenProps,
): React.JSX.Element {
  const { activityType, onBack, onPicked } = props;
  const { t } = useT();

  const items = sortBySuggestedCategory(supplySyncStore.getSupplyItems(), activityType);

  function handlePick(item: SupplyItemRecord): void {
    const now = new Date().toISOString();
    const record: ConsumptionMappingRecord = {
      id: uuidv4(),
      activityType,
      supplyItemId: item.id,
      defaultQty: DEFAULT_QTY,
      enabled: true,
      version: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    consumptionMappingStore.enqueueCreate(record);
    backgroundPush(props);
    if (onPicked) {
      onPicked();
    } else {
      onBack?.();
    }
  }

  return (
    <View style={styles.root}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          testID="supply-item-picker-back"
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('supplyItemPicker.backA11y')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} role="heading" aria-level={1}>
          {t('supplyItemPicker.navTitle')}
        </Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            {t('supplyItemPicker.emptyState')}
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.listFlex}
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              testID="supply-item-picker-row"
              style={styles.row}
              onPress={() => handlePick(item)}
              accessibilityRole="button"
              accessibilityLabel={item.name}
            >
              {/* Verbatim item name — FW-1: no brand/promo copy. */}
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// ALL values from ห้องแม่ tokens — ZERO inline hex/px literals (outside tokens.ts).

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: T.spacing[4],
    paddingVertical: T.spacing[3],
    backgroundColor: T.color.surface.base,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
  },
  backBtn: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  backText: {
    color: T.color.accent.interactive,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
  },
  navTitle: {
    flex: 1,
    color: T.color.text.heading,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    fontWeight: T.type.heading2.fontWeight,
    fontFamily: T.type.heading2.fontFamily,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: T.spacing[6],
  },
  emptyStateText: {
    color: T.color.text.secondary,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    fontFamily: T.type.body.fontFamily,
    textAlign: 'center',
  },
  listFlex: {
    flex: 1,
  },
  list: {
    padding: T.spacing[4],
  },
  row: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: T.spacing[3],
    paddingHorizontal: T.spacing[3],
  },
  itemName: {
    color: T.color.text.heading,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    fontFamily: T.type.bodyLarge.fontFamily,
  },
  separator: {
    height: 1,
    backgroundColor: T.color.surface.divider,
  },
});
