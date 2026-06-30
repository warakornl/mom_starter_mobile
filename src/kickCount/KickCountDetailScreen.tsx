/**
 * SC-K5: KickCountDetailScreen — read-only session detail.
 *
 * Rules:
 *   - Displays count/duration/gest-week verbatim (no parsing/derived value)
 *   - note: displayed verbatim; section hidden if empty (never empty placeholder)
 *   - Safety strip (K-5d) + disclaimer always-on (INV-K6)
 *   - "ส่งออกเป็น PDF หมอ" → POST /reports (requires pdf_egress consent)
 *     Note enters PDF only when includeLab=true (D9/K-7 compliance)
 *   - Immutable: no edit button
 *   - Tombstone delete: if implemented via delete button (soft-delete + tombstone push)
 *
 * Security: never log session fields (K-8 MOTHER-health).
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { kickCountSyncStore } from './kickCountSyncStore';
import type { KickCountSessionRecord } from './kickCountTypes';
import { SafetyStrip } from './KickCountHomeScreen';

type Route = NativeStackScreenProps<RootStackParamList, 'KickCountDetail'>['route'];

export function KickCountDetailScreen() {
  const { t } = useT();
  const route = useRoute<Route>();
  const { sessionId } = route.params;

  const [session, setSession] = useState<KickCountSessionRecord | null>(null);

  useEffect(() => {
    const s = kickCountSyncStore.getSession(sessionId);
    setSession(s ?? null);
  }, [sessionId]);

  if (!session) {
    return (
      <View style={styles.container} testID="kick-detail-loading">
        <Text style={styles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  const durationMin = session.durationSeconds ? Math.round(session.durationSeconds / 60) : 0;
  const startTime = session.startedAt.split('T')[1] ?? '';
  const endTime = session.endedAt ? session.endedAt.split('T')[1] ?? '' : '';
  const startDate = session.startedAt.split('T')[0] ?? '';

  const handleExportPdf = () => {
    // TODO: POST /reports with pdf_egress consent check
    // D9/K-7: note enters PDF only when includeLab=true (opt-in under sensitive_lab_results)
    // This is a carry-forward — wiring the PDF endpoint is out of scope for this slice.
  };

  return (
    <ScrollView style={styles.container} testID="kick-detail-screen">
      {/* Header */}
      <Text style={styles.bookIcon} accessibilityElementsHidden>📖</Text>
      <Text style={styles.headline}>{t('kick.summaryHeadline')}</Text>
      <Text style={styles.dateTime}>
        {startDate}  {startTime}{endTime ? ` – ${endTime}` : ''}
      </Text>

      {/* Stats box — verbatim values (INV-K1: no derived verdict string) */}
      <View style={styles.statsBox} testID="kick-detail-stats">
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>{t('kick.detailCountLabel')}</Text>
          <Text style={styles.statValue} testID="kick-detail-count">
            {interpolate(t('kick.summaryCount'), { n: session.movementCount })}
          </Text>
        </View>
        {durationMin > 0 && (
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{t('kick.detailDurationLabel')}</Text>
            <Text style={styles.statValue} testID="kick-detail-duration">
              {interpolate(t('kick.summaryDuration'), { min: durationMin })}
            </Text>
          </View>
        )}
        {session.gestationalWeekAtStart != null && (
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{t('kick.detailWeekLabel')}</Text>
            <Text style={styles.statValue} testID="kick-detail-week">
              {interpolate(t('kick.detailWeekValue'), { n: session.gestationalWeekAtStart })}
            </Text>
          </View>
        )}
      </View>

      {/* Note (verbatim — section hidden if empty, D10) */}
      {session.note && session.note.trim().length > 0 && (
        <View style={styles.noteSection} testID="kick-detail-note">
          <Text style={styles.noteLabel}>{t('kick.detailNoteLabel')}</Text>
          <View style={styles.noteBox}>
            {/* verbatim — never parsed, never interpreted (INV-K1) */}
            <Text style={styles.noteText}>{session.note}</Text>
          </View>
        </View>
      )}

      {/* Safety strip (K-5d) + disclaimer — always-on (INV-K6) */}
      <SafetyStrip t={t} />

      {/* PDF export */}
      <TouchableOpacity
        style={styles.exportBtn}
        onPress={handleExportPdf}
        accessibilityRole="button"
        accessibilityLabel={t('kick.detailExportPdf')}
        testID="kick-detail-export-pdf-btn"
      >
        <Text style={styles.exportBtnText}>{t('kick.detailExportPdf')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  loadingText: {
    fontSize: 15,
    color: '#6B6B6B',
    marginTop: 40,
    textAlign: 'center',
  },
  bookIcon: {
    fontSize: 42,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 4,
  },
  dateTime: {
    fontSize: 14,
    color: '#6B6B6B',
    textAlign: 'center',
    marginBottom: 20,
  },
  statsBox: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#9B9B9B',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A', // ink — no conditional coloring (INV-K1)
  },
  noteSection: {
    marginBottom: 16,
  },
  noteLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B6B6B',
    marginBottom: 8,
  },
  noteBox: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
  },
  noteText: {
    fontSize: 15,
    color: '#1A1A1A',
    lineHeight: 22,
  },
  exportBtn: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 32,
  },
  exportBtnText: {
    fontSize: 15,
    color: '#1A1A1A',
  },
});
