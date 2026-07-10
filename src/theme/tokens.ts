/**
 * tokens.ts — ห้องแม่ / The Mother's Room design system
 *
 * Three-tier system: primitive → semantic → component
 * Spec: docs/design/mother-room-build-spec.md §1
 *
 * WCAG contrast ratios (formula in spec header):
 *   Light background: ivory-100 #FBF6F1 (L=0.932)
 *   Dark background:  dark-base #241A1E  (L=0.01215)
 *
 * §1.8 Migration: old Clean direction token names are kept as backward-compat
 * aliases on T with UPDATED Mother's Room values. Phase 2 removes the deprecated
 * aliases once all screens are re-skinned.
 *
 * Import patterns:
 *   import { T } from '../theme/tokens'      — all callers (new + compat)
 *   import { tokens } from '../theme/tokens' — structured light/dark access
 */

// ─── Tier 1: Primitive Palette (§1.1) ─────────────────────────────────────────
// L values shown in comments for WCAG computation; not exported.

const ivory100   = '#FBF6F1'; // L=0.932 — Warm milk base; screen background
const ivory200   = '#F5EDE6'; // L=0.841 — Subtle surface, pressed rows, skeleton
const roselle900 = '#4A2230'; // L=0.0281 — Deep plum — headings
const roselle700 = '#7A3A52'; // L=0.0776 — Body text primary
const roselle500 = '#B85C78'; // L=0.1921 — Identity/brand, large text ≥18sp, UI ≥3:1
const roselle400 = '#D4809A'; // L=0.3178 — Dark-mode accent bars only
const roselle200 = '#F2D0DC'; // L=0.6918 — Selected state, active fills
const amber700   = '#9A5F0A'; // L=0.1506 — CTA interactive button fill
const amber600   = '#B8720E'; // L=0.2232 — Progress fill, milestone ring, UI accents
const amber300   = '#F5C96A'; // L=0.6221 — Dark-mode focus ring
const amber100   = '#FDF0D5'; // L=0.876  — Morning-light wash surface
const jade800    = '#2F5042'; // L=0.0674 — Botanical SVG stroke, section text
const jade600    = '#4A7A5C'; // L=0.1615 — Secondary text — MINIMUM 15sp (§0 R4)
const jade200    = '#C4D9CB'; // L=0.6570 — Dark-mode text and botanical stroke
const jade100    = '#E4EDE7'; // L=0.793  — Success wash
const error700   = '#8B2020'; // L=0.0663 — Emergency escalation only
const divider    = '#E8DDD5'; // L=0.739  — Hairlines, 1px borders
const white      = '#FFFFFF'; // L=1.000  — Text on dark/colored surfaces
const darkBase   = '#241A1E'; // L=0.01215 — Dark mode screen background
const darkSubtle = '#2E2227'; // L=0.01881 — Dark mode nested surface
const darkDivider = '#3D3039'; // L=0.03643 — Dark mode hairlines
const darkTextH  = '#F5E6EC'; // L=0.8210 — 14.01:1 on dark base — AAA headings
const darkTextP  = '#EDD4DC'; // L=0.7026 — 12.11:1 on dark base — AAA primary

// ─── Tier 2: Semantic — light mode (§1.2) ─────────────────────────────────────

const lightColor = {
  surface: {
    base:    ivory100,    // #FBF6F1 — App background
    subtle:  ivory200,    // #F5EDE6 — Nested surfaces, skeleton, pressed
    wash: {
      amber:   amber100,  // #FDF0D5 — Morning-light CTA section wash
      jade:    jade100,   // #E4EDE7 — Success / all-handled wash
      roselle: roselle200,// #F2D0DC — Selected state, active fills
    },
    divider: divider,     // #E8DDD5 — Hairlines, 1px borders (decorative)
  },
  text: {
    // §1.2 WCAG ratios on ivory-100 (L=0.932):
    heading:   roselle900, // #4A2230 ratio 12.57:1 AAA — Display + H1/H2 headings
    primary:   roselle700, // #7A3A52 ratio 7.70:1  AAA — Body text, labels, primary content
    secondary: jade600,    // #4A7A5C ratio 4.64:1  AA  — Supporting text — HARD: ≥15sp only (R4)
    botanical: jade800,    // #2F5042 ratio 8.36:1  AAA — Section labels, botanical annotations
    onDark:    white,      // #FFFFFF — Text on colored surfaces
  },
  accent: {
    identity:    roselle500, // #B85C78 ratio 4.06:1 AA large — Brand stripe, left-accent bar (≥18sp or UI ≥3:1)
    interactive: amber700,   // #9A5F0A ratio 4.90:1 AA — CTA fill; white text on it = 5.23:1 AA
    milestone:   amber600,   // #B8720E ratio 3.60:1 AA large — Progress fill, focus ring, icon strokes ≥3dp
    botanical:   jade800,    // #2F5042 ratio 8.36:1 AAA — Botanical SVG stroke
  },
  state: {
    success:   jade600,   // #4A7A5C — Done / logged (≥15sp constraint still applies)
    error:     error700,  // #8B2020 ratio 8.45:1 AAA — Genuine emergency ONLY
    attention: amber700,  // #9A5F0A — Missed / needs-attention (shape as primary cue)
  },
  list: {
    bar: {
      pregnancy: roselle500, // #B85C78 — Left-accent bar: pregnancy rows
      health:    jade800,    // #2F5042 — Left-accent bar: appointments, health rows
    },
  },
} as const;

