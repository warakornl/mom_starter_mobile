/**
 * ConsentNudgeModal — shared JIT consent nudge for the general_health gate.
 *
 * Used by:
 *   CaptureScreen  — testIDPrefix="capture"  (capture-consent-*)
 *   CalendarScreen — testIDPrefix="calendar" (calendar-consent-*)
 *
 * Shipped posture (§B.4 / MR-E1):
 *   - Show when a health write is attempted but general_health is not yet granted.
 *   - Grant:    POST consent → optimistic store update → drain held payload.
 *   - Not-now:  clear held payload (same-session lifetime; no persistence).
 *
 * SECURITY: no health data logged in this component.
 *
 * testIDs (per screen):
 *   CaptureScreen  → capture-consent-modal, capture-consent-grant, capture-consent-not-now
 *   CalendarScreen → calendar-consent-modal, calendar-consent-grant, calendar-consent-not-now
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { T } from '../theme/tokens';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConsentNudgeModalProps {
  visible: boolean;
  isLoading: boolean;
  onGrant: () => void;
  onNotNow: () => void;
  title: string;
  body: string;
  grantLabel: string;
  notNowLabel: string;
  changeLaterNote: string;
  /**
   * testID prefix for the modal and its buttons.
   * Defaults to "capture" for backward compatibility with CaptureScreen.
   * CalendarScreen passes "calendar".
   */
  testIDPrefix?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConsentNudgeModal({
  visible,
  isLoading,
  onGrant,
  onNotNow,
  title,
  body,
  grantLabel,
  notNowLabel,
  changeLaterNote,
  testIDPrefix = 'capture',
}: ConsentNudgeModalProps): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onNotNow}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View
          testID={`${testIDPrefix}-consent-modal`}
          style={styles.sheet}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
            <TouchableOpacity
              testID={`${testIDPrefix}-consent-grant`}
              style={[styles.grantBtn, isLoading && styles.grantBtnLoading]}
              onPress={isLoading ? undefined : onGrant}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={grantLabel}
              accessibilityState={{ disabled: isLoading }}
            >
              {isLoading
                ? <ActivityIndicator color={T.color.text.onDark} />
                : <Text style={styles.grantBtnText}>{grantLabel}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              testID={`${testIDPrefix}-consent-not-now`}
              style={styles.notNowBtn}
              onPress={onNotNow}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={notNowLabel}
            >
              <Text style={[styles.notNowText, isLoading && styles.notNowDisabled]}>
                {notNowLabel}
              </Text>
            </TouchableOpacity>
            <Text style={styles.changeLaterNote}>{changeLaterNote}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles — ห้องแม่ Phase 2 B4: full semantic T.* migration ────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    maxHeight: '80%',
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
  },
  body: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
  },
  grantBtn: {
    height: T.button.primary.height,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  grantBtnLoading: {
    backgroundColor: T.scrim.amber,
  },
  grantBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.onDark,
  },
  notNowBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notNowText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },
  notNowDisabled: { opacity: 0.5 },
  changeLaterNote: {
    fontFamily: T.type.micro.fontFamily,
    fontSize: T.type.micro.size,
    lineHeight: T.type.micro.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
  },
});
