/**
 * BottomTabNavigator — the 6-tab bottom navigation bar.
 *
 * Implements bottom-tab-navigation-design.md v2.1 §1–§8 +
 * profile-tab-and-hub-ui.md v1.1 (6th tab: Profile).
 *
 * Tab order (spec §1.1, v3):
 *   1 Supplies  2 Expenses  3 Home  4 Calendar  5 Medication  6 Profile
 *
 * initialRouteName = 'Home' (§10 OQ-NAV-1 — owner decision; was 'Calendar').
 *
 * Custom tab bar (CustomTabBar, v2 §2.1 moving disc):
 *   - 56dp content height + safe-area bottom inset (§7.4)
 *   - Background: surface/page #FFFFFF, 1px hairline #EBE1D9 top border
 *   - Active disc: 52×52dp rose/600 (#A8505A) filled disc on the FOCUSED tab
 *     (any of 5 tabs, not just center — OQ-NAV-3 "moving disc" resolution)
 *   - Active disc icon: white (#FFFFFF)
 *   - Active non-disc: rose/700 label color
 *   - Inactive: ink/soft #5F4A52 for icon and label
 *   - Full-column tap zone ≥ 44dp (§8.3)
 *   - accessibilityLabel (full name), accessibilityState.selected (§8.2)
 *
 * ProfileSnapshot lifting:
 *   HomeTabScreen updates the snapshot via useProfileSnapshotSetter() after
 *   GET /v1/pregnancy-profile. Other screens read it via useProfileSnapshot().
 *
 * Navigation wiring:
 *   All callbacks that push root-stack screens (Settings, KickCountHome,
 *   BirthEvent, DoctorReport, etc.) are wired here using the `navigation` prop
 *   from the root stack (Stack.Screen render-prop).
 *
 * v2 changes vs v1:
 *   - Center tab: Home (HomeTabScreen) replaces Calendar tab center position
 *   - Calendar tab: renders CalendarScreen DIRECTLY (fixes nested-ScrollView bug §6B)
 *   - Report tab removed from tab bar; DoctorReport is a root-stack screen (§8A)
 *   - Moving disc: all 5 tabs get the disc when focused (OQ-NAV-3)
 *   - LangToggle + gear ⚙ moved from Calendar to Home top bar (§3.2)
 *
 * Security: no health data in route params (PDPA SD-9).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import type { TokenStorage } from '../auth/tokenStorage';
import { useProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import { TAB_CONFIGS, TAB_BAR_TOKENS, INITIAL_TAB } from './tabNavigatorConfig';
import type { TabConfig } from './tabNavigatorConfig';
import { useT } from '../i18n/LanguageContext';
import {
  TabChecklistIcon,
  TabWalletIcon,
  TabHomeIcon,
  TabCalendarIcon,
  TabPillIcon,
  TabPersonIcon,
} from '../icons';
import { localCivilToday } from '../pregnancy/gestationalAge';

import { HomeTabScreen } from '../screens/HomeTabScreen';
import { CalendarScreen } from '../calendar/CalendarScreen';
import { SuppliesScreen } from '../supplies/SuppliesScreen';
import { ExpensesScreen } from '../expenses/ExpensesScreen';
import { MedicationPlanListScreen } from '../medication/MedicationPlanListScreen';
import { ProfileHubScreen } from '../profile/ProfileHubScreen';
import { buildAddCaptureParams } from '../calendar/calendarAddCaptureHandler';
import { buildLogDoseParams } from '../medication/logDoseParams';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import {
  performLogout,
} from '../auth/performLogout';
import { supplySyncStore } from '../sync/supplySyncStore';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { clearDraft } from '../kickCount/kickCountDraftStore';
import { consentStore } from '../consent/consentStore';
import { resetConsentQueue } from '../consent/consentSync';
import { suggestionStore } from '../suggestion/suggestionStore';
import { expensesSyncStore } from '../expenses/expensesSyncStore';
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { medicationPlanSyncStore } from '../medication/medicationPlanSyncStore';
import { medicationLogSyncStore } from '../medication/medicationLogSyncStore';

// ─── Tab param list (v3 — 6 tabs) ────────────────────────────────────────────

export type TabParamList = {
  Supplies: undefined;
  Expenses: undefined;
  /** Home — tab 3 (left-of-center in 6-tab bar); dashboard + snapshot-population. */
  Home: undefined;
  Calendar: undefined;
  Medication: undefined;
  /** Profile — tab 6 (far right); Profile Hub screen (§6.1). */
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

