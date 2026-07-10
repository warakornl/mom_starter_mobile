/**
 * SnoozeChooserSheet — 10/30/60-minute medication snooze chooser.
 *
 * Design ref: screens-spec §5.3 (bottom sheet, design-system §5.12 pattern)
 *             functional-spec §2 (snooze state machine, medication-only)
 *
 * MEDICATION-ONLY: this sheet is rendered only for type='medication' occurrences.
 * All other types snooze at fixed 1h with no sheet (caller guards with isMedicationReminder()).
 *
 * States (screens-spec §2.1):
 *   Shown     — three options (10/30/60 min) + cancel row. Non-blocking.
 *   Dismissed — no write; prior occurrence status is untouched.
 *   Picked    — onPick(minutes) → caller writes snoozedUntil + schedules alarm.
 *
 * Accessibility (screens-spec §5.6):
 *   - Option rows min-height 56dp (≥48dp spec, larger for medication snooze)
 *   - Cancel button min-height 44dp
 *   - SR label: "เลื่อนเตือน N นาที — จะแจ้งเตือนอีกครั้งเวลา HH:mm" (reminder.snooze.alertsAt.sr)
 *   - Sheet role="dialog", aria-modal, focus trap (React Native Modal provides this)
 *   - Focus order: title → opt10 → opt30 → opt60 → Cancel (screens-spec §5.6)
 *   - Fix A: plain <View> for sheet body (not TouchableOpacity) so VoiceOver
 *     traverses children individually. Sibling Pressable scrim for tap-to-dismiss.
 *
 * Layout (Fix A + Minor 2):
 *   Modal
 *     View (overlay: flex:1, justifyContent:flex-end, bg semi-transparent)
 *       Pressable (scrim: absoluteFill, tap=dismiss, accessible=false)
 *       ScrollView (sheet: maxHeight 85%, NOT a TouchableOpacity wrapper)
 *         ... drag handle, title, divider, options, divider, cancel ...
 *
 * SD-11: no drug name is passed to or rendered by this component; the sheet
 * displays only the generic snooze title and duration options.
 *
 * Security: no health data in this component.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { getSnoozeOptions } from './snoozeChooserLogic';
import type { SnoozeDuration } from './snoozeChooserLogic';
import { T } from '../theme/tokens';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SnoozeChooserSheetProps {
  /** Whether the sheet is visible. */
  visible: boolean;
  /**
   * Snapshot of wall-clock time taken when the chooser was opened.
   * Stable across renders so the "alerts at" times don't drift.
   * Set in pendingSnoozeRef.openedAt by CalendarScreen when opening the sheet.
   */
  now: Date;
  /**
   * Called when the user taps a snooze option.
   * The caller is responsible for writing snoozedUntil to the store and
   * scheduling the OS alarm via scheduleSnooze().
   */
  onPick: (minutes: SnoozeDuration) => void;
  /**
   * Called when the user taps Cancel or dismisses the sheet.
   * No write — occurrence stays in its prior status.
   */
  onDismiss: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SnoozeChooserSheet({
  visible,
  now,
  onPick,
  onDismiss,
}: SnoozeChooserSheetProps): React.JSX.Element {
  const { t } = useT();
  const options = getSnoozeOptions(now);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      {/*
        Overlay: layout container + background color.
        NOT itself focusable — VoiceOver traverses only the sheet children.
        Fix A: plain View (not TouchableOpacity) so the accessible tree is NOT
        collapsed. justifyContent:flex-end positions the sheet at the bottom.
      */}
      <View
        style={styles.overlay}
        importantForAccessibility="no"
        accessible={false}
      >
        {/*
          Scrim: absolutely-filled Pressable behind the sheet.
          Catches taps on the overlay area (above/beside the sheet) → dismiss.
          accessible={false}: VoiceOver does not focus the scrim; users dismiss
          via the Cancel button in the sheet. importantForAccessibility="no"
          hides it from the Android a11y tree as well.
          Fix A (sibling pattern): rendered BEFORE the sheet so the sheet
          (later sibling) is painted on top — taps on the sheet area reach
          sheet children first, not this Pressable.
        */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessible={false}
          importantForAccessibility="no"
        />

        {/*
          Sheet body: plain View (not TouchableOpacity) so VoiceOver can
          individually focus the title, each option row, and the Cancel button
          (screens-spec §5.6 focus order: title → opt10 → opt30 → opt60 → Cancel).
          Fix A: removing the TouchableOpacity wrapper prevents VoiceOver from
          collapsing children into a single grouped accessible node.
          Minor 2: wrapped in ScrollView with maxHeight:85% so rows don't
          overflow at ≥200% Dynamic Type (screens-spec §5.6).
        */}
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          testID="snooze-chooser-sheet"
        >
          {/* Drag handle bar — decorative, hidden from a11y */}
          <View style={styles.dragHandle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />

          {/* Sheet title */}
          <Text
            style={styles.title}
            accessibilityRole="header"
            testID="snooze-chooser-title"
          >
            {t('reminder.snooze.title')}
          </Text>

          <View style={styles.divider} accessibilityElementsHidden />

          {/* Option rows */}
          {options.map((opt) => {
            const optKey =
              opt.minutes === 10 ? 'reminder.snooze.opt.10'
              : opt.minutes === 30 ? 'reminder.snooze.opt.30'
              : 'reminder.snooze.opt.60';
            // Visible sub-label uses alertsAt (without "อีกครั้ง") — screens-spec §5.3
            const alertsAtLabel = interpolate(t('reminder.snooze.alertsAt'), { time: opt.alertsAtStr });
            // SR-only a11y label uses alertsAt.sr ("อีกครั้ง") — screens-spec §5.6 Minor-1
            const alertsAtSrLabel = interpolate(t('reminder.snooze.alertsAt.sr'), { time: opt.alertsAtStr });
            const a11yLabel = `${t('reminder.snooze.title')} ${t(optKey)} — ${alertsAtSrLabel}`;

            return (
              <TouchableOpacity
                key={opt.minutes}
                style={styles.optionRow}
                onPress={() => onPick(opt.minutes)}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                testID={`snooze-opt-${opt.minutes}`}
              >
                <View style={styles.optionLeft}>
                  <Text style={styles.optionMinutes}>{opt.minutes}</Text>
                </View>
                <View style={styles.optionBody}>
                  <Text style={styles.optionLabel}>{t(optKey)}</Text>
                  <Text style={styles.optionSublabel}>{alertsAtLabel}</Text>
                </View>
                <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{'›'}</Text>
              </TouchableOpacity>
            );
          })}

          <View style={styles.divider} accessibilityElementsHidden />

          {/* Cancel row */}
          <TouchableOpacity
            style={styles.cancelRow}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={t('reminder.snooze.cancel')}
            testID="snooze-chooser-cancel"
          >
            <Text style={styles.cancelLabel}>{t('reminder.snooze.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(74, 34, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  // Minor 2: maxHeight 85% mirrors JitConsentSheet to prevent overflow at
  // ≥200% Dynamic Type (screens-spec §5.6).
  sheet: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    maxHeight: '85%',
  },
  sheetContent: {
    paddingBottom: 40,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: T.color.surface.subtle,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  title: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
    marginHorizontal: 24,
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: T.color.surface.divider,
    marginHorizontal: 0,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    minHeight: 56, // ≥ 56dp as per screens-spec §5.6
    backgroundColor: T.color.surface.base,
  },
  optionLeft: {
    width: 40,
    alignItems: 'flex-start',
  },
  optionMinutes: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: 20,
    color: T.color.text.heading,
  },
  optionBody: {
    flex: 1,
    paddingVertical: 12,
  },
  optionLabel: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: T.color.text.primary,
    lineHeight: 22,
  },
  optionSublabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    color: T.color.text.primary,
    lineHeight: 18,
    marginTop: 2,
  },
  chevron: {
    fontSize: 18,
    color: T.color.text.primary,
    marginLeft: 8,
  },
  cancelRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // ≥ 44dp as per screens-spec §5.6
    marginTop: 4,
  },
  cancelLabel: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: T.color.text.primary,
  },
});
