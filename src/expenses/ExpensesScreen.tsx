/**
 * ExpensesScreen — offline-first monthly expense ledger.
 *
 * Implements: expenses-ui.md §1–§9 (screen anatomy, month view, list/empty/error/loading
 * states, add/edit sheet, category breakdown, ฿ amounts).
 *
 * Architecture (mirrors SuppliesScreen exactly):
 *   - Module-scoped expensesSyncStore singleton survives component re-mounts.
 *   - All mutations (create/update/delete) are:
 *       1. Applied optimistically (store.enqueueCreate/Update/Delete)
 *       2. Immediately pushed to the server via syncClient.push(drainQueue())
 *       3. Screen state re-read for UI refresh
 *   - Pull runs on mount + foreground (AppState 'active').
 *   - amount stored/synced as integer satang; UI accepts and displays ฿.
 *
 * Screen states (expenses-ui.md §4):
 *   loading  — skeleton (sub-100ms, rarely seen; local read)
 *   empty    — ฿0 total + illustration invite (§4.2)
 *   populated — total + breakdown + most-recent-first list (§4.3)
 *   error    — local store unreadable (§4.4) — single Retry
 *   offline is an overlay pill, NOT a state (§4.5)
 *
 * testIDs:
 *   expenses-add           — FAB + "add first" CTA
 *   expenses-item          — each expense row
 *   expenses-refresh       — pull-to-sync button
 *   expenses-form-amount   — amount TextInput in form
 *   expenses-form-save     — save button in form
 *   expenses-sync-error    — sync error banner
 *   expenses-month-total   — the large total figure
 *   expenses-empty         — empty state container
 *   expenses-error         — error state container
 *
 * i18n: useT() from LanguageContext. All strings from catalog expenses.*.
 *
 * Security:
 *   - NEVER log amount, note, or incurredOn (financial data).
 *   - expensesSyncStore is NON-health (cloud_storage only); no health consent needed.
 *   - note field is client-encrypted by contract (EX-2) — not re-encrypted in MVP;
 *     flagged for appsec-engineer before production egress (same carry-forward as
 *     KickCount note K-7).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Modal,
  ScrollView,
  AppState,
  Platform,
  type AppStateStatus,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { v4 as uuidv4 } from 'uuid';

import type { TokenStorage } from '../auth/tokenStorage';
import { createExpensesSyncClient } from '../sync/syncClient';
import { expensesSyncStore } from './expensesSyncStore';
import { executePush } from '../sync/pushOrchestrator';
import type { ExpenseRecord, ExpenseCategory, RejectedRecord } from '../sync/syncTypes';
import { useT } from '../i18n/LanguageContext';
import {
  satangToBaht,
  bahtStringToSatang,
  validateAmountInput,
  computeMonthTotal,
  computeCategoryBreakdown,
  groupExpensesByDate,
} from './expensesUtils';
import {
  filterAmountInput,
  satangToInputString,
  isValidCivilDate,
} from './expensesScreenHandlers';
import { toCivilDate, parseCivilDate } from '../calendar/dateTimePickerFormat';
import { formatCivilDate, formatYearMonth } from '../i18n/messages';
import type { Locale } from '../auth/types';
import { T } from '../theme/tokens';
import { ReceiptIcon } from '../icons/ReceiptIcon';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExpensesScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  onBack?: () => void;
}

interface FormState {
  id?: string; // undefined = new record
  amountBaht: string; // user-typed whole-baht string; converted to satang on save
  category: ExpenseCategory;
  incurredOn: string; // YYYY-MM-DD
  note: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: ExpenseCategory[] = [
  'baby-supplies',
  'healthcare',
  'baby-gear',
  'mother',
  'other',
];

const CATEGORY_GLYPHS: Record<ExpenseCategory, string> = {
  'baby-supplies': '◐',
  'healthcare': '➕',
  'baby-gear': '◇',
  'mother': '❀',
  'other': '▫',
};

/** Returns today's date as YYYY-MM-DD using the device-local civil date. */
function localCivilToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyForm(): FormState {
  return {
    id: undefined,
    amountBaht: '',
    category: 'other',
    incurredOn: localCivilToday(),
    note: '',
  };
}

// ─── Category chip selector ───────────────────────────────────────────────────

