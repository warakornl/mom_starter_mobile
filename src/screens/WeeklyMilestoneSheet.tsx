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
  /**
   * Explicit weekly content override (primarily for tests / a future
   * server-driven content source). When provided, this WINS over the
   * gestationalWeek-derived catalog lookup below.
   *
   * FIX (permanent-skeleton bug): previously HomeTabScreen rendered this
   * sheet with NO `content` prop at all, so resolveState(undefined) always
   * returned 'loading' — the sheet was a permanent skeleton ("the home hero
   * tap opens eternal bones"). `content` is now OPTIONAL and falls back to
   * `resolveWeeklyMilestoneContent(gestationalWeek)` below when omitted.
   */
  content?: WeeklyMilestoneContent;
  /**
   * Current gestational week — used to resolve real content from the static
   * WEEKLY_MILESTONE_CATALOG below when `content` is not explicitly passed.
   * Optional: when both `content` and `gestationalWeek` are omitted, the
   * sheet shows the 'empty' state (not an infinite loading skeleton).
   */
  gestationalWeek?: number;
}

// ─── Sheet state ──────────────────────────────────────────────────────────────

type SheetState =
  | { kind: 'success'; content: WeeklyMilestoneContent }
  | { kind: 'empty' }
  | { kind: 'error' };

/**
 * WEEKLY_MILESTONE_CATALOG — minimal in-file static content, bucketed by
 * trimester (T1 wk<=13, T2 14-27, T3 >=28 — matches gestationalAge.ts
 * currentStage bands).
 *
 * CONTENT SOURCE STATUS: placeholder generic/factual copy — same register as
 * home.babySizeDisclaimer (general information, not medical advice). This is
 * NOT clinician-authored per-week content. [content pending SA/legal review
 * before production — flag per BabySizeSection precedent (see
 * docs/legal/baby-size-content-legal.md pattern); a full week-by-week (5–40)
 * clinician-signed catalog is a separate content-authoring task and may
 * belong in a SHARED content module if other screens need the same data —
 * REPORTED upstream rather than guessed.]
 *
 * S6/S7-equivalent invariant: this content is DISPLAY-ONLY and driven solely
 * by gestationalWeek (civil-date derived) — never wired into ads, product
 * recommendations, or feeding-introduction paths.
 */
const WEEKLY_MILESTONE_CATALOG: Record<'T1' | 'T2' | 'T3', WeeklyMilestoneContent> = {
  T1: {
    babyBodyText: 'ในไตรมาสแรก อวัยวะสำคัญของลูกกำลังก่อตัวขึ้นทีละน้อย',
    selfCareText: 'ร่างกายคุณแม่กำลังปรับตัวรับการเปลี่ยนแปลงของฮอร์โมน พักผ่อนให้เพียงพอและดื่มน้ำสม่ำเสมอ',
    tipText: 'จดบันทึกอาการที่สังเกตได้ในแต่ละวัน จะช่วยให้พูดคุยกับแพทย์ได้ง่ายขึ้นในนัดถัดไป',
  },
  T2: {
    babyBodyText: 'ในไตรมาสที่สอง ลูกน้อยเริ่มเคลื่อนไหวและเติบโตอย่างต่อเนื่อง',
    selfCareText: 'ช่วงนี้คุณแม่หลายคนเริ่มรู้สึกมีแรงมากขึ้น ลองทำกิจกรรมเบาๆ ที่ทำให้ผ่อนคลาย',
    tipText: 'หากยังไม่ได้เริ่มนับการเคลื่อนไหวของลูก ลองสังเกตช่วงเวลาที่ลูกไหวบ่อยในแต่ละวัน',
  },
  T3: {
    babyBodyText: 'ในไตรมาสที่สาม ลูกน้อยกำลังเตรียมพร้อมสำหรับการคลอด',
    selfCareText: 'ร่างกายคุณแม่อาจรู้สึกหนักขึ้น ลองปรับท่านอนและพักผ่อนบ่อยขึ้นตามที่ร่างกายต้องการ',
    tipText: 'เตรียมกระเป๋าสำหรับไปโรงพยาบาลไว้ล่วงหน้า จะช่วยให้อุ่นใจเมื่อถึงเวลาคลอด',
  },
};

/**
 * Resolve trimester bucket from gestationalWeek — mirrors gestationalAge.ts
 * currentStage bands (T1 <=13, T2 14-27, T3 >=28) so the sheet's content
 * always matches the week shown in the home hero.
 */
function resolveWeeklyMilestoneContent(
  gestationalWeek: number | undefined,
): WeeklyMilestoneContent | undefined {
  if (gestationalWeek === undefined) return undefined;
  const stage: 'T1' | 'T2' | 'T3' =
    gestationalWeek <= 13 ? 'T1' : gestationalWeek <= 27 ? 'T2' : 'T3';
  return WEEKLY_MILESTONE_CATALOG[stage];
}

