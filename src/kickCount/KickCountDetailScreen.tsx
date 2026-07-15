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
import { T } from '../theme/tokens';

type Route = NativeStackScreenProps<RootStackParamList, 'KickCountDetail'>['route'];

export function KickCountDetailScreen() {
  const { t } = useT();
  const route = useRoute<Route>();
  const { sessionId } = route.params;

  // getSession() is a synchronous in-memory read — "loading" is only ever
  // transient (one render tick before the effect runs). Once the effect has
  // run, a null session means the id genuinely does not exist in the store
  // (e.g. stale deep link, tombstoned row) — that must show a distinct
  // not-found state, not an eternal loading spinner (previously: loading
  // forever whenever the id was missing/invalid).
  type LoadState = 'loading' | 'found' | 'not-found';
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [session, setSession] = useState<KickCountSessionRecord | null>(null);

  useEffect(() => {
    const s = kickCountSyncStore.getSession(sessionId);
    setSession(s ?? null);
    setLoadState(s ? 'found' : 'not-found');
  }, [sessionId]);

  if (loadState === 'loading') {
    return (
      <View style={styles.container} testID="kick-detail-loading">
        <Text style={styles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  if (loadState === 'not-found' || !session) {
    // TODO(i18n owner — shared messages.ts, not editable by this cluster):
    // add dedicated 'kick.detailNotFound' / 'kick.detailNotFoundBody' keys
    // (see report). Falls back to the existing generic store-error copy so
    // this state is never an eternal 'loading' skeleton in the meantime.
    return (
      <View style={styles.container} testID="kick-detail-not-found">
        <Text style={styles.headline}>{t('kick.storeError')}</Text>
      </View>
    );
  }

  const durationMin = session.durationSeconds ? Math.round(session.durationSeconds / 60) : 0;
  const startTime = session.startedAt.split('T')[1] ?? '';
  const endTime = session.endedAt ? session.endedAt.split('T')[1] ?? '' : '';
  const startDate = session.startedAt.split('T')[0] ?? '';

  // PDF export (POST /reports + pdf_egress consent) is NOT implemented in
  // this slice — the button is hidden below (design-reviewer: no dead
  // buttons). Re-add a wired handleExportPdf in the same change that wires
  // the endpoint.

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

      {/*
        PDF export — HIDDEN until wired (design-reviewer: no dead buttons).
        handleExportPdf is a no-op TODO (POST /reports + pdf_egress consent
        is not implemented in this slice). Re-enable this button in the same
        change that wires the endpoint — do not un-hide it before then.
      */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,   // #FBF6F1 ivory-100
    padding: T.spacing[4],                    // 16dp
  },
  loadingText: {
    fontFamily: T.type.body.fontFamily,       // Sarabun-Regular
    fontSize: T.type.body.size,               // 15sp
    lineHeight: T.type.body.lineHeight,       // 25
    color: T.color.text.primary,              // #7A3A52 roselle-700 (from #6B6B6B)
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
    fontFamily: T.type.heading2.fontFamily,   // Sarabun-SemiBold
    fontSize: T.type.heading2.size,           // 20sp (from 22sp — closest heading token)
    lineHeight: T.type.heading2.lineHeight,   // 33
    fontWeight: T.type.heading2.fontWeight,   // '600'
    color: T.color.text.heading,              // #4A2230 roselle-900 (from #1A1A1A ink)
    textAlign: 'center',
    marginBottom: 4,
  },
  dateTime: {
    fontFamily: T.type.caption.fontFamily,    // Sarabun-Regular
    fontSize: T.type.caption.size,            // 13sp (from 14sp — caption for metadata)
    lineHeight: T.type.caption.lineHeight,    // 21
    color: T.color.text.primary,              // #7A3A52 roselle-700 (from #6B6B6B)
    textAlign: 'center',
    marginBottom: 20,
  },
  statsBox: {
    backgroundColor: T.color.surface.subtle,  // #F5EDE6 ivory-200 (from #F5F5F5)
    borderRadius: T.radius.md,                // 12dp
    padding: T.spacing[4],                    // 16dp
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontFamily: T.type.caption.fontFamily,    // Sarabun-Regular
    fontSize: T.type.caption.size,            // 13sp (from 12sp)
    lineHeight: T.type.caption.lineHeight,    // 21
    color: T.color.text.primary,              // #7A3A52 roselle-700 (from #9B9B9B — not jade-600 at 13sp, R4)
    marginBottom: 4,
  },
  statValue: {
    fontFamily: T.type.bodyLarge.fontFamily,  // Sarabun-Regular
    fontSize: T.type.bodyLarge.size,          // 17sp (from 18sp, per spec "type.body.large")
    lineHeight: T.type.bodyLarge.lineHeight,  // 28
    fontWeight: '600',
    color: T.color.text.heading,              // #4A2230 roselle-900 (from #1A1A1A — no conditional coloring INV-K1)
  },
  noteSection: {
    marginBottom: 16,
  },
  noteLabel: {
    fontFamily: T.type.label.fontFamily,      // Sarabun-SemiBold
    fontSize: T.type.label.size,              // 15sp (from 13sp — label token)
    lineHeight: T.type.label.lineHeight,      // 24
    fontWeight: T.type.label.fontWeight,      // '600'
    color: T.color.text.botanical,            // #2F5042 jade-800 (from #6B6B6B — section labels → botanical)
    marginBottom: 8,
  },
  noteBox: {
    backgroundColor: T.color.surface.subtle,  // #F5EDE6 ivory-200 (from #F5F5F5)
    borderRadius: T.radius.sm,                // 6dp (from 8dp)
    padding: 12,
  },
  noteText: {
    fontFamily: T.type.body.fontFamily,       // Sarabun-Regular
    fontSize: T.type.body.size,               // 15sp
    lineHeight: T.type.body.lineHeight,       // 25
    color: T.color.text.primary,              // #7A3A52 roselle-700 (from #1A1A1A)
  },
});
