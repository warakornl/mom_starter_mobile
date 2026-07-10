/**
 * FormulaFeedSection — Screen 3 (component): formula-feed chip for feeding log form.
 *
 * A controlled component that adds a "formula feed" chip to the feeding log surface.
 * The parent manages isActive and amount state; this component handles rendering
 * and consent-gating.
 *
 * FW-1 HARD (§7.1):
 *   - Chip label = 'formulaFeed.chip' i18n key ONLY → 'ให้นมผง'.
 *   - NO brand names, product names, reorder prompts, or health claims anywhere
 *     on this component surface.
 *   - Amount field: numeric input only — no copy beyond the label and placeholder.
 *
 * Consent gate (INV-ASD-1 dual-gate):
 *   - Required: infant_feeding + general_health.
 *   - If either is missing → chip is disabled + advisory shown ('formulaFeed.consentGate').
 *   - Amount field NEVER shown without both consents.
 *
 * A11y (containment rule):
 *   - Chip = <TouchableOpacity accessibilityRole="checkbox"> standing alone —
 *     NEVER inside accessible={true} View wrapper (containment rule).
 *   - accessibilityState.checked mirrors isActive.
 *   - TextInput has accessibilityLabel.
 *
 * INV-ASD-8: usesRemainingInOpenContainer must NEVER appear in this component.
 *
 * Source:
 *   auto-stock-decrement-ui.md §4, auto-stock-decrement-screens.md §3,
 *   auto-stock-decrement-functional.md §T-F.
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import { consentStore } from '../consent/consentStore';
import type { ConsentType } from '../consent/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FormulaFeedSectionProps {
  /** Whether the formula-feed chip is selected / active */
  isActive: boolean;
  /** Called when the user toggles the chip */
  onToggle: (active: boolean) => void;
  /** Current amount (scoops / units) — shown only when isActive=true and consent granted */
  amount: number;
  /** Called when user changes the amount field */
  onAmountChange: (amount: number) => void;
  /** Navigate to consent flow when advisory CTA is pressed */
  onNavigateConsent?: (consentType: ConsentType) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** INV-ASD-1 dual-gate: both must be granted for formula-feed logging */
const FORMULA_FEED_REQUIRED_CONSENTS: ConsentType[] = ['infant_feeding', 'general_health'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formulaFeedConsentGranted(): boolean {
  return FORMULA_FEED_REQUIRED_CONSENTS.every((c) => consentStore.isGranted(c));
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Stateless controlled component — reads consent from store synchronously.
 * useT() is mocked as a plain function in unit tests.
 */
export function FormulaFeedSection(props: FormulaFeedSectionProps): React.JSX.Element {
  const { isActive, onToggle, amount, onAmountChange, onNavigateConsent } = props;
  const { t } = useT();

  // Synchronous consent check (offline-first — consentStore is always in-memory)
  const consentGranted = formulaFeedConsentGranted();

  // Only show the amount field when: consent granted AND chip is active
  const showAmountField = consentGranted && isActive;

  return (
    <View style={styles.container}>
      {/*
       * Formula-feed chip — accessibilityRole="checkbox" (toggle semantics).
       * FW-1: label is the i18n key 'formulaFeed.chip' ONLY → 'ให้นมผง'.
       * Containment rule: chip is a standalone TouchableOpacity sibling,
       * NEVER inside an accessible={true} View wrapper.
       */}
      <TouchableOpacity
        style={[styles.chip, isActive && styles.chipActive, !consentGranted && styles.chipDisabled]}
        onPress={() => {
          if (!consentGranted) {
            onNavigateConsent?.('infant_feeding');
            return;
          }
          onToggle(!isActive);
        }}
        accessibilityRole="checkbox"
        accessibilityLabel={t('formulaFeed.chip')}
        accessibilityState={{ checked: isActive, disabled: !consentGranted }}
        disabled={false}  // touchable always; handler guards consent
      >
        <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>
          {t('formulaFeed.chip')}
        </Text>
      </TouchableOpacity>

      {/* Consent advisory — shown when consent is missing */}
      {!consentGranted && (
        <View style={styles.consentAdvisory}>
          <Text style={styles.consentAdvisoryText}>
            {t('formulaFeed.consentGate')}
          </Text>
          {onNavigateConsent && (
            <TouchableOpacity
              style={styles.consentLink}
              onPress={() => onNavigateConsent('infant_feeding')}
              accessibilityRole="button"
              accessibilityLabel={t('autoDecrement.advisory.consentCta')}
            >
              <Text style={styles.consentLinkText}>
                {t('autoDecrement.advisory.consentCta')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Amount field — shown only when consent granted AND chip is active */}
      {showAmountField && (
        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>
            {t('formulaFeed.amountLabel')}
          </Text>
          {/*
           * Amount input: numeric only — no brand/promo copy (FW-1).
           * accessibilityLabel required (a11y).
           */}
          <TextInput
            style={styles.amountInput}
            value={String(amount)}
            onChangeText={(text) => {
              const n = parseInt(text, 10);
              if (!isNaN(n) && n >= 0) {
                onAmountChange(n);
              }
            }}
            keyboardType="number-pad"
            placeholder={t('formulaFeed.amountPlaceholder')}
            accessibilityLabel={t('formulaFeed.amountLabel')}
            maxLength={3}
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// ALL values from ห้องแม่ tokens — ZERO inline hex/px literals (outside tokens.ts).

const styles = StyleSheet.create({
  container: {
    gap: T.spacing[2],
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: T.spacing[3],
    paddingVertical: T.spacing[2],
    borderRadius: T.radius.pill,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    backgroundColor: T.color.surface.subtle,
    minHeight: 48,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: T.color.surface.subtle,
    borderColor: T.color.accent.interactive,
  },
  chipDisabled: {
    opacity: 0.5,
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
  consentAdvisory: {
    backgroundColor: T.color.surface.wash.amber,
    borderRadius: T.radius.sm,
    padding: T.spacing[3],
    marginTop: T.spacing[1],
  },
  consentAdvisoryText: {
    color: T.color.text.heading,
    fontSize: T.type.body.size,
    fontFamily: T.type.body.fontFamily,
  },
  consentLink: {
    marginTop: T.spacing[2],
    minHeight: 48,
    justifyContent: 'center',
  },
  consentLinkText: {
    color: T.color.accent.interactive,
    fontSize: T.type.body.size,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.spacing[3],
    marginTop: T.spacing[2],
  },
  amountLabel: {
    flex: 1,
    color: T.color.text.primary,
    fontSize: T.type.body.size,
    fontFamily: T.type.body.fontFamily,
  },
  amountInput: {
    minWidth: 64,
    minHeight: 48,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.sm,
    paddingHorizontal: T.spacing[3],
    color: T.color.text.heading,
    fontSize: T.type.body.size,
    fontFamily: T.type.body.fontFamily,
    textAlign: 'center',
  },
});
