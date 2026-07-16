/**
 * PrivacyPolicyScreen — honest "in progress" placeholder (task #40).
 *
 * INVESTIGATION RESULT (recorded here, do not remove without re-checking):
 *   No lawyer-approved final Privacy Policy copy exists anywhere in the repo.
 *   docs/legal/consent-copy.md (`legal-counsel`, DRAFT, v1.0) explicitly flags
 *   the policy-link target: "🚩 ป้ายลิงก์ต้องพาไปนโยบายจริงที่ทนายอนุมัติ
 *   (§Z-5) — ห้าม launch โดยลิงก์ไปหน้าเปล่า" (the link must lead to a real,
 *   lawyer-approved policy — must NOT launch linking to a blank page).
 *   docs/legal/legal-register.md §Z-5 ("อนุมัติ Privacy Policy + Terms of
 *   Service") is an OPEN checklist item — not yet signed off by a licensed
 *   Thai lawyer.
 *
 *   Per instructions: DO NOT invent legal text. This screen renders an
 *   honest "อยู่ระหว่างจัดทำ" (in progress) notice instead of either (a) a
 *   dead/non-interactive link, or (b) fabricated policy copy. Once §Z-5 is
 *   signed off, replace the body with the approved copy (from
 *   docs/legal/consent-copy.md or wherever legal-counsel publishes the final
 *   text) — this screen/route stays; only the content needs to change.
 *
 * Was previously a dead footer link on ManageConsentsScreen
 * ("consent-manage-policy-link", non-interactive plain text with a
 * mobile-reviewer comment explaining no route existed yet).
 *
 * SECURITY: static content only — no health data, no API call, no PII.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

import { T } from '../theme/tokens';
import { useT } from '../i18n/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PrivacyPolicyScreenProps {
  onBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PrivacyPolicyScreen({ onBack }: PrivacyPolicyScreenProps): React.JSX.Element {
  const { t } = useT();

  return (
    <SafeAreaView testID="privacy-policy-screen" style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity
          style={styles.backRow}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('general.back')}
        >
          <Text style={styles.backText}>{t('general.back')}</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>{t('privacyPolicy.title')}</Text>

        <View testID="privacy-policy-pending-notice" style={styles.noticePanel}>
          <Text style={styles.noticeText}>{t('privacyPolicy.pending_notice')}</Text>
          <Text style={styles.subNoteText}>{t('privacyPolicy.pending_subnote')}</Text>
        </View>
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

  noticePanel: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    padding: T.spacing[4],
    borderWidth: 1,
    borderColor: T.color.surface.divider,
  },
  noticeText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: T.type.bodyLarge.size,
    lineHeight: T.type.bodyLarge.lineHeight,
    color: T.color.text.heading,
    marginBottom: T.spacing[3],
  },
  subNoteText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.botanical,
  },
});
