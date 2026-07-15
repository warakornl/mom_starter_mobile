/**
 * duplicateBackButton.rntl.test.tsx
 *
 * Owner-reported bugs #1/#2 (2026-07): "ซิงค์ปฏิทินในเครื่อง" (CalendarSyncSettings)
 * and "จัดการความยินยอม" (ManageConsents) each showed TWO back affordances — a
 * custom in-screen back button AND the native-stack header's own back button.
 *
 * ROOT CAUSE: both routes were registered in RootNavigator with only
 * `title` + `headerBackTitle` (headerShown defaults to TRUE → react-navigation's
 * native-stack header renders, WITH its own back button), while the screen
 * component ALSO renders a custom in-screen back TouchableOpacity. The app's
 * established convention (verified against AutoDecrementSettingsScreen,
 * SubUnitSetupScreen, SupplyItemPickerScreen, FeedingLogScreen, CaptureScreen —
 * all full-bleed custom screens with their own back button) is: a screen that
 * renders its own back control MUST be registered with `headerShown: false`.
 * ManageConsents/CalendarSyncSettings were missing that flag.
 *
 * This test renders the REAL RootNavigator through a real NavigationContainer
 * (mirroring App.tsx's exact provider nesting) and navigates via the real
 * imperative nav ref (the same API App.tsx itself uses for deep links). It
 * proves duplication two ways:
 *   1. The visible in-screen back text renders (React Native Testing Library
 *      query — a real render, real text node).
 *   2. react-native-screens' native header config for the CURRENT screen
 *      (scoped by its `title`) must have `hidden: true` — i.e. the entire
 *      native header (and its own back button) is suppressed via
 *      headerShown: false. Before the fix, `hidden` was `false`, meaning
 *      react-navigation painted a full native header WITH its own back
 *      button on top of the screen's custom back button — the duplicate the
 *      owner saw.
 */
import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { render, screen, waitFor } from '@testing-library/react-native';

import { RootNavigator } from './RootNavigator';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { RootStackParamList } from './types';
import type { TokenStorage } from '../auth/tokenStorage';

const mockTokenStorage: TokenStorage = {
  save: jest.fn().mockResolvedValue(undefined),
  load: jest.fn().mockResolvedValue(null),
  clear: jest.fn().mockResolvedValue(undefined),
};

function renderAt(initialRoute: keyof RootStackParamList) {
  const ref = createNavigationContainerRef<RootStackParamList>();
  return render(
    <LanguageProvider>
      <NavigationContainer
        ref={ref}
        onReady={() => {
          // Real imperative navigation call — same API App.tsx uses for deep links.
          ref.navigate(initialRoute as never);
        }}
      >
        <RootNavigator tokenStorage={mockTokenStorage} apiBaseUrl="https://api.test.invalid" />
      </NavigationContainer>
    </LanguageProvider>,
  );
}

/**
 * Returns the react-native-screens native header config host element(s)
 * whose `title` matches the given screen title — i.e. scoped to ONE screen's
 * own header, not every screen ever pushed onto the stack. Filters to the
 * host `RNSScreenStackHeaderConfig` node (react-native-screens also renders
 * a composite wrapper with the same `title` prop but no `hidden` prop set).
 */
function headerConfigsForTitle(title: string) {
  return screen
    .UNSAFE_getAllByProps({ title })
    .filter((el) => el.props.hidden !== undefined);
}

describe('exactly one back affordance per screen (no duplicate back buttons)', () => {
  it('CalendarSyncSettings: native header back button must be hidden (screen owns its own back button)', async () => {
    renderAt('CalendarSyncSettings');

    await waitFor(() => {
      expect(screen.getByTestId('calendar-sync-settings-screen')).toBeTruthy();
    });

    // 1. The screen's own visible back button is present (by design).
    expect(screen.getByTestId('calendar-sync-back-btn')).toBeTruthy();
    expect(screen.getByText('ย้อนกลับ')).toBeTruthy();

    // 2. The native header for THIS screen must be fully hidden — otherwise
    //    react-navigation paints its own back button alongside the screen's
    //    custom one. Scoped by this screen's own header title (react-native-
    //    screens renders one RNSScreenStackHeaderConfig per screen).
    const headerConfigs = headerConfigsForTitle('ซิงก์ปฏิทินในเครื่อง');
    expect(headerConfigs.length).toBeGreaterThan(0);
    for (const cfg of headerConfigs) {
      expect(cfg.props.hidden).toBe(true);
    }
  });

  it('ManageConsents: native header back button must be hidden (screen owns its own back button)', async () => {
    renderAt('ManageConsents');

    await waitFor(() => {
      expect(
        screen.queryByTestId('consent-manage-screen') ??
          screen.queryByTestId('consent-manage-screen-skeleton') ??
          screen.queryByTestId('consent-manage-screen-load-error'),
      ).toBeTruthy();
    });

    // 1. The screen's own visible back button/text is present (by design).
    expect(screen.getByText('กลับ')).toBeTruthy();

    // 2. The native header for THIS screen must be fully hidden.
    const headerConfigs = headerConfigsForTitle('จัดการความยินยอม');
    expect(headerConfigs.length).toBeGreaterThan(0);
    for (const cfg of headerConfigs) {
      expect(cfg.props.hidden).toBe(true);
    }
  });

  // Regression: the SAME duplicate-back-button class recurred on the adjacent
  // CalendarSyncPrivacyLevel screen (full-app UX review 2026-07) — it renders
  // its own back button + H1 but its route omitted headerShown:false.
  it('CalendarSyncPrivacyLevel: native header back button must be hidden (screen owns its own back button)', async () => {
    renderAt('CalendarSyncPrivacyLevel');

    await waitFor(() => {
      expect(screen.getByTestId('calendar-sync-privacy-level-screen')).toBeTruthy();
    });

    // 1. The screen's own visible back button is present (by design).
    expect(screen.getByTestId('privacy-level-back-btn')).toBeTruthy();

    // 2. The native header for THIS screen must be fully hidden.
    const headerConfigs = headerConfigsForTitle('ระดับความเป็นส่วนตัว');
    expect(headerConfigs.length).toBeGreaterThan(0);
    for (const cfg of headerConfigs) {
      expect(cfg.props.hidden).toBe(true);
    }
  });
});