// ─── Tier 2: Semantic — dark mode (§1.5) ──────────────────────────────────────
// All ratios measured on dark.surface.base #241A1E (L=0.01215)

const darkColor = {
  surface: {
    base:   darkBase,    // #241A1E — Screen background
    subtle: darkSubtle,  // #2E2227 — Nested surface
    wash: {
      amber: '#2E2206' as const, // Dark mode CTA area wash (decorative)
      jade:  '#0D1E15' as const, // Dark mode success wash (decorative)
    },
    divider: darkDivider, // #3D3039 — Dark mode hairlines (decorative)
  },
  text: {
    heading:   darkTextH, // #F5E6EC ratio 14.01:1 AAA — Display, headings
    primary:   darkTextP, // #EDD4DC ratio 12.11:1 AAA — Body text, labels
    secondary: jade200,   // #C4D9CB ratio 11.38:1 AAA — Secondary (≥15sp still enforced)
    botanical: jade200,   // #C4D9CB ratio 11.38:1 AAA — Section labels, botanical
    onDark:    white,     // #FFFFFF — (same token; maps to text on CTA)
  },
  accent: {
    identity:    roselle400, // #D4809A ratio 5.92:1 AA, UI ≥3:1 — Left-accent bars (roselle)
    interactive: amber700,   // #9A5F0A — CTA fill unchanged; white text = 5.23:1 AA ✓
    milestone:   amber300,   // #F5C96A ratio 10.81:1 AAA — Progress fill, focus ring
    botanical:   jade200,    // #C4D9CB ratio 11.38:1 AAA — Botanical SVG stroke
  },
  state: {
    success:   jade200,          // #C4D9CB
    error:     '#E88080' as const, // ≥4.5:1 on dark base — Genuine emergency
    attention: amber700,         // #9A5F0A
  },
  list: {
    bar: {
      pregnancy: roselle400, // #D4809A ratio 5.92:1 UI ≥3:1 ✓
      health:    jade200,    // #C4D9CB ratio 11.38:1 ✓
    },
  },
} as const;

// ─── Spacing — 8dp base scale (§1.6) ─────────────────────────────────────────

const spacing = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,  // screen gutter default
  5:  20,  // screen gutter ≥390pt
  6:  24,  // section gap between major sections
  8:  32,
  10: 40,
  12: 48,
} as const;

// ─── Radius (§1.6) ────────────────────────────────────────────────────────────
// Note: sm=6 (not 8) reads warmer; md=12 (not 8) — CTA card earns rounder.

const radius = {
  sm:   6,   // chips, status pills, focus ring visual
  md:   12,  // CTA button, the ONE primary card per screen
  lg:   20,  // bottom sheet / WeeklyMilestoneSheet (top corners only)
  pill: 999, // tag badges, lifecycle pill
} as const;

// ─── Elevation (§1.6) ────────────────────────────────────────────────────────
// Warm-tinted shadow (roselle-900 base): rgba(74,34,48,*)

const elev = {
  0: {
    shadowColor:   'transparent' as const,
    shadowOffset:  { width: 0, height: 0 } as const,
    shadowRadius:  0,
    shadowOpacity: 0,
    elevation:     0,
  },
  1: {
    // The ONE primary CTA card per screen
    shadowColor:   'rgba(74,34,48,0.07)' as const,
    shadowOffset:  { width: 0, height: 2 } as const,
    shadowRadius:  8,
    shadowOpacity: 1,
    elevation:     2,
  },
  2: {
    // Bottom sheet / WeeklyMilestoneSheet
    shadowColor:   'rgba(74,34,48,0.12)' as const,
    shadowOffset:  { width: 0, height: 8 } as const,
    shadowRadius:  24,
    shadowOpacity: 1,
    elevation:     8,
  },
} as const;

