/**
 * ProfileHubScreen — the 6th tab screen (Profile Hub).
 *
 * Implements profile-tab-and-hub-ui.md v1.1 §3–§10.
 *
 * IA (§3.2):
 *   - Profile Summary Card (always visible — §3.3)
 *   - SECTION โปรไฟล์: Edit pregnancy (pregnant lifecycle only — §3.4)
 *   - SECTION บัญชีและข้อมูล: Download data (ม.30) + Delete account (ม.33)
 *   - SECTION บัญชี: Log out (always — §3.6)
 *
 * Security:
 *   - Logout uses the SHARED handleLogout from BottomTabNavigator (SD-5 teardown).
 *     ProfileHubScreen MUST NOT maintain its own store-clear list (§8.2).
 *   - Export/delete driven by useAccountRights hook (single reviewed implementation).
 *   - No health data in route params (PDPA SD-9).
 *   - profile.logout.message (consequence statement) used for confirm dialog — NOT
 *     home.logoutMessage (yes/no question) (§3.6 binding requirement).
 *
 * Label fit decision (§2.2):
 *   Tested "โปรไฟล์" and "ค่าใช้จ่าย" at 13pt IBMPlexSans-SemiBold in 65dp column.
 *   Both render without clipping (≈40pt each at 13pt font). 13pt retained.
 *   numberOfLines={2} fallback handles extreme OS font scale (§2.2 decision tree).
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT } from '../i18n/LanguageContext';
import type { TokenStorage } from '../auth/tokenStorage';
import { useProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import { useAccountRights } from '../accountRights/useAccountRights';
import { DeleteAccountSheet } from '../accountRights/DeleteAccountSheet';
import { PROFILE_HUB_TESTIDS } from './profileHubTestIds';
import { formatCivilDate } from '../i18n/messages';
import type { Locale } from '../auth/types';
import { buildPostpartumSummaryText, buildLogoutAlertConfig } from './profileHubSummary';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProfileHubScreenProps {
  tokenStorage: TokenStorage;
  /**
   * API base URL — required for export + delete API calls.
   * When absent, download/delete rows are hidden (showAccountRightsRows = false).
   */
  apiBaseUrl?: string;
  /**
   * SHARED logout runner from BottomTabNavigator (SD-5 full teardown).
   * Must NOT be re-implemented here — passes the same handleLogout used by Home tab.
   */
  onLogout: () => void;
  /**
   * Session-expired navigation callback (SD-5).
   * Optional — falls back to onLogout.
   */
  onSessionExpired?: () => void;
  /**
   * Navigate to ProfileEditScreen (root-stack push).
   * ProfileEdit is registered in RootNavigator — navigation.navigate('ProfileEdit').
   * Only called when the edit-pregnancy row is shown (lifecycle=pregnant).
   */
  onEditPregnancy: () => void;
  /**
   * Navigate to SettingsScreen (root-stack push via navigation.navigate('Settings')).
   * Wired from BottomTabNavigator the same way Home's onSettings is wired (§2
   * feat-profile-header-settings-row). Optional — row hidden when not provided.
   */
  onSettings?: () => void;
}

// ─── Profile Summary Card ─────────────────────────────────────────────────────

interface SummaryCardProps {
  loading: string; // a11y label for skeleton
}

