/**
 * BottomTabNavigator — the 5-tab bottom navigation bar.
 *
 * Implements bottom-tab-navigation-design.md §1–§8.
 *
 * Tab order (spec §1.1):
 *   1 Supplies  2 Expenses  3 Calendar (center)  4 Report  5 Medication
 *
 * initialRouteName = 'Calendar' (§10 OQ-NAV-1 — owner decision).
 *
 * Custom tab bar (CustomTabBar):
 *   - 56dp content height + safe-area bottom inset (§7.4)
 *   - Background: surface/page #FFFFFF, 1px hairline #EBE1D9 top border
 *   - Center tab: 52×52dp rose/600 (#A8505A) filled disc, white icon (§2.1)
 *   - Active (non-center): rose/600 icon, rose/700 label
 *   - Inactive: ink/soft #5F4A52 for icon and label
 *   - Full-column tap zone ≥ 44dp (§8.3)
 *   - accessibilityLabel (full name), accessibilityState.selected (§8.2)
 *
 * ProfileSnapshot lifting:
 *   The profileSnapshot is hosted in PregnancyProfileContext ABOVE this navigator.
 *   CalendarTabScreen updates it via useProfileSnapshotSetter().
 *   Other tab screens that need the snapshot (DoctorPdfScreen, MedicationPlanListScreen
 *   for consent) read it via useProfileSnapshot().
 *
 * Navigation wiring:
 *   All callbacks that push root-stack screens (Settings, KickCountHome,
 *   BirthEvent, etc.) are wired here using the `navigation` prop that this
 *   component receives from the root stack (Stack.Screen render-prop).
 *
 * Security: no health data in route params (PDPA SD-9).
 */

import React from 'react';
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
import { useT } from '../i18n/LanguageContext';
import { localCivilToday } from '../pregnancy/gestationalAge';

import { CalendarTabScreen } from '../screens/CalendarTabScreen';
import { SuppliesScreen } from '../supplies/SuppliesScreen';
import { ExpensesScreen } from '../expenses/ExpensesScreen';
import { DoctorPdfScreen } from '../pdfReport/DoctorPdfScreen';
import { MedicationPlanListScreen } from '../medication/MedicationPlanListScreen';
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

// ─── Tab param list ───────────────────────────────────────────────────────────

export type TabParamList = {
  Supplies: undefined;
  Expenses: undefined;
  Calendar: undefined;
  Report: undefined;
  Medication: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BottomTabNavigatorProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Root stack navigation — used to push non-tab screens over the tabs. */
  navigation: NativeStackNavigationProp<RootStackParamList>;
}

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function CustomTabBar({ state, navigation: tabNav }: BottomTabBarProps): React.JSX.Element {
  const { t } = useT();

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
          const isCenter = config.isCenter;

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

          const iconColor = isCenter
            ? TAB_BAR_TOKENS.centerIconColor
            : isFocused
              ? TAB_BAR_TOKENS.activeColor
              : TAB_BAR_TOKENS.inactiveColor;

          const labelColor = isFocused
            ? TAB_BAR_TOKENS.activeLabelColor
            : TAB_BAR_TOKENS.inactiveColor;

          return (
            <TouchableOpacity
              key={route.key}
              style={tabBarStyles.tabItem}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              accessibilityState={{ selected: isFocused }}
              activeOpacity={0.7}
            >
              {isCenter ? (
                // Center tab: 52×52dp rose/600 disc with white icon (spec §2.1)
                <View style={tabBarStyles.centerDisc}>
                  <Text style={[tabBarStyles.icon, { color: iconColor }]}>
                    {config.iconGlyph}
                  </Text>
                </View>
              ) : (
                <Text style={[tabBarStyles.icon, { color: iconColor }]}>
                  {config.iconGlyph}
                </Text>
              )}
              <Text style={[tabBarStyles.label, { color: labelColor }]}>
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
    height: TAB_BAR_TOKENS.contentHeight,
    backgroundColor: TAB_BAR_TOKENS.background,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // §8.3: ≥44dp touch target
    paddingBottom: 4,
  },
  icon: {
    fontSize: 20,
    lineHeight: 24,
  },
  label: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  // Center tab: 52×52dp rose/600 filled disc (spec §2.1)
  centerDisc: {
    width: TAB_BAR_TOKENS.centerDiscSize,
    height: TAB_BAR_TOKENS.centerDiscSize,
    borderRadius: TAB_BAR_TOKENS.centerDiscRadius,
    backgroundColor: TAB_BAR_TOKENS.centerDiscColor,
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
  // Profile snapshot from context (populated by CalendarTabScreen after GET profile)
  const snapshot = useProfileSnapshot();
  const kickProps = snapshot ?? {
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

      {/* Tab 3: Calendar (center) — dashboard + calendar grid ─────────────── */}
      <Tab.Screen name="Calendar">
        {({ navigation: tabNavigation }) => (
          <CalendarTabScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onLogout={handleLogout}
            onNeedsProfile={() =>
              navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] })
            }
            onBirthEvent={(profileVersion) =>
              navigation.navigate('BirthEvent', { profileVersion })
            }
            onSettings={() => navigation.navigate('Settings')}
            onSuggestions={() => navigation.navigate('Suggestions')}
            onKickCount={() => navigation.navigate('KickCountHome')}
            onKickCountHistory={() => navigation.navigate('KickCountHistory')}
            onSupplies={() => tabNavigation.navigate('Supplies')}
            onCalendar={() => tabNavigation.navigate('Calendar')}
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

      {/* Tab 4: Report (DoctorPdf) ──────────────────────────────────────── */}
      {/* EDD loading guard: only pass real EDD once the Calendar GET has resolved
          and written a snapshot into PregnancyProfileContext. Before that, show a
          loading placeholder so DoctorPdfScreen never receives the bogus '2999-12-31'
          sentinel that was previously injected when snapshot === null (reviewer §report-edd-guard). */}
      <Tab.Screen name="Report">
        {() =>
          snapshot !== null ? (
            <DoctorPdfScreen
              tokenStorage={tokenStorage}
              apiBaseUrl={apiBaseUrl}
              profile={{
                edd: snapshot.edd,
                gestationalWeek: snapshot.gestationalWeek,
                lifecycle: snapshot.lifecycle,
              }}
              // In tab context onBack is a no-op (no stack to go back in)
              onBack={() => {}}
            />
          ) : (
            <View style={reportLoadingStyles.container}>
              <Text style={reportLoadingStyles.text}>กำลังโหลด…</Text>
            </View>
          )
        }
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
    </Tab.Navigator>
  );
}

// ─── Report loading placeholder styles ────────────────────────────────────────

const reportLoadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBF6F1',
  },
  text: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#94818A',
  },
});
