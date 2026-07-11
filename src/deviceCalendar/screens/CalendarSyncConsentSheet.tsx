/**
 * CalendarSyncConsentSheet — CS-1 In-App Consent + Explainer Sheet
 *
 * HARD ORDERING (explainer-before-prompt, CAL-SCR-10):
 *   [1] Mother taps "เพิ่มลงปฏิทิน"
 *   [2] THIS SHEET appears (explainer + §1 consent copy + §2 propagation disclosure)
 *   [3] ONLY after tapping "เปิดการเพิ่มลงปฏิทิน" → OS permission prompt fires
 *
 * Legal copy: USE VERBATIM from calendar-sync-consent-copy.md v1.0.
 * Swipe-to-dismiss: DISABLED (ม.19 — explicit choice required).
 * Default OFF (ไม่ pre-tick, ไม่ default เปิด — AC-1.5, ม.19).
 *
 * Tokens: ห้องแม่ palette — consume T.color/T.spacing/T.radius/T.type only.
 * Trace: screens spec §2, functional §5.1, compliance §5, legal copy-doc v1.0.
 *
 * SECURITY: no health data in props or navigation params (SD-9).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { T } from '../../theme/tokens';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CalendarSyncConsentSheetProps {
  /** Called when mother taps "เปิดการเพิ่มลงปฏิทิน" (grant). */
  onGrant: () => Promise<void>;
  /** Called when mother taps "ไม่ใช่ตอนนี้" (decline). */
  onDecline: () => void;
  /** Whether the sheet is visible. */
  visible: boolean;
  /** Current locale for bilingual display. */
  locale?: 'th' | 'en';
}

// ─── Legal copy (VERBATIM — calendar-sync-consent-copy.md v1.0) ───────────────

