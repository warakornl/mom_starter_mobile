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
import { T } from '../theme/tokens';
import { useProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import { useAccountRights } from '../accountRights/useAccountRights';
import { DeleteAccountSheet } from '../accountRights/DeleteAccountSheet';
import { PROFILE_HUB_TESTIDS } from './profileHubTestIds';
import { formatCivilDate } from '../i18n/messages';
import type { Locale } from '../auth/types';
import { buildPostpartumSummaryText, buildLogoutAlertConfig, buildMotherNameSummary } from './profileHubSummary';

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
  /**
   * Navigate to ProfileInfoEditScreen (root-stack push).
   * Lifecycle-agnostic: shown for BOTH pregnant and postpartum profiles.
   * Wired from BottomTabNavigator: `() => navigation.navigate('ProfileInfoEdit')`.
   * Optional — row hidden when not provided (same pattern as onSettings).
   * Spec: profile-tab-and-hub-ui.md §3.4 / name-fields-design.md §3.4
   */
  onEditPersonalInfo?: () => void;
  /**
   * Navigate to PregnancySummaryScreen (root-stack push).
   * Lifecycle-agnostic: shown for BOTH pregnant and postpartum profiles.
   * Wired from BottomTabNavigator: `() => navigation.navigate('PregnancySummary')`.
   * Optional — row hidden when not provided.
   * Spec: docs/product/pregnancy-summary.md §3.2
   */
  onPregnancySummary?: () => void;
  /**
   * Navigate to ReopenConfirmScreen (root-stack push, no route params —
   * SD-9; the screen GETs its own fresh profile + version on mount).
   *
   * mobile-reviewer BLOCKER-1 fix: this is the REAL, reachable entry point
   * for the pregnancy-loss reopen path (pregnancy-loss-recording-ui.md §4.1).
   * ProfileHubScreen reads the raw snapshot directly (no pregnant-only
   * GET-gate on this host, unlike ProfileEditScreen) so the row below
   * actually renders when lifecycle === 'ended'. Optional — row hidden when
   * not provided (same pattern as onSettings/onPregnancySummary).
   */
  onReopenPregnancy?: () => void;
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
  onEditPersonalInfo,
  onPregnancySummary,
  onReopenPregnancy,
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
  // pregnancy-loss-recording-ui.md §4.1: reopen entry shown ONLY when
  // lifecycle === 'ended' — raw snapshot value, null/postpartum/pregnant all
  // resolve to false (fail-safe, GAP-2 — never show on an unknown snapshot).
  const isEnded = snapshot?.lifecycle === 'ended';

  // ── Profile Summary Card content ─────────────────────────────────────────────
  function renderSummaryCard(): React.JSX.Element {
    if (snapshot === null) {
      return <SummaryCardSkeleton loading={t('profile.loading')} />;
    }

    let badgeText = '';
    // Widen type so pregnant/postpartum badge styles can be swapped:
    let badgeStyle: typeof styles.badgePregnant | typeof styles.badgePostpartum = styles.badgePregnant;
    let badgeTextStyle: typeof styles.badgePregnantText | typeof styles.badgePostpartumText = styles.badgePregnantText;
    let mainText = '';
    let subText: string | null = null;

    // PDPA minimization (OQ-N-SEC2): show first name only on the card.
    // buildMotherNameSummary handles the fallback to "คุณแม่" when absent.
    // NEVER log snapshot.motherFirstNameDecoded (PDPA identity PII).
    const motherNameDisplay = buildMotherNameSummary(snapshot.motherFirstNameDecoded, t);

    if (isPregnant) {
      badgeText = t('profile.summary.badgePregnant');
      badgeStyle = styles.badgePregnant;
      badgeTextStyle = styles.badgePregnantText;
      mainText = t('profile.weekDisplay', { n: snapshot.gestationalWeek });
      if (snapshot.edd) {
        subText = t('profile.eddPreviewPrefix', { date: formatCivilDate(snapshot.edd, locale as Locale) });
      }
    } else if (isPostpartum) {
      badgeText = t('profile.summary.badgePostpartum');
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
        {/* Mother name display (PDPA minimization: first name only) */}
        <Text style={styles.summaryMotherName}>{motherNameDisplay}</Text>
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

        {/* ── SECTION: โปรไฟล์ — Profile rows ──────────────────────────────── */}
        {/* Show section when at least one row is visible. */}
        {(isPregnant || isEnded && onReopenPregnancy != null || onEditPersonalInfo != null || onPregnancySummary != null) && (
          <Text style={styles.sectionLabel}>{t('profile.section.profile')}</Text>
        )}

        {/* Edit pregnancy — pregnant-only (§3.4 / OQ-PROFILE-2) */}
        {isPregnant && (
          <TouchableOpacity
            testID={PROFILE_HUB_TESTIDS.editPregnancyBtn}
            style={styles.menuRow}
            onPress={onEditPregnancy}
            accessibilityRole="button"
            accessibilityLabel={t('settings.editPregnancy')}
          >
            {/* Tell 1D: menuRowIconWrap removed — row is [textGroup] [chevron] */}
            <View style={styles.menuRowTextGroup}>
              <Text style={styles.menuRowText}>{t('settings.editPregnancy')}</Text>
              <Text style={styles.menuRowSubtext}>{t('profile.editPregnancy.subtitle')}</Text>
            </View>
            <Text style={styles.menuRowChevron}>{'›'}</Text>
          </TouchableOpacity>
        )}

        {/* Reopen (correction) — ended-only (pregnancy-loss-recording-ui.md §4.1).
         * mobile-reviewer BLOCKER-1 fix: THIS is the real, reachable entry
         * point (ProfileEditScreen's copy of this link was unreachable dead
         * code — see profileEditScreenLossEntry.test.tsx). Mutually
         * exclusive with the "Edit pregnancy" row above (lifecycle can only
         * be one value), quiet neutral framing (no blame). */}
        {isEnded && onReopenPregnancy != null && (
          <TouchableOpacity
            testID="profile-hub-reopen-pregnancy"
            style={styles.menuRow}
            onPress={onReopenPregnancy}
            accessibilityRole="button"
            accessibilityLabel={t('loss.reopen.entry')}
          >
            <View style={styles.menuRowTextGroup}>
              <Text style={styles.menuRowText}>{t('loss.reopen.entry')}</Text>
            </View>
            <Text style={styles.menuRowChevron}>{'›'}</Text>
          </TouchableOpacity>
        )}

        {/* Edit personal info — LIFECYCLE-AGNOSTIC (pregnant AND postpartum — §3.4) */}
        {/* Shows mother/baby name edit; hidden only when the prop is not wired */}
        {onEditPersonalInfo != null && (
          <TouchableOpacity
            testID={PROFILE_HUB_TESTIDS.editPersonalInfoBtn}
            style={styles.menuRow}
            onPress={onEditPersonalInfo}
            accessibilityRole="button"
            accessibilityLabel={t('profile.infoEdit.rowLabel')}
          >
            {/* Tell 1D: menuRowIconWrap removed — row is [textGroup] [chevron] */}
            <View style={styles.menuRowTextGroup}>
              <Text style={styles.menuRowText}>{t('profile.infoEdit.rowLabel')}</Text>
              <Text style={styles.menuRowSubtext}>{t('profile.infoEdit.rowSubtitle')}</Text>
            </View>
            <Text style={styles.menuRowChevron}>{'›'}</Text>
          </TouchableOpacity>
        )}

        {/* Pregnancy Summary — LIFECYCLE-AGNOSTIC (pregnant AND postpartum) */}
        {/* Recap of trimester data; hidden only when the prop is not wired. */}
        {onPregnancySummary != null && (
          <TouchableOpacity
            testID={PROFILE_HUB_TESTIDS.pregnancySummaryBtn}
            style={styles.menuRow}
            onPress={onPregnancySummary}
            accessibilityRole="button"
            accessibilityLabel={t('pregnancySummary.rowLabel')}
          >
            <View style={styles.menuRowTextGroup}>
              <Text style={styles.menuRowText}>{t('pregnancySummary.rowLabel')}</Text>
              <Text style={styles.menuRowSubtext}>{t('pregnancySummary.rowSubtitle')}</Text>
            </View>
            <Text style={styles.menuRowChevron}>{'›'}</Text>
          </TouchableOpacity>
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
            {/* Tell 1D: menuRowIconWrap removed — row is [textGroup] [chevron/spinner] */}
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
                color={T.color.accent.interactive}
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
            {/* Tell 1D: deleteRowIconWrap removed — destructive signal via text + chevron color */}
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
              {/* Tell 1D: menuRowIconWrap removed — row is [textGroup] [chevron] */}
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
// ห้องแม่ Phase 2 B4: all token references migrated to semantic T.* namespace.
// No inline hex constants. No IBMPlex fonts. No textTransform:uppercase.

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },

  // ── Inline header bar (§1 feat-profile-header-settings-row) ──────────────────
  headerBar: {
    minHeight: 56,
    backgroundColor: T.color.surface.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.color.surface.divider,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },

  // ── Profile Summary Card (§3.3) ─────────────────────────────────────────────
  summaryCard: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    padding: 16,
    minHeight: 80,
    marginBottom: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: T.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 8,
  },
  badgePregnant: {
    backgroundColor: T.color.surface.wash.roselle,
  },
  badgePostpartum: {
    backgroundColor: T.color.surface.wash.jade,
  },
  badgeText: {
    fontSize: T.type.caption.size,
    fontFamily: T.type.label.fontFamily,
  },
  badgePregnantText: {
    color: T.color.text.heading,
  },
  badgePostpartumText: {
    color: T.color.text.botanical,
  },
  // Mother name display (PDPA minimization: first name only on card — OQ-N-SEC2)
  summaryMotherName: {
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    fontFamily: T.type.caption.fontFamily,
    color: T.color.text.primary,
    marginBottom: 6,
  },
  summaryMainText: {
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    fontFamily: T.type.heading2.fontFamily,
    color: T.color.text.heading,
    marginBottom: 4,
  },
  summarySubText: {
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },

  // ── Skeleton bones (loading state §4 State 1) ────────────────────────────────
  skeletonBone1: {
    height: 12,
    width: '50%',
    borderRadius: T.radius.sm,
    backgroundColor: T.skeleton.color,
    marginBottom: 8,
  },
  skeletonBone2: {
    height: 20,
    width: '70%',
    borderRadius: T.radius.sm,
    backgroundColor: T.skeleton.color,
    marginBottom: 8,
  },
  skeletonBone3: {
    height: 12,
    width: '40%',
    borderRadius: T.radius.sm,
    backgroundColor: T.skeleton.color,
  },

  // ── Section labels (§3.2) — T.type.label, botanical color, NO uppercase ───────
  // B4 migration: letterSpacing→0, textTransform removed (Thai rule §0 R1).
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
  menuRowInProgress: {
    backgroundColor: T.color.surface.subtle,
  },
  menuRowTextGroup: {
    flex: 1,
  },
  menuRowText: {
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.heading,
    fontWeight: '500',
  },
  menuRowSubtext: {
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    marginTop: 2,
  },
  menuRowChevron: {
    fontSize: 18,
    color: T.color.text.primary,
    marginLeft: 8,
  },

  // ── Logout row (§3.6) ────────────────────────────────────────────────────────
  logoutRow: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 52,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  logoutText: {
    color: T.color.text.primary,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    fontWeight: '500',
  },

  // ── Delete row (§3.5) ────────────────────────────────────────────────────────
  // Destructive signal carried by text.primary + chevron. No alarming red.
  deleteRowLabelText: {
    color: T.color.text.primary,
  },
  deleteRowChevron: {
    fontSize: 18,
    color: T.color.text.primary,
    marginLeft: 8,
  },

  // ── EXPORT_ERROR card (amber wash) ───────────────────────────────────────────
  exportErrorCard: {
    backgroundColor: T.color.surface.wash.amber,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 14,
    marginBottom: 8,
  },
  exportErrorTitle: {
    fontSize: T.type.caption.size,
    fontWeight: '700',
    color: T.color.text.heading,
    marginBottom: 4,
  },
  exportErrorBody: {
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
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
    borderRadius: T.radius.sm,
    borderWidth: 1.5,
    borderColor: T.color.accent.identity,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportRetryBtnLabel: {
    fontSize: T.type.caption.size,
    fontWeight: '700',
    color: T.color.text.primary,
  },
  exportDismissBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportDismissBtnLabel: {
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    textDecorationLine: 'underline',
  },

  // ── EXPORT_UNAVAILABLE_404 notice ──────────────────────────────────────────────
  export404Card: {
    backgroundColor: T.color.surface.subtle,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  export404Title: {
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
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
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    fontWeight: '600',
  },
});
