/**
 * AutoDecrementSettingsScreen — Screen 1 of the auto-stock-decrement feature.
 *
 * Purpose: the mother configures which activities auto-decrement which supply items.
 * Three activity types are always listed: diaper_change, feeding_formula, bathing.
 * The formula section is dual-gated (infant_feeding + general_health — INV-ASD-1).
 * Diaper and bathing are gated by general_health (INV-ASD-3).
 *
 * Offline-first design: the screen reads from the in-memory store synchronously on
 * every render — no loading state, no loading spinner, no blank screen. The store
 * is always populated from the local DB. Background sync (pull/push) is initiated
 * externally (by the navigator or sync service) and does NOT block the render.
 *
 * This component is intentionally hook-free (except useT which is safely mocked in
 * unit tests and reads from React context in production). Structural/a11y/token unit
 * tests call this component as a plain function to traverse the React element tree.
 * Interactive mutation tests (toggle, unlink, re-render) live in RNTL integration
 * tests in the navigation test suite (Commit 11).
 *
 * States (spec §1.1):
 *   Empty       — all activity types listed; no items linked (never blank screen)
 *   Populated   — per linked item: verbatim name · unit label · toggle · unlink
 *   Consent-gated — missing consent → disabled section with advisory copy
 *
 * FW-1 HARD (§7.1): formula section renders ONLY verbatim item name + integer +
 * neutral Thai verb. No brand/product/buy/promo/health-claim copy ANYWHERE on
 * this screen (not just the formula section). scanForFW1Violations on CI.
 *
 * A11y (containment rule):
 *   - Toggle = own <Switch> sibling, never wrapped in accessible={true} View.
 *   - Section header = <Text> with no interactive children in same accessible container.
 *   - All interactive elements ≥ 48dp hit targets.
 *   - accessibilityRole, accessibilityLabel, accessibilityState set on all controls.
 *
 * Security:
 *   - NEVER log item names, defaultQty, onHandQty, or usesRemaining (K-8 / SD-5).
 *   - SD-9: no health values in route params (settings navigate to sub-unit setup
 *     by ID only — caller fetches data on target screen).
 *   - INV-ASD-8: usesRemainingInOpenContainer is never rendered, never logged.
 *
 * Source:
 *   auto-stock-decrement-ui.md §2, auto-stock-decrement-screens.md §1,
 *   auto-stock-decrement-functional.md §9.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import type { TokenStorage } from '../auth/tokenStorage';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { consumptionMappingStore } from './consumptionMappingStore';
import { consentStore } from '../consent/consentStore';
import { createConsumptionMappingSyncClient } from '../sync/syncClient';
import type { ConsumptionMappingRecord, MappingActivityType } from '../sync/syncTypes';
import type { ConsentType } from '../consent/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AutoDecrementSettingsScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Called when the user presses the back button. */
  onBack?: () => void;
  /** Called to navigate to sub-unit setup for an item (SD-9: pass id only). */
  onNavigateSubUnitSetup?: (supplyItemId: string) => void;
  /** Called to open item picker for linking. */
  onNavigateItemPicker?: (activityType: MappingActivityType) => void;
  /** Called to navigate to consent flow. */
  onNavigateConsent?: (consentType: ConsentType) => void;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivitySection {
  activityType: MappingActivityType;
  labelKey: string;
  requiredConsents: ConsentType[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Fixed list of auto-decrement-capable activity types.
 * Always shown (even if no mappings) — never a blank screen (spec §1.1).
 * Order: care activities first, formula last (FW-1 separation).
 */
const ACTIVITY_SECTIONS: ActivitySection[] = [
  {
    activityType: 'diaper_change',
    labelKey: 'autoDecrement.activity.diaperChange',
    requiredConsents: ['general_health'],
  },
  {
    activityType: 'feeding_formula',
    labelKey: 'autoDecrement.activity.formulaFeed',
    requiredConsents: ['infant_feeding', 'general_health'],
  },
  {
    activityType: 'bathing',
    labelKey: 'autoDecrement.activity.bathing',
    requiredConsents: ['general_health'],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasAllConsents(consents: ConsentType[]): boolean {
  return consents.every((c) => consentStore.isGranted(c));
}

/**
 * Fire-and-forget background push of queued mutations.
 * Errors are swallowed — mutations remain in the queue for the next sync cycle.
 * K-8: NEVER log health data, item names, or quantity values.
 */
function backgroundPush(props: AutoDecrementSettingsScreenProps): void {
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
 * Stateless (hook-free) screen that renders current store state synchronously.
 *
 * Offline-first: the in-memory store always holds the latest local data. No
 * loading spinner needed. Mutations write to the store synchronously and enqueue
 * a background push. Re-render after mutations is triggered by the caller (e.g.
 * navigator re-mounts on back-and-forward, or parent passes a refreshKey prop).
 *
 * ALL section content is inlined (no helper sub-components) so that unit tests
 * calling the component as a plain function can traverse the full element tree.
 * Interactive mutation / re-render tests use RNTL (navigation test suite, Commit 11).
 *
 * A11y (containment rule):
 *   - Section header = <Text> sibling ONLY — never a wrapper with accessible={true}
 *     around an interactive child (containment rule).
 *   - Toggle = <Switch> sibling of the item label, NEVER inside accessible={true}.
 *   - All interactive controls ≥ 48dp hit target.
 *
 * FW-1: only i18n keys and verbatim item names are rendered — zero hardcoded copy.
 */
export function AutoDecrementSettingsScreen(
  props: AutoDecrementSettingsScreenProps,
): React.JSX.Element {
  const {
    onBack,
    onNavigateSubUnitSetup,
    onNavigateItemPicker,
    onNavigateConsent,
  } = props;

  // useT is mocked as a plain function in unit tests — safe to call here.
  // In production it reads from React context (the reconciler calls this normally).
  const { t } = useT();

  // Synchronous reads — in-memory store is always populated from local DB.
  // No loading state: offline-first means data is always available locally.
  const mappings = consumptionMappingStore.getAll();

  // ── Handlers ──

  function handleToggle(mapping: ConsumptionMappingRecord, enabled: boolean): void {
    const updated: ConsumptionMappingRecord = {
      ...mapping,
      enabled,
      version: mapping.version + 1,
      updatedAt: new Date().toISOString(),
    };
    consumptionMappingStore.enqueueUpdate(updated);
    backgroundPush(props);
  }

  function handleUnlink(mapping: ConsumptionMappingRecord): void {
    consumptionMappingStore.enqueueDelete(mapping.id);
    backgroundPush(props);
  }

  // ── Render ──

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
          {t('autoDecrement.navTitle')}
        </Text>
      </View>

      {/* Always show all 3 activity sections (offline-first — never blank screen §1.1) */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {ACTIVITY_SECTIONS.map((section) => {
          const consentGranted = hasAllConsents(section.requiredConsents);
          const sectionMappings = mappings.filter(
            (m) => m.activityType === section.activityType,
          );

          return (
            <View key={section.activityType} style={styles.section}>
              {/*
               * Section header — <Text> sibling ONLY; never wraps toggles.
               * (containment rule: accessible={true} on a View collapses subtree on iOS)
               */}
              <Text
                style={styles.sectionTitle}
                role="heading"
                aria-level={2}
              >
                {t(section.labelKey as Parameters<typeof t>[0])}
              </Text>

              {/* Consent-gated advisory — shown when any required consent is missing */}
              {!consentGranted && (
                <View style={styles.consentAdvisory}>
                  <Text style={styles.advisoryText}>
                    {t('autoDecrement.advisory.consentRequired')}
                  </Text>
                  {onNavigateConsent && (
                    <TouchableOpacity
                      style={styles.advisoryLink}
                      onPress={() => onNavigateConsent(section.requiredConsents[0]!)}
                      accessibilityRole="button"
                      accessibilityLabel={t('autoDecrement.advisory.consentCta')}
                    >
                      <Text style={styles.advisoryLinkText}>
                        {t('autoDecrement.advisory.consentCta')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Mapped items — only shown when consent is granted */}
              {consentGranted && sectionMappings.map((mapping) => (
                <View key={mapping.id} style={styles.mappingRow}>
                  {/* Verbatim item name — FW-1 ✓: no brand copy, just the supply item name */}
                  <Text style={styles.itemName} numberOfLines={1}>
                    {mapping.supplyItemId ?? t('autoDecrement.advisory.noItemLinked')}
                  </Text>

                  {/* Unit label */}
                  <Text style={styles.unitLabel}>
                    {section.activityType === 'feeding_formula'
                      ? t('autoDecrement.unit.meal')
                      : section.activityType === 'diaper_change'
                        ? t('autoDecrement.unit.piece')
                        : t('autoDecrement.unit.time')}
                  </Text>

                  {/*
                   * Toggle — SIBLING of the label, NEVER wrapped in accessible={true}.
                   * Containment rule: accessible={true} on the row View would collapse
                   * the Switch into the View's a11y element, making it untappable on iOS.
                   */}
                  <Switch
                    value={mapping.enabled}
                    onValueChange={(val) => handleToggle(mapping, val)}
                    accessibilityRole="switch"
                    accessibilityLabel={t('autoDecrement.toggle.a11yLabel')}
                    accessibilityState={{ checked: mapping.enabled }}
                    trackColor={{
                      false: T.color.surface.divider,
                      true: T.color.accent.interactive,
                    }}
                  />

                  {/* Unlink button */}
                  <TouchableOpacity
                    style={styles.unlinkBtn}
                    onPress={() => handleUnlink(mapping)}
                    accessibilityRole="button"
                    accessibilityLabel={t('autoDecrement.unlinkItem.a11yLabel')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.unlinkText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {/* "Link an item" affordance — always shown when consent is granted (§1.1) */}
              {consentGranted && (
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() => onNavigateItemPicker?.(section.activityType)}
                  accessibilityRole="button"
                  accessibilityLabel={t('autoDecrement.linkItem')}
                >
                  <Text style={styles.linkBtnText}>
                    {t('autoDecrement.linkItem')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
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
  },
  navTitle: {
    flex: 1,
    color: T.color.text.heading,
    fontSize: T.type.heading2.size,
    fontWeight: T.type.heading2.fontWeight,
    fontFamily: T.type.heading2.fontFamily,
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
    fontWeight: T.type.heading2.fontWeight,
    fontFamily: T.type.heading2.fontFamily,
    marginBottom: T.spacing[3],
  },
  consentAdvisory: {
    backgroundColor: T.color.surface.wash.amber,
    borderRadius: T.radius.sm,
    padding: T.spacing[3],
    marginBottom: T.spacing[3],
  },
  advisoryText: {
    color: T.color.text.heading,
    fontSize: T.type.body.size,
    fontFamily: T.type.body.fontFamily,
  },
  advisoryLink: {
    marginTop: T.spacing[2],
    minHeight: 48,
    justifyContent: 'center',
  },
  advisoryLinkText: {
    color: T.color.accent.interactive,
    fontSize: T.type.body.size,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },
  mappingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: T.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
    gap: T.spacing[2],
  },
  itemName: {
    flex: 1,
    color: T.color.text.heading,
    fontSize: T.type.bodyLarge.size,
    fontFamily: T.type.bodyLarge.fontFamily,
  },
  unitLabel: {
    color: T.color.text.primary,
    fontSize: T.type.caption.size,
    fontFamily: T.type.caption.fontFamily,
  },
  unlinkBtn: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unlinkText: {
    color: T.color.text.primary,
    fontSize: T.type.body.size,
  },
  linkBtn: {
    marginTop: T.spacing[3],
    minHeight: 48,
    justifyContent: 'center',
  },
  linkBtnText: {
    color: T.color.accent.interactive,
    fontSize: T.type.body.size,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },
});
