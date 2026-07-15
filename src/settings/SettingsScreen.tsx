/**
 * SettingsScreen — language and consent-management only.
 *
 * After Step-3 migration (profile-tab-and-hub-ui.md §5.3):
 *   Logout, download-data, delete-account, and edit-pregnancy rows now live in
 *   ProfileHubScreen (tab 6).  Settings renders exactly two sections:
 *   - ทั่วไป: language toggle (ภาษาไทย ↔ English)
 *   - ความเป็นส่วนตัว: Manage consent → ManageConsentsScreen (when onManageConsent
 *     prop is provided)
 *
 * Props carried for backwards-compat with RootNavigator wiring but unused here:
 *   tokenStorage, onLogout, apiBaseUrl, onSessionExpired,
 *   profileLifecycle, onEditPregnancy.
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
import { T } from '../theme/tokens';

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
   * Navigate to CalendarSyncSettingsScreen (CS-4).
   * Optional — no-op / row hidden if not provided (keeps existing tests green).
   * SD-9: no health data passed — screen fetches on mount.
   */
  onCalendarSync?: () => void;
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
  onCalendarSync,
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
        {(onManageConsent || onCalendarSync) && (
          <Text style={styles.sectionLabel}>{t('settings.privacy')}</Text>
        )}

        {/* Calendar Sync row — CS-4 entry point (calendar-sync-ui.md §3.1) */}
        {/* mobile-reviewer 🟡 (cluster 6 review): title + a11y label/hint are
         * hardcoded Thai, bypassing i18n (no English translation, ever).
         * REPORTED — needs catalog keys 'settings.calendarSync.title'
         * ('ซิงก์ปฏิทินในเครื่อง' / 'Sync calendar on device'),
         * 'settings.calendarSync.a11yLabel' (same string, reusable), and
         * 'settings.calendarSync.a11yHint' ('เปิดการตั้งค่าปฏิทิน' / 'Opens
         * calendar settings'). Left as literals here (cannot edit
         * messages.ts — shared file) until those keys land. */}
        {onCalendarSync && (
          <TouchableOpacity
            testID="settings-calendar-sync-btn"
            style={styles.menuRow}
            onPress={onCalendarSync}
            accessibilityRole="button"
            accessibilityLabel="ซิงก์ปฏิทินในเครื่อง"
            accessibilityHint="เปิดการตั้งค่าปฏิทิน"
          >
            <View style={styles.menuRowTextGroup}>
              <Text style={styles.menuRowText}>ซิงก์ปฏิทินในเครื่อง</Text>
            </View>
            <Text style={styles.menuRowChevron}>›</Text>
          </TouchableOpacity>
        )}

        {onManageConsent && (
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
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// ห้องแม่ Phase 2 B4: all token references migrated to semantic T.* namespace.

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    letterSpacing: T.type.label.letterSpacing,
    color: T.color.text.botanical,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 16,
  },

  // ── Shared menu row ─────────────────────────────────────────────────────────
  menuRow: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  menuRowTextGroup: {
    flex: 1,
  },
  // mobile-reviewer fix (cluster 6 review): was missing fontFamily (fell back
  // to system font, no Thai-capable Sarabun guarantee).
  menuRowText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.heading,
    fontWeight: '500',
  },
  menuRowSubtext: {
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    marginTop: 2,
  },
  menuRowChevron: {
    fontSize: 18,
    color: T.color.text.primary,
    marginLeft: 8,
  },

  // ── unused but kept for type-compatibility with existing test mocks ──────
  menuRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: T.radius.sm,
    backgroundColor: T.color.surface.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuRowIconText: {
    fontSize: 16,
    color: T.color.text.primary,
  },
});
