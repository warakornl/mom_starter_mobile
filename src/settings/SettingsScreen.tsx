/**
 * SettingsScreen — the account/settings menu.
 *
 * STEP 0 REFACTOR (profile-tab-and-hub-ui.md §5.3):
 *   The ~250 lines of export/delete orchestration previously in this file have
 *   been extracted into `useAccountRights` (src/accountRights/useAccountRights.ts).
 *   This component now CONSUMES that hook. Behavior is IDENTICAL to the pre-refactor
 *   version — all export/delete/logout/session-expired paths are unchanged.
 *
 * POST-MIGRATION (Step 3):
 *   Logout, download-data, delete-account, and edit-pregnancy rows have been
 *   moved to ProfileHubScreen (tab 6). Settings now only contains:
 *   - Language toggle (ทั่วไป section)
 *   - Manage consent → ManageConsentsScreen (ความเป็นส่วนตัว section)
 *
 * PDPA: tokenStorage.load() is called only at action time. No PII in logs.
 */

import React from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n/LanguageContext';
import type { TokenStorage } from '../auth/tokenStorage';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SettingsScreenProps {
  /** Shared secure token storage — cleared on logout. */
  tokenStorage: TokenStorage;
  /** Runs after logout completes — navigate to the unauthenticated entry (Welcome). */
  onLogout: () => void;
  /**
   * Navigate to ManageConsentsScreen (S8).
   * Optional — no-op if not provided (so existing tests do not break).
   */
  onManageConsent?: () => void;
  /**
   * API base URL — kept for backwards-compat with RootNavigator wiring.
   * Not used in Settings after migration (download/delete moved to ProfileHub).
   */
  apiBaseUrl?: string;
  /**
   * Called when a 401 is encountered (for backwards-compat with RootNavigator).
   * Not used in Settings after migration (export/delete moved to ProfileHub).
   */
  onSessionExpired?: () => void;
  /**
   * AC-2 — lifecycle gate for edit-pregnancy row (now in ProfileHub).
   * Kept for backwards-compat. Not rendered in Settings post-migration.
   */
  profileLifecycle?: import('../pregnancy/types').Lifecycle | null;
  /**
   * Navigate to ProfileEditScreen.
   * Kept for backwards-compat. Not rendered in Settings post-migration.
   */
  onEditPregnancy?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsScreen({
  onManageConsent,
}: SettingsScreenProps): React.JSX.Element {
  const { t, locale, setLocale } = useT();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} testID="settings-screen">
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* ── General section — language selector ─────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.general')}</Text>
        <TouchableOpacity
          testID="settings-language-btn"
          style={styles.menuRow}
          onPress={() => setLocale(locale === 'th' ? 'en' : 'th')}
          accessibilityRole="button"
          accessibilityLabel={
            locale === 'th'
              ? 'ภาษา / Language — ตอนนี้ภาษาไทย · กดเพื่อเปลี่ยนเป็น English'
              : 'ภาษา / Language — currently English · tap to switch to ไทย'
          }
        >
          <View style={styles.menuRowTextGroup}>
            <Text style={styles.menuRowText}>{t('settings.language')}</Text>
          </View>
          <Text style={styles.menuRowChevron}>
            {locale === 'th' ? t('settings.languageValueTh') : t('settings.languageValueEn')}
          </Text>
        </TouchableOpacity>

        {/* ── Privacy & Consent section ─────────────────────────────────────── */}
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
              <View style={styles.menuRowTextGroup}>
                <Text style={styles.menuRowText}>{t('consent.settings.manage_btn')}</Text>
              </View>
              <Text style={styles.menuRowChevron}>›</Text>
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const INK = '#3A2A30';
const INK_SOFT = '#5F4A52';
const INK_FAINT = '#94818A';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontSize: 13,
    color: INK_FAINT,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 16,
  },

  // ── Shared menu row ─────────────────────────────────────────────────────────
  menuRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    elevation: 1,
    shadowColor: INK,
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  menuRowTextGroup: {
    flex: 1,
  },
  menuRowText: {
    fontSize: 16,
    color: INK,
    fontWeight: '500',
  },
  menuRowSubtext: {
    fontSize: 13,
    color: INK_FAINT,
    marginTop: 2,
  },
  menuRowChevron: {
    fontSize: 18,
    color: INK_FAINT,
    marginLeft: 8,
  },

  // ── unused but kept for type-compatibility with existing test mocks ──────
  menuRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FFF0F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuRowIconText: {
    fontSize: 16,
    color: INK_SOFT,
  },
});
