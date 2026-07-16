/**
 * CalendarSyncSettingsScreen — CS-4 Calendar Sync Hub / Settings
 *
 * This is the primary management screen reached from the main Settings list.
 * It shows the sync status, lets the user toggle the feature on/off, and
 * navigates to sub-screens (privacy level, disable dialog, etc.).
 *
 * Entry point: Settings screen row "ซิงก์ปฏิทินในเครื่อง" → this screen.
 *
 * States:
 *  - DISABLED  (feature toggle OFF)           → CS-4 disabled view, toggle row
 *  - ENABLED   (feature toggle ON, consented)  → CS-4 enabled view, status badge
 *  - PENDING   (consent flow in progress)      → CalendarSyncConsentSheet modal
 *  - OS_DENIED (permission withdrawn on iOS/Android) → CS-6 attention banner
 *  - OFFLINE   (network unavailable)           → CS-9 offline strip (non-blocking)
 *
 * Tokens: ห้องแม่ palette — consume T.color/T.spacing/T.radius/T.type only.
 * Trace: screens spec §3, ui-spec CS-4/CS-6/CS-8/CS-9, compliance §4.
 *
 * SECURITY: no health data passed in navigation params (SD-9).
 * a11y: WCAG 2.1 AA+; 48dp targets; role + label on every interactive element.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
import { T } from '../../theme/tokens';
import { useT } from '../../i18n/LanguageContext';
import { CalendarSyncConsentSheet } from './CalendarSyncConsentSheet';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CalendarSyncSettingsScreenProps {
  /** Navigate to the privacy-level picker screen. */
  onNavigateToPrivacyLevel: () => void;
  /** Called when the user dismisses this screen. */
  onBack: () => void;
  /** Current feature-enabled state (drives the toggle). */
  featureEnabled?: boolean;
  /** Current privacy level: 'generic' | 'descriptive'. */
  privacyLevel?: 'generic' | 'descriptive';
  /** Whether consent is already granted. */
  consentGranted?: boolean;
  /** Whether OS calendar permission is granted. */
  osPermissionGranted?: boolean;
  /** Whether the device is offline (shows CS-9 strip). */
  isOffline?: boolean;
  /**
   * Handlers the screen invokes for state changes.
   * Wired to deviceCalendarBridge by the navigator host.
   */
  onGrantConsent?: () => Promise<void>;
  onDeclineConsent?: () => void;
  onDisableFeature?: (action: 'delete' | 'keep') => Promise<void>;
  onToggleOn?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarSyncSettingsScreen({
  onNavigateToPrivacyLevel,
  onBack,
  featureEnabled = false,
  privacyLevel = 'generic',
  consentGranted = false,
  osPermissionGranted = true,
  isOffline = false,
  onGrantConsent,
  onDeclineConsent,
  onDisableFeature,
  onToggleOn,
}: CalendarSyncSettingsScreenProps) {
  const { t } = useT();
  const [showConsentSheet, setShowConsentSheet] = useState(false);

  // Toggle handler — if turning ON and no consent yet, show consent sheet first
  function handleToggle(value: boolean) {
    if (value && !consentGranted) {
      setShowConsentSheet(true);
      return;
    }
    if (value && onToggleOn) {
      onToggleOn();
      return;
    }
    if (!value) {
      handleDisable();
    }
  }

  function handleDisable() {
    Alert.alert(
      t('calendarSync.disableDialogTitle'),
      t('calendarSync.disableDialogMsg'),
      [
        {
          text: t('calendarSync.disableCancel'),
          style: 'cancel',
        },
        {
          text: t('calendarSync.disableDelete'),
          style: 'destructive',
          onPress: () => onDisableFeature?.('delete'),
        },
        {
          text: t('calendarSync.disableKeep'),
          onPress: () => onDisableFeature?.('keep'),
        },
      ],
    );
  }

  async function handleConsentGrant() {
    setShowConsentSheet(false);
    if (onGrantConsent) await onGrantConsent();
  }

  function handleConsentDecline() {
    setShowConsentSheet(false);
    onDeclineConsent?.();
  }

  // Privacy level display label
  const privacyLabel =
    privacyLevel === 'generic' ? t('calendarSync.privacyGeneric') : t('calendarSync.privacyDescriptive');

  // Status badge
  const statusLabel   = featureEnabled ? t('calendarSync.statusEnabled') : t('calendarSync.statusDisabled');
  const statusStyle   = featureEnabled ? s.statusEnabled : s.statusDisabled;

  return (
    <View style={s.screen} testID="calendar-sync-settings-screen">
      {/* Back button */}
      <TouchableOpacity
        style={s.backBtn}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t('calendarSync.back')}
        testID="calendar-sync-back-btn"
      >
        <Text style={s.backBtnText}>{t('calendarSync.back')}</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Screen heading */}
        <Text
          style={s.heading}
          accessibilityRole="header"
          testID="calendar-sync-settings-title"
        >
          {t('calendarSync.title')}
        </Text>
        <Text style={s.subtitle}>{t('calendarSync.subtitle')}</Text>

        {/* CS-9 Offline strip — non-blocking */}
        {isOffline && (
          <View
            style={s.offlineStrip}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={t('calendarSync.offlineStrip')}
          >
            <Text style={s.offlineStripText}>{t('calendarSync.offlineStrip')}</Text>
          </View>
        )}

        {/* CS-6 OS permission denied banner */}
        {featureEnabled && !osPermissionGranted && (
          <View
            style={s.attentionBanner}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={`${t('calendarSync.osDeniedTitle')}. ${t('calendarSync.osDeniedBody')}`}
          >
            <Text style={s.attentionTitle}>{t('calendarSync.osDeniedTitle')}</Text>
            <Text style={s.attentionBody}>{t('calendarSync.osDeniedBody')}</Text>
            <TouchableOpacity
              style={s.attentionBtn}
              // 🔴 fix: was a dead button (no onPress) — CS-6 recovery path was
              // unreachable. Opens the OS app-settings screen so the user can
              // re-grant calendar permission.
              onPress={() => { void Linking.openSettings(); }}
              accessibilityRole="button"
              accessibilityLabel={t('calendarSync.osDeniedBtn')}
              testID="calendar-sync-os-settings-btn"
            >
              <Text style={s.attentionBtnText}>{t('calendarSync.osDeniedBtn')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Status + Toggle row */}
        <View style={s.section}>
          <View
            style={s.row}
            accessible={false}
          >
            <View style={s.rowContent}>
              <Text style={s.rowLabel}>{t('calendarSync.toggleLabel')}</Text>
              <View style={statusStyle}>
                <Text style={s.statusText}>{statusLabel}</Text>
              </View>
            </View>
            <Switch
              value={featureEnabled}
              onValueChange={handleToggle}
              testID="calendar-sync-toggle"
              accessibilityRole="switch"
              accessibilityLabel={t('calendarSync.toggleLabel')}
              accessibilityState={{ checked: featureEnabled }}
              thumbColor={T.color.surface.base}
              trackColor={{
                false: T.color.surface.divider,
                true:  T.color.accent.interactive,
              }}
            />
          </View>
        </View>

        {/* Privacy level row — only shown when enabled */}
        {featureEnabled && (
          <View style={s.section}>
            <TouchableOpacity
              style={s.row}
              onPress={onNavigateToPrivacyLevel}
              accessibilityRole="button"
              accessibilityLabel={`${t('calendarSync.privacyRow')}: ${privacyLabel}`}
              accessibilityHint={t('calendarSync.privacyRowA11yHint')}
              testID="calendar-sync-privacy-row"
            >
              <Text style={s.rowLabel}>{t('calendarSync.privacyRow')}</Text>
              <View style={s.rowRight}>
                <Text style={s.rowValue}>{privacyLabel}</Text>
                <Text style={s.chevron} aria-hidden>›</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Disable row — only shown when enabled */}
        {featureEnabled && (
          <View style={s.section}>
            <TouchableOpacity
              style={s.row}
              onPress={handleDisable}
              accessibilityRole="button"
              accessibilityLabel={t('calendarSync.disableRow')}
              testID="calendar-sync-disable-btn"
            >
              <Text style={[s.rowLabel, s.destructive]}>{t('calendarSync.disableRow')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* CS-1 Consent sheet — shown when toggling on without consent */}
      <CalendarSyncConsentSheet
        visible={showConsentSheet}
        onGrant={handleConsentGrant}
        onDecline={handleConsentDecline}
      />
    </View>
  );
}

// ─── Styles — ห้องแม่ tokens only (no inline hex/px) ──────────────────────────

const s = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: T.color.surface.base,
  },
  backBtn: {
    padding:          T.spacing[4],
    paddingBottom:    T.spacing[2],
    minHeight:        48,
    justifyContent:   'center',
  },
  backBtnText: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.accent.interactive,
  },
  scroll: {
    padding:     T.spacing[4],
    paddingBottom: T.spacing[10],
  },
  heading: {
    fontFamily:  T.type.heading1.fontFamily,
    fontSize:    T.type.heading1.size,
    lineHeight:  T.type.heading1.lineHeight,
    color:       T.color.text.heading,
    marginBottom: T.spacing[1],
  },
  subtitle: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.text.secondary,
    marginBottom: T.spacing[6],
  },
  offlineStrip: {
    backgroundColor: T.color.surface.subtle,
    borderRadius:    T.radius.sm,
    padding:         T.spacing[3],
    marginBottom:    T.spacing[4],
  },
  offlineStripText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize:   T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color:      T.color.text.primary,
  },
  attentionBanner: {
    backgroundColor: T.color.surface.wash.amber,
    borderRadius:    T.radius.md,
    padding:         T.spacing[4],
    marginBottom:    T.spacing[4],
  },
  attentionTitle: {
    fontFamily: T.type.label.fontFamily,
    fontSize:   T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color:      T.color.state.attention,
    marginBottom: T.spacing[1],
  },
  attentionBody: {
    fontFamily: T.type.caption.fontFamily,
    fontSize:   T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color:      T.color.text.primary,
    marginBottom: T.spacing[3],
  },
  attentionBtn: {
    alignSelf:    'flex-start',
    borderRadius: T.radius.pill,
    borderWidth:  1,
    borderColor:  T.color.state.attention,
    paddingVertical:   T.spacing[1],
    paddingHorizontal: T.spacing[3],
    minHeight: 48, // 🔴 fix: was 36 — below ≥48dp touch-target minimum
    justifyContent: 'center',
  },
  attentionBtnText: {
    fontFamily: T.type.label.fontFamily,
    fontSize:   T.type.label.size,
    lineHeight: T.type.label.lineHeight,
    color:      T.color.state.attention,
  },
  section: {
    backgroundColor: T.color.surface.base,
    borderColor:     T.color.surface.divider,
    borderWidth:     1,
    borderRadius:    T.radius.md,
    marginBottom:    T.spacing[3],
    overflow:        'hidden',
  },
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical:   T.spacing[4],
    paddingHorizontal: T.spacing[4],
    minHeight:      56,
  },
  rowContent: {
    flex:       1,
    flexDirection: 'row',
    alignItems: 'center',
    gap:        T.spacing[2],
  },
  rowLabel: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color:      T.color.text.primary,
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           T.spacing[1],
  },
  rowValue: {
    fontFamily: T.type.caption.fontFamily,
    fontSize:   T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color:      T.color.text.secondary,
  },
  chevron: {
    fontFamily: T.type.body.fontFamily,
    fontSize:   18,
    lineHeight: 22,
    color:      T.color.text.secondary,
  },
  statusEnabled: {
    backgroundColor: T.color.surface.wash.jade,
    borderRadius:    T.radius.sm,
    paddingVertical:   T.spacing[0],
    paddingHorizontal: T.spacing[2],
  },
  statusDisabled: {
    backgroundColor: T.color.surface.subtle,
    borderRadius:    T.radius.sm,
    paddingVertical:   T.spacing[0],
    paddingHorizontal: T.spacing[2],
  },
  statusText: {
    fontFamily: T.type.micro.fontFamily,
    fontSize:   T.type.micro.size,
    lineHeight: T.type.micro.lineHeight,
    color:      T.color.text.primary,
  },
  destructive: {
    color: T.color.state.error,
  },
});
