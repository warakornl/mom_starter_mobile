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
                ? <ActivityIndicator color="#FFFFFF" />
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(58,42,48,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
  },
  body: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
  },
  error: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#8E3A44',
    backgroundColor: '#FBEDEE',
    borderRadius: 8,
    padding: 12,
  },
  grantBtn: {
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  grantBtnLoading: {
    backgroundColor: '#DDA0A6',
  },
  grantBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  notNowBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notNowText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#8E3A44',
  },
  notNowDisabled: { opacity: 0.5 },
  changeLaterNote: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#94818A',
    textAlign: 'center',
  },
});