/**
 * resolveState — content is resolved SYNCHRONOUSLY from the static catalog
 * (or an explicit `content` override), so there is no async 'loading' phase
 * anymore (FIX: previously resolveState(undefined) always returned 'loading'
 * because HomeTabScreen never passed a `content` prop — permanent skeleton).
 *
 * 'error' is reached defensively when gestationalWeek is a non-finite /
 * out-of-range number (e.g. NaN from a malformed profile) — a genuine
 * "we could not resolve this week's content" case, distinct from 'empty'
 * (a valid week with deliberately no copy).
 */
function resolveState(
  content: WeeklyMilestoneContent | undefined,
  gestationalWeek: number | undefined,
): SheetState {
  if (gestationalWeek !== undefined && !Number.isFinite(gestationalWeek)) {
    return { kind: 'error' };
  }
  if (!content || (!content.babyBodyText && !content.selfCareText && !content.tipText)) {
    return { kind: 'empty' };
  }
  return { kind: 'success', content };
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ label }: { label: string }): React.JSX.Element {
  return (
    <Text
      style={sheetStyles.sectionLabel}
      // FIX: role="text" collapsed this into plain text for screen readers —
      // it announces as a heading now (role="header"), matching the §4.2 spec
      // comment ("heading level 2 announced by SR") which the code did not
      // actually implement. accessibilityRole="text" on a bare <Text> with no
      // interactive descendants does not trip the containment rule (nothing
      // to swallow), so this is a safe, isolated fix.
      accessibilityRole="header"
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
  gestationalWeek,
}: WeeklyMilestoneSheetProps): React.JSX.Element {
  const { t, locale } = useT();
  // REPORTED (not added here — src/i18n/messages.ts is a shared file outside
  // this task's edit scope): needs a new key 'milestone.error' (th: e.g.
  // "ไม่สามารถโหลดข้อมูลสัปดาห์นี้ได้" / en: "Could not load this week's
  // content"). `t()` is strictly typed against MessageKey, so an
  // as-yet-unadded key fails `tsc`, not just a runtime miss — using a plain
  // locale-branched literal below until the key exists (same pattern as
  // PregnancySummaryScreen.tsx's reported 'ปิด' gap).
  const errorText = locale === 'th'
    ? 'ไม่สามารถโหลดข้อมูลสัปดาห์นี้ได้'
    : "Could not load this week's content";
  // FIX (permanent-skeleton bug): `content` now falls back to the static
  // catalog resolved from `gestationalWeek` when the caller (HomeTabScreen)
  // does not pass an explicit override.
  const resolvedContent = content ?? resolveWeeklyMilestoneContent(gestationalWeek);
  const state = resolveState(resolvedContent, gestationalWeek);

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
              {state.kind === 'error' && (
                <Text style={sheetStyles.errorText}>{errorText}</Text>
              )}
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
            {state.kind === 'error' && (
              <Text style={sheetStyles.errorText}>{errorText}</Text>
            )}
            {state.kind === 'empty' && (
              <Text style={sheetStyles.emptyText}>{t('milestone.empty')}</Text>
            )}
            {state.kind === 'success' && state.content.selfCareText ? (
              <Text style={sheetStyles.bodyText}>
                {state.content.selfCareText}
              </Text>
            ) : null}
          </View>

          {/* §4.2: "เคล็ดลับ" section — always present.
              FIX: this section previously had NO empty/error body text at all
              (missing "เคล็ดลับ" section body in loading/empty per review). */}
          <View style={sheetStyles.section}>
            <View style={sheetStyles.sectionDivider}
              accessibilityElementsHidden={true}
              // @ts-ignore
              importantForAccessibility="no-hide-descendants"
            />
            <SectionHeading label={t('milestone.tipSection')} />
            {state.kind === 'error' && (
              <Text style={sheetStyles.errorText}>{errorText}</Text>
            )}
            {state.kind === 'empty' && (
              <Text style={sheetStyles.emptyText}>{t('milestone.empty')}</Text>
            )}
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
    backgroundColor: T.scrim.color, // roselle-900-tinted modal backdrop (T.scrim; decorative)
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

  // Error state text — roselle-700 at 15sp (safe at any size, unlike jade-600)
  errorText: {
    fontFamily: T.type.body.fontFamily,       // Sarabun-Regular
    fontSize: T.type.body.size,               // 15sp
    lineHeight: T.type.body.lineHeight,       // 25sp
    color: T.color.text.primary,              // roselle-700 #7A3A52
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