// ─── Type scale (§1.7) ───────────────────────────────────────────────────────
// All line-heights ≥1.6× size — Thai stacked-tone-mark rule (§0 R2).
// R2 resolutions: display LH bumped 48→52; heading1 LH bumped 38→39.
// fontFamilyEn: EN bilingual surfaces only (max 2 per screen), TH always Sarabun.

const type = {
  display: {
    // §0 R1: Fraunces only where English is present + bilingual context.
    // TH locale always falls back to Sarabun-SemiBold.
    fontFamily:    'Sarabun-SemiBold' as const, // TH default
    fontFamilyEn:  'Fraunces-SemiBold' as const, // EN bilingual only (max 2/screen)
    size:          32,
    lineHeight:    52, // 1.625× — §0 R2 (bumped from 48, was 1.50× — FAILED Thai rule)
    fontWeight:    '600' as const,
    letterSpacing: 0,  // Thai: zero tracking; EN Fraunces: +0.03em (apply in component)
  },
  heading1: {
    fontFamily:    'Sarabun-SemiBold' as const,
    fontFamilyEn:  'Fraunces-SemiBold' as const,
    size:          24,
    lineHeight:    39, // 1.625× — §0 R2 (bumped from 38, was 1.583× — FAILED Thai rule)
    fontWeight:    '600' as const,
    letterSpacing: 0,
  },
  heading2: {
    fontFamily:    'Sarabun-SemiBold' as const,
    size:          20,
    lineHeight:    33, // 1.65×
    fontWeight:    '600' as const,
    letterSpacing: 0,
  },
  bodyLarge: {
    fontFamily:    'Sarabun-Regular' as const,
    size:          17,
    lineHeight:    28, // 1.647×
    fontWeight:    '400' as const,
    letterSpacing: 0,
  },
  body: {
    fontFamily:    'Sarabun-Regular' as const,
    size:          15,
    lineHeight:    25, // 1.667×
    fontWeight:    '400' as const,
    letterSpacing: 0,
  },
  label: {
    fontFamily:    'Sarabun-SemiBold' as const,
    size:          15,
    lineHeight:    24, // 1.600× (exactly)
    fontWeight:    '600' as const,
    letterSpacing: 0,
  },
  caption: {
    fontFamily:    'Sarabun-Regular' as const,
    size:          13,
    lineHeight:    21, // 1.615×
    fontWeight:    '400' as const,
    letterSpacing: 0,
  },
  micro: {
    fontFamily:    'Sarabun-Regular' as const,
    size:          11,
    lineHeight:    18, // 1.636× — footnotes only (§1.7 "ไม่ใช่คำแนะนำทางการแพทย์")
    fontWeight:    '400' as const,
    letterSpacing: 0,
  },
} as const;

// ─── Tier 3: Component tokens (§1.3) ──────────────────────────────────────────

const button = {
  primary: {
    bg:       amber700,  // #9A5F0A — CTA fill
    text:     white,     // #FFFFFF — 5.23:1 on amber-700 AA ✓
    radius:   radius.md, // 12dp
    height:   52,        // minimum 52dp tap target
    minWidth: 280,
  },
  secondary: {
    border: divider,     // #E8DDD5 1px
    text:   roselle700,  // #7A3A52 — 7.70:1 AAA
    radius: radius.md,   // 12dp
  },
} as const;

const tab = {
  active: {
    underline: { color: amber700, height: 2 },     // 2dp amber-700 underline below icon
    icon:      { color: roselle900 },               // #4A2230
    label:     { color: roselle900 },               // #4A2230
  },
  inactive: {
    icon:      { color: roselle700 },               // #7A3A52
    label:     { color: roselle700 },               // #7A3A52
  },
  bar: {
    background:     ivory100,   // #FBF6F1 — matches screen background (not white)
    borderColor:    divider,    // #E8DDD5 — 1px top border
    contentHeight:  56,
    focusRingColor: amber600,   // #B8720E — keyboard / switch-control §8.5
  },
} as const;

const list = {
  row: {
    accentBar: {
      width:     3,            // 3dp accent bar
      pregnancy: roselle500,   // #B85C78 — pregnancy rows
      health:    jade800,      // #2F5042 — appointments, health rows
    },
    divider:    { color: divider, style: 'solid' as const, width: 1 },
    subDivider: { color: divider, style: 'dashed' as const, width: 1, dashLength: 4, gapLength: 4 },
    minHeight:  56,
    paddingH:   spacing[4],   // 16dp
  },
} as const;