function CategorySelector({
  value,
  onChange,
}: {
  value: ExpenseCategory;
  onChange: (c: ExpenseCategory) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={formStyles.categoryRow}>
      {CATEGORIES.map((cat) => (
        <TouchableOpacity
          key={cat}
          style={[formStyles.categoryChip, value === cat && formStyles.categoryChipSelected]}
          onPress={() => onChange(cat)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === cat }}
        >
          {/* B3 spec: shape cue — checkmark glyph (non-color-only selection indicator) */}
          {value === cat && (
            <Text style={formStyles.categoryChipCheck} accessibilityElementsHidden>✓</Text>
          )}
          <Text
            style={[
              formStyles.categoryChipText,
              value === cat && formStyles.categoryChipTextSelected,
            ]}
          >
            {CATEGORY_GLYPHS[cat]} {t(`expenses.category.${cat}` as
              | 'expenses.category.baby-supplies'
              | 'expenses.category.healthcare'
              | 'expenses.category.baby-gear'
              | 'expenses.category.mother'
              | 'expenses.category.other')}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── Add / edit form modal ────────────────────────────────────────────────────

function ExpenseFormModal({
  visible,
  form,
  onChange,
  onSave,
  onDelete,
  onCancel,
}: {
  visible: boolean;
  form: FormState;
  onChange: (f: Partial<FormState>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t, locale } = useT();
  const isEdit = Boolean(form.id);

  // ── Date picker state (mirrors AppointmentFormScreen pattern) ──────────────
  const [showDatePicker, setShowDatePicker] = useState(false);
  // tempPickerDate holds the spinning wheel value on iOS; committed on "Done"
  const [tempPickerDate, setTempPickerDate] = useState<Date>(
    parseCivilDate(form.incurredOn),
  );

  function openDatePicker() {
    setTempPickerDate(parseCivilDate(form.incurredOn));
    setShowDatePicker(true);
  }

  function handleDateChangeAndroid(_event: DateTimePickerEvent, selectedDate?: Date) {
    setShowDatePicker(false);
    if (selectedDate) {
      onChange({ incurredOn: toCivilDate(selectedDate) });
    }
  }

  function handleDateChangeIOS(_event: DateTimePickerEvent, selectedDate?: Date) {
    if (selectedDate) setTempPickerDate(selectedDate);
  }

  function confirmDateIOS() {
    onChange({ incurredOn: toCivilDate(tempPickerDate) });
    setShowDatePicker(false);
  }

  // Echo line preview
  const previewAmountSatang = bahtStringToSatang(form.amountBaht);
  const previewAmountStr = previewAmountSatang > 0 ? satangToBaht(previewAmountSatang) : '฿—';
  const previewCatLabel = t(`expenses.category.${form.category}` as
    | 'expenses.category.baby-supplies'
    | 'expenses.category.healthcare'
    | 'expenses.category.baby-gear'
    | 'expenses.category.mother'
    | 'expenses.category.other');
  const previewGlyph = CATEGORY_GLYPHS[form.category];

  // Save is disabled until amount > 0 and category is set
  const saveEnabled = validateAmountInput(form.amountBaht).valid;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={formStyles.container}>
        <View style={formStyles.header}>
          <TouchableOpacity onPress={onCancel} accessibilityRole="button" accessibilityLabel={t('general.cancel')}>
            <Text style={formStyles.cancelBtn}>{t('general.cancel')}</Text>
          </TouchableOpacity>
          <Text style={formStyles.title}>
            {isEdit ? t('expenses.editTitle') : t('expenses.addTitle')}
          </Text>
          <View style={formStyles.headerSpacer} />
        </View>

        <ScrollView style={formStyles.body} contentContainerStyle={formStyles.bodyContent}>
          {/* Amount field */}
          <Text style={formStyles.label}>{t('expenses.fieldAmount')}</Text>
          <View style={formStyles.amountRow}>
            <Text style={formStyles.currencyPrefix}>฿</Text>
            <TextInput
              testID="expenses-form-amount"
              style={formStyles.amountInput}
              value={form.amountBaht}
              onChangeText={(v) => onChange({ amountBaht: filterAmountInput(v) })}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={T.input.placeholder}
              autoFocus={!isEdit}
            />
          </View>

          {/* Category chips */}
          <Text style={formStyles.label}>{t('expenses.fieldCategory')}</Text>
          <CategorySelector
            value={form.category}
            onChange={(c) => onChange({ category: c })}
          />

          {/* Date field — picker button (spec §3.2/§7: stepper/picker, not free-text) */}
          <Text style={formStyles.label}>{t('expenses.fieldDate')}</Text>
          <TouchableOpacity
            testID="expenses-form-date"
            style={formStyles.pickerField}
            onPress={openDatePicker}
            accessibilityRole="button"
            accessibilityLabel={`${t('expenses.fieldDate')}: ${formatCivilDate(form.incurredOn, locale as Locale)}`}
          >
            <Text style={formStyles.pickerFieldText}>
              {formatCivilDate(form.incurredOn, locale as Locale)}
            </Text>
            <Text style={formStyles.pickerChevron} accessibilityElementsHidden={true}>›</Text>
          </TouchableOpacity>

          {/* Note field */}
          <Text style={formStyles.label}>{t('expenses.fieldNote')}</Text>
          <TextInput
            style={[formStyles.input, formStyles.noteInput]}
            value={form.note}
            onChangeText={(v) => onChange({ note: v })}
            multiline
            numberOfLines={3}
            placeholder={t('expenses.fieldNote')}
            placeholderTextColor={T.input.placeholder}
          />
          <Text style={formStyles.privacyLine}>{t('expenses.notePrivacyLine')}</Text>

          {/* Echo line (spec §3.2 — capture-ui signature) */}
          <View style={formStyles.echoContainer}>
            <Text style={formStyles.echoLabel}>{t('expenses.echoPrefix')}</Text>
            <Text style={formStyles.echoLine}>
              {previewGlyph}{previewCatLabel}  {previewAmountStr}  {formatCivilDate(form.incurredOn, locale as Locale)}
              {form.note ? `\n${form.note}` : ''}
            </Text>
          </View>
        </ScrollView>

        <View style={formStyles.footer}>
          <TouchableOpacity
            testID="expenses-form-save"
            style={[formStyles.saveBtn, !saveEnabled && formStyles.saveBtnDisabled]}
            onPress={onSave}
            disabled={!saveEnabled}
            accessibilityRole="button"
            accessibilityLabel={t('expenses.save')}
          >
            <Text style={formStyles.saveBtnText}>{t('expenses.save')}</Text>
          </TouchableOpacity>
          {isEdit && onDelete && (
            <TouchableOpacity
              style={formStyles.deleteBtn}
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={t('expenses.delete')}
            >
              <Text style={formStyles.deleteBtnText}>{t('expenses.delete')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {/* ── Date picker — Android: dialog rendered directly ── */}
      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          mode="date"
          display="default"
          value={parseCivilDate(form.incurredOn)}
          onChange={handleDateChangeAndroid}
        />
      )}

      {/* ── Date picker — iOS bottom sheet ── */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={formStyles.pickerOverlay}>
            <View style={formStyles.pickerCard}>
              <View style={formStyles.pickerBtnRow}>
                <TouchableOpacity
                  style={formStyles.pickerCancelBtn}
                  onPress={() => setShowDatePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.cancel')}
                >
                  <Text style={formStyles.pickerCancelText}>{t('general.cancel')}</Text>
                </TouchableOpacity>
                <Text style={formStyles.pickerTitle}>{t('picker.selectDate')}</Text>
                <TouchableOpacity
                  testID="expenses-form-date-picker-done"
                  style={formStyles.pickerDoneBtn}
                  onPress={confirmDateIOS}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.done')}
                >
                  <Text style={formStyles.pickerDoneText}>{t('general.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                mode="date"
                display="spinner"
                value={tempPickerDate}
                onChange={handleDateChangeIOS}
                style={formStyles.iosPicker}
              />
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

const formStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.color.surface.base },          // #FBF6F1 (from #FBF6F1 literal)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: T.spacing[4],                                                  // 16dp
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,                             // #E8DDD5 (from #EBE1D9)
  },
  headerSpacer: { width: 60 },
  title: {
    fontFamily: T.type.heading2.fontFamily,                                 // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.heading2.size,                                         // 20sp (from 18sp)
    lineHeight: T.type.heading2.lineHeight,                                 // 33
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #3A2A30)
    flex: 1,
    textAlign: 'center',
  },
  cancelBtn: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #A8505A)
    width: 60,
  },
  body: { flex: 1 },
  bodyContent: { padding: 20, gap: 12 },
  label: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  // Amount input with ฿ prefix — spec: type.body.large text.primary tabular-nums Thai Baht ฿ Sarabun
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.input.border.default,                                    // #E8DDD5 (from #EBE1D9)
    borderRadius: T.radius.sm,                                              // 6dp (from 12dp)
    backgroundColor: T.input.bg,                                            // #F5EDE6 ivory-200 (from #FFFFFF)
    paddingHorizontal: 14,
  },
  currencyPrefix: {
    // ฿ symbol in Sarabun (spec: "Thai Baht symbol ฿ Sarabun")
    fontFamily: T.type.bodyLarge.fontFamily,                                // Sarabun-Regular (from IBMPlexMono-Regular)
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 18sp)
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #3A2A30 — per spec text.primary)
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 14,
    // spec: "Amount display: type.body.large text.primary tabular-nums"
    fontFamily: T.type.bodyLarge.fontFamily,                                // Sarabun-Regular (from IBMPlexMono-Regular)
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 22sp — per spec body.large)
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #3A2A30)
  },
  input: {
    borderWidth: 1,
    borderColor: T.input.border.default,                                    // #E8DDD5 (from #EBE1D9)
    borderRadius: T.radius.sm,                                              // 6dp (from 12dp)
    padding: 14,
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.input.text,                                                    // #4A2230 roselle-900 (from #3A2A30)
    backgroundColor: T.input.bg,                                            // #F5EDE6 ivory-200 (from #FFFFFF)
  },
  noteInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  privacyLine: {
    fontFamily: T.type.micro.fontFamily,                                    // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.micro.size,                                            // 11sp (from 12sp) — footnote
    lineHeight: T.type.micro.lineHeight,                                    // 18
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
    fontStyle: 'italic',
  },
  categoryRow: { flexGrow: 0 },
  categoryChip: {
    // B3 spec: radius.sm 6dp for expense category chips
    flexDirection: 'row',                                                   // row for checkmark + text
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: T.radius.sm,                                              // 6dp (from 999 — spec: radius.sm for category chips)
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
    marginRight: 8,
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 (from #FFFFFF)
    gap: 4,
    minHeight: 48,                                                          // ≥48dp touch target (a11y)
    justifyContent: 'center',
  },
  categoryChipSelected: {
    // B3 spec: selected surface.wash.amber bg + text.heading; checkmark shape cue added in JSX
    backgroundColor: T.color.surface.wash.amber,                            // #FDF0D5 amber-100 (from #FBEDEE — per spec!)
    borderColor: T.color.accent.milestone,                                  // #B8720E amber-600 — matches amber wash
  },
  categoryChipCheck: {
    // Checkmark shape cue (non-color-only selection indicator — B3 spec)
    fontSize: T.type.caption.size,                                          // 13sp
    color: T.color.accent.interactive,                                      // #9A5F0A amber-700 — on amber-100 wash 4.90:1 AA ✓
    fontWeight: '700',
  },
  categoryChipText: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp (from 14sp) — text.primary R4
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  categoryChipTextSelected: {
    // B3 spec: selected text = text.heading (roselle-900)
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #8E3A44 — spec: text.heading)
  },
  // Date picker field (replaces free-text TextInput)
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.input.border.default,                                    // #E8DDD5 (from #EBE1D9)
    borderRadius: T.radius.sm,                                              // 6dp (from 12dp)
    backgroundColor: T.input.bg,                                            // #F5EDE6 ivory-200 (from #FFFFFF)
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: T.input.height,                                              // 52dp
  },
  pickerFieldText: {
    flex: 1,
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 16sp)
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.input.text,                                                    // #4A2230 roselle-900 (from #3A2A30)
  },
  pickerChevron: {
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 18sp)
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
    marginLeft: 8,
  },
  // Bottom-sheet picker modal (iOS)
  pickerOverlay: {
    flex: 1,
    backgroundColor: T.scrim.color,                                         // rgba(74,34,48,0.40) (from rgba(58,42,48,0.4))
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 (from #FFFFFF)
    borderTopLeftRadius: T.radius.lg,                                       // 20dp (from 24dp)
    borderTopRightRadius: T.radius.lg,                                      // 20dp
    paddingBottom: 32,
  },
  pickerBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,                             // #E8DDD5 (from #EBE1D9)
  },
  pickerCancelBtn: { minHeight: 44, justifyContent: 'center' as const },
  pickerCancelText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp ✓
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
  },
  pickerTitle: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.label.size,                                            // 15sp ✓
    lineHeight: T.type.label.lineHeight,                                    // 24
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #3A2A30)
    textAlign: 'center' as const,
  },
  pickerDoneBtn: { minHeight: 44, justifyContent: 'center' as const },
  pickerDoneText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.label.size,                                            // 15sp ✓
    lineHeight: T.type.label.lineHeight,                                    // 24
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #A8505A)
  },
  iosPicker: { alignSelf: 'center' as const },

  // Echo line
  echoContainer: {
    backgroundColor: T.color.surface.subtle,                                // #F5EDE6 ivory-200 (from #FBF3EE)
    borderRadius: T.radius.sm,                                              // 6dp (from 12dp)
    padding: 14,
    gap: 4,
  },
  echoLabel: {
    fontFamily: T.type.micro.fontFamily,                                    // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.micro.size,                                            // 11sp (from 12sp)
    lineHeight: T.type.micro.lineHeight,                                    // 18
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
  },
  echoLine: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #3A2A30)
  },
  footer: {
    padding: T.spacing[4],                                                  // 16dp
    borderTopWidth: 1,
    borderTopColor: T.color.surface.divider,                                // #E8DDD5 (from #EBE1D9)
    gap: 8,
  },
  saveBtn: {
    height: T.button.primary.height,                                        // 52dp ✓
    backgroundColor: T.button.primary.bg,                                   // #9A5F0A amber-700 (from #A8505A)
    borderRadius: T.button.primary.radius,                                  // 12dp (from 999/pill)
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,                                                           // from explicit muted-rose bg (#C8A0A6) → standard opacity
  },
  saveBtnText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.bodyLarge.size,                                        // 17sp ✓
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.color.text.onDark,                                             // #FFFFFF
  },
  deleteBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp ✓
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #A8505A)
  },
});

