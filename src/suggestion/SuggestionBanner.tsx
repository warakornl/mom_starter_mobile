/**
 * SuggestionBanner — single light banner for HomeScreen.
 *
 * Implements design-system.md §5.3 "Banner — suggestion (single, light)":
 *   - soft rose/50 background card
 *   - sprout/new glyph + one-line headline
 *   - quiet "View all" affordance → routes to SuggestionFlowScreen
 *   - dismiss (X) button → removes the top suggestion from view
 *   - "not medical advice" footnote (US-11)
 *
 * Shows only when there is ≥1 offerable suggestion (AC-29).
 * At most ONE suggestion banner is shown (design-system §5.3).
 *
 * Priority on HomeScreen: consent nudge FIRST (compliance-critical),
 * suggestion banner SECOND (per CLAUDE.md coordination note).
 *
 * Props:
 *   topSuggestion — the first offerable suggestion (from suggestionEngine)
 *   onAction      — navigates to the capture-target screen for this suggestion
 *   onDismiss     — dismisses the top suggestion (updates local store)
 *   onViewAll     — (optional) navigates to SuggestionFlowScreen
 *
 * testIDs: "suggestion-banner", "suggestion-banner-action", "suggestion-banner-dismiss",
 *          "suggestion-banner-view-all"
 *
 * Security: renders no health values, no tokens. Only i18n strings + suggestion key.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import type { OfferableSuggestion } from './types';
import { useT } from '../i18n/LanguageContext';

// ─── Capture-type glyph map ───────────────────────────────────────────────────
// Text glyphs only — no literal emoji in production (design-system §4.1 note).
// Using Unicode math/symbol characters as lightweight stand-ins.

const CAPTURE_GLYPHS: Record<string, string> = {
  kick_count:  '🌀',
  medication:  '💊',
  appointment: '📋',
  supplies:    '🎒',
  self_log:    '📓',
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SuggestionBannerProps {
  /** The top suggestion to display. When null/undefined the banner is hidden. */
  topSuggestion: OfferableSuggestion | null | undefined;
  /** Navigate to the relevant feature screen for this suggestion. */
  onAction: () => void;
  /** Dismiss this suggestion (marks as dismissed in the store). */
  onDismiss: () => void;
  /** Navigate to the full SuggestionFlowScreen (optional). */
  onViewAll?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SuggestionBanner({
  topSuggestion,
  onAction,
  onDismiss,
  onViewAll,
}: SuggestionBannerProps): React.JSX.Element | null {
  const { t } = useT();

  if (!topSuggestion) return null;

  const glyph = CAPTURE_GLYPHS[topSuggestion.captureTarget] ?? '🌱';
  const titleKey = `suggestion.${topSuggestion.key}.title` as Parameters<typeof t>[0];
  const title = t(titleKey);
  const headline = t('suggestion.banner.headline');
  const notMedicalAdvice = t('suggestion.banner.notMedicalAdvice');
  const viewAllLabel = t('suggestion.banner.view');
  const dismissA11y = t('suggestion.banner.dismissA11y');
  const captureTypeLabel = t(`suggestion.captureType.${topSuggestion.captureTarget}` as Parameters<typeof t>[0]);
  const startLabel = t('suggestion.action.start');

  const cardA11y = `${headline}. ${title}. ${captureTypeLabel}. ${notMedicalAdvice}.`;

  return (
    <View
      testID="suggestion-banner"
      style={styles.card}
      accessible={false}
    >
      {/* Top row: glyph disc + headline + dismiss button */}
      <View style={styles.topRow}>
        <View style={styles.glyphDisc} accessibilityElementsHidden={true}>
          <Text style={styles.glyph}>{glyph}</Text>
        </View>

        <View style={styles.textCol}>
          <Text style={styles.headline} numberOfLines={1} accessibilityElementsHidden={true}>
            {headline}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        </View>

        <TouchableOpacity
          testID="suggestion-banner-dismiss"
          style={styles.dismissBtn}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={dismissA11y}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.dismissIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Action row */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          testID="suggestion-banner-action"
          style={styles.startBtn}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={cardA11y}
        >
          <Text style={styles.startBtnText}>{startLabel}</Text>
        </TouchableOpacity>

        {onViewAll && (
          <TouchableOpacity
            testID="suggestion-banner-view-all"
            style={styles.viewAllBtn}
            onPress={onViewAll}
            accessibilityRole="button"
            accessibilityLabel={viewAllLabel}
          >
            <Text style={styles.viewAllText}>{viewAllLabel}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Not medical advice footnote (US-11) */}
      <Text style={styles.disclaimer}>{notMedicalAdvice}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// design-system.md §5.3: rose/50 card, radius/lg, elev/1

const styles = StyleSheet.create({
  // Soft rose/50 surface card (design-system §5.3)
  card: {
    backgroundColor: '#FBEDEE', // rose/50
    borderRadius: 20,           // radius/lg
    borderWidth: 1,
    borderColor: '#F4D9DC',     // rose/100
    padding: 16,
    gap: 10,
    // elev/1 (design-system §3.3)
    shadowColor: '#3A2A30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  // Sprout glyph disc — rose/50 family (design-system §5.3 "sprout/new glyph")
  glyphDisc: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F4D9DC', // rose/100
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  glyph: {
    fontSize: 18,
    lineHeight: 22,
  },

  textCol: {
    flex: 1,
    gap: 2,
  },

  headline: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#5F4A52', // ink/soft
  },

  title: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A2A30', // ink
  },

  dismissBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: -2,
  },
  dismissIcon: {
    fontSize: 14,
    color: '#94818A', // ink/faint
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },

  startBtn: {
    height: 36,
    paddingHorizontal: 16,
    backgroundColor: '#A8505A', // rose/600
    borderRadius: 999,          // radius/pill
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },

  viewAllBtn: {
    height: 36,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewAllText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#8E3A44', // rose/700
    textDecorationLine: 'underline',
  },

  disclaimer: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 11,
    lineHeight: 16,
    color: '#94818A', // ink/faint
  },
});