function SummaryCardSkeleton({ loading }: SummaryCardProps): React.JSX.Element {
  return (
    <View
      style={styles.summaryCard}
      accessibilityRole="none"
      accessibilityLabel={loading}
      testID={PROFILE_HUB_TESTIDS.summaryCard}
    >
      <View style={styles.skeletonBone1} />
      <View style={styles.skeletonBone2} />
      <View style={styles.skeletonBone3} />
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfileHubScreen({
  tokenStorage,
  apiBaseUrl,
  onLogout,
  onSessionExpired,
  onEditPregnancy,
  onSettings,
}: ProfileHubScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const snapshot = useProfileSnapshot();

  const accountRights = useAccountRights({
    tokenStorage,
    apiBaseUrl,
    onLogout,
    onSessionExpired,
  });

  // ── Logout confirm dialog (§3.6, §10.4) ─────────────────────────────────────
  // Uses buildLogoutAlertConfig (pure, tested) — which enforces profile.logout.message
  // (consequence statement) and binds onPress directly to the injected onLogout.
  // See §3.6 binding requirement.
  function confirmLogout(): void {
    Alert.alert(...buildLogoutAlertConfig(t, onLogout));
  }

  // ── Lifecycle gating ─────────────────────────────────────────────────────────
  const isPregnant = snapshot?.lifecycle === 'pregnant';
  const isPostpartum = snapshot?.lifecycle === 'postpartum';

  // ── Profile Summary Card content ─────────────────────────────────────────────
  function renderSummaryCard(): React.JSX.Element {
    if (snapshot === null) {
      return <SummaryCardSkeleton loading={t('profile.loading')} />;
    }

    let badgeText = '';
    let badgeStyle = styles.badgePregnant;
    let badgeTextStyle = styles.badgePregnantText;
    let mainText = '';
    let subText: string | null = null;

    if (isPregnant) {
      badgeText = 'ตั้งครรภ์';
      badgeStyle = styles.badgePregnant;
      badgeTextStyle = styles.badgePregnantText;
      mainText = `สัปดาห์ที่ ${snapshot.gestationalWeek}`;
      if (snapshot.edd) {
        subText = `กำหนดคลอด ${formatCivilDate(snapshot.edd, locale as Locale)}`;
      }
    } else if (isPostpartum) {
      badgeText = 'หลังคลอด';
      badgeStyle = styles.badgePostpartum;
      badgeTextStyle = styles.badgePostpartumText;
      // Spec §3.3/§10.2: use computePostpartumAge via buildPostpartumSummaryText
      // so day count is byte-identical to server and HomeTabScreen.
      // snapshot.birthDate is populated by calendarTabSnapshotBuilder from profile.birthDate.
      mainText = buildPostpartumSummaryText(snapshot.birthDate, snapshot.todayCivil, t);
    } else {
      // Unknown lifecycle or snapshot with no recognized lifecycle
      mainText = t('profile.summary.fallbackName');
    }

    return (
      <View
        style={styles.summaryCard}
        accessibilityRole="none"
        testID={PROFILE_HUB_TESTIDS.summaryCard}
      >
        {badgeText ? (
          <View style={[styles.badge, badgeStyle]}>
            <Text style={[styles.badgeText, badgeTextStyle]}>{badgeText}</Text>
          </View>
        ) : null}
        <Text style={styles.summaryMainText}>{mainText}</Text>
        {subText ? (
          <Text style={styles.summarySubText}>{subText}</Text>
        ) : null}
      </View>
    );
  }

  // ── Account rights derived values (from hook) ─────────────────────────────
  const {
    exportPhase,
    exportErrorMsg,
    isExportInProgress,
    showAccountRightsRows,
    handleExportRowTap,
    handleExportRetry,
    handleExportDismiss,
    handleExport404Back,
    deleteSheetVisible,
    stepUpDegraded,
    deleteInFlight,
    deleteError,
    confirmInput,
    setConfirmInput,
    handleDeleteRowTap,
    handleSheetCancel,
    handleNudgeDownloadTap,
    handleNudgeSkipTap,
    handleConfirmTap,
    handleDeleteRetry,
    locale: arLocale,
  } = accountRights;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID={PROFILE_HUB_TESTIDS.screen}>
      {/* ── Inline header bar (§1 feat-profile-header-settings-row) ─────────── */}
      {/* Tab screen: no react-navigation header (MainTabs has headerShown:false).
          Modelled on HomeTabScreen topBar pattern + RootNavigator header tokens.
          accessibilityRole="header" marks the title for screen readers (a11y §1). */}
      <View style={styles.headerBar}>
        <Text
          style={styles.headerTitle}
          testID={PROFILE_HUB_TESTIDS.screenHeader}
          accessibilityRole="header"
        >
          {t('profile.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* ── Profile Summary Card ──────────────────────────────────────────── */}
        {renderSummaryCard()}

        {/* ── SECTION: โปรไฟล์ — Edit pregnancy (pregnant-only, §3.4) ──────── */}
        {/* OQ-PROFILE-2: hide entire section when not pregnant (§12) */}
        {isPregnant && (
          <>
            <Text style={styles.sectionLabel}>{t('profile.section.profile')}</Text>
            <TouchableOpacity
              testID={PROFILE_HUB_TESTIDS.editPregnancyBtn}
              style={styles.menuRow}
              onPress={onEditPregnancy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.editPregnancy')}
            >
              <View style={styles.menuRowIconWrap}>
                <Text style={styles.menuRowIconText} accessibilityElementsHidden>
                  {'✎'}
                </Text>
              </View>
              <View style={styles.menuRowTextGroup}>
                <Text style={styles.menuRowText}>{t('settings.editPregnancy')}</Text>
                <Text style={styles.menuRowSubtext}>{t('profile.editPregnancy.subtitle')}</Text>
              </View>
              <Text style={styles.menuRowChevron}>{'›'}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── SECTION: บัญชีและข้อมูล — Account rights (§3.5) ─────────────── */}
        {showAccountRightsRows && (
          <Text style={styles.sectionLabel}>{t('profile.section.accountData')}</Text>
        )}

        {/* Download my data row (§3.5) */}
        {showAccountRightsRows && exportPhase !== 'EXPORT_UNAVAILABLE_404' && (
          <TouchableOpacity
            testID={PROFILE_HUB_TESTIDS.downloadDataBtn}
            style={[
              styles.menuRow,
              isExportInProgress && styles.menuRowInProgress,
            ]}
            onPress={handleExportRowTap}
            disabled={isExportInProgress}
            accessibilityRole="button"
            accessibilityLabel={
              isExportInProgress
                ? (locale === 'th' ? 'กำลังเตรียมไฟล์ข้อมูล' : 'Preparing your data file')
                : t('profile.downloadData.label')
            }
            accessibilityLiveRegion={isExportInProgress ? 'polite' : 'none'}
          >
            <View style={styles.menuRowIconWrap}>
              <Text style={styles.menuRowIconText} accessibilityElementsHidden>
                {'↓'}
              </Text>
            </View>
            <View style={styles.menuRowTextGroup}>
              <Text style={styles.menuRowText}>{t('profile.downloadData.label')}</Text>
              <Text style={styles.menuRowSubtext}>
                {isExportInProgress
                  ? t('accountRights.export.inProgress')
                  : t('profile.downloadData.subtitle')}
              </Text>
            </View>
            {isExportInProgress ? (
              <ActivityIndicator
                size="small"
                color="#9B1C35"
                testID={PROFILE_HUB_TESTIDS.downloadSpinner}
                accessibilityElementsHidden
              />
            ) : (
              <Text style={styles.menuRowChevron}>›</Text>
            )}
          </TouchableOpacity>
        )}

        {/* EXPORT_ERROR card */}
        {showAccountRightsRows && exportPhase === 'EXPORT_ERROR' && (
          <View
            testID={PROFILE_HUB_TESTIDS.exportErrorCard}
            style={styles.exportErrorCard}
            accessibilityLiveRegion="polite"
            accessibilityRole="none"
          >
            <Text style={styles.exportErrorTitle}>{t('accountRights.export.errorTitle')}</Text>
            <Text style={styles.exportErrorBody}>{t('accountRights.export.errorBody')}</Text>
            <View style={styles.exportErrorActions}>
              <TouchableOpacity
                testID={PROFILE_HUB_TESTIDS.exportRetryBtn}
                style={styles.exportRetryBtn}
                onPress={handleExportRetry}
                accessibilityRole="button"
                accessibilityLabel={t('accountRights.export.retry')}
              >
                <Text style={styles.exportRetryBtnLabel}>{t('accountRights.export.retry')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID={PROFILE_HUB_TESTIDS.exportDismissBtn}
                style={styles.exportDismissBtn}
                onPress={handleExportDismiss}
                accessibilityRole="button"
                accessibilityLabel={t('accountRights.export.dismiss')}
              >
                <Text style={styles.exportDismissBtnLabel}>{t('accountRights.export.dismiss')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* EXPORT_UNAVAILABLE_404 notice */}
        {showAccountRightsRows && exportPhase === 'EXPORT_UNAVAILABLE_404' && (
          <View
            testID={PROFILE_HUB_TESTIDS.export404Notice}
            style={styles.export404Card}
            accessibilityLiveRegion="polite"
            accessibilityRole="none"
          >
            <Text style={styles.export404Title}>{t('accountRights.export.notAvailableTitle')}</Text>
            <TouchableOpacity
              testID={PROFILE_HUB_TESTIDS.export404BackBtn}
              style={styles.export404BackBtn}
              onPress={handleExport404Back}
              accessibilityRole="button"
              accessibilityLabel={t('accountRights.export.backToSettings')}
            >
              <Text style={styles.export404BackBtnLabel}>{t('accountRights.export.backToSettings')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Delete account row (§3.5) */}
        {showAccountRightsRows && (
          <TouchableOpacity
            testID={PROFILE_HUB_TESTIDS.deleteAccountBtn}
            style={styles.menuRow}
            onPress={handleDeleteRowTap}
            accessibilityRole="button"
            accessibilityLabel={
              locale === 'th'
                ? 'ลบบัญชีของฉัน, การลบเป็นการถาวรและไม่มีการกู้คืน'
                : 'Delete my account, permanently removes your account with no recovery'
            }
          >
            <View style={styles.deleteRowIconWrap}>
              <Text style={styles.deleteRowIconText} accessibilityElementsHidden>
                {'🗑'}
              </Text>
            </View>
            <View style={styles.menuRowTextGroup}>
              <Text style={[styles.menuRowText, styles.deleteRowLabelText]}>
                {t('profile.deleteAccount.label')}
              </Text>
              <Text style={styles.menuRowSubtext}>
                {t('profile.deleteAccount.subtitle')}
              </Text>
            </View>
            <Text style={styles.deleteRowChevron}>›</Text>
          </TouchableOpacity>
        )}

        {/* ── SECTION: การตั้งค่า — Settings row (§2 feat-profile-header-settings-row) ─
         * Placed above the destructive logout row so Settings is easily reachable
         * from Profile without navigating to the Home tab's gear ⚙.
         * onSettings is optional — row is hidden when not provided
         * (same pattern as onManageConsent in SettingsScreen). */}
        {onSettings != null && (
          <>
            <Text style={styles.sectionLabel}>{t('settings.title')}</Text>
            <TouchableOpacity
              testID={PROFILE_HUB_TESTIDS.settingsBtn}
              style={styles.menuRow}
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel={t('settings.navTitle')}
              accessibilityHint={t('settings.navTitle')}
            >
              <View style={styles.menuRowIconWrap}>
                <Text style={styles.menuRowIconText} accessibilityElementsHidden>
                  {'⚙'}
                </Text>
              </View>
              <View style={styles.menuRowTextGroup}>
                <Text style={styles.menuRowText}>{t('settings.navTitle')}</Text>
              </View>
              <Text style={styles.menuRowChevron}>{'›'}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── SECTION: บัญชี — Log out (always visible, §3.6) ─────────────── */}
        <Text style={styles.sectionLabel}>{t('profile.section.account')}</Text>
        <TouchableOpacity
          style={styles.logoutRow}
          onPress={confirmLogout}
          accessibilityRole="button"
          accessibilityLabel={t('home.logout')}
          testID={PROFILE_HUB_TESTIDS.logout}
        >
          <Text style={styles.logoutText}>{t('home.logout')}</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* ── DeleteAccountSheet (§3.5, §8.3) ──────────────────────────────── */}
      <DeleteAccountSheet
        visible={deleteSheetVisible}
        locale={arLocale}
        confirmInput={confirmInput}
        onConfirmInputChange={setConfirmInput}
        deleteInFlight={deleteInFlight}
        deleteError={deleteError}
        stepUpDegraded={stepUpDegraded}
        onConfirmTap={handleConfirmTap}
        onCancelTap={handleSheetCancel}
        onNudgeDownloadTap={handleNudgeDownloadTap}
        onNudgeSkipTap={handleNudgeSkipTap}
        onRetryTap={handleDeleteRetry}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ROSE_700 = '#8E3A44';
const HONEY_100 = '#FBE9D2';
const HONEY_BORDER = '#E9C097';
const INK = '#3A2A30';
const INK_SOFT = '#5F4A52';
const INK_FAINT = '#94818A';
const SURFACE_PAGE_SUNK = '#F5F0ED';
const HAIRLINE_COLOR = '#EBE1D9';
const ROSE_50 = '#FBEDEE';    // icon background (rose/50)
const SKELETON_COLOR = '#FBF3EE'; // skeleton bone fill

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },

  // ── Inline header bar (§1 feat-profile-header-settings-row) ──────────────────
  // Mirrors RootNavigator headerStyle tokens: bg #FBF6F1, tint #3A2A30 (INK),
  // IBMPlexSans-SemiBold. minHeight ≥ standard header height (44pt iOS, 56dp Android).
  // No back button: Profile is a tab, not a pushed screen.
  headerBar: {
    minHeight: 56,
    backgroundColor: '#FBF6F1',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE_COLOR,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    color: INK,
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },

  // ── Profile Summary Card (§3.3) ─────────────────────────────────────────────
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE_COLOR,
    padding: 16,
    minHeight: 80,
    marginBottom: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 8,
  },
  badgePregnant: {
    backgroundColor: ROSE_50,
  },
  badgePostpartum: {
    backgroundColor: '#EBF2EC', // sage/50
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'IBMPlexSans-SemiBold',
  },
  badgePregnantText: {
    color: ROSE_700, // rose/700
  },
  badgePostpartumText: {
    color: '#3D6647', // sage/700
  },
  summaryMainText: {
    fontSize: 20,
    fontFamily: 'IBMPlexSans-SemiBold',
    color: INK,
    marginBottom: 4,
  },
  summarySubText: {
    fontSize: 14,
    color: INK_SOFT,
  },

  // ── Skeleton bones (loading state §4 State 1) ────────────────────────────────
  skeletonBone1: {
    height: 12,
    width: '50%',
    borderRadius: 8,
    backgroundColor: SKELETON_COLOR,
    marginBottom: 8,
  },
  skeletonBone2: {
    height: 20,
    width: '70%',
    borderRadius: 8,
    backgroundColor: SKELETON_COLOR,
    marginBottom: 8,
  },
  skeletonBone3: {
    height: 12,
    width: '40%',
    borderRadius: 8,
    backgroundColor: SKELETON_COLOR,
  },

  // ── Section labels (§3.2) ────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 13,
    color: INK_FAINT,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 16,
  },

  // ── Shared menu row (§3.2 — same as SettingsScreen menuRow) ─────────────────
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
  menuRowInProgress: {
    backgroundColor: SURFACE_PAGE_SUNK,
  },
  menuRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: ROSE_50,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuRowIconText: {
    fontSize: 16,
    color: ROSE_700,
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

  // ── Logout row (§3.6, §7.2 — minHeight 52dp) ────────────────────────────────
  logoutRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 52,   // intentional carry-over from Settings logout row spec §7.2
    justifyContent: 'center',
  },
  logoutText: {
    color: ROSE_700,
    fontSize: 16,
    fontWeight: '500',
  },

  // ── Delete row (§3.5 — rose/700 destructive styling) ──────────────────────────
  deleteRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FEF2F2', // warm red tint
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  deleteRowIconText: {
    fontSize: 15,
    color: '#C0392B',
  },
  deleteRowLabelText: {
    color: ROSE_700,
  },
  deleteRowChevron: {
    fontSize: 18,
    color: ROSE_700,
    marginLeft: 8,
  },

  // ── EXPORT_ERROR card (amber) ─────────────────────────────────────────────────
  exportErrorCard: {
    backgroundColor: HONEY_100,
    borderWidth: 1,
    borderColor: HONEY_BORDER,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  exportErrorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: INK,
    marginBottom: 4,
  },
  exportErrorBody: {
    fontSize: 13,
    lineHeight: 20,
    color: INK_SOFT,
    marginBottom: 12,
  },
  exportErrorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exportRetryBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: ROSE_700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportRetryBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: ROSE_700,
  },
  exportDismissBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportDismissBtnLabel: {
    fontSize: 14,
    color: INK_FAINT,
    textDecorationLine: 'underline',
  },

  // ── EXPORT_UNAVAILABLE_404 notice (neutral/sunk) ──────────────────────────────
  export404Card: {
    backgroundColor: SURFACE_PAGE_SUNK,
    borderWidth: 1,
    borderColor: HAIRLINE_COLOR,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  export404Title: {
    fontSize: 14,
    color: INK_SOFT,
    textAlign: 'center',
    marginBottom: 12,
  },
  export404BackBtn: {
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  export404BackBtnLabel: {
    fontSize: 14,
    color: ROSE_700,
    fontWeight: '600',
  },
});
