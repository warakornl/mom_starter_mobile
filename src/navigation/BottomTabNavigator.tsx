/**
 * BottomTabNavigator — the 6-tab bottom navigation bar.
 *
 * Implements bottom-tab-navigation-design.md v2.1 §1–§8 +
 * profile-tab-and-hub-ui.md v1.1 (6th tab: Profile) +
 * mother-room-build-spec.md §3.4 + §4.1 (Mother's Room re-skin).
 *
 * Tab order (spec §1.1, v3):
 *   1 Supplies  2 Expenses  3 Home  4 Calendar  5 Medication  6 Profile
 *
 * initialRouteName = 'Home' (§10 OQ-NAV-1 — owner decision; was 'Calendar').
 *
 * Custom tab bar (v3 Mother's Room §3.4):
 *   - 56dp content height + safe-area bottom inset (§7.4)
 *   - Background: ivory-100 #FBF6F1 (matches screen surface — NOT white; §4.1)
 *   - Top border: 1px #E8DDD5 (new divider)
 *   - Active indicator: 2dp amber-700 #9A5F0A UNDERLINE below icon (§3.4)
 *     REPLACES v2 moving disc (disc removed in Mother's Room)
 *   - Active icon + label: roselle-900 #4A2230 (12.57:1 AAA on ivory)
 *   - Inactive: roselle-700 #7A3A52 (7.70:1 AAA on ivory)
 *   - Focus ring: amber-600 #B8720E (T.focus.ring.color §8.5)
 *   - Font: Sarabun-SemiBold (§2 Sarabun throughout)
 *   - Full-column tap zone ≥ 44dp (§8.3)
 *   - accessibilityLabel (full name), accessibilityState.selected (§8.2)
 *
 * v3 Mother's Room changes vs v2:
 *   - Disc removed; underline added (§3.4)
 *   - Background ivory → not white (§4.1)
 *   - Font: IBMPlexSans-SemiBold → Sarabun-SemiBold
 *   - Colors: all via TAB_BAR_TOKENS (aligned with T.tab.* tokens)
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
  TabCoinsIcon,
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
import { consumptionMappingStore } from '../autoStockDecrement/consumptionMappingStore';
import { stockDecrementMarkerStore } from '../autoStockDecrement/stockDecrementMarkerStore';

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
  expenses:   TabCoinsIcon,
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

// ─── Custom tab bar (v3 Mother's Room: underline replaces disc; §3.4) ─────────

/**
 * CustomTabBar — 56dp content-height bar with amber-700 underline active indicator.
 *
 * v3 Mother's Room (§3.4):
 *   The moving rose/600 disc is REPLACED by a 2dp amber-700 underline below the
 *   icon. The icon itself is shown directly on ivory-100 in roselle-900 (active)
 *   or roselle-700 (inactive) — no disc background.
 *
 * Underline: positioned just below the icon, 2dp high × full tab column width,
 * amber-700 #9A5F0A (T.tab.active.underline.color).
 */
