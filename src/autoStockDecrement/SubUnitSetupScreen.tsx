/**
 * SubUnitSetupScreen — Screen 2 of the auto-stock-decrement feature.
 *
 * Purpose: the mother configures how many uses (scoops / pieces / feeds) are in
 * one container (pack / tin / bottle) for a given supply item. This value
 * (usesPerContainer) drives the container-holds-N decrement engine.
 *
 * Entry point: navigated from AutoDecrementSettingsScreen.onNavigateSubUnitSetup
 * when an item's usesPerContainer < 2 (D-4 steer-to-pack advisory).
 *
 * SD-9: only a supply item ID is accepted as a route param. All item data is
 * fetched from the local store on this screen — no health values in params.
 *
 * D-4 (steer-to-pack invariant):
 *   - Container-based auto-decrement is enabled ONLY when usesPerContainer ≥ 2.
 *   - When < 2: amber advisory shown (subUnitSetup.steerToPack.itemsPerPackError).
 *
 * Offline-first / stateless design (same pattern as AutoDecrementSettingsScreen):
 *   - Reads from supplySyncStore synchronously — no loading state.
 *   - Hook-free render body (useT is mocked as plain fn in unit tests).
 *   - Mutations write to store + fire-and-forget push.
 *   - Interactive re-render tests use RNTL (navigation tests, Commit 11).
 *
 * A11y (containment rule):
 *   - Stepper buttons are siblings of the count Text — never inside accessible={true}.
 *   - All interactive controls ≥ 48dp hit target.
 *   - accessibilityRole + accessibilityLabel on all controls.
 *
 * INV-ASD-8: usesRemainingInOpenContainer is NEVER rendered, logged, or exposed.
 *
 * Source:
 *   auto-stock-decrement-ui.md §3, auto-stock-decrement-screens.md §2,
 *   auto-stock-decrement-functional.md §D-4.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import type { TokenStorage } from '../auth/tokenStorage';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { supplySyncStore } from '../sync/supplySyncStore';
import { createSyncClient } from '../sync/syncClient';
import type { SupplyItemRecord } from '../sync/syncTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SubUnitSetupScreenProps {
  /** SD-9: supply item ID only — no health values in route params. */
  supplyItemId: string;
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  onBack?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** D-4: usesPerContainer must be ≥ 2 to enable container-based auto-decrement. */
const D4_MIN_USES_PER_CONTAINER = 2;
const MAX_USES_PER_CONTAINER = 99;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget background push of queued supply item mutations.
 * Errors are swallowed — mutations remain in the queue for the next sync cycle.
 * K-8: NEVER log item names or quantity values.
 */
function backgroundPush(props: SubUnitSetupScreenProps): void {
  void (async () => {
    try {
      const tokens = await props.tokenStorage.load();
      if (tokens?.accessToken) {
        const client = createSyncClient(props.apiBaseUrl, supplySyncStore);
        const cs = supplySyncStore.drainQueue();
        await client.push(
          cs,
          supplySyncStore.getWatermark() ?? '',
          tokens.accessToken,
          uuidv4(),
        );
      }
    } catch {
      // Silent — will retry on next sync cycle (K-8: no health/item data in logs)
    }
  })();
}

/**
 * Compute new usesPerContainer value clamped to [1, MAX].
 * Returns null to mean "keep null/undefined" (discrete mode) — not used in current
 * UI since stepper always starts at 1.
 */
function clampUsesPerContainer(value: number): number {
  return Math.max(1, Math.min(MAX_USES_PER_CONTAINER, value));
}

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * Stateless (hook-free) screen — reads from the local store synchronously.
 * Handlers write to the store directly (no setState). Re-renders after
 * mutations are driven by navigation or parent component.
 */