// ─── Expense row ──────────────────────────────────────────────────────────────

function ExpenseRow({
  item,
  onEdit,
}: {
  item: ExpenseRecord;
  onEdit: (item: ExpenseRecord) => void;
}): React.JSX.Element {
  const { t, locale } = useT();
  const catLabel = t(`expenses.category.${item.category}` as
    | 'expenses.category.baby-supplies'
    | 'expenses.category.healthcare'
    | 'expenses.category.baby-gear'
    | 'expenses.category.mother'
    | 'expenses.category.other');

  // Review fix: format the raw ISO date (พ.ศ. in th, Gregorian in en) instead
  // of echoing "YYYY-MM-DD" verbatim — matches the form's date field pattern.
  const formattedDate = formatCivilDate(item.incurredOn, locale as Locale);

  // Screen-reader label per spec §7
  const a11yLabel = `${satangToBaht(item.amount)} ${catLabel} ${formattedDate}${
    item.note ? ` ${item.note}` : ''
  }`;

  return (
    <TouchableOpacity
      testID="expenses-item"
      style={rowStyles.row}
      onPress={() => onEdit(item)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={rowStyles.left}>
        <Text style={rowStyles.glyph}>{CATEGORY_GLYPHS[item.category]}</Text>
      </View>
      <View style={rowStyles.info}>
        <Text style={rowStyles.catLabel}>{catLabel}</Text>
        {item.note ? (
          <Text style={rowStyles.note} numberOfLines={2}>{item.note}</Text>
        ) : (
          <Text style={rowStyles.noNote}>{t('expenses.noNote')}</Text>
        )}
        <Text style={rowStyles.date}>{formattedDate}</Text>
      </View>
      <Text style={rowStyles.amount}>{satangToBaht(item.amount)}</Text>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: T.input.bg,                                            // #F5EDE6 ivory-200 (from #FFFFFF — no white surfaces)
    borderRadius: T.radius.md,                                              // 12dp (from 16dp)
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
    // B3 spec: AccentRow — jade-800 3dp left accent bar for health/expense rows
    borderLeftWidth: T.list.row.accentBar.width,                            // 3dp
    borderLeftColor: T.list.row.accentBar.health,                           // #2F5042 jade-800
    padding: T.spacing[4],                                                  // 16dp ✓
    gap: 12,
    minHeight: 48,
  },
  left: {
    width: 24,
    alignItems: 'center',
    paddingTop: 2,
  },
  glyph: {
    fontSize: T.type.body.size,                                             // 15sp (from 16sp) — decorative category icon
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  info: { flex: 1, gap: 2 },
  catLabel: {
    // B3 spec: type.body.large text.primary 17sp
    fontFamily: T.type.bodyLarge.fontFamily,                                // Sarabun-Regular (from IBMPlexSans-SemiBold)
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 14sp — per spec body.large)
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    fontWeight: '600',
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #3A2A30 — per spec text.primary)
  },
  note: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp ✓ — text.primary (R4)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  noNote: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp — text.primary (R4; same as note)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
    fontStyle: 'italic',
  },
  date: {
    fontFamily: T.type.micro.fontFamily,                                    // Sarabun-Regular (from IBMPlexMono-Regular — no mono token)
    fontSize: T.type.micro.size,                                            // 11sp (from 12sp) — date micro
    lineHeight: T.type.micro.lineHeight,                                    // 18
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
    marginTop: 2,
  },
  amount: {
    // B3 spec: "Amount display: type.body.large text.primary; tabular-nums"
    fontFamily: T.type.bodyLarge.fontFamily,                                // Sarabun-Regular (from IBMPlexMono-Regular)
    fontSize: T.type.bodyLarge.size,                                        // 17sp (from 16sp — per spec body.large)
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #3A2A30 — per spec text.primary)
    fontWeight: '600',
    minWidth: 80,
    textAlign: 'right',
  },
});

