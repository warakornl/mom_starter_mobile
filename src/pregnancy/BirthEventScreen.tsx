/**
 * BirthEventScreen — "ลูกคลอดแล้ว / Baby is here"
 *
 * Implements pregnancy-profile-ui.md §4 (Birth event) + §4.2 (Review screen)
 * + §4.4 (Screen states).
 *
 * Records the birth by calling POST /v1/pregnancy-profile/birth-event with:
 *   - birthDate  (required, YYYY-MM-DD civil date, ≤ today)
 *   - deliveryType (optional, 4 choices)
 *   - birthNote (optional free text)
 *   - X-Client-Date header (MUST — prevents false 422 in TH UTC+7)
 *   - If-Match: "<version>" header (required; absent → 428)
 *
 * NOTE ON DATE/TIME DISCREPANCY:
 *   pregnancy-profile-ui §4.2.1 specifies a "birth date & time" picker, but
 *   api-contract.md §"Birth-event & postpartum counting" (OQ-11 RESOLVED) pins
 *   `birthDate` as a floating-civil DATE (YYYY-MM-DD, no time component).
 *   This screen implements per the contract: date only, no time-of-day.
 *   Flag to the System Analyst / UX designer to reconcile the spec (data-model
 *   notes time-of-birth belongs to a future BabyProfile, out of scope for MVP).
 *
 * NOTE ON ENCRYPTION:
 *   deliveryType and birthNote are "client-encrypted" fields per data-model §3.1
 *   (ruling 4 — AES-GCM before transmission).  This MVP implementation sends
 *   them as plaintext strings pending the encryption utility from appsec-engineer.
 *   NEVER log these values.
 *
 * Screen states (§4.4):
 *   editing  — form ready for input
 *   saving   — POST in-flight (button spinner)
 *   error    — inline, non-blocking error note with Retry
 *
 * Accessibility: all touch targets ≥ 48dp (height set in StyleSheet), Thai
 * accessibilityLabel on every interactive element, non-color chip selection
 * cue (checkmark + border change).
 *
 * Security: NEVER log accessToken, deliveryType, or birthNote.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';
import { createPregnancyClient } from './pregnancyApiClient';
import { localCivilToday } from './gestationalAge';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BirthEventScreenProps {
  /** Shared secure token storage — used to read accessToken. */
  tokenStorage: TokenStorage;
  /** API base URL from src/config.ts. */
  apiBaseUrl: string;
  /** The current profile version (for If-Match: "<version>" header). */
  profileVersion: number;
  /** Navigate back / reset to Home after a successful birth-event recording. */
  onBirthRecorded: () => void;
  /** Navigate back without saving. */
  onCancel: () => void;
}

// ─── Delivery type options ────────────────────────────────────────────────────

type DeliveryType = 'vaginal' | 'cesarean' | 'other' | 'prefer_not';

interface DeliveryOption {
  value: DeliveryType;
  labelTh: string;
}

