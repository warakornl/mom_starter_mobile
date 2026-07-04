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
 *   - SR label: "เลื่อนเตือน N นาที — จะแจ้งเตือนอีกครั้งเวลา HH:mm"
 *   - Sheet role="dialog", aria-modal, focus trap (React Native Modal provides this)
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
  Modal,
  StyleSheet,
} from 'react-native';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { getSnoozeOptions } from './snoozeChooserLogic';
import type { SnoozeDuration } from './snoozeChooserLogic';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SnoozeChooserSheetProps {
  /** Whether the sheet is visible. */
  visible: boolean;
  /**
   * Current wall-clock time — injected so the alertsAt sub-label is computed
   * at open time (not import time). Pass `new Date()` in production.
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
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onDismiss}
        accessibilityLabel={t('reminder.snooze.cancel')}
      >
        {/* Sheet — stopPropagation so tapping inside the sheet does not dismiss */}
        <TouchableOpacity
          activeOpacity={1}
          style={styles.sheet}
          accessibilityRole="none"
        >
          {/* Drag handle bar */}
          <View style={styles.dragHandle} accessibilityElementsHidden />

          {/* Sheet title */}
          <Text
            style={styles.title}
            accessibilityRole="header"
            testID="snooze-chooser-title"
          >
            {t('reminder.snooze.title')}
          </Text>

          <View style={styles.divider} />

          {/* Option rows */}
          {options.map((opt) => {
            const optKey =
              opt.minutes === 10 ? 'reminder.snooze.opt.10'
              : opt.minutes === 30 ? 'reminder.snooze.opt.30'
              : 'reminder.snooze.opt.60';
            const alertsAtLabel = interpolate(t('reminder.snooze.alertsAt'), { time: opt.alertsAtStr });
            const a11yLabel = `${t('reminder.snooze.title')} ${t(optKey)} — ${alertsAtLabel}`;

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
                <Text style={styles.chevron} accessibilityElementsHidden>{'›'}</Text>
              </TouchableOpacity>
            );
          })}

          <View style={styles.divider} />

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
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(58, 42, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#EBE1D9', // hairline
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  title: {
    fontFamily: 'Looped-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30', // ink
    marginHorizontal: 24,
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#EBE1D9', // hairline
    marginHorizontal: 0,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    minHeight: 56, // ≥ 56dp as per screens-spec §5.6
    backgroundColor: '#FFFFFF', // surface/page
  },
  optionLeft: {
    width: 40,
    alignItems: 'flex-start',
  },
  optionMinutes: {
    fontFamily: 'IBMPlexMono-SemiBold',
    fontSize: 20,
    color: '#3A2A30', // ink
  },
  optionBody: {
    flex: 1,
    paddingVertical: 12,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3A2A30', // ink
    lineHeight: 22,
  },
  optionSublabel: {
    fontSize: 12,
    color: '#94818A', // ink/faint
    lineHeight: 18,
    marginTop: 2,
  },
  chevron: {
    fontSize: 18,
    color: '#94818A', // ink/faint
    marginLeft: 8,
  },
  cancelRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // ≥ 44dp as per screens-spec §5.6
    marginTop: 4,
  },
  cancelLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8E3A44', // rose/700
  },
});
