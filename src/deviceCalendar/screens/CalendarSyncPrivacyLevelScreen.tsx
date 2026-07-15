/**
 * CalendarSyncPrivacyLevelScreen — CS-5 Privacy Level Picker
 *
 * Lets the user choose between two calendar event title strategies:
 *
 *   Generic     → "การแจ้งเตือน" on lock screen, "นัดตรวจครรภ์" in calendar app
 *                 (CS-TITLE-1 default — structurally prevents health leakage)
 *   Descriptive → Appointment title from the app (only for user_created entries;
 *                 from_suggestion entries still use "นัดตรวจครรภ์" — CAL-SA-11)
 *
 * CS-5b confirmation sheet: shown when user selects Descriptive to warn that
 * the appointment name will be visible on the lock screen / in calendar sync.
 *
 * Tokens: ห้องแม่ palette — consume T.color/T.spacing/T.radius/T.type only.
 * Trace: screens spec §4, ui-spec CS-5/CS-5b, functional §4 (CAL-SA-10/11).
 *
 * SECURITY: no health data in props or navigation params (SD-9).
 * a11y: radio group pattern; selected state via accessibilityState.checked.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
} from 'react-native';
import { T } from '../../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrivacyLevel = 'generic' | 'descriptive';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CalendarSyncPrivacyLevelScreenProps {
  /** The currently active privacy level. */
  currentLevel: PrivacyLevel;
  /** Called when the user confirms a new level selection. */
  onLevelSelected: (level: PrivacyLevel) => void;
  /** Navigate back to the settings hub. */
  onBack: () => void;
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