function CustomTabBar({ state, navigation: tabNav }: BottomTabBarProps): React.JSX.Element {
  const { t } = useT();

  // §8.5 focus ring: track keyboard/switch-control focused tab index.
  // Uses TAB_BAR_TOKENS.focusRingColor (amber-600 #B8720E) for the ring border.
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

          // v3 Mother's Room: icon color = roselle-900 (active) or roselle-700 (inactive)
          // NO disc — icon sits directly on ivory-100 background
          const iconColor = isFocused
            ? TAB_BAR_TOKENS.activeIconColor   // roselle-900 #4A2230
            : TAB_BAR_TOKENS.inactiveColor;    // roselle-700 #7A3A52

          const labelColor = isFocused
            ? TAB_BAR_TOKENS.activeLabelColor  // roselle-900 #4A2230
            : TAB_BAR_TOKENS.inactiveColor;    // roselle-700 #7A3A52

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
              {/* §3.4: amber-700 2dp underline above icon when active (top of tab zone) */}
              {isFocused ? (
                <View
                  style={tabBarStyles.activeUnderline}
                  accessibilityElementsHidden={true}
                  // @ts-ignore
                  importantForAccessibility="no-hide-descendants"
                />
              ) : (
                <View style={tabBarStyles.underlinePlaceholder} />
              )}

              {/* Icon: rendered directly on ivory background (no disc) */}
              {React.createElement(ICON_MAP[config.iconName], { color: iconColor, size: 24 })}

              {/* §8.7 Dynamic Type: numberOfLines={2} allows large text to wrap cleanly.
               * "ค่าใช้จ่าย" wraps to two lines at 13pt (§7.5, §8.7). */}
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
    backgroundColor: TAB_BAR_TOKENS.background,  // ivory-100 #FBF6F1 (§4.1)
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TAB_BAR_TOKENS.borderColor,   // #E8DDD5 (§1.3 divider)
  },
  container: {
    flexDirection: 'row',
    // §8.7 Dynamic Type: paddingVertical replaces fixed height: 56 so the bar
    // can grow when the OS text size is increased. minHeight preserves 56dp floor.
    minHeight: TAB_BAR_TOKENS.contentHeight,
    paddingVertical: 4,
    backgroundColor: TAB_BAR_TOKENS.background,  // ivory-100 #FBF6F1
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',  // v3: top-align so underline sits at top
    minHeight: 44,                 // §8.3: ≥44dp touch target
    paddingBottom: 4,
    paddingTop: 0,                 // underline at very top of tab zone
  },
  // §8.5: visible focus ring for keyboard / switch-control navigation.
  // v3: uses TAB_BAR_TOKENS.focusRingColor (amber-600 #B8720E; was honey/700).
  tabItemFocused: {
    borderWidth: 2,
    borderColor: TAB_BAR_TOKENS.focusRingColor,  // amber-600 #B8720E
    borderRadius: 10,
  },
  label: {
    fontFamily: 'Sarabun-SemiBold',  // v3: Sarabun (was IBMPlexSans-SemiBold; §2)
    // §7.5 floor: min 12pt. Settled at 13pt — fits "หน้าหลัก" on one line.
    // Thai line-height: 13 × 1.6 = 20.8 → 21sp (Thai stacked mark rule §0 R2).
    // Tab labels are very short (≤4 chars TH); 17sp lineHeight is acceptable here
    // since they're labels, not body copy.
    fontSize: 13,
    lineHeight: 17,
    marginTop: 2,
    textAlign: 'center',
    flexShrink: 1,  // §8.7: allow text to shrink / wrap with Dynamic Type
  },
  // §3.4: amber-700 2dp underline below icon — REPLACES disc
  activeUnderline: {
    width: '80%',                                      // covers most of tab column width
    height: TAB_BAR_TOKENS.activeUnderlineHeight,      // 2dp
    backgroundColor: TAB_BAR_TOKENS.activeUnderlineColor, // amber-700 #9A5F0A
    borderRadius: 1,                                   // slight rounding
    marginBottom: 4,                                   // 4dp gap between underline and icon
  },
  // Placeholder for inactive tabs (same height as underline to keep icon positions aligned)
  underlinePlaceholder: {
    width: '80%',
    height: TAB_BAR_TOKENS.activeUnderlineHeight,      // 2dp — same as underline
    backgroundColor: 'transparent',
    marginBottom: 4,
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
      resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
      resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
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
            onAutoDecrementSettings={() => navigation.navigate('AutoDecrementSettings')}
            onFeedingLog={() => navigation.navigate('FeedingLog')}
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

      {/* Tab 3: Home — dashboard + snapshot-population ────────────────────── */}
      {/* v3 Mother's Room: WeeklyMilestoneSheet is now owned by HomeTabScreen (§4.2 + §4.3).
          Sheet state and isLoss are managed inside HomeTabScreen so isLoss is threaded in.
          Week-zone tap → sheet open; sheet CTA → onCapture (CaptureScreen). */}
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
            onSupplies={() => tabNavigation.navigate('Supplies')}
            onCalendar={() => tabNavigation.navigate('Calendar')}
            onDoctorReport={() => navigation.navigate('DoctorReport')}
            onCapture={() => navigation.navigate('Capture', { loggedAtDate: undefined })}
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
            lifecycle={snapshot?.lifecycle}
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
       * onPregnancySummary: navigate('PregnancySummary') — B1 fix; params=undefined (SD-9).
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
            onPregnancySummary={() => navigation.navigate('PregnancySummary')}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
