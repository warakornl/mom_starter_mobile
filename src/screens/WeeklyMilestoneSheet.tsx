/**
 * WeeklyMilestoneSheet — Bottom-sheet modal for weekly pregnancy milestone (§4.2).
 *
 * Spec: docs/design/mother-room-build-spec.md §4.2
 *
 * NOT a new route. Presented as a React Native Modal within HomeTabScreen.
 * Triggered by: week-zone tap on HomeTabScreen (§4.2 trigger).
 *
 * Navigation map (§4.3):
 *   Inbound:  HomeTabScreen week-zone tap → visible=true
 *   Outbound: ← ปิด button / swipe-down → visible=false (HomeTabScreen)
 *             CTA "เขียนบันทึกวันนี้" → onNavigateToCapture() → CaptureScreen
 *
 * Layout (§4.2):
 *   Drag handle (4×32dp, ivory-200 pill, centered)
 *   ← ปิด button (48dp tap target)
 *   MilestoneHeroIllustration (120×80dp, animated on open unless loss/reduce-motion)
 *   ─ "ลูกของคุณ" section (hidden in loss state)
 *   ─ "ร่างกายของคุณแม่" section (always present)
 *   ─ "เคล็ดลับ" section (always present)
 *   Amber CTA card (amber-700, 52dp, radius.md 12dp, Sarabun/600 white)
 *
 * A11y (§4.2 sheet a11y):
 *   Modal with accessibilityViewIsModal={true}
 *   Drag handle: decorative (accessibilityElementsHidden={true})
 *   Close button: role=button, label='ปิด', first focus on sheet open
 *   Botanical hero: decorative (accessibilityElementsHidden={true})
 *   Section headings: role=text (heading level 2)
 *   Journal CTA: role=button, label='เขียนบันทึกวันนี้'
 *
 * Loss state (§4.2 loss matrix):
 *   "ลูกของคุณ" section hidden (not greyed — removed entirely)
 *   botanical hero: static (animated=false)
 *   CTA text: "เขียนบันทึกวันนี้" (same as HomeTabScreen loss CTA)
 *
 * Security: never log pregnancy week or health field values.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
} from 'react-native';
import { MilestoneHeroIllustration } from '../illustrations/MilestoneHeroIllustration';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Weekly milestone content for the sheet.
 * All fields optional — sheet handles loading/empty states.
 */
export interface WeeklyMilestoneContent {
  /** Baby body description (§4.2 "ลูกของคุณ" section). e.g. "น้ำหนักประมาณ 1.1 กิโลกรัม" */
  babyBodyText?: string;
  /** Self-care note (§4.2 "ร่างกายของคุณแม่" section). */
  selfCareText?: string;
  /** Practical tip (§4.2 "เคล็ดลับ" section). */
  tipText?: string;
}

export interface WeeklyMilestoneSheetProps {
  /** Controls sheet visibility — set by HomeTabScreen week-zone tap. */
  visible: boolean;
  /**
   * Callback to close the sheet (outbound → HomeTabScreen).
   * Called by ← ปิด button and backdrop tap.
   */
  onClose: () => void;
  /**
   * Callback to navigate to CaptureScreen (outbound → CaptureScreen).
   * §4.3: CTA "เขียนบันทึกวันนี้" → navigation.navigate('Capture')
   */
  onNavigateToCapture: () => void;
  /**
   * Loss state — `true` when profile.lifecycle === 'ended'.
   * §4.2: "ลูกของคุณ" section hidden; botanical hero static; CTA unchanged.
   */
  isLoss?: boolean;
  /** Weekly content. When undefined, sheet shows loading state. */
  content?: WeeklyMilestoneContent;
}

// ─── Sheet state ──────────────────────────────────────────────────────────────

type SheetState =
  | { kind: 'loading' }
  | { kind: 'success'; content: WeeklyMilestoneContent }
  | { kind: 'empty' }
  | { kind: 'error' };

