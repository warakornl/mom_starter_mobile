/**
 * privacyPolicyScreen.rntl.test.tsx — real render (task #40).
 *
 * PrivacyPolicyScreen was a dead footer link on ManageConsentsScreen. This
 * proves the REAL screen renders the honest "in progress" placeholder — not
 * invented legal text — and that back navigation works.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PrivacyPolicyScreen } from './PrivacyPolicyScreen';
import { LanguageProvider } from '../i18n/LanguageContext';

describe('PrivacyPolicyScreen — honest placeholder (real render)', () => {
  it('renders the pending-notice panel with the honest in-progress copy', () => {
    render(
      <LanguageProvider>
        <PrivacyPolicyScreen onBack={jest.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('privacy-policy-pending-notice')).toBeTruthy();
    expect(
      screen.getByText('นโยบายความเป็นส่วนตัวฉบับเต็มอยู่ระหว่างจัดทำและรอทนายความตรวจสอบ จะแสดงที่นี่เมื่อพร้อม'),
    ).toBeTruthy();
  });

  it('does NOT render any fabricated legal-policy body text', () => {
    render(
      <LanguageProvider>
        <PrivacyPolicyScreen onBack={jest.fn()} />
      </LanguageProvider>,
    );
    // Guard: no invented "we collect / we share" style prose anywhere on screen.
    expect(screen.queryByText(/we collect|we may share/i)).toBeNull();
  });

  it('calls onBack when the back row is pressed', () => {
    const onBack = jest.fn();
    render(
      <LanguageProvider>
        <PrivacyPolicyScreen onBack={onBack} />
      </LanguageProvider>,
    );

    const backBtn = screen.getByRole('button', { name: 'กลับ' });
    fireEvent.press(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the screen title is reachable via getByText (real, rendered content)', () => {
    render(
      <LanguageProvider>
        <PrivacyPolicyScreen onBack={jest.fn()} />
      </LanguageProvider>,
    );
    expect(screen.getByText('นโยบายความเป็นส่วนตัว')).toBeTruthy();
  });
});
