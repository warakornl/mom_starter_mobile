/**
 * BabySizeSection.tsx — Baby size comparison / postpartum age section for HomeTabScreen.
 *
 * Design ground-truth: docs/design/baby-size-home-section.md
 * Legal ground-truth:  docs/legal/baby-size-content-legal.md §4, §5
 *
 * Two variants:
 *   'pregnant'   — fruit size-comparison icon + name + size info + always-on disclaimer
 *   'postpartum' — baby footprint icon + age line + warm note + postpartum disclaimer
 *
 * S5 (legal §5): disclaimer is ALWAYS-ON in both variants. NEVER conditionally hidden.
 *   Color: T.color.text.primary (roselle-700 #7A3A52, 7.70:1 AAA). Font: 13sp Regular,
 *   LH 21sp (T.type.caption — meets §0 R2 Thai ≥1.6× rule).
 *   NEVER use #94818A/11pt (withdrawn per design-reviewer B1).
 *
 * S6/S7 Invariant (legal §5 CR-1 — Milk Code / no-ad-targeting):
 *   gestationalWeek and baby postpartum age values MUST NEVER be wired into:
 *     • any ad selection, product recommendation, or feeding-introduction path
 *     • any infant-feeding or food-introduction content tied to age
 *   This section is display-only. The S6/S7 invariant is permanent.
 *   Refs: legal §5 S6/S7, CR-1 (Milk Code temporal targeting), register Z-13/Z-8.
 *
 * Placement (design §1):
 *   Pregnant:   after StageBanner, before KickCountCard
 *   Postpartum: after PostpartumDayCard, before SuggestionBanner
 *
 * Props accept ONLY server-derived civil-date data (S4 legal invariant):
 *   'pregnant'   → GestationalAge (derived from EDD via computeGestationalAge)
 *   'postpartum' → PostpartumAge  (derived from birthDate via computePostpartumAge)
 *   No mother-entered health field (weight/BP/symptoms/self-log) can reach here.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { T } from '../theme/tokens';
import { getBabySizeEntry, formatWeightDisplay } from '../pregnancy/babySizeData';
import { formatPostpartumAgeForSection } from './babySizeSectionHelpers';
import type { GestationalAge } from '../pregnancy/gestationalAge';
import type { PostpartumAge } from '../pregnancy/postpartumAge';
import type { BabySizeIconKey } from '../pregnancy/babySizeData';

// ─── Icon map ─────────────────────────────────────────────────────────────────
// Lazy import to keep babySizeData.ts free of React Native imports (pure data).

import {
  BabySizeSmallRoundIcon,
  BabySizeStrawberryIcon,
  BabySizeAppleIcon,
  BabySizeAvocadoIcon,
  BabySizePearIcon,
  BabySizeMangoIcon,
  BabySizeBananaIcon,
  BabySizeCarrotIcon,
  BabySizePapayaIcon,
  BabySizeCornIcon,
  BabySizePineappleIcon,
  BabySizeEggplantIcon,
  BabySizeSquashIcon,
  BabySizeLargeRibbedRoundIcon,
  BabySizeWatermelonIcon,
  BabyFootprintIcon,
} from '../icons';

const BABY_SIZE_ICON_MAP: Record<BabySizeIconKey, React.FC<{ color: string; size: number }>> = {
  'small-round':        BabySizeSmallRoundIcon,
  'strawberry':         BabySizeStrawberryIcon,
  'apple':              BabySizeAppleIcon,
  'avocado':            BabySizeAvocadoIcon,
  'pear':               BabySizePearIcon,
  'mango':              BabySizeMangoIcon,
  'banana':             BabySizeBananaIcon,
  'carrot':             BabySizeCarrotIcon,
  'papaya':             BabySizePapayaIcon,
  'corn':               BabySizeCornIcon,
  'pineapple':          BabySizePineappleIcon,
  'eggplant':           BabySizeEggplantIcon,
  'squash':             BabySizeSquashIcon,
  'large-ribbed-round': BabySizeLargeRibbedRoundIcon,
  'watermelon':         BabySizeWatermelonIcon,
};

// ─── Props ────────────────────────────────────────────────────────────────────
// S4: props accept ONLY civil-date derived types — no mother health fields.

export type BabySizeSectionProps =
  | { variant: 'pregnant'; ga: GestationalAge }
  | { variant: 'postpartum'; pp: PostpartumAge };

// ─── Full-disclaimer Modal ────────────────────────────────────────────────────

function DisclaimerModal({
  visible,
  onClose,
  title,
  body,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body: string;
}): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      accessibilityViewIsModal={true}
    >
      <View style={modalStyles.overlay}>
        <SafeAreaView style={modalStyles.sheet}>
          <View style={modalStyles.handle} accessibilityElementsHidden={true} />
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={modalStyles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="ปิด / Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={modalStyles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={modalStyles.body} contentContainerStyle={modalStyles.bodyContent}>
            <Text style={modalStyles.bodyText}>{body}</Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: T.scrim.color,          // roselle-900-tinted scrim (was rgba(0,0,0,0.4))
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.color.surface.base,   // ivory-100 #FBF6F1
    borderTopLeftRadius: T.radius.lg,        // 20dp
    borderTopRightRadius: T.radius.lg,
    maxHeight: '80%',
    paddingBottom: T.spacing[8],             // 32dp
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: T.color.surface.subtle, // ivory-200 (nearest surface token; was #C8B9C0)
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: T.spacing[3],                 // 12dp
    marginBottom: T.spacing[2],              // 8dp
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: T.spacing[6],         // 24dp
    paddingVertical: T.spacing[3],           // 12dp
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider, // #E8DDD5 (was #EBE1D9)
  },
  title: {
    flex: 1,
    fontFamily: T.type.heading2.fontFamily,  // Sarabun-SemiBold
    fontSize: T.type.heading2.size,          // 20sp
    lineHeight: T.type.heading2.lineHeight,  // 33sp — Thai LH rule
    color: T.color.text.heading,             // roselle-900 #4A2230
  },
  closeBtn: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontFamily: T.type.body.fontFamily,      // Sarabun-Regular
    fontSize: 18,
    color: T.color.text.primary,             // roselle-700 #7A3A52
  },
  body: { flex: 1 },
  bodyContent: { padding: T.spacing[6] },    // 24dp
  bodyText: {
    fontFamily: T.type.body.fontFamily,      // Sarabun-Regular
    fontSize: T.type.body.size,              // 15sp
    lineHeight: T.type.body.lineHeight,      // 25sp — Thai LH rule
    color: T.color.text.heading,             // roselle-900 #4A2230
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function BabySizeSection(props: BabySizeSectionProps): React.JSX.Element | null {
  const { t, locale } = useT();
  const [modalVisible, setModalVisible] = useState(false);

  // ── Pregnant variant ────────────────────────────────────────────────────────

  if (props.variant === 'pregnant') {
    const { ga } = props;
    const entry = getBabySizeEntry(ga.gestationalWeek);

    // Visibility: section hidden for week < 5 (design §1.3)
    if (!entry) return null;

    const FruitIcon = BABY_SIZE_ICON_MAP[entry.iconKey];

    // Fruit name (locale-aware from static table)
    const fruitName = locale === 'th' ? entry.nameTh : entry.nameEn;

    // Size info line
    const sizeInfoLine = entry.weightG !== null
      ? interpolate(t('home.babySizeSizeInfo'), {
          length: entry.lengthCm,
          weight: formatWeightDisplay(entry.weightG, entry.weightIsKg, locale),
        })
      : interpolate(t('home.babySizeSizeInfoLengthOnly'), { length: entry.lengthCm });

    // a11y label — "โดยเฉลี่ย" framing required (legal S3)
    const a11yLabel = locale === 'th'
      ? `ขนาดลูกน้อย โดยเฉลี่ยสัปดาห์ที่ ${ga.gestationalWeek} ทารกยาวประมาณ ${entry.lengthCm} เซนติเมตร${entry.weightG ? ' น้ำหนักประมาณ ' + formatWeightDisplay(entry.weightG, entry.weightIsKg, 'th') : ''}`
      : `Baby size: on average at week ${ga.gestationalWeek}, a baby is approximately ${entry.lengthCm} cm long${entry.weightG ? ' · ' + formatWeightDisplay(entry.weightG, entry.weightIsKg, 'en') : ''}`;

    return (
      <>
        {/*
          FIX (disclaimer-modal bug): The outer View is now a plain layout wrapper
          with NO accessibilityRole/accessibilityLabel.  Previously it had
          accessibilityRole="text" + accessibilityLabel which made the entire section
          isAccessibilityElement=YES on iOS, swallowing the inner TouchableOpacity
          into the parent accessibility element and making the modal unreachable via
          VoiceOver.  The accessible summary now lives on the content-row View only.
        */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('home.babySizeSectionLabel')}</Text>

          {/* Content row — accessible summary for screen readers (design §0 + a11y fix).
              accessibilityRole="text" + accessibilityLabel replaced the former
              accessibilityElementsHidden={true}; the full a11yLabel is read once here. */}
          <View
            style={babySizeStyles.row}
            accessibilityRole="text"
            accessibilityLabel={a11yLabel}
          >
            {/* Icon: decorative — merged into parent's accessible element */}
            <FruitIcon color={T.color.accent.identity} size={28} />
            <View style={babySizeStyles.textCol}>
              {/* Primary line: fruit name */}
              <Text style={babySizeStyles.primaryLinePink}>{fruitName}</Text>
              {/* Secondary line: size info */}
              <Text style={babySizeStyles.secondaryLine}>{sizeInfoLine}</Text>
            </View>
          </View>

          {/* Disclaimer — LEGALLY MANDATORY (S5). Always-on. NEVER hide. */}
          <Text style={babySizeStyles.disclaimer}>
            {t('home.babySizeDisclaimer')}
          </Text>

          {/* "ดูเพิ่มเติม" — ≥48dp tap target (design B3 / §3.2 / a11y touch-target rule).
              OUTSIDE the accessibilityRole="text" container so VoiceOver can reach
              this button as a standalone interactive element (root-cause fix). */}
          <TouchableOpacity
            testID="baby-size-disclaimer-link"
            style={babySizeStyles.disclaimerLinkRow}
            onPress={() => setModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="ดูข้อความแจ้งเตือนฉบับเต็ม / View full disclaimer"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={babySizeStyles.disclaimerLink}>
              {t('home.babySizeDisclaimerLink')}
            </Text>
          </TouchableOpacity>

          {/* Source ribbon — pregnant variant only (size numbers; postpartum has no numbers). */}
          {/* [source/year to confirm before prod: research pass = BabyCenter Fetal Growth Chart; year 2024 pending confirmation on the cited page] */}
          <Text style={babySizeStyles.sourceRibbon} accessibilityElementsHidden={true}>
            {t('home.babySizeSourceRibbon')}
          </Text>
        </View>

        <DisclaimerModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          title={t('home.babySizeDisclaimerModalTitle')}
          body={t('home.babySizeFullDisclaimer')}
        />
      </>
    );
  }

  // ── Postpartum variant ──────────────────────────────────────────────────────

  const { pp } = props;
  const ageLabel = formatPostpartumAgeForSection(pp, locale);

  // a11y label for postpartum — use ageLabel directly.
  // ageLabel already contains "ลูกน้อย…" (th) / "Baby…" (en), so no prefix
  // needed. Prefixing "ลูกน้อยของคุณ" + ageLabel would duplicate "ลูกน้อย".
  const ppA11yLabel = ageLabel;

  return (
    <>
      {/*
        FIX (disclaimer-modal bug): Same root-cause fix as pregnant variant.
        The outer View is now a plain layout wrapper (no accessibilityRole).
        The accessible summary lives on the content-row View only so the
        disclaimer link TouchableOpacity is reachable via VoiceOver.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('home.babyYourBabySectionLabel')}</Text>

        {/* Content row — accessible summary for screen readers (a11y fix).
            accessibilityRole="text" + accessibilityLabel replaced the former
            accessibilityElementsHidden={true}. */}
        <View
          style={babySizeStyles.row}
          accessibilityRole="text"
          accessibilityLabel={ppA11yLabel}
        >
          {/* BabyFootprintIcon: decorative — merged into parent's accessible element */}
          <BabyFootprintIcon color={T.color.accent.botanical} size={28} />
          <View style={babySizeStyles.textCol}>
            {/* Primary line: age */}
            <Text style={babySizeStyles.primaryLineInk}>{ageLabel}</Text>
            {/* Secondary line: warm note */}
            <Text style={babySizeStyles.secondaryLine}>{t('home.babyWarmNote')}</Text>
          </View>
        </View>

        {/* Postpartum disclaimer — LEGALLY MANDATORY (S5). Always-on. */}
        <Text style={babySizeStyles.disclaimer}>
          {t('home.babyPostpartumDisclaimer')}
        </Text>

        {/* "ดูเพิ่มเติม" — ≥48dp tap target (a11y touch-target rule).
            OUTSIDE the accessibilityRole="text" container (root-cause fix). */}
        <TouchableOpacity
          testID="baby-size-disclaimer-link"
          style={babySizeStyles.disclaimerLinkRow}
          onPress={() => setModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="ดูข้อความแจ้งเตือนฉบับเต็ม / View full disclaimer"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={babySizeStyles.disclaimerLink}>
            {t('home.babySizeDisclaimerLink')}
          </Text>
        </TouchableOpacity>

        {/* Bottom spacer — postpartum has no size numbers, so no source ribbon here. */}
        <View style={babySizeStyles.postpartumBottomSpacer} accessibilityElementsHidden={true} />
      </View>

      <DisclaimerModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title={t('home.babySizeDisclaimerModalTitle')}
        body={t('home.babyPostpartumDisclaimer')}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Reuses HomeTabScreen's section/sectionLabel tokens. New styles below.

const styles = StyleSheet.create({
  section: { gap: T.spacing[2] },            // 8dp
  sectionLabel: {
    fontFamily: T.type.label.fontFamily,     // Sarabun-SemiBold
    fontSize: T.type.label.size,             // 15sp
    lineHeight: T.type.label.lineHeight,     // 24sp — Thai LH rule (was 16, hardcoded)
    letterSpacing: T.type.label.letterSpacing, // 0 — Thai: zero tracking, no uppercase
    color: T.color.text.botanical,           // jade-800 #2F5042
    marginTop: T.spacing[4],                 // 16dp
    marginBottom: T.spacing[2],              // 8dp
  },
});

const babySizeStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.spacing[3],                       // 12dp
  },
  textCol: {
    flex: 1,
    gap: T.spacing[1],                       // 4dp
  },
  primaryLinePink: {
    // Fruit name — pregnant variant
    fontFamily: T.type.label.fontFamily,     // Sarabun-SemiBold
    fontSize: T.type.label.size,             // 15sp
    lineHeight: T.type.label.lineHeight,     // 24sp — Thai LH rule
    color: T.color.accent.identity,          // roselle-500 #B85C78 (was #A8505A)
  },
  primaryLineInk: {
    // Baby age — postpartum variant
    fontFamily: T.type.label.fontFamily,     // Sarabun-SemiBold
    fontSize: T.type.label.size,             // 15sp
    lineHeight: T.type.label.lineHeight,     // 24sp — Thai LH rule
    color: T.color.text.heading,             // roselle-900 #4A2230 (was #3A2A30)
  },
  secondaryLine: {
    fontFamily: T.type.caption.fontFamily,   // Sarabun-Regular
    fontSize: T.type.caption.size,           // 13sp
    lineHeight: T.type.caption.lineHeight,   // 21sp — Thai LH rule (was 19, 1.46×)
    color: T.color.text.primary,             // roselle-700 #7A3A52 (was #5F4A52)
  },
  /**
   * disclaimer — LEGALLY MANDATORY (S5). Always-on in both variants.
   * Color: T.color.text.primary (roselle-700, 7.70:1 AAA). Font: 13sp Regular,
   * LH 21sp (1.615× — meets §0 R2 Thai stacked-tone-mark rule; was 19/1.46×).
   * NEVER change to #94818A/11pt (withdrawn per design-reviewer B1).
   */
  disclaimer: {
    fontFamily: T.type.caption.fontFamily,   // Sarabun-Regular
    fontSize: T.type.caption.size,           // 13sp
    lineHeight: T.type.caption.lineHeight,   // 21sp — Thai LH rule ✓
    color: T.color.text.primary,             // roselle-700 #7A3A52 (was #5F4A52)
    marginTop: T.spacing[2],                 // 8dp
  },
  /**
   * sourceRibbon — G-size-2 research pass source attribution.
   * Pregnant variant only (postpartum has no size numbers).
   * Color: T.color.text.primary (roselle-700). Font: 11sp Regular, LH 18sp (1.636×).
   * NEVER use #94818A (withdrawn per design-reviewer B1 — too low contrast for small text).
   */
  sourceRibbon: {
    fontFamily: T.type.micro.fontFamily,     // Sarabun-Regular
    fontSize: T.type.micro.size,             // 11sp
    lineHeight: T.type.micro.lineHeight,     // 18sp — Thai LH rule (was 16, 1.45×)
    color: T.color.text.primary,             // roselle-700 #7A3A52 (was #5F4A52)
    marginTop: T.spacing[1],                 // 4dp
  },
  /**
   * disclaimerLinkRow — ≥48dp tap target (design B3 / a11y touch-target rule).
   * minHeight:48 + hitSlop:8 ensures ≥48dp tappable area under dynamic type.
   */
  disclaimerLinkRow: {
    minHeight: 48,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  disclaimerLink: {
    fontFamily: T.type.caption.fontFamily,   // Sarabun-Regular
    fontSize: T.type.caption.size,           // 13sp
    lineHeight: T.type.caption.lineHeight,   // 21sp — Thai LH rule
    color: T.color.accent.identity,          // roselle-500 #B85C78 (was #A8505A)
    textDecorationLine: 'underline',
  },
  /**
   * postpartumBottomSpacer — replaces the former inline `<View style={{height:16}}>`.
   * Postpartum variant has no source ribbon, so this closes the section gap.
   */
  postpartumBottomSpacer: {
    height: T.spacing[4],                    // 16dp
  },
});
