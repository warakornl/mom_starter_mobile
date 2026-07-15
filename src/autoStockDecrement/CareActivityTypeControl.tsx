/**
 * CareActivityTypeControl — Screen 4 (component): careActivityType chip-group for
 * the ReminderFormScreen.
 *
 * Controlled component: parent (ReminderFormScreen) owns the value state.
 *
 * Purpose: lets the mother tag a reminder as a care activity (diaper_change /
 * bathing) so that when the reminder fires, the T-D trigger fires
 * `applyCareActivityTrigger()` which auto-decrements the linked supply items.
 *
 * US-AS6 (anti-double-count): value=null means the reminder is NOT a care
 * activity — `applyCareActivityTrigger()` returns 'not_care_activity' and
 * writes no marker. The null option must ALWAYS be present and user-selectable.
 *
 * A11y: each chip has accessibilityRole="button" + accessibilityState.selected.
 * No accessible={true} View wrapper around chips (containment rule).
 *
 * Source:
 *   auto-stock-decrement-ui.md §5, auto-stock-decrement-functional.md §T-D.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';
import type { CareActivityType } from '../sync/syncTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CareActivityTypeControlProps {
  /**
   * Current care activity type.
   * null = "not a care activity" (US-AS6: no trigger, no marker).
   */
  value: CareActivityType | null;
  /** Called when user selects a different option */
  onChange: (value: CareActivityType | null) => void;
}

// ─── Options ──────────────────────────────────────────────────────────────────

interface CareActivityOption {
  value: CareActivityType | null;
  labelKey: string;
}

/**
 * All selectable options.
 * US-AS6: null is ALWAYS first and ALWAYS present.
 */
const OPTIONS: CareActivityOption[] = [
  { value: null,           labelKey: 'reminder.careActivityType.none' },
  { value: 'diaper_change', labelKey: 'reminder.careActivityType.diaperChange' },
  { value: 'bathing',      labelKey: 'reminder.careActivityType.bathing' },
];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Stateless controlled component — no hooks (except useT mocked in tests).
 */
export function CareActivityTypeControl(
  props: CareActivityTypeControlProps,
): React.JSX.Element {
  const { value, onChange } = props;
  const { t } = useT();

  return (
    <View style={styles.container}>
      {/* Field label */}
      <Text style={styles.fieldLabel}>
        {t('reminder.careActivityType.fieldLabel')}
      </Text>

      {/* Chip row — chips are siblings, NEVER inside accessible={true} wrapper */}
      <View style={styles.chipRow}>
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <TouchableOpacity
              key={option.labelKey}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onChange(option.value)}
              accessibilityRole="button"
              accessibilityLabel={t(option.labelKey as Parameters<typeof t>[0])}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {t(option.labelKey as Parameters<typeof t>[0])}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// ALL values from ห้องแม่ tokens — ZERO inline hex/px literals (outside tokens.ts).

const styles = StyleSheet.create({
  container: {
    marginTop: T.spacing[3],
    marginBottom: T.spacing[2],
  },
  fieldLabel: {
    // R4: text.secondary (jade-600) is BANNED below 15sp — was caption (13sp).
    // Bumped to type.body (15sp) so jade-600 satisfies the ≥15sp floor.
    color: T.color.text.secondary,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    fontFamily: T.type.body.fontFamily,
    marginBottom: T.spacing[2],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: T.spacing[2],
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
  },
  chipSelected: {
    // Distinct fill for the selected chip (matches FeedingLogScreen's
    // chipActive) — border-only selection was too subtle a cue.
    backgroundColor: T.color.surface.wash.roselle,
    borderColor: T.color.accent.interactive,
  },
  chipText: {
    color: T.color.text.primary,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    fontFamily: T.type.body.fontFamily,
  },
  chipTextSelected: {
    color: T.color.accent.interactive,
    fontFamily: T.type.label.fontFamily,
    fontWeight: T.type.label.fontWeight,
    lineHeight: T.type.label.lineHeight,
  },
});