// ─── Icon map — iconName → SVG component ─────────────────────────────────────

/**
 * ICON_MAP maps each tab's iconName string key to its SVG component.
 * Lives in the view layer (not tabNavigatorConfig.ts) so React + SVG imports
 * stay out of the pure-Node config file. See spec §2 Tell 1 Fix A.
 */
const ICON_MAP: Record<TabConfig['iconName'], React.FC<{ color: string; size: number }>> = {
  supplies:   TabChecklistIcon,
  expenses:   TabWalletIcon,
  home:       TabHomeIcon,
  calendar:   TabCalendarIcon,
  medication: TabPillIcon,
  profile:    TabPersonIcon,
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BottomTabNavigatorProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Root stack navigation — used to push non-tab screens over the tabs. */
  navigation: NativeStackNavigationProp<RootStackParamList>;
}

// ─── Custom tab bar (v2 moving disc per OQ-NAV-3) ────────────────────────────

/**
 * CustomTabBar — 56dp content-height bar with moving-disc active indicator.
 *
 * v2 change (§2.1 OQ-NAV-3):
 *   The rose/600 disc is shown on whichever tab is FOCUSED.
 *   In v1 the disc was permanent on the center (Calendar) tab only.
 *   Now every tab renders the disc when isFocused=true, making it "moving".
 */