function resolveState(content: WeeklyMilestoneContent | undefined): SheetState {
  if (content === undefined) return { kind: 'loading' };
  if (!content.babyBodyText && !content.selfCareText && !content.tipText) {
    return { kind: 'empty' };
  }
  return { kind: 'success', content };
}

// ─── Sheet skeleton ───────────────────────────────────────────────────────────

function SheetSkeleton(): React.JSX.Element {
  return (
    <View style={skelStyles.container} accessibilityLabel="กำลังโหลดข้อมูลสัปดาห์">
      {/* Botanical hero skeleton: 120×80dp ivory-200 rectangle */}
      <View style={skelStyles.heroBone} />
      {/* Section bones (3 text rows per section) */}
      <View style={[skelStyles.bone, { width: '40%' }]} />
      <View style={skelStyles.bone} />
      <View style={[skelStyles.bone, { width: '80%' }]} />
      <View style={[skelStyles.bone, { width: '40%' }]} />
      <View style={skelStyles.bone} />
    </View>
  );
}

const skelStyles = StyleSheet.create({
  container: { gap: T.spacing[3] },
  heroBone: {
    width: 120,
    height: 80,
    borderRadius: T.radius.sm,
    backgroundColor: T.skeleton.color,
    alignSelf: 'center',
  },
  bone: {
    height: 20,
    borderRadius: T.radius.sm,
    backgroundColor: T.skeleton.color,
    width: '100%',
  },
});

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ label }: { label: string }): React.JSX.Element {
  return (
    <Text
      style={sheetStyles.sectionLabel}
      accessibilityRole="text"
      // §4.2: heading level 2 announced by SR (using accessibilityRole='text' per containment rule)
    >
      {label}
    </Text>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyMilestoneSheet({
  visible,
  onClose,
  onNavigateToCapture,
  isLoss = false,
  content,
}: WeeklyMilestoneSheetProps): React.JSX.Element {
  const { t } = useT();
  const state = resolveState(content);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
      // §4.2: Modal with accessibilityViewIsModal so SR focuses only within sheet
      accessibilityViewIsModal={true}
    >
      {/* Backdrop */}
      <TouchableOpacity
        style={sheetStyles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('milestone.closeSheet')}
        activeOpacity={1}
      />

      {/* Sheet container */}
      <View style={sheetStyles.sheet}>

        {/* §4.2: Drag handle (4×32dp, ivory-200 pill, centered; decorative) */}
        <View
          style={sheetStyles.dragHandle}
          accessibilityElementsHidden={true}
          // @ts-ignore — importantForAccessibility (Android)
          importantForAccessibility="no-hide-descendants"
        />

        {/* §4.2: ← ปิด close button (48dp tap target; first focus on open) */}
        <TouchableOpacity
          testID="milestone-sheet-close"
          style={sheetStyles.closeButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('milestone.close')}
        >
          <Text style={sheetStyles.closeButtonText}>{t('milestone.close')}</Text>
        </TouchableOpacity>

        <ScrollView
          style={sheetStyles.scroll}
          contentContainerStyle={sheetStyles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* §4.2: MilestoneHeroIllustration (120×80dp)
              Loss state: animated=false (static botanical hero)
              Normal: animated=true (400ms path-length grow on sheet open) */}
          <View style={sheetStyles.heroWrapper}>
            <MilestoneHeroIllustration
              color={T.color.accent.botanical}
              animated={!isLoss}
            />
          </View>

          {/* §4.2: "ลูกของคุณ" section — REMOVED in loss state (not greyed) */}
          {!isLoss && (
            <View style={sheetStyles.section}>
              <View style={sheetStyles.sectionDivider}
                accessibilityElementsHidden={true}
                // @ts-ignore
                importantForAccessibility="no-hide-descendants"
              />
              <SectionHeading label={t('milestone.babySection')} />
              {state.kind === 'loading' && <SheetSkeleton />}
              {state.kind === 'empty' && (
                <Text style={sheetStyles.emptyText}>{t('milestone.empty')}</Text>
              )}
              {state.kind === 'success' && state.content.babyBodyText ? (
                <Text style={sheetStyles.bodyLargeText}>
                  {state.content.babyBodyText}
                </Text>
              ) : null}
            </View>
          )}

          {/* §4.2: "ร่างกายของคุณแม่" section — always present (self-care relevant in loss) */}
          <View style={sheetStyles.section}>
            <View style={sheetStyles.sectionDivider}
              accessibilityElementsHidden={true}
              // @ts-ignore
              importantForAccessibility="no-hide-descendants"
            />
            <SectionHeading label={t('milestone.maternitySection')} />
            {state.kind === 'loading' && <SheetSkeleton />}
            {state.kind === 'empty' && (
              <Text style={sheetStyles.emptyText}>{t('milestone.empty')}</Text>
            )}
            {state.kind === 'success' && state.content.selfCareText ? (
              <Text style={sheetStyles.bodyText}>
                {state.content.selfCareText}
              </Text>
            ) : null}
          </View>

          {/* §4.2: "เคล็ดลับ" section — always present */}
          <View style={sheetStyles.section}>
            <View style={sheetStyles.sectionDivider}
              accessibilityElementsHidden={true}
              // @ts-ignore
              importantForAccessibility="no-hide-descendants"
            />
            <SectionHeading label={t('milestone.tipSection')} />
            {state.kind === 'success' && state.content.tipText ? (
              <Text style={sheetStyles.bodyText}>
                {state.content.tipText}
              </Text>
            ) : null}
          </View>

          {/* §4.2: Amber CTA — "เขียนบันทึกวันนี้" */}
          <TouchableOpacity
            testID="milestone-sheet-cta"
            style={sheetStyles.ctaButton}
            onPress={onNavigateToCapture}
            accessibilityRole="button"
            accessibilityLabel={t('milestone.journalCta')}
          >
            <Text style={sheetStyles.ctaText}>{t('milestone.journalCta')}</Text>
            <Text style={sheetStyles.ctaArrow} accessibilityElementsHidden={true}>{'→'}</Text>
          </TouchableOpacity>

        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles (tokens only — no inline hex or px) ───────────────────────────────

const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(74,34,48,0.40)', // roselle-900-tinted scrim (decorative)
  },

  sheet: {
    backgroundColor: T.color.surface.base,   // ivory-100 #FBF6F1 (§4.2)
    borderTopLeftRadius: T.radius.lg,         // 20dp top corners (§4.2)
    borderTopRightRadius: T.radius.lg,
    paddingHorizontal: T.spacing[4],          // 16dp
    paddingTop: T.spacing[3],                 // 12dp above drag handle
    paddingBottom: T.spacing[6],              // 24dp + safe area bottom (§4.2)
    // §4.2: elev/2 — y8 blur24 rgba(74,34,48,0.12)
    shadowColor: T.elev[2].shadowColor,
    shadowOffset: T.elev[2].shadowOffset,
    shadowOpacity: T.elev[2].shadowOpacity,
    shadowRadius: T.elev[2].shadowRadius,
    elevation: T.elev[2].elevation,
  },

  // §4.2: Drag handle — 4dp × 32dp, ivory-200 pill, centered, decorative
  dragHandle: {
    width: 32,
    height: 4,
    borderRadius: T.radius.pill,
    backgroundColor: T.color.surface.subtle,  // ivory-200 #F5EDE6
    alignSelf: 'center',
    marginBottom: T.spacing[3],               // 12dp below handle
  },

  // §4.2: ← ปิด close button — 48dp tap target
  closeButton: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingVertical: T.spacing[2],            // 8dp
    paddingHorizontal: T.spacing[3],          // 12dp
  },
  closeButtonText: {
    fontFamily: T.type.label.fontFamily,      // Sarabun-SemiBold
    fontSize: T.type.label.size,              // 15sp
    lineHeight: T.type.label.lineHeight,      // 24sp
    color: T.color.text.botanical,            // jade-800 #2F5042 (8.36:1 AAA)
  },

  scroll: { maxHeight: 520 },
  scrollContent: {
    gap: T.spacing[4],                        // 16dp between sections
    paddingBottom: T.spacing[6],              // 24dp above safe area
  },

  // §4.2: Botanical hero centered
  heroWrapper: {
    alignItems: 'center',
    paddingVertical: T.spacing[2],            // 8dp
  },

  section: {
    gap: T.spacing[3],                        // 12dp within section
  },

  // §4.2: 1px #E8DDD5 section divider
  sectionDivider: {
    height: 1,
    backgroundColor: T.color.surface.divider, // #E8DDD5
  },

  // §4.2: Section label — jade-600 at 15sp (§0 R4: ≥15sp ✓)
  sectionLabel: {
    fontFamily: T.type.label.fontFamily,      // Sarabun-SemiBold
    fontSize: T.type.label.size,              // 15sp — R4 ≥15sp ✓
    lineHeight: T.type.label.lineHeight,      // 24sp (1.6× Thai rule ✓)
    color: T.color.text.secondary,            // jade-600 #4A7A5C — R4 ≥15sp ✓
  },

  // §4.2: Baby body text — Sarabun/400 17sp bodyLarge roselle-700
  bodyLargeText: {
    fontFamily: T.type.bodyLarge.fontFamily,  // Sarabun-Regular
    fontSize: T.type.bodyLarge.size,          // 17sp
    lineHeight: T.type.bodyLarge.lineHeight,  // 28sp
    color: T.color.text.primary,              // roselle-700 #7A3A52 (7.70:1 AAA)
  },

  // §4.2: Self-care + tip text — Sarabun/400 15sp body roselle-700
  bodyText: {
    fontFamily: T.type.body.fontFamily,       // Sarabun-Regular
    fontSize: T.type.body.size,               // 15sp
    lineHeight: T.type.body.lineHeight,       // 25sp (1.667× Thai rule ✓)
    color: T.color.text.primary,              // roselle-700 #7A3A52
  },

  // §4.2: Empty state text — jade-600 at 15sp (R4 ✓)
  emptyText: {
    fontFamily: T.type.body.fontFamily,       // Sarabun-Regular
    fontSize: T.type.body.size,               // 15sp — R4 ≥15sp ✓
    lineHeight: T.type.body.lineHeight,       // 25sp
    color: T.color.text.secondary,            // jade-600 #4A7A5C (R4 ✓ at 15sp)
  },

  // §4.2: Amber CTA — amber-700, radius.md 12dp, 52dp, Sarabun/600 white
  ctaButton: {
    backgroundColor: T.button.primary.bg,     // amber-700 #9A5F0A
    borderRadius: T.button.primary.radius,    // 12dp (radius.md)
    height: T.button.primary.height,          // 52dp
    paddingHorizontal: T.spacing[4],          // 16dp
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // elev/1 for CTA card — same warm shadow as HomeTabScreen CTA
    shadowColor: T.elev[1].shadowColor,
    shadowOffset: T.elev[1].shadowOffset,
    shadowOpacity: T.elev[1].shadowOpacity,
    shadowRadius: T.elev[1].shadowRadius,
    elevation: T.elev[1].elevation,
    marginTop: T.spacing[2],                  // 8dp above CTA
  },
  ctaText: {
    fontFamily: T.type.label.fontFamily,      // Sarabun-SemiBold
    fontSize: T.type.label.size,              // 15sp
    lineHeight: T.type.label.lineHeight,      // 24sp
    color: T.button.primary.text,             // #FFFFFF
  },
  ctaArrow: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    color: T.button.primary.text,
  },
});