export function SubUnitSetupScreen(
  props: SubUnitSetupScreenProps,
): React.JSX.Element {
  const { supplyItemId, onBack } = props;
  const { t } = useT();

  // Synchronous read — supplySyncStore is always populated from local DB.
  // INV-ASD-8: we destructure only the fields we render; usesRemainingInOpenContainer
  // is intentionally NOT accessed here.
  const item: SupplyItemRecord | undefined = supplySyncStore.getSupplyItem(supplyItemId);

  // ── Handlers ──

  function handleIncrement(): void {
    if (!item) return;
    const next = clampUsesPerContainer((item.usesPerContainer ?? 1) + 1);
    const updated: SupplyItemRecord = {
      ...item,
      usesPerContainer: next,
      version: item.version + 1,
      updatedAt: new Date().toISOString(),
    };
    // INV-ASD-8: usesRemainingInOpenContainer must NOT be included in the push payload.
    // The egress sanitizer in supplySyncStore.drainQueue() strips this field from every
    // supply item before the wire (structural allow-list on the push changeset).
    supplySyncStore.enqueueUpdate(updated);
    backgroundPush(props);
  }

  function handleDecrement(): void {
    if (!item) return;
    const current = item.usesPerContainer ?? 1;
    if (current <= 1) return; // already at minimum
    const next = clampUsesPerContainer(current - 1);
    const updated: SupplyItemRecord = {
      ...item,
      usesPerContainer: next,
      version: item.version + 1,
      updatedAt: new Date().toISOString(),
    };
    supplySyncStore.enqueueUpdate(updated);
    backgroundPush(props);
  }

  function handleConfirm(): void {
    if (!item) return;
    // Current usesPerContainer is already saved by handleIncrement/Decrement.
    // Confirm just navigates back.
    onBack?.();
  }

  // ── Render ──

  const usesPerContainer = item?.usesPerContainer ?? 1;
  const isD4Advisory = !!item && usesPerContainer < D4_MIN_USES_PER_CONTAINER;

  return (
    <View style={styles.root}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('autoDecrement.backToSupplies')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} role="heading" aria-level={1}>
          {t('subUnitSetup.sectionTitle')}
        </Text>
      </View>

      {/* Item not found */}
      {!item && (
        <View style={styles.centeredState}>
          <Text style={styles.notFoundText}>
            {t('subUnitSetup.itemNotFound')}
          </Text>
          <TouchableOpacity
            onPress={onBack}
            style={styles.cancelBtn}
            accessibilityRole="button"
            accessibilityLabel={t('subUnitSetup.steerToPack.cancelBtn')}
          >
            <Text style={styles.cancelBtnText}>
              {t('subUnitSetup.steerToPack.cancelBtn')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Item found */}
      {!!item && (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Section: usesPerContainer setup */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} role="heading" aria-level={2}>
              {t('subUnitSetup.steerToPack.title')}
            </Text>

            {/* usesPerContainer label */}
            <Text style={styles.fieldLabel}>
              {t('subUnitSetup.usesPerContainerLabel')}
            </Text>

            {/* Stepper — three siblings: decrement | count | increment (containment rule) */}
            <View style={styles.stepperRow}>
              {/*
               * Decrement button — sibling, NEVER inside accessible={true} wrapper.
               * Containment rule: accessible wrapper would collapse the button into
               * the count Text, making it untappable on iOS VoiceOver.
               */}
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={handleDecrement}
                accessibilityRole="button"
                accessibilityLabel={t('subUnitSetup.a11y.decrement')}
                disabled={usesPerContainer <= 1}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>

              {/* Current count display — plain Text sibling (not a wrapper View) */}
              <Text
                style={styles.stepperCount}
                accessibilityLabel={`${usesPerContainer}`}
              >
                {usesPerContainer}
              </Text>

              {/* Increment button — sibling of count */}
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={handleIncrement}
                accessibilityRole="button"
                accessibilityLabel={t('subUnitSetup.a11y.increment')}
                disabled={usesPerContainer >= MAX_USES_PER_CONTAINER}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {/* D-4 steer-to-pack advisory — amber, shown when usesPerContainer < 2 */}
            {isD4Advisory && (
              <View style={styles.d4Advisory}>
                <Text style={styles.d4AdvisoryText}>
                  {t('subUnitSetup.steerToPack.itemsPerPackError')}
                </Text>
              </View>
            )}

            {/* steerToPack itemsPerPackLabel — informational */}
            <Text style={styles.fieldLabel}>
              {t('subUnitSetup.steerToPack.itemsPerPackLabel')}
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.cancelBtnRow}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={t('subUnitSetup.steerToPack.cancelBtn')}
            >
              <Text style={styles.cancelBtnText}>
                {t('subUnitSetup.steerToPack.cancelBtn')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleConfirm}
              accessibilityRole="button"
              accessibilityLabel={t('subUnitSetup.steerToPack.confirmBtn')}
            >
              <Text style={styles.confirmBtnText}>
                {t('subUnitSetup.steerToPack.confirmBtn')}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
  centeredState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: T.spacing[4],
  },
  notFoundText: {
    color: T.color.text.secondary,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    fontFamily: T.type.body.fontFamily,
  },
  scrollContent: {
    paddingVertical: T.spacing[4],
  },
  section: {
    marginHorizontal: T.spacing[4],
    marginBottom: T.spacing[6],
    backgroundColor: T.color.surface.base,
    borderRadius: T.radius.md,
    padding: T.spacing[4],
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  sectionTitle: {
    color: T.color.text.botanical,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    fontWeight: T.type.heading2.fontWeight,
    fontFamily: T.type.heading2.fontFamily,
    marginBottom: T.spacing[3],
  },
  fieldLabel: {
    color: T.color.text.primary,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    fontFamily: T.type.body.fontFamily,
    marginTop: T.spacing[3],
    marginBottom: T.spacing[2],
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.spacing[4],
    marginVertical: T.spacing[3],
  },
  stepperBtn: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.sm,
  },
  stepperBtnText: {
    color: T.color.text.heading,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    fontFamily: T.type.heading2.fontFamily,
    fontWeight: T.type.heading2.fontWeight,
  },
  stepperCount: {
    color: T.color.text.heading,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    fontFamily: T.type.heading2.fontFamily,
    fontWeight: T.type.heading2.fontWeight,
    minWidth: 48,
    textAlign: 'center',
  },
  d4Advisory: {
    backgroundColor: T.color.surface.wash.amber,
    borderRadius: T.radius.sm,
    padding: T.spacing[3],
    marginTop: T.spacing[2],
    marginBottom: T.spacing[3],
  },
  d4AdvisoryText: {
    color: T.color.text.heading,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    fontFamily: T.type.body.fontFamily,
  },
  actionRow: {
    flexDirection: 'row',
    gap: T.spacing[3],
    marginHorizontal: T.spacing[4],
    marginBottom: T.spacing[6],
  },
  cancelBtnRow: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  cancelBtn: {
    minHeight: 48,
    paddingHorizontal: T.spacing[6],
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  cancelBtnText: {
    color: T.color.text.primary,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },
  confirmBtn: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: T.radius.md,
    backgroundColor: T.color.accent.interactive,
  },
  confirmBtnText: {
    color: T.color.surface.base,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },
});