const COPY = {
  title_th:             'เพิ่มนัดของคุณลงปฏิทินในเครื่อง',
  title_en:             "Add your appointments to your phone's calendar",
  data_copy_th:
    'นัดฝากครรภ์ (ANC) ของคุณถือเป็น "ข้อมูลสุขภาพ" ที่กฎหมายคุ้มครองเป็นพิเศษ' +
    ' ถ้าคุณเปิดสิ่งนี้ แอปจะนำ วันและเวลานัด ของคุณไปสร้างเป็นรายการในปฏิทินของเครื่องนี้',
  data_copy_en:
    'Your antenatal (ANC) appointments count as "health data," which the law protects specially.' +
    " If you turn this on, the app will add the date and time of your appointments as events in this phone's calendar.",
  purpose_copy_th:
    'เพื่อให้คุณเห็นนัดของคุณในปฏิทินที่คุณใช้ทุกวัน จะได้ไม่ลืมไปตรวจตามกำหนด' +
    ' เราใช้ข้อมูลนี้เพื่อ "เพิ่มลงปฏิทิน" เท่านั้น ไม่นำไปวินิจฉัย ไม่วิเคราะห์ และไม่ทำโฆษณา',
  purpose_copy_en:
    "So you can see your appointments in the calendar you use every day and won’t miss a visit." +
    ' We use this only to “add them to your calendar” — never to diagnose, analyse, or advertise.',
  propagation_title_th: 'สิ่งที่ควรรู้',
  propagation_th:
    'แอปจะเขียนนัดลง "ปฏิทินของเครื่องนี้" เท่านั้น' +
    ' ถ้าคุณผูกบัญชี Google หรือ iCloud ไว้กับเครื่องอยู่แล้ว ระบบของโทรศัพท์เอง (ไม่ใช่แอปเรา)' +
    ' อาจซิงก์รายการเหล่านี้ขึ้นบัญชีนั้นต่อ ซึ่ง อาจถูกเก็บบนเซิร์ฟเวอร์นอกประเทศไทย' +
    ' ส่วนนี้อยู่ใต้ บัญชีและการตั้งค่าของคุณเอง ไม่ได้ผ่านเซิร์ฟเวอร์ของเรา' +
    ' คุณจัดการหรือปิดการซิงก์นี้ได้ในการตั้งค่าบัญชีของโทรศัพท์',
  propagation_en:
    'Good to know: the app writes appointments only to “this phone’s calendar.”' +
    ' If you already have a Google or iCloud account linked to this phone, the phone’s own system (not our app)' +
    ' may sync these events on to that account, which may be stored on servers outside Thailand.' +
    ' That part is under your own account and settings, not our servers.' +
    ' You can manage or turn off that sync in your phone’s account settings.',
  withdraw_th:
    'คุณ ปิดหรือถอนได้ทุกเมื่อ ที่ บัญชี › จัดการความยินยอม' +
    ' เมื่อปิด เราจะหยุดเพิ่มนัดใหม่ และจะถามคุณว่าจะให้ลบนัดที่แอปเคยเพิ่มไว้หรือเก็บไว้',
  withdraw_en:
    'You can turn this off or withdraw anytime in Account › Manage Permissions.' +
    ' When you turn it off, we stop adding new appointments and ask whether to remove the ones the app already added, or keep them.',
  version:       'เวอร์ชันข้อความ v1.0',
  grant_btn_th:  'เปิดการเพิ่มลงปฏิทิน',
  grant_btn_en:  'Turn on calendar sync',
  decline_btn_th:'ไม่ใช่ตอนนี้',
  decline_btn_en:'Not now',
  decline_note_th:
    'ไม่เป็นไรค่ะ นัดของคุณยังอยู่ครบในแอป เพียงแต่จะไม่ถูกเพิ่มลงปฏิทินของเครื่อง เปิดได้ทุกเมื่อภายหลัง',
  decline_note_en:
    "That's okay — your appointments still stay in the app; they just won't be added to your phone's calendar. You can turn this on later anytime.",
  close_btn:     'ปิด / Close',
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarSyncConsentSheet({
  visible,
  onGrant,
  onDecline,
  locale = 'th',
}: CalendarSyncConsentSheetProps) {
  const [declined, setDeclined] = useState(false);
  const [loading,  setLoading]  = useState(false);

  const th = locale === 'th';

  async function handleGrant() {
    setLoading(true);
    try {
      await onGrant();
    } finally {
      setLoading(false);
    }
  }

  function handleDecline() {
    setDeclined(true);
    onDecline();
  }

  if (declined) {
    // CS-1b — Post-decline reassurance state
    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => {/* swipe-to-dismiss disabled — ม.19 */}}
        accessibilityViewIsModal
      >
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.scrollContent}>
              <Text
                style={s.body}
                testID="consent-cal-decline-note"
                accessibilityRole="text"
                accessibilityLiveRegion="assertive"
              >
                {th ? COPY.decline_note_th : COPY.decline_note_en}
              </Text>
              <View style={s.stickyButtons}>
                <TouchableOpacity
                  style={s.quietBtnBordered}
                  onPress={() => { setDeclined(false); onDecline(); }}
                  testID="consent-cal-decline-close-btn"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.close_btn}
                >
                  <Text style={s.quietBtnText}>{COPY.close_btn}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {/* swipe-to-dismiss disabled — ม.19 */}}
      accessibilityViewIsModal
    >
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <ScrollView contentContainerStyle={s.scrollContent}>
            {/* Title — heading level 2 */}
            <Text
              style={s.headline}
              accessibilityRole="header"
              accessibilityLiveRegion="assertive"
            >
              {th ? COPY.title_th : COPY.title_en}
            </Text>

            <View style={s.divider} />

            {/* §1 data_copy — VERBATIM */}
            <Text style={s.body} accessibilityRole="text">
              {th ? COPY.data_copy_th : COPY.data_copy_en}
            </Text>

            {/* §1 purpose_copy — VERBATIM */}
            <Text style={[s.body, s.mt12]} accessibilityRole="text">
              {th ? COPY.purpose_copy_th : COPY.purpose_copy_en}
            </Text>

            {/* §2 Propagation disclosure box */}
            <View
              style={s.infoBox}
              accessible
              accessibilityLabel={
                COPY.propagation_title_th + ': ' +
                (th ? COPY.propagation_th : COPY.propagation_en)
              }
            >
              <Text style={s.infoBoxTitle} accessible={false}>
                {COPY.propagation_title_th}
              </Text>
              <Text style={s.caption} accessible={false}>
                {th ? COPY.propagation_th : COPY.propagation_en}
              </Text>
            </View>

            {/* §1 withdraw_copy — VERBATIM */}
            <Text style={[s.caption, s.mt12]} accessibilityRole="text">
              {th ? COPY.withdraw_th : COPY.withdraw_en}
            </Text>

            <Text style={[s.captionMuted, s.mt8]}>{COPY.version}</Text>
            <View style={s.divider} />
          </ScrollView>

          {/* Sticky action buttons — outside ScrollView so always visible */}
          <View style={s.stickyButtons}>
            <TouchableOpacity
              style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
              onPress={handleGrant}
              disabled={loading}
              testID="consent-cal-grant-btn"
              accessibilityRole="button"
              accessibilityLabel={
                th
                  ? 'เปิดการเพิ่มนัดลงปฏิทินในเครื่อง'
                  : 'Turn on calendar sync'
              }
              accessibilityHint={
                th
                  ? 'แอปจะขอสิทธิ์ปฏิทินหลังจากนี้'
                  : 'App will request calendar permission next'
              }
              accessibilityState={{ busy: loading }}
            >
              {loading ? (
                <ActivityIndicator color={T.color.text.onDark} />
              ) : (
                <Text style={s.primaryBtnText}>
                  {th ? COPY.grant_btn_th : COPY.grant_btn_en}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={s.quietBtn}
              onPress={handleDecline}
              disabled={loading}
              testID="consent-cal-decline-btn"
              accessibilityRole="button"
              accessibilityLabel={
                th
                  ? 'ไม่ใช่ตอนนี้ ปิดหน้าต่างนี้'
                  : 'Not now, close this sheet'
              }
            >
              <Text style={s.quietBtnText}>
                {th ? COPY.decline_btn_th : COPY.decline_btn_en}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles — ห้องแม่ tokens only (no inline hex/px) ──────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    maxHeight: '92%' as unknown as number,  // RN accepts string for maxHeight
  },
  scrollContent: {
    padding: T.spacing[4],
    paddingBottom: T.spacing[2],
  },
  headline: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize:   T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color:      T.color.text.heading,
    marginBottom: T.spacing[3],
  },
  body: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.text.primary,
  },
  caption: {
    fontFamily: T.type.caption.fontFamily,
    fontSize:   T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color:      T.color.text.primary,
  },
  captionMuted: {
    fontFamily: T.type.caption.fontFamily,
    fontSize:   T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color:      T.color.text.secondary,
  },
  infoBox: {
    backgroundColor: T.color.surface.subtle,
    borderColor:     T.color.surface.divider,
    borderWidth:     1,
    borderRadius:    T.radius.md,
    padding:         T.spacing[4],
    marginTop:       T.spacing[3],
  },
  infoBoxTitle: {
    fontFamily: T.type.label.fontFamily,
    fontSize:   T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color:      T.color.text.primary,
    marginBottom: T.spacing[1],
  },
  divider: {
    height:          1,
    backgroundColor: T.color.surface.divider,
    marginVertical:  T.spacing[3],
  },
  mt12: { marginTop: T.spacing[3] },
  mt8:  { marginTop: T.spacing[2] },
  stickyButtons: {
    padding:    T.spacing[4],
    paddingTop: T.spacing[2],
    gap:        T.spacing[2],
  },
  primaryBtn: {
    backgroundColor: T.color.accent.interactive,
    borderRadius:    T.radius.pill,
    minHeight:       T.button.primary.height,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: T.spacing[4],
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize:   T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color:      T.color.text.onDark,
  },
  quietBtn: {
    borderRadius:    T.radius.pill,
    minHeight:       T.button.primary.height,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: T.spacing[4],
  },
  quietBtnBordered: {
    borderWidth:     1,
    borderColor:     T.color.surface.divider,
    borderRadius:    T.radius.pill,
    minHeight:       T.button.primary.height,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: T.spacing[4],
  },
  quietBtnText: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.text.primary,
  },
});