const C = {
  title:                 'ระดับความเป็นส่วนตัว',
  subtitle:              'เลือกว่าจะให้แสดงชื่ออะไรในปฏิทินและหน้าจอล็อก',
  genericLabel:          'ซ่อนชื่อนัด (ปลอดภัยกว่า)',
  genericDesc:
    'ในหน้าจอล็อก: "การแจ้งเตือน"\n' +
    'ในแอปปฏิทิน: "นัดตรวจครรภ์"\n' +
    'ไม่แสดงชื่อนัดหรือข้อมูลสุขภาพ ผู้อื่นที่เห็นโทรศัพท์ของคุณจะไม่รู้ว่าเป็นนัดอะไร',
  descriptiveLabel:      'แสดงชื่อนัด',
  descriptiveDesc:
    'ในหน้าจอล็อกและแอปปฏิทิน: ชื่อที่คุณตั้งให้นัดนั้น\n' +
    'สะดวกกว่า แต่ผู้ที่เห็นหน้าจอโทรศัพท์ของคุณจะเห็นชื่อนัดได้',
  confirmTitle:          'ยืนยันการแสดงชื่อนัด',
  confirmMsg:
    'ชื่อนัดของคุณจะปรากฏในหน้าจอล็อกและแอปปฏิทิน ซึ่งอาจรวมถึงข้อมูลที่คุณบันทึกไว้' +
    ' ผู้อื่นที่เห็นโทรศัพท์ของคุณจะมองเห็นสิ่งเหล่านี้ได้',
  confirmBtn:            'ยืนยัน แสดงชื่อนัด',
  cancelBtn:             'ยกเลิก',
  back:                  'ย้อนกลับ',
  recommended:           'แนะนำ',
  lockScreenPreview:     'ตัวอย่างหน้าจอล็อก',
  lockScreenGeneric:     '"การแจ้งเตือน"',
  lockScreenDescriptive: '"ชื่อนัดของคุณ"',
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarSyncPrivacyLevelScreen({
  currentLevel,
  onLevelSelected,
  onBack,
}: CalendarSyncPrivacyLevelScreenProps) {
  const [pendingLevel, setPendingLevel] = useState<PrivacyLevel | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);

  function handleSelect(level: PrivacyLevel) {
    if (level === currentLevel) return;

    if (level === 'descriptive') {
      // CS-5b — warn before switching to descriptive
      setPendingLevel(level);
      setShowConfirm(true);
    } else {
      // Generic is always safe to select immediately
      onLevelSelected(level);
    }
  }

  function handleConfirm() {
    if (pendingLevel) {
      onLevelSelected(pendingLevel);
    }
    setPendingLevel(null);
    setShowConfirm(false);
  }

  function handleCancel() {
    setPendingLevel(null);
    setShowConfirm(false);
  }

  return (
    <View style={s.screen} testID="calendar-sync-privacy-level-screen">
      {/* Back button */}
      <TouchableOpacity
        style={s.backBtn}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={C.back}
        testID="privacy-level-back-btn"
      >
        <Text style={s.backBtnText}>{C.back}</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Screen heading */}
        <Text
          style={s.heading}
          accessibilityRole="header"
          testID="privacy-level-title"
        >
          {C.title}
        </Text>
        <Text style={s.subtitle}>{C.subtitle}</Text>

        {/* Radio group — a11y: role="radiogroup" via parent label.
            🟡 fix: was `accessible={false}` + accessibilityRole/Label on the
            SAME node — a contradiction: accessible={false} means this node is
            never exposed as an accessible element, so the radiogroup role/label
            were silently dropped. Removed accessible={false} so the group role
            actually takes effect; radiogroup does not collapse the child radio
            buttons (unlike accessible={true}), so each option stays individually
            focusable — containment rule is preserved. */}
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="เลือกระดับความเป็นส่วนตัว"
        >
          {/* Option A: Generic (recommended, default) */}
          <TouchableOpacity
            style={[
              s.option,
              currentLevel === 'generic' && s.optionSelected,
            ]}
            onPress={() => handleSelect('generic')}
            accessibilityRole="radio"
            accessibilityLabel={C.genericLabel}
            accessibilityState={{ checked: currentLevel === 'generic' }}
            accessibilityHint="แสดง 'การแจ้งเตือน' บนหน้าจอล็อก ปลอดภัยกว่า"
            testID="privacy-level-generic-option"
          >
            <View style={s.optionHeader}>
              <View style={s.radioIndicator}>
                {currentLevel === 'generic' && (
                  <View style={s.radioDot} />
                )}
              </View>
              <Text style={s.optionLabel}>{C.genericLabel}</Text>
              {/* Recommended badge */}
              <View style={s.badge}>
                <Text style={s.badgeText}>{C.recommended}</Text>
              </View>
            </View>
            <Text style={s.optionDesc}>{C.genericDesc}</Text>
            {/* Lock screen preview */}
            <View style={s.previewBox}>
              <Text style={s.previewLabel}>{C.lockScreenPreview}</Text>
              <Text style={s.previewValue}>{C.lockScreenGeneric}</Text>
            </View>
          </TouchableOpacity>

          {/* Option B: Descriptive */}
          <TouchableOpacity
            style={[
              s.option,
              currentLevel === 'descriptive' && s.optionSelected,
            ]}
            onPress={() => handleSelect('descriptive')}
            accessibilityRole="radio"
            accessibilityLabel={C.descriptiveLabel}
            accessibilityState={{ checked: currentLevel === 'descriptive' }}
            accessibilityHint="แสดงชื่อนัดจริงบนหน้าจอล็อก"
            testID="privacy-level-descriptive-option"
          >
            <View style={s.optionHeader}>
              <View style={s.radioIndicator}>
                {currentLevel === 'descriptive' && (
                  <View style={s.radioDot} />
                )}
              </View>
              <Text style={s.optionLabel}>{C.descriptiveLabel}</Text>
            </View>
            <Text style={s.optionDesc}>{C.descriptiveDesc}</Text>
            {/* Lock screen preview */}
            <View style={s.previewBox}>
              <Text style={s.previewLabel}>{C.lockScreenPreview}</Text>
              <Text style={s.previewValue}>{C.lockScreenDescriptive}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* CS-5b — Descriptive confirmation modal */}
      <Modal
        visible={showConfirm}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
        accessibilityViewIsModal
      >
        <View style={s.modalBackdrop}>
          <View style={s.confirmSheet}>
            <Text
              style={s.confirmTitle}
              accessibilityRole="header"
              accessibilityLiveRegion="assertive"
            >
              {C.confirmTitle}
            </Text>
            <Text style={s.confirmMsg}>{C.confirmMsg}</Text>
            <TouchableOpacity
              style={s.confirmPrimaryBtn}
              onPress={handleConfirm}
              testID="privacy-level-confirm-btn"
              accessibilityRole="button"
              accessibilityLabel={C.confirmBtn}
            >
              <Text style={s.confirmPrimaryBtnText}>{C.confirmBtn}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.confirmCancelBtn}
              onPress={handleCancel}
              testID="privacy-level-cancel-btn"
              accessibilityRole="button"
              accessibilityLabel={C.cancelBtn}
            >
              <Text style={s.confirmCancelBtnText}>{C.cancelBtn}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles — ห้องแม่ tokens only (no inline hex/px) ──────────────────────────

