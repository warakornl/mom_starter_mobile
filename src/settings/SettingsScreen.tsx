/**
 * SettingsScreen — the account/settings menu.
 *
 * Logout lives HERE (not on Home) so it is two levels deep (Home ⚙ → Settings →
 * ออกจากระบบ → confirm) and cannot be triggered by accident. It reuses the shared
 * performLogout runner so the same PDPA health-store clearing (1.1 appsec) applies.
 *
 * Future home for: language, account management, consent, widget picker.
 */

import React from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n/LanguageContext';
import type { TokenStorage } from '../auth/tokenStorage';
import { performLogout } from '../auth/performLogout';
import { supplySyncStore } from '../sync/supplySyncStore';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { clearDraft } from '../kickCount/kickCountDraftStore';

interface SettingsScreenProps {
  /** Shared secure token storage — cleared on logout. */
  tokenStorage: TokenStorage;
  /** Runs after logout completes — navigate to the unauthenticated entry (Welcome). */
  onLogout: () => void;
}

export function SettingsScreen({ tokenStorage, onLogout }: SettingsScreenProps): React.JSX.Element {
  const { t } = useT();

  async function handleLogout(): Promise<void> {
    await performLogout({
      clearTokens: () => tokenStorage.clear(),
      resetSupplyStore: () => supplySyncStore.reset(),
      resetKickCountStore: () => kickCountSyncStore.reset(),
      resetCalendarStore: () => calendarSyncStore.reset(),
      clearKickCountDraft: () => clearDraft(),
      onComplete: onLogout,
    });
  }

  function confirmLogout(): void {
    Alert.alert(
      t('home.logoutTitle'),
      t('home.logoutMessage'),
      [
        { text: t('home.logoutCancel'), style: 'cancel' },
        {
          text: t('home.logoutConfirm'),
          style: 'destructive',
          onPress: () => void handleLogout(),
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} testID="settings-screen">
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>{t('settings.account')}</Text>

        {/* Logout — de-emphasized, red, at the bottom of the account section. */}
        <TouchableOpacity
          style={styles.logoutRow}
          onPress={confirmLogout}
          accessibilityRole="button"
          accessibilityLabel={t('home.logout')}
          testID="settings-logout"
        >
          <Text style={styles.logoutText}>{t('home.logout')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#9B9B9B',
    marginBottom: 8,
    marginLeft: 4,
  },
  logoutRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 52,
    justifyContent: 'center',
  },
  logoutText: {
    color: '#9B1C35', // rose/700 — destructive
    fontSize: 16,
    fontWeight: '500',
  },
});
