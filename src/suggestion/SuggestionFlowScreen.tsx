/**
 * SuggestionFlowScreen — "สิ่งที่น่าติดตามช่วงนี้" (Worth tracking this stage)
 *
 * Implements suggestion-flow-ui.md §1 full screen:
 * - Stage context strip (gestational week + stage)
 * - List of suggestion cards — one card per offerable suggestion
 * - Each card: capture-type glyph + title + reason + evidence ribbon
 * - Three actions per card: Start · Snooze (menu 3/7/14d) · Not for me
 * - Empty state when all suggestions handled or lifecycle = ended
 * - Persistent "not medical advice" footer (US-11)
 * - Dismissed list accessible from empty state (§3.1)
 *
 * States: list (populated) | empty / all-handled | loading (rare, sub-100ms)
 *
 * Data: local-first (B5). All Start/Snooze/Dismiss writes go to the local
 * suggestionStore (persisted via durable storage). Cards animate out on action.
 * The engine is re-run locally after each action — no network wait.
 *
 * Design tokens: design-system.md §1–§5 (rose/50 card surfaces, ink text,
 * evidence ribbon caption style, radius/lg cards, elev/1).
 *
 * Security: no health values logged, no tokens in props.
 *
 * testIDs:
 *   suggestion-flow-screen
 *   suggestion-card-{key}
 *   suggestion-card-start-{key}
 *   suggestion-card-snooze-{key}
 *   suggestion-card-dismiss-{key}
 *   suggestion-flow-empty
 *   suggestion-flow-back
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';

import { getOfferable } from './suggestionEngine';
import { suggestionStore } from './suggestionStore';
import { SUGGESTION_CATALOG } from './suggestionCatalog';
import type { OfferableSuggestion, SuggestionKey, CaptureTarget, SuggestionCatalogEntry, AncFormPrefill } from './types';
import type { Stage } from '../pregnancy/gestationalAge';
import type { Lifecycle } from '../pregnancy/types';
import { useT } from '../i18n/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SuggestionFlowScreenProps {
  /** Current lifecycle — used to filter suggestions. */
  lifecycle: Lifecycle;
  /** Current trimester stage (T1/T2/T3); null when postpartum. */
  stage: Stage | null;
  /** Current gestational week (only meaningful when pregnant). */
  gestationalWeek: number;
  /**
   * Estimated due date (EDD) as 'YYYY-MM-DD'.
   * Required for the ANC cadence suggestion offerable predicate (§1.3 item 1).
   * Optional for screens that do not use the ANC suggestion.
   */
  edd?: string | null;
  /**
   * True when the caller has determined that at least one non-done
   * appointment/anc_visit exists in [today, nextTargetDate + WINDOW].
   * Passed through to the SuggestionContext for the ANC offerable predicate
   * (§1.3 item 4). Optional for backward-compat.
   */
  upcomingApptInWindow?: boolean;
  /** Navigate back. */
  onBack: () => void;
  /** Navigate to KickCountHome (for kick_count suggestions). */
  onKickCount?: () => void;
  /** Navigate to SuppliesScreen (for supplies suggestions). */
  onSupplies?: () => void;
  /** Navigate to CalendarScreen (for appointment/medication suggestions). */
  onCalendar?: () => void;
  /**
   * Called when the ANC suggestion Start tap opens the pre-filled
   * AppointmentFormScreen. The caller is responsible for rendering it.
   * Receives the prefill payload for the form.
   */
  onAncStart?: (prefill: AncFormPrefill) => void;
}

// ─── Capture-type glyphs ─────────────────────────────────────────────────────

const CAPTURE_GLYPHS: Record<CaptureTarget, string> = {
  kick_count:  '🌀',
  medication:  '💊',
  appointment: '📋',
  supplies:    '🎒',
  self_log:    '📓',
};

// ─── Evidence glyph (shape + text — not colour alone; design-system §2.1) ────

const EVIDENCE_GLYPHS: Record<string, string> = {
  HIGH:     '●', // filled dot
  STRONG:   '◑', // half dot
  MODERATE: '○', // open dot
};

// ─── Snooze days ─────────────────────────────────────────────────────────────