// ─── Category breakdown ───────────────────────────────────────────────────────

function CategoryBreakdown({
  records,
  year,
  month,
}: {
  records: ExpenseRecord[];
  year: number;
  month: number;
}): React.JSX.Element | null {
  const { t } = useT();
  const breakdown = computeCategoryBreakdown(records, year, month);

  if (breakdown.length === 0) return null;

  return (
    <View style={breakdownStyles.container}>
      {breakdown.map((entry) => (
        <View key={entry.category} style={breakdownStyles.row}>
          <Text style={breakdownStyles.glyph}>{CATEGORY_GLYPHS[entry.category]}</Text>
          <Text style={breakdownStyles.label}>
            {t(`expenses.category.${entry.category}` as
              | 'expenses.category.baby-supplies'
              | 'expenses.category.healthcare'
              | 'expenses.category.baby-gear'
              | 'expenses.category.mother'
              | 'expenses.category.other')}
          </Text>
          <Text style={breakdownStyles.amount}>{satangToBaht(entry.totalSatang)}</Text>
        </View>
      ))}
    </View>
  );
}

const breakdownStyles = StyleSheet.create({
  container: {
    backgroundColor: T.input.bg,                                            // #F5EDE6 ivory-200 (from #FFFFFF)
    borderRadius: T.radius.md,                                              // 12dp (from 16dp)
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
    padding: 12,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  glyph: {
    fontSize: T.type.caption.size,                                          // 13sp (from 14sp)
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
    width: 20,
  },
  label: {
    flex: 1,
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp ✓ — text.primary (R4)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  amount: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexMono-Regular — no mono token)
    fontSize: T.type.caption.size,                                          // 13sp ✓ — text.primary (R4)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #3A2A30)
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export function ExpensesScreen({ tokenStorage, apiBaseUrl }: ExpensesScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  // Month navigation: defaults to current civil month
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1); // 1-based

  // All records (all months) — filtered per month for display
  const [allRecords, setAllRecords] = useState<ExpenseRecord[]>(
    expensesSyncStore.getExpenses(),
  );
  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [syncing, setSyncing] = useState(false);
  // syncError: non-null only for genuine server/client errors (not offline).
  // isOffline: true when the last pull or push failed with code='network_error'.
  // Spec §4.5: offline shows a calm pill, real errors show the error banner.
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);
  const [rejectedItems, setRejectedItems] = useState<RejectedRecord[]>([]);

  // Undo-delete toast state (spec §3.2/US-E3)
  const [deleteToastVisible, setDeleteToastVisible] = useState(false);
  const [undoRecord, setUndoRecord] = useState<ExpenseRecord | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clientRef = useRef(createExpensesSyncClient(apiBaseUrl, expensesSyncStore));

  const refreshFromStore = useCallback(() => {
    setAllRecords([...expensesSyncStore.getExpenses()]);
  }, []);

  // ── Sync pull ───────────────────────────────────────────────────────────────

  const syncPull = useCallback(async () => {
    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    setSyncing(true);
    setSyncError(null);
    setIsOffline(false);

    const result = await clientRef.current.pull(
      tokens.accessToken,
      expensesSyncStore.getWatermark(),
    );

    setSyncing(false);
    refreshFromStore();

    if (!result.ok) {
      // 'network_error' = offline (fetch threw); all other codes are real errors.
      if (result.code === 'network_error') {
        setIsOffline(true);
      } else {
        setSyncError(t('expenses.syncError'));
      }
    }
  }, [tokenStorage, refreshFromStore, t]);

  // ── Sync push ───────────────────────────────────────────────────────────────

  const syncPush = useCallback(async () => {
    if (expensesSyncStore.getPendingCount() === 0) return;

    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    setSyncing(true);
    setSyncError(null);
    setIsOffline(false);

    const result = await executePush(
      expensesSyncStore,
      clientRef.current,
      tokens.accessToken,
      uuidv4(),
    );

    setSyncing(false);
    refreshFromStore();

    if (!result.ok) {
      // 'network_error' = offline (fetch threw); all other codes are real errors.
      if (result.code === 'network_error') {
        setIsOffline(true);
      } else {
        setSyncError(t('expenses.syncError'));
      }
      setConflictCount(0);
      setRejectedItems([]);
    } else {
      setConflictCount(result.conflicts.length);
      setRejectedItems(result.rejected);
    }
  }, [tokenStorage, refreshFromStore, t]);

  // ── Mount + foreground pull ────────────────────────────────────────────────

  useEffect(() => {
    void syncPull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next === 'active') {
        void syncPull();
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [syncPull]);

  // ── Month navigation ──────────────────────────────────────────────────────

  function prevMonth(): void {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth(): void {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  // ── Form helpers ──────────────────────────────────────────────────────────

  function openAdd(): void {
    setForm(emptyForm());
    setFormVisible(true);
  }

  function openEdit(item: ExpenseRecord): void {
    setForm({
      id: item.id,
      // satangToInputString gives "59.90" for 5990 satang, preserving sub-baht
      // precision. The old Math.round(amount/100) turned 5990→60, losing 10 satang.
      amountBaht: satangToInputString(item.amount),
      category: item.category,
      incurredOn: item.incurredOn,
      note: item.note ?? '',
    });
    setFormVisible(true);
  }

  function updateForm(partial: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function handleSave(): void {
    const validation = validateAmountInput(form.amountBaht);
    if (!validation.valid) return;

    // Guard: date must be a valid civil date (picker always provides one, but
    // guard against an empty/malformed value from edge cases or test injection).
    if (!isValidCivilDate(form.incurredOn)) return;

    const satang = bahtStringToSatang(form.amountBaht);
    const now = new Date().toISOString();

    if (form.id) {
      // Update existing
      const existing = expensesSyncStore.getExpense(form.id);
      if (!existing) return;
      const updated: ExpenseRecord = {
        ...existing,
        amount: satang,
        category: form.category,
        incurredOn: form.incurredOn,
        note: form.note.trim() || null,
        updatedAt: now,
      };
      expensesSyncStore.enqueueUpdate(updated);
    } else {
      // Create new
      const record: ExpenseRecord = {
        id: uuidv4(),
        amount: satang,
        category: form.category,
        incurredOn: form.incurredOn,
        note: form.note.trim() || null,
        clientId: uuidv4(),
        version: 0, // create sentinel per contract §5
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      expensesSyncStore.enqueueCreate(record);
    }

    setFormVisible(false);
    refreshFromStore();
    void syncPush();
  }

  function handleDelete(): void {
    if (!form.id) return;
    // Save the record before tombstoning (needed for Undo restore).
    const snapshot = expensesSyncStore.getExpense(form.id);
    if (!snapshot) return;

    // Tombstone locally + queue delete
    expensesSyncStore.enqueueDelete(form.id);
    setFormVisible(false);
    refreshFromStore();

    // Show undo toast; push is deferred until the toast expires
    setUndoRecord({ ...snapshot });
    setDeleteToastVisible(true);

    // Cancel any in-flight timer before starting a fresh one
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = setTimeout(() => {
      setDeleteToastVisible(false);
      setUndoRecord(null);
      undoTimerRef.current = null;
      void syncPush();
    }, 4000);
  }

  function handleUndoDelete(): void {
    // Cancel the drain timer
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setDeleteToastVisible(false);

    if (!undoRecord) return;
    // Re-insert with deletedAt: null — restores both local state and queues
    // an update so the record is preserved on the server (LWW: update wins).
    expensesSyncStore.enqueueUpdate({ ...undoRecord, deletedAt: null });
    setUndoRecord(null);
    refreshFromStore();
    void syncPush();
  }

  // ── Derived display values ────────────────────────────────────────────────

  const listRecords = groupExpensesByDate(allRecords, viewYear, viewMonth);
  const totalSatang = computeMonthTotal(allRecords, viewYear, viewMonth);
  const totalStr = satangToBaht(totalSatang);
  const countLabel = t('expenses.totalCount', { n: listRecords.length });

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;

  // yyyyMm string used for locale-aware month+year label (matches CalendarScreen pattern)
  const viewYyyyMm = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Sync status banners */}
      {syncing && (
        <View style={styles.syncBar}>
          <Text style={styles.syncBarText}>{t('expenses.loading')}</Text>
        </View>
      )}
      {/* Offline pill (spec §4.5): calm warm-neutral; list stays interactive.
          Shown for network_error only — NOT the error banner. */}
      {isOffline && !syncing && (
        <View testID="expenses-offline-pill" style={styles.offlinePill}>
          <Text style={styles.offlinePillText}>{t('expenses.offlinePill')}</Text>
        </View>
      )}
      {/* Error banner: genuine server/client errors only (not offline).
          testID expenses-error matches screen anatomy + the documented testID list.
          Review fix: add a VISIBLE retry affordance (role + label + retry text) —
          previously the whole banner was tappable but showed no cue that tapping
          retries. Reuses the existing 'general.retry' catalog key. */}
      {syncError && (
        <TouchableOpacity
          testID="expenses-error"
          style={styles.errorBar}
          onPress={() => void syncPull()}
          accessibilityRole="button"
          accessibilityLabel={`${syncError} ${t('general.retry')}`}
        >
          <Text style={styles.errorBarText}>{syncError}</Text>
          <Text style={styles.errorBarRetryText}>{t('general.retry')}</Text>
        </TouchableOpacity>
      )}
      {conflictCount > 0 && (
        <View style={styles.infoBar}>
          <Text style={styles.infoBarText}>{t('expenses.conflictNote')}</Text>
        </View>
      )}
      {rejectedItems.length > 0 && (
        <View style={styles.warnBar}>
          <Text style={styles.warnBarText}>{t('expenses.rejectedNote')}</Text>
        </View>
      )}

      <FlatList
        data={listRecords}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerSection}>
            {/* Month navigation */}
            <View style={styles.monthNav}>
              <TouchableOpacity
                onPress={prevMonth}
                accessibilityRole="button"
                accessibilityLabel={t('expenses.monthNavPrevA11y')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.monthNavBtn}
              >
                <Text style={styles.monthNavArrow}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthLabel}>
                {formatYearMonth(viewYyyyMm, locale as Locale)}
              </Text>
              <TouchableOpacity
                onPress={nextMonth}
                accessibilityRole="button"
                accessibilityLabel={t('expenses.monthNavNextA11y')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.monthNavBtn}
              >
                <Text style={styles.monthNavArrow}>›</Text>
              </TouchableOpacity>
            </View>

            {/* Month total — the one bold thing (spec §2.1) */}
            <View style={styles.totalSection}>
              <Text style={styles.totalLabel}>{t('expenses.totalLabel')}</Text>
              <Text
                testID="expenses-month-total"
                style={styles.totalAmount}
                accessibilityLabel={`${t('expenses.totalLabel')}: ${totalStr}. ${countLabel}`}
              >
                {totalStr}
              </Text>
              <Text style={styles.totalCount}>{countLabel}</Text>
            </View>

            {/* Category breakdown (spec §2.2) */}
            <CategoryBreakdown records={allRecords} year={viewYear} month={viewMonth} />

            {/* Jump to current month (when navigating away) */}
            {!isCurrentMonth && (
              <TouchableOpacity
                style={styles.jumpToTodayBtn}
                onPress={() => {
                  setViewYear(currentYear);
                  setViewMonth(currentMonth);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.jumpToTodayText}>{t('expenses.jumpToThisMonth')}</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        ListEmptyComponent={
          <View testID="expenses-empty" style={styles.emptyContainer}>
            <View accessibilityElementsHidden={true}>
              <ReceiptIcon color={T.color.text.primary} size={40} />
            </View>
            <Text style={styles.emptyHeadline}>
              {isCurrentMonth
                ? t('expenses.emptyHeadline')
                : t('expenses.emptyPastMonth')}
            </Text>
            <Text style={styles.emptyBody}>
              {isCurrentMonth ? t('expenses.emptyBody') : ''}
            </Text>
            {isCurrentMonth && (
              <TouchableOpacity
                testID="expenses-add-empty"
                style={styles.addFirstBtn}
                onPress={openAdd}
                accessibilityRole="button"
                accessibilityLabel={t('expenses.addFirst')}
              >
                <Text style={styles.addFirstBtnText}>{t('expenses.addFirst')}</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <ExpenseRow item={item} onEdit={openEdit} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Refresh button */}
      <TouchableOpacity
        testID="expenses-refresh"
        style={styles.refreshBtn}
        onPress={() => void syncPull()}
        accessibilityRole="button"
        accessibilityLabel={t('expenses.refresh')}
      >
        <Text style={styles.refreshBtnText}>{t('expenses.refresh')}</Text>
      </TouchableOpacity>

      {/* FAB — add expense (spec §1: thumb-anchored) */}
      <TouchableOpacity
        testID="expenses-add"
        style={styles.fab}
        onPress={openAdd}
        accessibilityRole="button"
        accessibilityLabel={t('expenses.add')}
      >
        <Text style={styles.fabText}>{t('expenses.add')}</Text>
      </TouchableOpacity>

      {/* Add / edit form modal */}
      <ExpenseFormModal
        visible={formVisible}
        form={form}
        onChange={updateForm}
        onSave={handleSave}
        onDelete={form.id ? handleDelete : undefined}
        onCancel={() => setFormVisible(false)}
      />

      {/* Undo-delete toast (spec §3.2/US-E3) */}
      {deleteToastVisible && (
        <View testID="expenses-delete-toast" style={styles.deleteToast}>
          <Text style={styles.deleteToastText}>{t('expenses.deleteToast')}</Text>
          <TouchableOpacity
            testID="expenses-delete-undo"
            onPress={handleUndoDelete}
            accessibilityRole="button"
            accessibilityLabel={t('expenses.deleteUndo')}
            style={styles.deleteToastUndoBtn}
          >
            <Text style={styles.deleteToastUndoText}>{t('expenses.deleteUndo')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 ivory-100 (from #FBF6F1 literal)
  },

  // Sync status banners
  syncBar: {
    backgroundColor: T.color.surface.wash.jade,                             // #E4EDE7 jade-100 (from #EBF2EC)
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  syncBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #4A7A56)
  },
  // Offline pill (spec §4.5 — calm warm-neutral, list stays interactive)
  offlinePill: {
    backgroundColor: T.color.surface.wash.amber,                            // #FDF0D5 amber-100 (from #FFF8E8)
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  offlinePillText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #7A5A10)
  },
  // Error banner (genuine server/client errors only — not offline)
  errorBar: {
    backgroundColor: T.color.surface.subtle,                                // #F5EDE6 ivory-200 (from #FBEDEE — blameless; per B3 spec)
    paddingVertical: 8,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.spacing[2],
    minHeight: 48,                                                          // ≥48dp touch target (a11y)
  },
  errorBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp — per B3 spec 15sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #8E3A44 — blameless)
  },
  // Review fix: visible retry affordance on the error banner (was tappable
  // with no visible cue that tapping retries).
  errorBarRetryText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold
    fontSize: T.type.body.size,                                             // 15sp
    lineHeight: T.type.body.lineHeight,                                     // 25
    fontWeight: T.type.label.fontWeight,
    color: T.color.accent.interactive,                                      // #9A5F0A amber-700
    textDecorationLine: 'underline',
  },
  infoBar: {
    backgroundColor: T.color.surface.wash.jade,                             // #E4EDE7 jade-100 (from #EBF2EC)
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  infoBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #4A7A56)
  },
  warnBar: {
    backgroundColor: T.color.surface.wash.amber,                            // #FDF0D5 amber-100 (from #FFF8E8)
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],                                        // 16dp
    alignItems: 'center',
  },
  warnBarText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 13sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #7A5A10)
  },

  // List container
  list: {
    paddingBottom: 160,
  },

  // Header: month nav + total + breakdown
  headerSection: {
    padding: 20,
    gap: 16,
  },

  // Month navigation
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthNavBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavArrow: {
    fontSize: T.type.heading2.size,                                         // 20sp (from 22sp — nearest heading token)
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
    lineHeight: T.type.heading2.lineHeight,                                 // 33
  },
  monthLabel: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp ✓
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #3A2A30)
    textAlign: 'center',
    flex: 1,
  },
  yearLabel: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexMono-Regular)
    fontSize: T.type.body.size,                                             // 15sp ✓
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #3A2A30)
  },

  // Month total — B3 spec: type.heading2 text.heading 20sp
  totalSection: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  totalLabel: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },
  totalAmount: {
    // B3 spec: "Total summary: type.heading2 text.heading 20sp"
    fontFamily: T.type.heading2.fontFamily,                                 // Sarabun-SemiBold (from IBMPlexMono-Regular)
    fontSize: T.type.heading2.size,                                         // 20sp (from 36sp — per spec; heading2 is the largest non-display token)
    lineHeight: T.type.heading2.lineHeight,                                 // 33
    fontWeight: T.type.heading2.fontWeight,                                 // '600'
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #3A2A30 — per spec text.heading)
  },
  totalCount: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp ✓ — text.primary (R4)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #94818A)
  },

  // Jump-to-current-month
  jumpToTodayBtn: {
    alignSelf: 'center',
    paddingHorizontal: T.spacing[4],                                        // 16dp
    paddingVertical: 8,
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 (from #FFFFFF)
    borderRadius: T.radius.pill,                                            // 999
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
  },
  jumpToTodayText: {
    fontFamily: T.type.caption.fontFamily,                                  // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.caption.size,                                          // 13sp ✓ — text.primary (R4)
    lineHeight: T.type.caption.lineHeight,                                  // 21
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },

  // List items
  separator: {
    height: 10,
  },

  // Empty state (spec §4.2 — PandanEmptyState)
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 32,
    paddingBottom: 20,
    gap: 10,
  },
  emptyHeadline: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.bodyLarge.size,                                        // 17sp ✓
    lineHeight: T.type.bodyLarge.lineHeight,                                // 28
    color: T.color.text.heading,                                            // #4A2230 roselle-900 (from #3A2A30)
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
    textAlign: 'center',
  },
  addFirstBtn: {
    marginTop: 8,
    height: T.button.primary.height,                                        // 52dp ✓
    paddingHorizontal: 28,
    backgroundColor: T.button.primary.bg,                                   // #9A5F0A amber-700 (from #A8505A)
    borderRadius: T.button.primary.radius,                                  // 12dp (from 999/pill)
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFirstBtnText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                                             // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF
  },

  // Refresh button
  refreshBtn: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: T.color.surface.base,                                  // #FBF6F1 (from #FFFFFF)
    borderRadius: T.radius.pill,                                            // 999
    borderWidth: 1,
    borderColor: T.color.surface.divider,                                   // #E8DDD5 (from #EBE1D9)
  },
  refreshBtnText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.primary,                                            // #7A3A52 roselle-700 (from #5F4A52)
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    height: T.button.primary.height,                                        // 52dp ✓
    paddingHorizontal: 28,
    backgroundColor: T.button.primary.bg,                                   // #9A5F0A amber-700 (from #A8505A)
    borderRadius: T.button.primary.radius,                                  // 12dp (from 999/pill)
    alignItems: 'center',
    justifyContent: 'center',
    // Warm-tinted shadow per token (T.elev.1)
    shadowColor: T.elev[1].shadowColor,                                     // 'rgba(74,34,48,0.07)' (from '#000')
    shadowOffset: T.elev[1].shadowOffset,                                   // { width:0, height:2 }
    shadowOpacity: T.elev[1].shadowOpacity,                                 // 1
    shadowRadius: T.elev[1].shadowRadius,                                   // 8
    elevation: T.elev[1].elevation,                                         // 2
  },
  fabText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                                             // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF
  },

  // Undo-delete toast (spec §3.2/US-E3)
  deleteToast: {
    position: 'absolute',
    bottom: 100,
    left: T.spacing[4],                                                     // 16dp
    right: T.spacing[4],                                                    // 16dp
    backgroundColor: T.color.text.heading,                                  // #4A2230 roselle-900 (from #3A2A30)
    borderRadius: T.radius.md,                                              // 12dp ✓
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.spacing[4],                                        // 16dp
    paddingVertical: 12,
    // Elevated shadow per T.elev[2]
    shadowColor: T.elev[2].shadowColor,                                     // 'rgba(74,34,48,0.12)' (from '#000')
    shadowOffset: T.elev[2].shadowOffset,                                   // { width:0, height:8 }
    shadowOpacity: T.elev[2].shadowOpacity,                                 // 1
    shadowRadius: T.elev[2].shadowRadius,                                   // 24
    elevation: T.elev[2].elevation,                                         // 8
  },
  deleteToastText: {
    fontFamily: T.type.body.fontFamily,                                     // Sarabun-Regular (from IBMPlexSans-Regular)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF
    flex: 1,
  },
  deleteToastUndoBtn: {
    paddingLeft: T.spacing[4],                                              // 16dp
    paddingVertical: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  deleteToastUndoText: {
    fontFamily: T.type.label.fontFamily,                                    // Sarabun-SemiBold (from IBMPlexSans-SemiBold)
    fontSize: T.type.body.size,                                             // 15sp (from 14sp)
    lineHeight: T.type.body.lineHeight,                                     // 25
    color: T.color.text.onDark,                                             // #FFFFFF (from #F2B8BE — no light-rose token; use onDark white)
  },
});