const progress = {
  track:  { color: divider },   // #E8DDD5
  fill:   { color: amber600 },  // #B8720E — amber-600
  height: 4,
} as const;

const botanical = {
  stroke: { width: 1.5, color: jade800 }, // 1.5dp jade-800 #2F5042
  cap:    'round' as const,
  join:   'round' as const,
} as const;

const focus = {
  ring: { color: amber600, width: 2, offset: 2 }, // #B8720E focus ring
} as const;

const skeleton = {
  color: ivory200, // #F5EDE6 — bone color
} as const;

const errorPanel = {
  bg:       ivory100,    // #FBF6F1
  headline: roselle900,  // #4A2230
  body:     jade600,     // #4A7A5C (at 15sp — satisfies R4)
} as const;

const offlinePill = {
  bg:   ivory200,  // #F5EDE6
  text: jade600,   // #4A7A5C (at ≥15sp)
} as const;

// ─── Structured export (new API) ──────────────────────────────────────────────

export const tokens = {
  light: {
    color:      lightColor,
    spacing,
    radius,
    elev,
    type,
    button,
    tab,
    list,
    progress,
    botanical,
    focus,
    skeleton,
    errorPanel,
    offlinePill,
  },
  dark: {
    color: darkColor,
  },
} as const;

// ─── T — flat export (backward-compat + flagship access) ─────────────────────
//
// Every caller uses: import { T } from '../theme/tokens'
//
// §1.8 Migration map: old Clean direction token names kept with UPDATED values.
// These @deprecated aliases will be removed in Phase 2 when each screen is
// fully re-skinned to the new semantic namespace.
//
// New flagship screens access semantic tokens via T.color.*, T.spacing[*], etc.

export const T = {
  // ── §1.8 Backward-compat aliases (old Clean names → new Mother's Room values) ──

  /**
   * @deprecated Phase 2: use T.color.surface.divider
   * §1.8: was '#E3D8CE'; updated to color.surface.divider = '#E8DDD5'
   * WCAG: decorative only (hairlines / borders)
   */
  hairline: divider,                             // '#E8DDD5'

  /**
   * @deprecated Phase 2: use T.radius.md (CTA card) or T.radius.sm (chips)
   * §1.8: was 8; updated to radius.md = 12 (warmer, less generic per §1.6)
   */
  cardRadius: radius.md,                         // 12

  /**
   * @deprecated Phase 2: use T.radius.pill
   * §1.8: retained at 999 (same value)
   */
  pillRadius: radius.pill,                       // 999

  /**
   * @deprecated Phase 2: use T.type.display.size
   * §1.8: was 28; updated to type.display.size = 32 (week hero §4.1)
   */
  heroFontSize: type.display.size,               // 32

  /**
   * @deprecated Phase 2: use T.type.display.fontFamily
   * §1.8: was 'IBMPlexSans-SemiBold'; updated to 'Sarabun-SemiBold'
   */
  heroFontFamily: type.display.fontFamily,       // 'Sarabun-SemiBold'

  /**
   * @deprecated Phase 2: use T.type.label.size (section headers now label-sized)
   * §1.8: was 11; updated to type.label.size = 15
   */
  sectionLabelFontSize: type.label.size,         // 15

  /**
   * @deprecated Phase 2: use T.type.label.fontFamily
   * §1.8: was 'IBMPlexSans-SemiBold'; updated to 'Sarabun-SemiBold'
   */
  sectionLabelFontFamily: type.label.fontFamily, // 'Sarabun-SemiBold'

  /**
   * @deprecated Phase 2: use T.type.label.letterSpacing
   * §1.8: was 0.8; updated to 0 (Thai Sarabun: zero tracking; no uppercase)
   */
  sectionLabelLetterSpacing: type.label.letterSpacing, // 0

  /**
   * @deprecated Phase 2: use T.color.text.botanical
   * §1.8: was '#5F4A52' (inkSoft); updated to color.text.botanical = '#2F5042'
   */
  sectionLabelColor: lightColor.text.botanical,  // '#2F5042'

  // ── New semantic namespaces (flagship screens use these) ───────────────────
  color:      lightColor,
  spacing,
  radius,
  elev,
  type,
  button,
  tab,
  list,
  progress,
  botanical,
  focus,
  skeleton,
  errorPanel,
  offlinePill,
  dark:       darkColor,
} as const;