function CustomTabBar({ state, navigation: tabNav }: BottomTabBarProps): React.JSX.Element {
  const { t } = useT();

  // §8.5 focus ring: track keyboard/switch-control focused tab index.
  // Uses TAB_BAR_TOKENS.focusRingColor (honey/700 #B96A28) for the ring border.
  const [keyboardFocusedIndex, setKeyboardFocusedIndex] = useState<number | null>(null);

  return (
    <SafeAreaView
      edges={['bottom']}
      style={tabBarStyles.safeArea}
    >
      <View style={tabBarStyles.container}>
        {state.routes.map((route, index) => {
          const config = TAB_CONFIGS[index];
          if (!config) return null;

          const isFocused = state.index === index;
          const isKeyboardFocused = keyboardFocusedIndex === index;

          const label = t(config.labelKey);
          const a11yLabel = t(config.a11yKey);

          function onPress(): void {
            const event = tabNav.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              tabNav.navigate(route.name as keyof TabParamList);
            }
          }

          // v2 moving disc: disc is on the focused tab (any of 5); white icon inside disc
          const iconColor = isFocused
            ? TAB_BAR_TOKENS.activeIconColor
            : TAB_BAR_TOKENS.inactiveColor;

          const labelColor = isFocused
            ? TAB_BAR_TOKENS.activeLabelColor
            : TAB_BAR_TOKENS.inactiveColor;

          return (
            <TouchableOpacity
              key={route.key}
              style={[
                tabBarStyles.tabItem,
                // §8.5: focus ring — visible when navigated via keyboard/switch control
                isKeyboardFocused && tabBarStyles.tabItemFocused,
              ]}
              onPress={onPress}
              onFocus={() => setKeyboardFocusedIndex(index)}
              onBlur={() => setKeyboardFocusedIndex(null)}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              accessibilityState={{ selected: isFocused }}
              activeOpacity={0.7}
            >
              {/* Moving disc: shown on any focused tab (v2 §2.1) */}
              {isFocused ? (
                <View
                  style={tabBarStyles.activeDisc}
                  accessibilityElementsHidden={true}
                >
                  {React.createElement(ICON_MAP[config.iconName], { color: '#FFFFFF', size: 24 })}
                </View>
              ) : (
                React.createElement(ICON_MAP[config.iconName], { color: '#5F4A52', size: 24 })
              )}
              {/* §8.7 Dynamic Type: numberOfLines={2} + flexWrap allow large text to wrap
               * cleanly rather than clip. "ค่าใช้จ่าย" wraps to two lines at 13pt. */}
              <Text
                style={[tabBarStyles.label, { color: labelColor }]}
                numberOfLines={2}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const tabBarStyles = StyleSheet.create({
  safeArea: {
    backgroundColor: TAB_BAR_TOKENS.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TAB_BAR_TOKENS.borderColor,
  },
  container: {
    flexDirection: 'row',
    // §8.7 Dynamic Type: paddingVertical replaces fixed height: 56 so the bar
    // can grow when the OS text size is increased. minHeight preserves the
    // 56dp content-height floor when text is at default size.
    minHeight: TAB_BAR_TOKENS.contentHeight,
    paddingVertical: 4,
    backgroundColor: TAB_BAR_TOKENS.background,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // §8.3: ≥44dp touch target
    paddingVertical: 4,
  },
  // §8.5: visible focus ring for keyboard / switch-control navigation.
  // Uses TAB_BAR_TOKENS.focusRingColor (honey/700 #B96A28) per design spec §8.5.
  tabItemFocused: {
    borderWidth: 2,
    borderColor: TAB_BAR_TOKENS.focusRingColor,
    borderRadius: 10,
  },
  icon: {
    fontSize: 20,
    lineHeight: 24,
  },
  label: {
    fontFamily: 'IBMPlexSans-SemiBold',
    // §7.5 floor: min 12pt. Settled at 13pt — fits "หน้าหลัก" on one line;
    // "ค่าใช้จ่าย" wraps cleanly to 2 lines via numberOfLines={2} (§8.7).
    fontSize: 13,
    lineHeight: 17,
    marginTop: 2,
    textAlign: 'center',
    flexShrink: 1, // §8.7: allow text to shrink / wrap with Dynamic Type
  },
  // Active disc: 52×52dp rose/600 filled disc (v2 §2.1 — moves with focus)
  activeDisc: {
    width: TAB_BAR_TOKENS.activeDiscSize,
    height: TAB_BAR_TOKENS.activeDiscSize,
    borderRadius: TAB_BAR_TOKENS.activeDiscRadius,
    backgroundColor: TAB_BAR_TOKENS.activeDiscColor,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});

// ─── Navigator component ──────────────────────────────────────────────────────

export function BottomTabNavigator({
  tokenStorage,
  apiBaseUrl,
  navigation,
}: BottomTabNavigatorProps): React.JSX.Element {
  // Profile snapshot from context (populated by HomeTabScreen after GET profile).
  // Used by DoctorReport (root-stack) and Medication tab for consent.
  const snapshot = useProfileSnapshot();
  const _kickProps = snapshot ?? {
    gestationalWeek: 0,
    edd: '',
    todayCivil: localCivilToday(),
    lifecycle: 'pregnant' as const,
    generalHealthConsented: false,
  };

  // ── Shared logout runner (PDPA SD-5 cross-account-leak guard) ───────────────
  function handleLogout(): void {
    void performLogout({
      clearTokens: () => tokenStorage.clear(),
      resetSupplyStore: () => supplySyncStore.reset(),
      resetKickCountStore: () => kickCountSyncStore.reset(),
      resetCalendarStore: () => calendarSyncStore.reset(),
      resetSelfLogStore: () => selfLogSyncStore.reset(),
      resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
      resetMedicationLogStore: () => medicationLogSyncStore.reset(),
      resetConsentStore: () => consentStore.reset(),
      resetConsentQueue: () => resetConsentQueue(),
      resetSuggestionStore: () => suggestionStore.reset(),
      resetExpensesStore: () => expensesSyncStore.reset(),
      clearKickCountDraft: () => clearDraft(),
      onComplete: () =>
        navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
    });
  }

  return (
    <Tab.Navigator
      initialRouteName={INITIAL_TAB}
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      {/* Tab 1: Supplies ─────────────────────────────────────────────────── */}
      <Tab.Screen name="Supplies">
        {() => (
          <SuppliesScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Tab.Screen>

      {/* Tab 2: Expenses ─────────────────────────────────────────────────── */}
      <Tab.Screen name="Expenses">
        {() => (
          <ExpensesScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Tab.Screen>

      {/* Tab 3: Home (center) — dashboard + snapshot-population ─────────── */}
      {/* v2: HomeTabScreen owns the full snapshot-population path (§3 build risk).
          LangToggle + gear ⚙ now on HomeTabScreen top bar (moved from Calendar §3.2).
          DoctorReport entry row at bottom (spec §3.3). */}
      <Tab.Screen name="Home">
        {({ navigation: tabNavigation }) => (
          <HomeTabScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onLogout={handleLogout}
            onNeedsProfile={() =>
              navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] })
            }
            onBirthEvent={(profileVersion) =>
              navigation.navigate('BirthEvent', { profileVersion })
            }
            onSuggestions={() => navigation.navigate('Suggestions')}
            onKickCount={() => navigation.navigate('KickCountHome')}
            onKickCountHistory={() => navigation.navigate('KickCountHistory')}
            onSupplies={() => tabNavigation.navigate('Supplies')}
            onCalendar={() => tabNavigation.navigate('Calendar')}
            onDoctorReport={() => navigation.navigate('DoctorReport')}
          />
        )}
      </Tab.Screen>

      {/* Tab 4: Calendar — CalendarScreen DIRECT (fixes nested ScrollView bug §6B) */}
      {/* v2: CalendarScreen rendered without a wrapper component. The fix for the
          +บันทึกสุขภาพ unreachability bug — CalendarScreen owns its own SafeAreaView +
          ScrollView and must NOT be nested inside another ScrollView (§3A, §6B). */}
      <Tab.Screen name="Calendar">
        {() => (
          <CalendarScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onAddAppointment={() =>
              navigation.navigate('AppointmentForm', {})
            }
            onEditAppointment={(itemId) =>
              navigation.navigate('AppointmentForm', { itemId })
            }
            onAddReminder={() => navigation.navigate('ReminderForm', {})}
            onEditReminder={(reminderId) =>
              navigation.navigate('ReminderForm', { reminderId })
            }
            onAddCapture={(loggedAtDate) =>
              navigation.navigate('Capture', buildAddCaptureParams(loggedAtDate))
            }
          />
        )}
      </Tab.Screen>

      {/* Tab 5: Medication ──────────────────────────────────────────────── */}
      <Tab.Screen name="Medication">
        {() => (
          <MedicationPlanListScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onManageConsents={() => navigation.navigate('ManageConsents')}
            onLogDose={(planId) =>
              navigation.navigate('Capture', buildLogDoseParams(planId))
            }
          />
        )}
      </Tab.Screen>

      {/* Tab 6: Profile — Profile Hub screen (profile-tab-and-hub-ui.md v1.1) ─
       * Owns: profile summary, edit-pregnancy (pregnant-only), download data
       * (ม.30), delete account (ม.33), logout.
       * Receives handleLogout (shared SD-5 teardown runner — PDPA §8.2).
       * onEditPregnancy navigates to ProfileEdit (root-stack screen).
       * onSessionExpired runs full teardown then resets to Welcome (SD-5).
       * onSettings: navigation.navigate('Settings') (§2 feat-profile-header-settings-row).
       * Security: no health data in route params (PDPA SD-9). */}
      <Tab.Screen name="Profile">
        {() => (
          <ProfileHubScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onLogout={handleLogout}
            onSessionExpired={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })
            }
            onEditPregnancy={() => navigation.navigate('ProfileEdit')}
            onSettings={() => navigation.navigate('Settings')}
            onEditPersonalInfo={() => navigation.navigate('ProfileInfoEdit')}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