const s = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: T.color.surface.base,
  },
  backBtn: {
    padding:       T.spacing[4],
    paddingBottom: T.spacing[2],
    minHeight:     48,
    justifyContent:'center',
  },
  backBtnText: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.accent.interactive,
  },
  scroll: {
    padding:       T.spacing[4],
    paddingBottom: T.spacing[10],
  },
  heading: {
    fontFamily:   T.type.heading1.fontFamily,
    fontSize:     T.type.heading1.size,
    lineHeight:   T.type.heading1.lineHeight,
    color:        T.color.text.heading,
    marginBottom: T.spacing[1],
  },
  subtitle: {
    fontFamily:   T.type.body.fontFamily,
    fontSize:     T.type.body.size,
    lineHeight:   T.type.body.lineHeight,
    color:        T.color.text.secondary,
    marginBottom: T.spacing[6],
  },
  option: {
    borderWidth:   1,
    borderColor:   T.color.surface.divider,
    borderRadius:  T.radius.md,
    padding:       T.spacing[4],
    marginBottom:  T.spacing[3],
    backgroundColor: T.color.surface.base,
  },
  optionSelected: {
    borderColor: T.color.accent.interactive,
    backgroundColor: T.color.surface.wash.amber,
  },
  optionHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            T.spacing[2],
    marginBottom:   T.spacing[2],
  },
  radioIndicator: {
    width:        22,
    height:       22,
    borderRadius: 11,
    borderWidth:  2,
    borderColor:  T.color.accent.interactive,
    alignItems:   'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioDot: {
    width:        10,
    height:       10,
    borderRadius: 5,
    backgroundColor: T.color.accent.interactive,
  },
  optionLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize:   T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color:      T.color.text.primary,
    flex: 1,
  },
  badge: {
    backgroundColor: T.color.surface.wash.jade,
    borderRadius:    T.radius.sm,
    paddingVertical:   2,
    paddingHorizontal: T.spacing[2],
  },
  badgeText: {
    fontFamily: T.type.micro.fontFamily,
    fontSize:   T.type.micro.size,
    lineHeight: T.type.micro.lineHeight,
    color:      T.color.text.botanical,
  },
  optionDesc: {
    fontFamily: T.type.caption.fontFamily,
    fontSize:   T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color:      T.color.text.primary,
    marginLeft: T.spacing[6],
  },
  previewBox: {
    backgroundColor: T.color.surface.subtle,
    borderRadius:    T.radius.sm,
    padding:         T.spacing[3],
    marginTop:       T.spacing[3],
    marginLeft:      T.spacing[6],
  },
  // 🟡 fix: was color.text.secondary (jade-600) at 11sp — 4.21:1 FAILS AA
  // (BANNED per tokens.ts) AND breaks R4 (jade-600 requires ≥15sp). Switched to
  // text.primary (roselle-700, AAA at any size) — keeps the micro (11sp) size
  // for the small label without needing a font-size bump.
  previewLabel: {
    fontFamily: T.type.micro.fontFamily,
    fontSize:   T.type.micro.size,
    lineHeight: T.type.micro.lineHeight,
    color:      T.color.text.primary,
    marginBottom: T.spacing[1],
  },
  previewValue: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.text.primary,
  },
  // CS-5b modal
  modalBackdrop: {
    flex:            1,
    backgroundColor: T.scrim.color,
    justifyContent:  'center',
    paddingHorizontal: T.spacing[4],
  },
  confirmSheet: {
    backgroundColor: T.color.surface.base,
    borderRadius:    T.radius.lg,
    padding:         T.spacing[4],
  },
  confirmTitle: {
    fontFamily:   T.type.heading2.fontFamily,
    fontSize:     T.type.heading2.size,
    lineHeight:   T.type.heading2.lineHeight,
    color:        T.color.text.heading,
    marginBottom: T.spacing[3],
  },
  confirmMsg: {
    fontFamily:   T.type.body.fontFamily,
    fontSize:     T.type.body.size,
    lineHeight:   T.type.body.lineHeight,
    color:        T.color.text.primary,
    marginBottom: T.spacing[4],
  },
  confirmPrimaryBtn: {
    backgroundColor: T.color.accent.interactive,
    borderRadius:    T.radius.pill,
    minHeight:       T.button.primary.height,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: T.spacing[4],
    marginBottom:    T.spacing[2],
  },
  confirmPrimaryBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize:   T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color:      T.color.text.onDark,
  },
  confirmCancelBtn: {
    borderWidth:     1,
    borderColor:     T.color.surface.divider,
    borderRadius:    T.radius.pill,
    minHeight:       T.button.primary.height,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: T.spacing[4],
  },
  confirmCancelBtnText: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.text.primary,
  },
});
