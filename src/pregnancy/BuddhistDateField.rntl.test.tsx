/**
 * BuddhistDateField.rntl.test.tsx — task #40 (centralize the พ.ศ.-aware
 * date-entry + BE-year guard into ONE shared component).
 *
 * Real render, real press (RNTL) — proves the shared component's Confirm
 * flow actually EXECUTES `convertBuddhistEraYearIfNeeded` /
 * `isBuddhistEraYear` from buddhistDateGuard.ts (no re-implementation in the
 * test, no mocked internals) for both guard modes used by the real screens:
 *   - 'auto-convert' (ProfileSetupScreen behaviour): 2569 → silently
 *     corrected to 2026, calm notice shown, value committed.
 *   - 'reject' (BirthEventScreen / LossConfirmScreen behaviour): 2569 →
 *     rejected inline, no commit, no Continue-anyway path.
 *
 * FAIL-ON-REVERT: manually reverting the `year > BE_YEAR_THRESHOLD` guard in
 * buddhistDateGuard.ts (e.g. commenting out the `if` branch) makes the
 * 'auto-convert 2569→2026' and 'reject a BE year' tests below fail, because
 * they assert on the REAL commit/error outcome, not a simulated one.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BuddhistDateField } from './BuddhistDateField';

describe('BuddhistDateField — modal variant, guardMode="auto-convert"', () => {
  function renderField(onChange: (v: string) => void, initialValue = '') {
    return render(
      <BuddhistDateField
        variant="modal"
        guardMode="auto-convert"
        value={initialValue}
        onChange={onChange}
        a11yLabel="วันกำหนดคลอด"
        placeholder="เลือกวันที่"
        modalTitle="เลือกวันกำหนดคลอด"
        modalHint="กรอกในรูปแบบ YYYY-MM-DD"
        modalCancelLabel="ยกเลิก"
        modalConfirmLabel="ยืนยันวันนี้"
        formatErrorMessage="กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD"
        beAutoConvertedNotice="ปรับปีจาก พ.ศ. เป็น ค.ศ. ให้อัตโนมัติแล้ว ตรวจสอบวันที่อีกครั้งก่อนบันทึก"
        testID="field-under-test"
        modalInputTestID="field-modal-input"
      />,
    );
  }

  it('FAIL-ON-REVERT: a typed BE year (2569) is silently converted to CE (2026) and committed via the REAL onChange', () => {
    // Matches ProfileSetupScreen's original handleDateConfirm: the notice is
    // set in the SAME state update that closes the modal (setShowDateModal
    // (false)), so by the time the modal has closed the notice text is no
    // longer mounted (the modal that contained it is gone) — the commit
    // value itself is the durable, externally-observable proof of the
    // guard's real BE→CE conversion having run.
    const onChange = jest.fn();
    renderField(onChange);

    fireEvent.press(screen.getByTestId('field-under-test'));
    fireEvent.changeText(screen.getByTestId('field-modal-input'), '2569-11-20');
    fireEvent.press(screen.getByLabelText('ยืนยันวันนี้'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-11-20');
  });

  it('a normal CE year (2026) commits unchanged with no BE notice', () => {
    const onChange = jest.fn();
    renderField(onChange);

    fireEvent.press(screen.getByTestId('field-under-test'));
    fireEvent.changeText(screen.getByTestId('field-modal-input'), '2026-11-20');
    fireEvent.press(screen.getByLabelText('ยืนยันวันนี้'));

    expect(onChange).toHaveBeenCalledWith('2026-11-20');
    expect(
      screen.queryByText('ปรับปีจาก พ.ศ. เป็น ค.ศ. ให้อัตโนมัติแล้ว ตรวจสอบวันที่อีกครั้งก่อนบันทึก'),
    ).toBeNull();
  });

  it('malformed input shows the inline format-error and does NOT call onChange', () => {
    const onChange = jest.fn();
    renderField(onChange);

    fireEvent.press(screen.getByTestId('field-under-test'));
    fireEvent.changeText(screen.getByTestId('field-modal-input'), 'not-a-date');
    fireEvent.press(screen.getByLabelText('ยืนยันวันนี้'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD')).toBeTruthy();
  });
});

describe('BuddhistDateField — modal variant, guardMode="reject"', () => {
  function renderField(onChange: (v: string) => void) {
    return render(
      <BuddhistDateField
        variant="modal"
        guardMode="reject"
        value=""
        onChange={onChange}
        a11yLabel="วันที่คลอด"
        placeholder="เลือกวันที่"
        modalTitle="เลือกวันที่คลอด"
        modalHint="กรอกในรูปแบบ YYYY-MM-DD"
        modalCancelLabel="ยกเลิก"
        modalConfirmLabel="ยืนยัน"
        formatErrorMessage="กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD"
        beRejectedMessage="กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD"
        testID="birth-field"
        modalInputTestID="birth-field-modal-input"
      />,
    );
  }

  it('FAIL-ON-REVERT: a typed BE year (2569) is REJECTED inline — no commit, no silent correction', () => {
    const onChange = jest.fn();
    renderField(onChange);

    fireEvent.press(screen.getByTestId('birth-field'));
    fireEvent.changeText(screen.getByTestId('birth-field-modal-input'), '2569-11-20');
    fireEvent.press(screen.getByLabelText('ยืนยัน'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD')).toBeTruthy();
  });

  it('a normal CE year (2026) commits via the REAL onChange', () => {
    const onChange = jest.fn();
    renderField(onChange);

    fireEvent.press(screen.getByTestId('birth-field'));
    fireEvent.changeText(screen.getByTestId('birth-field-modal-input'), '2026-06-29');
    fireEvent.press(screen.getByLabelText('ยืนยัน'));

    expect(onChange).toHaveBeenCalledWith('2026-06-29');
  });

  it('boundary: year 2100 (not > threshold) is accepted, not rejected', () => {
    const onChange = jest.fn();
    renderField(onChange);

    fireEvent.press(screen.getByTestId('birth-field'));
    fireEvent.changeText(screen.getByTestId('birth-field-modal-input'), '2100-01-01');
    fireEvent.press(screen.getByLabelText('ยืนยัน'));

    expect(onChange).toHaveBeenCalledWith('2100-01-01');
  });
});

describe('BuddhistDateField — modal variant, guardMode="none" (hospital admission/discharge)', () => {
  it('a BE-looking year (2569) is NOT guarded — commits as-is, matching current admission/discharge behaviour', () => {
    const onChange = jest.fn();
    render(
      <BuddhistDateField
        variant="modal"
        guardMode="none"
        value=""
        onChange={onChange}
        a11yLabel="วันที่เข้ารับการรักษา"
        placeholder="เลือกวันที่"
        modalTitle="วันที่เข้ารับการรักษา"
        modalHint="กรอกในรูปแบบ YYYY-MM-DD"
        modalCancelLabel="ยกเลิก"
        modalConfirmLabel="ยืนยัน"
        formatErrorMessage="กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD"
        testID="admission-field"
        modalInputTestID="admission-field-modal-input"
      />,
    );

    fireEvent.press(screen.getByTestId('admission-field'));
    fireEvent.changeText(screen.getByTestId('admission-field-modal-input'), '2569-01-01');
    fireEvent.press(screen.getByLabelText('ยืนยัน'));

    expect(onChange).toHaveBeenCalledWith('2569-01-01');
  });
});

describe('BuddhistDateField — inline variant (LossConfirmScreen layout)', () => {
  it('renders a plain controlled TextInput with no modal, forwarding onChangeText verbatim', () => {
    const onChangeText = jest.fn();
    render(
      <BuddhistDateField
        variant="inline"
        value=""
        onChangeText={onChangeText}
        a11yLabel="วันที่ (ไม่บังคับ)"
        placeholder="เลือกวันที่ (ไม่บังคับ)"
        testID="loss-date-field"
      />,
    );

    fireEvent.changeText(screen.getByTestId('loss-date-field'), '2026-05-01');
    expect(onChangeText).toHaveBeenCalledWith('2026-05-01');
    // No modal Confirm/Cancel controls exist in the inline variant.
    expect(screen.queryByLabelText('ยืนยัน')).toBeNull();
  });

  it('shows an externally-supplied errorText (host screen owns validation timing)', () => {
    render(
      <BuddhistDateField
        variant="inline"
        value="2569-01-01"
        onChangeText={jest.fn()}
        a11yLabel="วันที่ (ไม่บังคับ)"
        placeholder="เลือกวันที่ (ไม่บังคับ)"
        errorText="วันที่นี้อยู่นอกช่วงที่บันทึกได้ · เว้นว่างได้"
      />,
    );

    expect(screen.getByText('วันที่นี้อยู่นอกช่วงที่บันทึกได้ · เว้นว่างได้')).toBeTruthy();
  });
});
