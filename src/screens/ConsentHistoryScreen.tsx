/**
 * ConsentHistoryScreen — read-only consent grant/withdrawal history (task #40).
 *
 * REAL screen backed by the REAL endpoint `GET /v1/account/consents`
 * (docs/api-spec/api-contract.md: "consent history — supports s.19
 * management UI"), already wired via `consentApiClient.getConsents`.
 *
 * Was previously a dead footer link on ManageConsentsScreen
 * ("consent-manage-history-link", non-interactive plain text with a
 * mobile-reviewer comment explaining no route existed yet). This screen
 * closes that gap with a genuine, reachable, read-only history view.
 *
 * Screen states:
 *   skeleton — GET in flight
 *   loaded   — history rendered (empty sub-state when items.length === 0)
 *   error    — GET failed, retry available
 *
 * PDPA: append-only log — this screen NEVER lets the user edit/delete a
 * past record (that would defeat the audit trail); to change current
 * consent state, users go to Manage Permissions instead.
 *
 * SECURITY: ConsentRecord carries no health VALUES — only consent metadata
 * (type, granted boolean, text version, timestamp). Never logs accessToken.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

import type { TokenStorage } from '../auth/tokenStorage';
import { T } from '../theme/tokens';
import { createConsentApiClient } from '../consent/consentApiClient';
import { useT } from '../i18n/LanguageContext';
import { formatCivilDate } from '../i18n/messages';
import type { ConsentRecord } from '../consent/types';
import {
  CONSENT_TYPE_TITLE_KEY,
  historyItemLabelKey,
  sortHistoryDescending,
  civilDateFromGrantedAt,
  type HistoryScreenStatus,
} from './consentHistoryScreenLogic';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConsentHistoryScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  onBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConsentHistoryScreen({
  tokenStorage,
  apiBaseUrl,
  onBack,
}: ConsentHistoryScreenProps): React.JSX.Element {
  const { t, locale } = useT();

  const [status, setStatus] = useState<HistoryScreenStatus>('skeleton');
  const [items, setItems] = useState<ConsentRecord[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setStatus('skeleton');
    try {
      const tokens = await tokenStorage.load();
      if (!tokens) {
        setStatus('error');
        return;
      }
      const client = createConsentApiClient(apiBaseUrl);
      const result = await client.getConsents(tokens.accessToken);
      if (result.ok) {
        setItems(sortHistoryDescending(result.page.items));
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }, [tokenStorage, apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Skeleton state ──────────────────────────────────────────────────────────
  if (status === 'skeleton') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.scroll}>
          <TouchableOpacity
            style={styles.backRow}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('general.back')}
          >
            <Text style={styles.backText}>{t('general.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>{t('consent.history.title')}</Text>
          <View testID="consent-history-screen-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonRow} />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error state ─────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.scroll}>
          <TouchableOpacity
            style={styles.backRow}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('general.back')}
          >
            <Text style={styles.backText}>{t('general.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>{t('consent.history.title')}</Text>
          <View testID="consent-history-screen-load-error" style={styles.loadErrorPanel}>
            <Text style={styles.loadErrorText}>{t('consent.history.load_error')}</Text>
            <TouchableOpacity
              testID="consent-history-screen-load-retry-btn"
              style={styles.loadRetryBtn}
              onPress={() => void load()}
              accessibilityRole="button"
              accessibilityLabel={t('consent.history.load_retry_btn')}
            >
              <Text style={styles.loadRetryBtnLabel}>{t('consent.history.load_retry_btn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Loaded state (list or empty) ────────────────────────────────────────────
  return (
    <SafeAreaView testID="consent-history-screen" style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity
          style={styles.backRow}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('general.back')}
        >
          <Text style={styles.backText}>{t('general.back')}</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>{t('consent.history.title')}</Text>

        {items.length === 0 ? (
          <View testID="consent-history-empty">
            <Text style={styles.emptyText}>{t('consent.history.empty')}</Text>
          </View>
        ) : (
          items.map((record) => {
            const dateLabel = formatCivilDate(civilDateFromGrantedAt(record.grantedAt), locale);
            const typeLabel = t(CONSENT_TYPE_TITLE_KEY[record.consentType]);
            const stateLabel = t(historyItemLabelKey(record.granted));
            return (
              <View
                key={record.id}
                testID="consent-history-item"
                style={styles.row}
                accessibilityLabel={`${typeLabel}, ${stateLabel}, ${dateLabel}`}
              >
                <View style={styles.rowTextGroup}>
                  <Text style={styles.rowTitle}>{typeLabel}</Text>
                  <Text
                    style={record.granted ? styles.rowStateGranted : styles.rowStateWithdrawn}
                  >
                    {stateLabel}
                  </Text>
                </View>
                <Text style={styles.rowDate}>{dateLabel}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles — ห้องแม่ tokens only ─────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.color.surface.base,
  },
  scroll: {
    padding: T.spacing[5],
    paddingBottom: T.spacing[10],
  },

  backRow: { marginBottom: T.spacing[2], minHeight: 48, justifyContent: 'center' },
  backText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.accent.interactive,
    fontWeight: '500',
  },

  screenTitle: {
    fontFamily: T.type.heading1.fontFamily,
    fontSize: T.type.heading1.size,
    lineHeight: T.type.heading1.lineHeight,
    color: T.color.text.heading,
    marginBottom: T.spacing[6],
  },

  row: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    paddingVertical: 14,
    paddingHorizontal: T.spacing[4],
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: T.spacing[2],
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  rowTextGroup: { flex: 1, marginRight: T.spacing[3] },
  rowTitle: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    color: T.color.text.heading,
    fontWeight: '500',
  },
  rowStateGranted: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.state.success,
    marginTop: 2,
  },
  rowStateWithdrawn: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.botanical,
    marginTop: 2,
  },
  rowDate: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.botanical,
  },

  emptyText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    lineHeight: T.type.body.lineHeight,
    color: T.color.text.primary,
    textAlign: 'center',
    marginTop: T.spacing[6],
  },

  skeletonRow: {
    height: 52,
    backgroundColor: T.skeleton.color,
    borderRadius: T.radius.md,
    opacity: 0.5,
    marginBottom: T.spacing[2],
  },

  loadErrorPanel: {
    marginTop: T.spacing[6],
    backgroundColor: T.errorPanel.bg,
    borderRadius: T.radius.md,
    padding: T.spacing[4],
    alignItems: 'center',
  },
  loadErrorText: {
    fontSize: T.type.bodyLarge.size,
    color: T.errorPanel.body,
    marginBottom: T.spacing[3],
    textAlign: 'center',
  },
  loadRetryBtn: {
    paddingHorizontal: T.spacing[5],
    paddingVertical: T.spacing[2] + 2,
    borderRadius: T.radius.sm,
    borderWidth: 1.5,
    borderColor: T.color.accent.interactive,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadRetryBtnLabel: { fontSize: T.type.bodyLarge.size, fontWeight: '700', color: T.color.accent.interactive },
});