const SNOOZE_OPTIONS = [3, 7, 14] as const;
type SnoozeDays = (typeof SNOOZE_OPTIONS)[number];

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onStart,
  onSnooze,
  onDismiss,
}: {
  suggestion: OfferableSuggestion;
  onStart: (key: SuggestionKey) => void;
  onSnooze: (key: SuggestionKey, days: SnoozeDays) => void;
  onDismiss: (key: SuggestionKey) => void;
}): React.JSX.Element {
  const { t } = useT();
  const { key, captureTarget, evidenceStrength, source } = suggestion;

  const titleKey = `suggestion.${key}.title` as Parameters<typeof t>[0];
  const reasonKey = `suggestion.${key}.reason` as Parameters<typeof t>[0];
  const evidenceKey = `suggestion.evidence.${evidenceStrength}` as Parameters<typeof t>[0];

  const title = t(titleKey);
  const reason = t(reasonKey);
  const evidenceLabel = t(evidenceKey);
  const sourcePrefix = t('suggestion.source.prefix');
  const evidenceGlyph = EVIDENCE_GLYPHS[evidenceStrength] ?? '○';
  const captureGlyph = CAPTURE_GLYPHS[captureTarget] ?? '🌱';
  const captureTypeA11y = t(`suggestion.captureType.${captureTarget}` as Parameters<typeof t>[0]);

  const startLabel = t('suggestion.action.start');
  const snoozeLabel = t('suggestion.action.snooze');
  const dismissLabel = t('suggestion.action.dismiss');
  const snoozeTitle = t('suggestion.action.snoozeTitle');
  const snooze3Label = t('suggestion.action.snooze3d');
  const snooze7Label = t('suggestion.action.snooze7d');
  const snooze14Label = t('suggestion.action.snooze14d');
  const cancelLabel = t('suggestion.action.snoozeCancel');

  const cardA11y =
    `Suggestion: ${title}. Reason: ${reason}. ${evidenceLabel}. ${t('suggestion.banner.notMedicalAdvice')}. Actions: ${startLabel}, ${snoozeLabel}, ${dismissLabel}.`;

  function handleSnooze() {
    const options = [
      { text: snooze3Label, onPress: () => onSnooze(key, 3) },
      { text: snooze7Label, onPress: () => onSnooze(key, 7) },
      { text: snooze14Label, onPress: () => onSnooze(key, 14) },
      { text: cancelLabel, style: 'cancel' as const },
    ];
    Alert.alert(snoozeTitle, undefined, options, { cancelable: true });
  }

  return (
    <View
      testID={`suggestion-card-${key}`}
      style={cardStyles.card}
      accessible={true}
      accessibilityLabel={cardA11y}
      accessibilityRole="none"
    >
      {/* Title row */}
      <View style={cardStyles.titleRow}>
        <Text style={cardStyles.glyph} accessibilityElementsHidden={true}>
          {captureGlyph}
        </Text>
        <Text style={cardStyles.title} accessibilityElementsHidden={true} numberOfLines={2}>
          {title}
        </Text>
      </View>

      {/* Reason text */}
      <Text style={cardStyles.reason} accessibilityElementsHidden={true}>
        {reason}
      </Text>

      {/* Evidence ribbon — §2.1 signature element */}
      <View style={cardStyles.ribbon} accessibilityElementsHidden={true}>
        <Text style={cardStyles.ribbonDot}>{evidenceGlyph}</Text>
        <Text style={cardStyles.ribbonText} numberOfLines={2}>
          {`${evidenceLabel} · ${sourcePrefix}${source} ›`}
        </Text>
      </View>

      {/* Three actions — §2.2: Start · Snooze · Not for me */}
      <View style={cardStyles.actions}>
        <TouchableOpacity
          testID={`suggestion-card-start-${key}`}
          style={cardStyles.startBtn}
          onPress={() => onStart(key)}
          accessibilityRole="button"
          accessibilityLabel={`${startLabel}: ${title} — ${captureTypeA11y}`}
        >
          <Text style={cardStyles.startBtnText}>{startLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID={`suggestion-card-snooze-${key}`}
          style={cardStyles.snoozeBtn}
          onPress={handleSnooze}
          accessibilityRole="button"
          accessibilityLabel={`${snoozeLabel}: ${title}`}
        >
          <Text style={cardStyles.snoozeBtnText}>{`${snoozeLabel} ▾`}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID={`suggestion-card-dismiss-${key}`}
          style={cardStyles.dismissBtn}
          onPress={() => onDismiss(key)}
          accessibilityRole="button"
          accessibilityLabel={`${dismissLabel}: ${title}`}
        >
          <Text style={cardStyles.dismissBtnText}>{dismissLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF', // surface/page
    borderRadius: 20,           // radius/lg
    borderWidth: 1,
    borderColor: '#EBE1D9',     // hairline
    padding: 16,
    gap: 10,
    // elev/1
    shadowColor: '#3A2A30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
    // rose/50 left inset (design-system §5.3 "soft rose/50 left inset")
    borderLeftWidth: 4,
    borderLeftColor: '#FBEDEE', // rose/50
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  glyph: {
    fontSize: 18,
    lineHeight: 26,
  },
  title: {
    flex: 1,
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 17,
    lineHeight: 26,
    color: '#3A2A30', // ink
  },
  reason: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52', // ink/soft
  },
  ribbon: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#EBE1D9', // hairline
  },
  ribbonDot: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 11,
    lineHeight: 19,
    color: '#94818A', // ink/faint
    flexShrink: 0,
  },
  ribbonText: {
    flex: 1,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#94818A', // ink/faint
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  startBtn: {
    height: 40,
    paddingHorizontal: 20,
    backgroundColor: '#A8505A', // rose/600
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  startBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  snoozeBtn: {
    height: 40,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EBE1D9',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  snoozeBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#3A2A30',
  },
  dismissBtn: {
    height: 40,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissBtnText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#8E3A44', // rose/700
  },
});

// ─── Dismissed suggestions section (§3.1) ─────────────────────────────────────

function DismissedSection({
  entries,
  onReenable,
}: {
  entries: SuggestionCatalogEntry[];
  onReenable: (key: SuggestionKey) => void;
}): React.JSX.Element {
  const { t } = useT();
  const reenableLabel = t('suggestion.action.reenable');
  const sectionTitle = t('suggestion.dismissed.title');

  return (
    <View style={dismissedStyles.container} testID="suggestion-dismissed-section">
      <Text style={dismissedStyles.sectionTitle}>{sectionTitle}</Text>
      {entries.map((entry) => {
        const titleKey = `suggestion.${entry.key}.title` as Parameters<typeof t>[0];
        const title = t(titleKey);
        const glyph = CAPTURE_GLYPHS[entry.captureTarget] ?? '🌱';
        return (
          <View key={entry.key} style={dismissedStyles.row} testID={`suggestion-dismissed-${entry.key}`}>
            <Text style={dismissedStyles.glyph} accessibilityElementsHidden={true}>{glyph}</Text>
            <Text style={dismissedStyles.title} numberOfLines={2}>{title}</Text>
            <TouchableOpacity
              testID={`suggestion-reenable-${entry.key}`}
              style={dismissedStyles.reenableBtn}
              onPress={() => onReenable(entry.key)}
              accessibilityRole="button"
              accessibilityLabel={`${reenableLabel}: ${title}`}
            >
              <Text style={dismissedStyles.reenableBtnText}>{reenableLabel}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const dismissedStyles = StyleSheet.create({
  container: {
    gap: 8,
    paddingTop: 8,
  },
  sectionTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 13,
    lineHeight: 19,
    color: '#94818A', // ink/faint
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 12,
  },
  glyph: {
    fontSize: 16,
    lineHeight: 22,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#94818A', // ink/faint — dimmed since dismissed
  },
  reenableBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#A8505A', // rose/600
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  reenableBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 13,
    color: '#A8505A', // rose/600
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export function SuggestionFlowScreen({
  lifecycle,
  stage,
  gestationalWeek,
  onBack,
  onKickCount,
  onSupplies,
  onCalendar,
}: SuggestionFlowScreenProps): React.JSX.Element {
  const { t } = useT();

  // Compute offerable list from engine each render (pure, fast, local)
  const [tick, setTick] = useState(0);
  const recompute = useCallback(() => setTick((n) => n + 1), []);

  // Toggle for the dismissed-suggestions section (spec §3.1 "View hidden")
  const [showDismissed, setShowDismissed] = useState(false);

  // void tick is used to trigger re-render; suppress lint
  void tick;

  // Dismissed entries — mapped from keys → catalog for the "View hidden" section.
  // Dismiss is always recoverable via this section (spec §3.1).
  // NOTE: an undo toast (suggestion.hidden.toast / suggestion.hidden.undo) is
  // deferred; recoverability is guaranteed by the "View hidden" affordance below.
  const dismissedKeys = suggestionStore.getDismissedKeys();
  const dismissedEntries: SuggestionCatalogEntry[] = SUGGESTION_CATALOG.filter(
    (entry) => (dismissedKeys as string[]).includes(entry.key),
  );

  const suggestions: OfferableSuggestion[] = getOfferable(
    { lifecycle, stage, gestationalWeek, now: new Date() },
    suggestionStore.getState(),
  );

  // ── Stage context strip ─────────────────────────────────────────────────
  let stageStrip = '';
  if (lifecycle === 'pregnant' && stage) {
    const stageName = t(`stage.${stage}` as 'stage.T1' | 'stage.T2' | 'stage.T3');
    stageStrip = `${stageName} · ${t('home.weekDisplay', { n: gestationalWeek })}`;
  } else if (lifecycle === 'postpartum') {
    stageStrip = t('home.postpartumStage', { n: 0 });
  }

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleStart(key: SuggestionKey) {
    suggestionStore.start(key);
    recompute();
    // Route to the relevant screen for this capture target
    const entry = suggestions.find((s) => s.key === key);
    if (!entry) return;
    switch (entry.captureTarget) {
      case 'kick_count':
        onKickCount?.();
        break;
      case 'supplies':
        onSupplies?.();
        break;
      case 'appointment':
      case 'medication':
      case 'self_log':
        onCalendar?.();
        break;
    }
  }

  function handleSnooze(key: SuggestionKey, days: SnoozeDays) {
    suggestionStore.snooze(key, days);
    recompute();
  }

  function handleDismiss(key: SuggestionKey) {
    suggestionStore.dismiss(key);
    recompute();
  }

  function handleReenable(key: SuggestionKey) {
    suggestionStore.reenable(key);
    recompute();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View testID="suggestion-flow-screen" style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          testID="suggestion-flow-back"
          style={styles.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('general.back')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backBtnText}>{'‹ '}{t('general.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>{t('suggestion.screen.title')}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Stage context strip */}
        {stageStrip ? (
          <View style={styles.stageStrip}>
            <Text style={styles.stageStripText}>{stageStrip}</Text>
            <Text style={styles.offersSubline}>{t('suggestion.screen.offers')}</Text>
          </View>
        ) : null}

        {/* Suggestion cards / empty state */}
        {suggestions.length > 0 ? (
          suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.key}
              suggestion={suggestion}
              onStart={handleStart}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
            />
          ))
        ) : (
          <View testID="suggestion-flow-empty" style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('suggestion.screen.empty')}</Text>
            {dismissedEntries.length > 0 && (
              <TouchableOpacity
                testID="suggestion-flow-view-hidden"
                style={styles.viewHiddenBtn}
                onPress={() => setShowDismissed((prev) => !prev)}
                accessibilityRole="button"
                accessibilityLabel={t('suggestion.screen.viewHidden')}
              >
                <Text style={styles.viewHiddenText}>{t('suggestion.screen.viewHidden')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Dismissed suggestions section — §3.1 "View hidden" affordance.
            Visible when toggled from empty state OR from the inline link below
            when active suggestions exist. Re-enable restores → 'offered'. */}
        {dismissedEntries.length > 0 && suggestions.length > 0 && (
          <TouchableOpacity
            testID="suggestion-flow-view-hidden"
            style={styles.viewHiddenBtn}
            onPress={() => setShowDismissed((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={t('suggestion.screen.viewHidden')}
          >
            <Text style={styles.viewHiddenText}>{t('suggestion.screen.viewHidden')}</Text>
          </TouchableOpacity>
        )}

        {showDismissed && dismissedEntries.length > 0 && (
          <DismissedSection entries={dismissedEntries} onReenable={handleReenable} />
        )}
      </ScrollView>

      {/* Persistent "not medical advice" footer (US-11) */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('suggestion.screen.notMedicalAdvice')}</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1', // bg/warm-milk
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: 12,
    backgroundColor: '#FBF6F1',
    borderBottomWidth: 1,
    borderBottomColor: '#EBE1D9',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    minHeight: 44,
    justifyContent: 'center',
  },
  backBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#8E3A44', // rose/700
  },
  navTitle: {
    flex: 1,
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
    textAlign: 'center',
    marginRight: 60, // balance the back button width
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    gap: 16,
  },

  stageStrip: {
    gap: 4,
  },
  stageStripText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F4A52', // ink/soft
  },
  offersSubline: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#94818A', // ink/faint
  },

  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 16,
  },
  emptyText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    textAlign: 'center',
  },
  viewHiddenBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  viewHiddenText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#8E3A44',
    textDecorationLine: 'underline',
  },

  footer: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#EBE1D9',
    backgroundColor: '#FBF6F1',
  },
  footerText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#94818A',
    textAlign: 'center',
  },
});
