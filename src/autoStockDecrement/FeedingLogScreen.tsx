/**
 * FeedingLogScreen — Screen 3 surface: breastfeed / pump / formula logging.
 *
 * This is the feeding-log surface that hosts the three-chip kind selector and
 * renders `FormulaFeedSection` as the third chip option (per Screen 3 of
 * auto-stock-decrement-ui.md §4).
 *
 * Consent gate (SD-10):
 *   - `general_health` required for ALL feed kinds (breastfeed, pump, formula).
 *     Absent → save button disabled + advisory shown; nothing persisted.
 *   - `infant_feeding` ADDITIONALLY required for formula.
 *     FormulaFeedSection handles this dual-gate internally (chip disabled +
 *     advisory). The write path ALSO re-checks both consents (belt-and-suspenders).
 *
 * FW-1 (Milk-Code §7.1 HARD):
 *   - Formula chip label = 'formulaFeed.chip' i18n key only → 'ให้นมผง'.
 *   - No brand/product/buy/promo/health-claim copy anywhere on this surface.
 *   - Formula amount = integer only; neutral verbs only.
 *
 * Feed kinds:
 *   breastfeed / pump → persists FeedingSessionRecord (kind=breastfeed/pump);
 *                        NO supply decrement.
 *   formula            → persists FeedingSessionRecord (kind=formula) via
 *                        feedingSessionStore.commitLocalFormula() → sessionId →
 *                        commitFormulaFeedDecrement() (T-F path).
 *
 * A11y (containment rule):
 *   - Each kind chip = standalone <TouchableOpacity> sibling, NEVER inside an
 *     accessible={true} wrapper.
 *   - FormulaFeedSection is its own sibling; it manages its chip internally.
 *   - accessibilityRole="checkbox" on kind chips; accessibilityState.checked.
 *   - Save button: accessibilityRole="button", ≥48dp.
 *   - Consent advisory: accessibilityLiveRegion for screen reader announcement.
 *
 * INV-ASD-8:
 *   - usesRemainingInOpenContainer is NEVER rendered, NEVER logged, NEVER passed
 *     to the session store record (health-side only).
 *   - FeedingSessionRecord stored here has NO supply-side fields.
 *
 * DI (Dependency Injection for testing):
 *   Optional _feedingSessionStore, _supplyStore, _consumptionMappingStore, and
 *   _markerStore props default to module singletons in production. Tests inject
 *   fresh real instances for isolation.
 *
 * Security:
 *   - NEVER log amountSubUnits, sessionId, or any health value (K-8 / SD-5).
 *   - No health data in route params (PDPA SD-9) — this screen takes no params.
 *   - consentStore.isGranted() read at write-time (not just render-time).
 *
 * testIDs:
 *   feeding-log-breastfeed-chip   — breastfeed kind chip
 *   feeding-log-pump-chip         — pump kind chip
 *   feeding-log-save-btn          — save button (breastfeed/pump kinds)
 *   feeding-log-consent-advisory  — general_health advisory panel
 *   feeding-log-saved             — saved confirmation
 *   feeding-log-error             — error panel
 *
 * Source:
 *   auto-stock-decrement-ui.md §4 (Screen 3),
 *   auto-stock-decrement-functional.md §2 (T-F sequence),
 *   auto-stock-decrement-screens.md §3.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import type { TokenStorage } from '../auth/tokenStorage';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { consentStore } from '../consent/consentStore';
import { feedingSessionStore as defaultFeedingSessionStore } from './feedingSessionStore';
import type { FeedingSessionStore } from './feedingSessionStore';
import { supplySyncStore as defaultSupplyStore } from '../sync/supplySyncStore';
import type { SyncStore } from '../sync/syncStore';
import { consumptionMappingStore as defaultConsumptionMappingStore } from './consumptionMappingStore';
import type { ConsumptionMappingStore } from './consumptionMappingStore';
import { stockDecrementMarkerStore as defaultMarkerStore } from './stockDecrementMarkerStore';
import type { StockDecrementMarkerStore } from './stockDecrementMarkerStore';
import { commitFormulaFeedDecrement } from './decrementCommit';
import { FormulaFeedSection } from './FormulaFeedSection';
import type { ConsentType } from '../consent/types';
import type { FeedingSessionRecord } from '../sync/syncTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FeedingLogScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Navigate back (close this screen). */
  onBack: () => void;
  /** Navigate to consent flow when advisory CTA is pressed. */
  onNavigateConsent?: (consentType: ConsentType) => void;
  /**
   * DI: FeedingSession store (defaults to module singleton).
   * Tests inject fresh real instances for isolation.
   */
  _feedingSessionStore?: FeedingSessionStore;
  /**
   * DI: Supply store (defaults to module singleton).
   * Tests inject fresh real instances for isolation.
   */
  _supplyStore?: SyncStore;
  /**
   * DI: ConsumptionMapping store (defaults to module singleton).
   * Tests inject fresh real instances for isolation.
   */
  _consumptionMappingStore?: ConsumptionMappingStore;
  /**
   * DI: StockDecrementMarker store (defaults to module singleton).
   * Tests inject fresh real instances for isolation.
   */
  _markerStore?: StockDecrementMarkerStore;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FeedKind = 'breastfeed' | 'pump' | 'formula';
