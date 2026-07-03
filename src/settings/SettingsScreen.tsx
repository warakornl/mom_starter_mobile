/**
 * SettingsScreen — the account/settings menu.
 *
 * Logout lives HERE (not on Home) so it is two levels deep (Home ⚙ → Settings →
 * ออกจากระบบ → confirm) and cannot be triggered by accident. It reuses the shared
 * performLogout runner so the same PDPA health-store clearing (1.1 appsec) applies.
 *
 * PDPA entry point: "Manage Permissions" button navigates to ManageConsentsScreen (S8)
 * where users can review, grant, or withdraw any of the 6 consent types (ม.19 —
 * withdrawal is as easy as granting).
 *
 * Future home for: language, account management, widget picker.
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
import { consentStore } from '../consent/consentStore';
import { resetConsentQueue } from '../consent/consentSync';
import { suggestionStore } from '../suggestion/suggestionStore';

interface SettingsScreenProps {
  /** Shared secure token storage — cleared on logout. */
  tokenStorage: TokenStorage;
  /** Runs after logout completes — navigate to the unauthenticated entry (Welcome). */
  onLogout: () => void;
  /**
   * Navigate to ManageConsentsScreen (S8) so the user can review, grant, or
   * withdraw any of the 6 PDPA consent types (ม.19 compliance).
   * Optional — no-op if not provided (so existing tests do not break).
   */
  onManageConsent?: () => void;
}

export function SettingsScreen({ tokenStorage, onLogout, onManageConsent }: SettingsScreenProps): React.JSX.Element {
  const { t } = useT();

  async function handleLogout(): Promise<void> {
    await performLogout({
      clearTokens: () => tokenStorage.clear(),
      resetSupplyStore: () => supplySyncStore.reset(),
      resetKickCountStore: () => kickCountSyncStore.reset(),
      resetCalendarStore: () => calendarSyncStore.reset(),
      resetConsentStore: () => consentStore.reset(),
      resetConsentQueue: () => resetConsentQueue(),
      resetSuggestionStore: () => suggestionStore.reset(),
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
        {/* ── Privacy & Consent (routes to S8 ManageConsentsScreen — full grant + withdrawal) ── */}
        {onManageConsent && (
          <>
            <Text style={styles.sectionLabel}>{t('settings.privacy')}</Text>
            <TouchableOpacity
              testID="settings-manage-consent-btn"
              style={styles.menuRow}
              onPress={onManageConsent}
              accessibilityRole="button"
              accessibilityLabel={t('consent.settings.manage_btn')}
            >
              <Text style={styles.menuRowText}>{t('consent.settings.manage_btn')}</Text>
              <Text style={styles.menuRowChevron}>›</Text>
            </TouchableOpacity>
          </>
        )}

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

  // Consent "Manage Permissions" row
  menuRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  menuRowText: {
    fontSize: 16,
    color: '#3A2A30', // ink
  },
  menuRowChevron: {
    fontSize: 18,
    color: '#94818A', // ink/faint
  },
});