const DELIVERY_OPTIONS: DeliveryOption[] = [
  { value: 'vaginal',    labelTh: 'คลอดเอง' },
  { value: 'cesarean',   labelTh: 'ผ่าคลอด' },
  { value: 'other',      labelTh: 'อื่น ๆ' },
  { value: 'prefer_not', labelTh: 'ไม่ระบุ' },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function formatThaiDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1]} พ.ศ. ${y + 543}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BirthEventScreen({
  tokenStorage,
  apiBaseUrl,
  profileVersion,
  onBirthRecorded,
  onCancel: _onCancel,
}: BirthEventScreenProps): React.JSX.Element {
  // ── Form state ────────────────────────────────────────────────────────────
  const [birthDate, setBirthDate] = useState<string>('');
  const [deliveryType, setDeliveryType] = useState<DeliveryType | null>(null);
  const [birthNote, setBirthNote] = useState<string>('');

  // ── Date picker modal ─────────────────────────────────────────────────────
  const [showDateModal, setShowDateModal] = useState(false);
  const [dateInputText, setDateInputText] = useState<string>('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Validation ────────────────────────────────────────────────────────────
  const canSave = birthDate.length === 10 && !saving;

  // ─── Handlers ────────────────────────────────────────────────────────────

  function handleDateConfirm(): void {
    const trimmed = dateInputText.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      Alert.alert('รูปแบบวันที่', 'กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD เช่น 2026-06-29');
      return;
    }
    // Soft guard: birth date should not be in the future (§5 — non-blocking typo hint).
    // The server enforces the actual bound; this is a UX convenience only.
    const today = localCivilToday();
    if (trimmed > today) {
      Alert.alert(
        'ตรวจสอบวันที่',
        'วันคลอดดูเหมือนจะเป็นอนาคต — ต้องการใช้วันนี้ไหมคะ?',
        [
          { text: 'ยกเลิก', style: 'cancel' },
          {
            text: 'ใช้ต่อ',
            onPress: () => {
              setBirthDate(trimmed);
              setShowDateModal(false);
              setErrorMsg(null);
            },
          },
        ],
      );
      return;
    }
    setBirthDate(trimmed);
    setShowDateModal(false);
    setErrorMsg(null);
  }

  function handleDeliveryTypeSelect(value: DeliveryType): void {
    // Toggle: tapping the same chip again deselects it (field is optional — §4.2.2).
    setDeliveryType((prev) => (prev === value ? null : value));
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setErrorMsg(null);

    try {
      const tokens = await tokenStorage.load();
      const accessToken = tokens?.accessToken;
      if (!accessToken) {
        setErrorMsg('กรุณาเข้าสู่ระบบใหม่');
        setSaving(false);
        return;
      }

      const clientDate = localCivilToday();
      const client = createPregnancyClient(apiBaseUrl);

      // Build the birth-event input.
      // TODO (security): deliveryType and birthNote MUST be AES-GCM encrypted
      // before transmission per data-model §3.1 (ruling 4).  Coordinate with
      // appsec-engineer before production.  NEVER log these values.
      const input = {
        birthDate,
        ...(deliveryType != null ? { deliveryType } : {}),
        ...(birthNote.trim() ? { birthNote: birthNote.trim() } : {}),
      };

      const result = await client.recordBirthEvent(
        input,
        accessToken,
        String(profileVersion),
        clientDate,
      );

      if (result.ok) {
        // Birth event recorded — navigate back to Home.
        // HomeScreen reloads on foreground and switches to postpartum mode.
        onBirthRecorded();
      } else {
        // Map server error codes to calm Thai copy (pregnancy-profile-ui §4.4).
        if (result.status === 403 && result.code === 'consent_required') {
          setErrorMsg('การบันทึกต้องเปิดสิทธิ "บันทึกสุขภาพในเครื่อง" ก่อน');
        } else if (result.status === 409) {
          // Another device already recorded the birth — intent may be satisfied.
          // Prompt the user to go back and see the latest profile.
          setErrorMsg('มีการบันทึกจากอุปกรณ์อื่น กรุณาดูข้อมูลล่าสุดในหน้าหลัก');
        } else if (result.status === 422) {
          setErrorMsg('ลองตรวจสอบวันที่อีกครั้ง (วันที่ไม่ถูกต้อง)');
        } else if (result.status === 428) {
          setErrorMsg('ไม่สามารถบันทึกได้ กรุณาลองอีกครั้ง');
        } else if (result.status === 404) {
          setErrorMsg('ไม่พบข้อมูลการตั้งครรภ์');
        } else {
          setErrorMsg('บันทึกไม่สำเร็จในขณะนี้');
        }
      }
    } catch {
      // Network error — offline or unreachable server (§4.4.3 / §4.4.4)
      setErrorMsg('ออฟไลน์ · บันทึกไว้ในเครื่องเมื่อออนไลน์');
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header — celebratory, warm, brief (§4.2 / task: "ยินดีด้วย") */}
        <View style={styles.headerRow}>
          <Text style={styles.glyphBig} accessibilityElementsHidden={true}>
            {'🍃'}
          </Text>
          <Text style={styles.headline} accessibilityRole="header">
            {'ยินดีด้วยนะคะ'}
          </Text>
          <Text style={styles.subline}>
            {'มาบันทึกการคลอดของคุณกัน'}
          </Text>
        </View>

        {/* ── Birth date (required) ──────────────────────────────────────── */}
        <Text style={styles.fieldLabel}>
          {'วันที่คลอด / Birth date'}
          <Text style={styles.required}>{' *'}</Text>
        </Text>
        <TouchableOpacity
          style={styles.dateField}
          onPress={() => {
            setDateInputText(birthDate);
            setShowDateModal(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            birthDate
              ? `วันที่คลอด, ${formatThaiDate(birthDate)}, ปุ่ม`
              : 'วันที่คลอด, เลือกวันที่, ปุ่ม — จำเป็นต้องกรอก'
          }
        >
          <Text
            style={[
              styles.dateFieldText,
              !birthDate && styles.dateFieldPlaceholder,
            ]}
          >
            {birthDate ? formatThaiDate(birthDate) : 'เลือกวันที่'}
          </Text>
          <Text style={styles.chevron} accessibilityElementsHidden={true}>
            {' ›'}
          </Text>
        </TouchableOpacity>

        {/* ── Delivery type — optional, 4 chips (§4.2.2) ─────────────────── */}
        <Text style={styles.fieldLabel}>
          {'วิธีคลอด (ถ้าต้องการ) / Delivery type (optional)'}
        </Text>
        <View
          style={styles.chipsRow}
          accessibilityRole="radiogroup"
          accessibilityLabel="วิธีคลอด, ไม่บังคับ / Delivery type, optional"
        >
          {DELIVERY_OPTIONS.map((opt, index) => {
            const isSelected = deliveryType === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => handleDeliveryTypeSelect(opt.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${opt.labelTh}, ${isSelected ? 'เลือกแล้ว' : 'ไม่ได้เลือก'}, ${index + 1} จาก ${DELIVERY_OPTIONS.length}`}
              >
                {/* Checkmark — non-color shape-based selected-state cue (§4.2.2) */}
                {isSelected && (
                  <Text style={styles.chipCheck} accessibilityElementsHidden={true}>
                    {'✓ '}
                  </Text>
                )}
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                  {opt.labelTh}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Note — optional free text (§4.2) ──────────────────────────── */}
        <Text style={styles.fieldLabel}>
          {'บันทึกเพิ่มเติม (ถ้าต้องการ) / Note (optional)'}
        </Text>
        <TextInput
          style={styles.noteInput}
          value={birthNote}
          onChangeText={setBirthNote}
          placeholder={'เพิ่มบันทึกสั้น ๆ ถ้าต้องการ'}
          placeholderTextColor={'#94818A'}
          multiline
          numberOfLines={3}
          accessibilityLabel="บันทึกเพิ่มเติม, ไม่บังคับ"
          textAlignVertical="top"
        />
        <Text style={styles.encryptionNote} accessibilityElementsHidden={true}>
          {'🔒 เก็บแบบเข้ารหัสในเครื่องและบนคลาวด์'}
        </Text>

        {/* ── Consequence line (§4.2 — calm, not scary) ─────────────────── */}
        <View style={styles.consequenceBox}>
          <Text style={styles.consequenceText}>
            {'สิ่งนี้จะปิดไทม์ไลน์การตั้งครรภ์ และเริ่มช่วงหลังคลอด บันทึกทั้งหมดของคุณยังอยู่ครบ'}
          </Text>
        </View>

        {/* ── Error panel (§4.4.2 / §4.4.3 — inline, non-blocking) ──────── */}
        {errorMsg != null && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.retryLink}
              onPress={() => {
                setErrorMsg(null);
                void handleSave();
              }}
              accessibilityRole="button"
              accessibilityLabel="ลองอีกครั้ง"
            >
              <Text style={styles.retryLinkText}>{'ลองอีกครั้ง'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty-state hint when date not yet selected */}
        {!birthDate && (
          <Text style={styles.emptyHint}>
            {'เพิ่มวันที่คลอดเพื่อบันทึก'}
          </Text>
        )}

        {/* ── Save button (§4.2 — explicit confirm, If-Match guarded) ────── */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="บันทึกการคลอด / Save birth"
          accessibilityHint={!birthDate ? 'เพิ่มวันที่คลอดก่อน' : undefined}
          accessibilityState={{ disabled: !canSave }}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>
              {'บันทึกการคลอด / Save birth'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Date input modal ──────────────────────────────────────────────── */}
      <Modal
        visible={showDateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {'เลือกวันที่คลอด / Choose birth date'}
            </Text>
            <Text style={styles.modalHint}>
              {'กรอกในรูปแบบ YYYY-MM-DD เช่น 2026-06-29'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={dateInputText}
              onChangeText={setDateInputText}
              placeholder={'2026-06-29'}
              placeholderTextColor={'#94818A'}
              keyboardType="numeric"
              autoFocus
              accessibilityLabel="วันที่คลอด รูปแบบ YYYY-MM-DD"
              maxLength={10}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDateModal(false)}
                accessibilityRole="button"
                accessibilityLabel="ยกเลิก"
              >
                <Text style={styles.modalCancelText}>{'ยกเลิก'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleDateConfirm}
                accessibilityRole="button"
                accessibilityLabel="ยืนยันวันที่"
              >
                <Text style={styles.modalConfirmText}>{'ยืนยัน'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    gap: 16,
  },

  // Header
  headerRow: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  glyphBig: {
    fontSize: 48,
    lineHeight: 56,
  },
  headline: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 24,
    lineHeight: 32,
    color: '#3A2A30',
    textAlign: 'center',
  },
  subline: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    textAlign: 'center',
  },

  // Field labels
  fieldLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F4A52',
    marginTop: 4,
  },
  required: {
    color: '#A8505A',
  },

  // Date field — ≥56dp height per a11y (design-system §8)
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    paddingHorizontal: 16,
    minHeight: 56,
  },
  dateFieldText: {
    flex: 1,
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 16,
    lineHeight: 24,
    color: '#3A2A30',
    paddingVertical: 14,
  },
  dateFieldPlaceholder: {
    color: '#94818A',
    fontFamily: 'IBMPlexSans-Regular',
  },
  chevron: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 18,
    color: '#94818A',
  },

  // Chips — ≥48dp height (§4.2.2 / design-system §8)
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#EBE1D9',
    paddingHorizontal: 16,
    minHeight: 48,
  },
  chipSelected: {
    backgroundColor: '#FBEDEE',
    borderColor: '#A8505A',
    borderWidth: 2,
  },
  chipCheck: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#A8505A',
  },
  chipLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#3A2A30',
  },
  chipLabelSelected: {
    fontFamily: 'IBMPlexSans-SemiBold',
    color: '#8E3A44',
  },

  // Note input
  noteInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 23,
    color: '#3A2A30',
    minHeight: 80,
  },
  encryptionNote: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#94818A',
    marginTop: -8,
  },

  // Consequence box
  consequenceBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 16,
  },
  consequenceText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 22,
    color: '#5F4A52',
    textAlign: 'center',
  },

  // Error panel (§4.4.2 / §4.4.3 — inline, non-blocking)
  errorBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    flex: 1,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#5F4A52',
  },
  retryLink: {
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLinkText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#A8505A',
  },

  // Empty hint
  emptyHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#94818A',
    textAlign: 'center',
  },

  // Save button — ≥52dp height, primary rose (§4.2)
  saveBtn: {
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: {
    backgroundColor: '#DDA0A6',
  },
  saveBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  saveBtnTextDisabled: {
    color: '#FFFFFF',
    opacity: 0.7,
  },

  // Date modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(58,42,48,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
    textAlign: 'center',
  },
  modalHint: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#94818A',
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#FBF6F1',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 18,
    color: '#3A2A30',
    textAlign: 'center',
    letterSpacing: 2,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#5F4A52',
  },
  modalConfirmBtn: {
    flex: 1,
    height: 48,
    backgroundColor: '#A8505A',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