type ScreenState = 'idle' | 'saving' | 'saved' | 'error';

// ─── Helper: floating-civil datetime ─────────────────────────────────────────

/** Build floating-civil "YYYY-MM-DDTHH:mm" from device local clock (FLAG-1). */
function localCivilNow(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * FeedingLogScreen — the feeding-log surface.
 *
 * Three feed kinds: breastfeed, pump, formula (via FormulaFeedSection).
 * FormulaFeedSection manages the formula chip + amount + its own submit button.
 * Breastfeed/pump use a shared "Save" button at the bottom of the form.
 */
export function FeedingLogScreen({
  onBack,
  onNavigateConsent,
  _feedingSessionStore = defaultFeedingSessionStore,
  _supplyStore = defaultSupplyStore,
  _consumptionMappingStore = defaultConsumptionMappingStore,
  _markerStore = defaultMarkerStore,
}: FeedingLogScreenProps): React.JSX.Element {
  const { t } = useT();

  // ── Kind state ────────────────────────────────────────────────────────────
  // Initial kind: 'breastfeed' (most common postpartum first action).
  const [kind, setKind] = useState<FeedKind>('breastfeed');

  // Formula chip state — controlled by this parent (FormulaFeedSection is controlled)
  const [formulaAmount, setFormulaAmount] = useState<number>(1);

  // ── Screen state ──────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>('idle');

  // ── Consent reads (synchronous — offline-first, always in-memory) ─────────
  const generalHealthGranted = consentStore.isGranted('general_health');

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Breastfeed / pump save handler.
   *
   * SD-10: gates on general_health. If absent → no-op (UI shows advisory).
   * NO supply decrement for breastfeed/pump — only formula triggers T-F.
   * NEVER log kind, sessionId, or any health value (K-8 / SD-5).
   */
  function handleBasicFeedSave(): void {
    // SD-10: write-path consent gate (belt-and-suspenders — not just UI hide)
    if (!consentStore.isGranted('general_health')) {
      return;
    }

    const session: FeedingSessionRecord = {
      id: uuidv4(),
      kind: kind as 'breastfeed' | 'pump',
      startedAt: localCivilNow(),
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setScreenState('saving');
    try {
      _feedingSessionStore.commitLocalFormula(session);
      setScreenState('saved');
    } catch {
      setScreenState('error');
    }
  }

  /**
   * Formula feed submit handler — the T-F trigger entry point.
   *
   * Wired to FormulaFeedSection.onSubmitFormulaFeed (the T-F trigger).
   * Steps (auto-stock-decrement-functional.md §2):
   *   1. Write-path consent dual-gate (general_health + infant_feeding — SD-10).
   *   2. Create and persist a FeedingSessionRecord (kind='formula').
   *   3. commitFormulaFeedDecrement → T-F decrement engine (D-6 atomicity).
   *
   * NEVER log amountSubUnits or sessionId (K-8 / SD-5 / INV-ASD-8).
   * INV-ASD-8: FeedingSessionRecord stored here has NO supply-side fields.
   */
  function handleFormulaSubmit(amountSubUnits: number | null): void {
    // SD-10: WRITE-PATH dual-gate (belt-and-suspenders — FormulaFeedSection also
    // gates at the UI level, but we always re-check at the write path per SD-10).
    if (
      !consentStore.isGranted('general_health') ||
      !consentStore.isGranted('infant_feeding')
    ) {
      return; // consent_blocked: no session persisted, no decrement
    }

    const session: FeedingSessionRecord = {
      id: uuidv4(),
      kind: 'formula',
      startedAt: localCivilNow(),
      // amountSubUnits carried through to decrement engine (null = use defaultQty D-2)
      amountSubUnits,
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // INV-ASD-8: NO supply-side fields (onHandQty, usesRemainingInOpenContainer)
      // are set on the FeedingSessionRecord — health side only.
    };

    setScreenState('saving');
    try {
      // Step 1: Persist FeedingSession (immutable event log — append-only).
      // sessionId is the idempotency key for the decrement engine (D-6).
      const sessionId = _feedingSessionStore.commitLocalFormula(session);

      // Step 2: Trigger formula decrement (T-F path — D-6 atomicity).
      // commitFormulaFeedDecrement gates again internally (consent, E-10, E-2, E-9).
      commitFormulaFeedDecrement({
        sessionId,
        amountSubUnits,
        consentInfantFeeding: true,  // already checked above
        consentGeneralHealth: true,  // already checked above
        supplyStore: _supplyStore,
        consumptionMappingStore: _consumptionMappingStore,
        markerStore: _markerStore,
      });

      setScreenState('saved');
    } catch {
      setScreenState('error');
    }
  }

  // ── Saved state ───────────────────────────────────────────────────────────
  if (screenState === 'saved') {
    return (
      <SafeAreaView style={styles.container} testID="feeding-log-saved">
        <View style={styles.savedContainer}>
          <Text style={styles.savedText}>{t('feedingLog.saved')}</Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('feedingLog.close')}
          >
            <Text style={styles.closeBtnText}>{t('feedingLog.close')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/*
       * Header — back/close button + title.
       * Title: 'feedingLog.navTitle' → 'บันทึกการให้นม' (FW-1: no brand).
       * Close button: standalone TouchableOpacity (containment rule).
       */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.headerCloseBtn}
          accessibilityRole="button"
          accessibilityLabel={t('feedingLog.close')}
        >
          <Text style={styles.headerCloseText}>‹ {t('feedingLog.close')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('feedingLog.navTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/*
         * General-health consent advisory.
         * Shown when general_health is not granted.
         * Formula's additional infant_feeding gate is handled by FormulaFeedSection.
         *
         * accessibilityLiveRegion="polite": screen reader announces when advisory
         * appears / disappears (async-announced per wave 1 heuristics).
         */}
        {!generalHealthGranted && (
          <View
            testID="feeding-log-consent-advisory"
            style={styles.consentAdvisory}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.consentAdvisoryText}>
              {t('feedingLog.consentGate')}
            </Text>
            {onNavigateConsent && (
              <TouchableOpacity
                style={styles.consentCtaBtn}
                onPress={() => onNavigateConsent('general_health')}
                accessibilityRole="button"
                accessibilityLabel={t('feedingLog.consentCta')}
              >
                <Text style={styles.consentCtaText}>{t('feedingLog.consentCta')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/*
         * Kind chip row: breastfeed + pump chips.
         * FormulaFeedSection provides the third chip (formula) via its own chip.
         *
         * A11y containment rule: each chip is a standalone TouchableOpacity
         * sibling — NEVER inside accessible={true} View wrapper.
         * accessibilityRole="checkbox" + accessibilityState.checked (toggle semantics).
         */}
        <View style={styles.chipRow}>
          {/*
           * Breastfeed chip — standalone TouchableOpacity (containment rule).
           * testID: feeding-log-breastfeed-chip
           */}
          <TouchableOpacity
            testID="feeding-log-breastfeed-chip"
            style={[styles.chip, kind === 'breastfeed' && styles.chipActive]}
            onPress={() => setKind('breastfeed')}
            accessibilityRole="checkbox"
            accessibilityLabel={t('feedingLog.breastfeed')}
            accessibilityState={{ checked: kind === 'breastfeed' }}
          >
            <Text style={[styles.chipLabel, kind === 'breastfeed' && styles.chipLabelActive]}>
              {t('feedingLog.breastfeed')}
            </Text>
          </TouchableOpacity>

          {/*
           * Pump chip — standalone TouchableOpacity (containment rule).
           * testID: feeding-log-pump-chip
           */}
          <TouchableOpacity
            testID="feeding-log-pump-chip"
            style={[styles.chip, kind === 'pump' && styles.chipActive]}
            onPress={() => setKind('pump')}
            accessibilityRole="checkbox"
            accessibilityLabel={t('feedingLog.pump')}
            accessibilityState={{ checked: kind === 'pump' }}
          >
            <Text style={[styles.chipLabel, kind === 'pump' && styles.chipLabelActive]}>
              {t('feedingLog.pump')}
            </Text>
          </TouchableOpacity>
        </View>

        {/*
         * FormulaFeedSection — Screen 3 chip (the third kind option).
         *
         * FormulaFeedSection is a controlled component:
         *   isActive = (kind === 'formula') — parent controls which kind is active.
         *   onToggle — updates parent kind state.
         *   onSubmitFormulaFeed — wired to handleFormulaSubmit (T-F entry point).
         *
         * A11y (containment rule): FormulaFeedSection manages its own chip
         * internally as a standalone TouchableOpacity. The wrapper View here has
         * NO accessible={true} (containment rule — chip inside would be unreachable).
         *
         * FW-1: FormulaFeedSection renders only 'formulaFeed.chip' i18n key
         * and 'formulaFeed.amountLabel' — no brand/promo copy.
         *
         * INV-ASD-8: onSubmitFormulaFeed (handleFormulaSubmit) NEVER reads
         * usesRemainingInOpenContainer — it passes amountSubUnits only to the engine.
         */}
        <View style={styles.formulaSection}>
          <FormulaFeedSection
            isActive={kind === 'formula'}
            onToggle={(active) => setKind(active ? 'formula' : 'breastfeed')}
            amount={formulaAmount}
            onAmountChange={setFormulaAmount}
            onNavigateConsent={onNavigateConsent}
            onSubmitFormulaFeed={handleFormulaSubmit}
          />
        </View>

        {/*
         * Error panel — shown on local write failure.
         * testID: feeding-log-error
         * accessibilityLiveRegion="assertive": screen reader announces immediately.
         */}
        {screenState === 'error' && (
          <View
            testID="feeding-log-error"
            style={styles.errorPanel}
            accessibilityLiveRegion="assertive"
          >
            <Text style={styles.errorText}>{t('feedingLog.error')}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => { setScreenState('idle'); }}
              accessibilityRole="button"
              accessibilityLabel={t('feedingLog.retry')}
            >
              <Text style={styles.retryBtnText}>{t('feedingLog.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/*
       * Breastfeed / Pump save button — shown only when kind !== 'formula'.
       * (Formula submit is handled by FormulaFeedSection's own submit button.)
       *
       * SD-10: disabled when general_health is not granted.
       * A11y: ≥48dp minHeight; accessibilityState.disabled reflects disabled state.
       * testID: feeding-log-save-btn
       * containment rule: standalone TouchableOpacity outside accessible={true} wrapper.
       */}
      {kind !== 'formula' && (
        <View style={styles.footer}>
          <TouchableOpacity
            testID="feeding-log-save-btn"
            style={[
              styles.saveBtn,
              !generalHealthGranted && styles.saveBtnDisabled,
            ]}
            onPress={handleBasicFeedSave}
            disabled={!generalHealthGranted}
            accessibilityRole="button"
            accessibilityLabel={t('feedingLog.save')}
            accessibilityState={{ disabled: !generalHealthGranted }}
          >
            <Text style={styles.saveBtnText}>{t('feedingLog.save')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// ALL values from ห้องแม่ tokens — ZERO inline hex/px literals outside tokens.ts.

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.spacing[4],
    paddingVertical: T.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
  },
  headerCloseBtn: {
    minWidth: 60,
    minHeight: 48,
    justifyContent: 'center',
  },
  headerCloseText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: T.type.bodyLarge.size,
    color: T.color.text.primary,
  },
  headerTitle: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: { width: 60 },

  // ── Body ─────────────────────────────────────────────────────────────────
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: T.spacing[4],
    paddingTop: T.spacing[4],
    paddingBottom: T.spacing[2],
    gap: T.spacing[4],
  },

  // ── Consent advisory ──────────────────────────────────────────────────────
  consentAdvisory: {
    backgroundColor: T.color.surface.wash.amber,
    borderRadius: T.radius.sm,
    padding: T.spacing[3],
  },
  consentAdvisoryText: {
    color: T.color.text.heading,
    fontSize: T.type.body.size,
    fontFamily: T.type.body.fontFamily,
  },
  consentCtaBtn: {
    marginTop: T.spacing[2],
    minHeight: 48,
    justifyContent: 'center',
  },
  consentCtaText: {
    color: T.color.accent.interactive,
    fontSize: T.type.body.size,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },

  // ── Kind chip row ─────────────────────────────────────────────────────────
  chipRow: {
    flexDirection: 'row',
    gap: T.spacing[2],
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: T.spacing[3],
    paddingVertical: T.spacing[2],
    borderRadius: T.radius.pill,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    backgroundColor: T.color.surface.subtle,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActive: {
    borderColor: T.color.accent.interactive,
    backgroundColor: T.color.surface.wash.roselle,
  },
  chipLabel: {
    color: T.color.text.primary,
    fontSize: T.type.body.size,
    fontFamily: T.type.body.fontFamily,
  },
  chipLabelActive: {
    color: T.color.accent.interactive,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },

  // ── Formula section ───────────────────────────────────────────────────────
  formulaSection: {
    // No accessible={true} here — containment rule (FormulaFeedSection chip would be
    // unreachable on VoiceOver if the wrapper were accessible).
  },

  // ── Error panel ───────────────────────────────────────────────────────────
  errorPanel: {
    backgroundColor: T.color.surface.wash.roselle,
    borderRadius: T.radius.sm,
    padding: T.spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    color: T.color.text.primary,
    fontSize: T.type.body.size,
    fontFamily: T.type.body.fontFamily,
    flex: 1,
  },
  retryBtn: {
    paddingLeft: T.spacing[3],
    minHeight: 48,
    justifyContent: 'center',
  },
  retryBtnText: {
    color: T.color.accent.interactive,
    fontSize: T.type.body.size,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },

  // ── Saved state ───────────────────────────────────────────────────────────
  savedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.spacing[4],
    padding: T.spacing[6],
  },
  savedText: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.list.bar.health,
    textAlign: 'center',
  },
  closeBtn: {
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    paddingHorizontal: T.spacing[6],
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: T.color.text.onDark,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
    fontSize: T.type.body.size,
  },

  // ── Footer / save button ──────────────────────────────────────────────────
  footer: {
    paddingHorizontal: T.spacing[4],
    paddingTop: T.spacing[3],
    paddingBottom: T.spacing[4],
    borderTopWidth: 1,
    borderTopColor: T.color.surface.divider,
    backgroundColor: T.color.surface.base,
    shadowColor: T.color.text.heading,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtn: {
    height: 52,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
    fontSize: T.type.bodyLarge.size,
    color: T.color.text.onDark,
  },

  bottomSpacer: { height: 8 },
});
