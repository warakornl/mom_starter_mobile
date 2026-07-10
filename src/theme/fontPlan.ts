/**
 * fontPlan.ts — Font loading configuration for ห้องแม่ / The Mother's Room.
 *
 * Spec: docs/design/mother-room-build-spec.md §2
 *
 * Font pairing (§2.3 — not a superfamily, a typographic PAIRING):
 *   Sarabun  — primary for TH and all body text; both scripts covered
 *   Fraunces — additive EN personality; bilingual surfaces only (max 2/screen)
 *
 * Fraunces italic is SKIPPED per design-reviewer nit.
 * Fraunces load failure degrades silently to Sarabun-SemiBold (§2.2).
 *
 * This module exports pure constants — no native code, no expo-font — so it
 * can be unit-tested in a pure-Node Jest environment. App.tsx consumes these
 * keys when building the useFonts() argument object.
 *
 * Import in App.tsx alongside the actual font files:
 *   import { REQUIRED_FONTS } from './src/theme/fontPlan';
 *   import { Sarabun_400Regular, Sarabun_600SemiBold } from '@expo-google-fonts/sarabun';
 *   import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
 */

/**
 * Maps CSS font-family names (used in StyleSheet) → Expo font-file export name.
 * The font-family name on the left is what you use in `fontFamily: 'Sarabun-Regular'`.
 * The value is the Expo Google Fonts named export key (for documentation; actual
 * font objects are passed by the caller).
 *
 * NOTE: Fraunces italic intentionally excluded (reviewer nit — skip optional weight).
 */
export const REQUIRED_FONTS = {
  'Sarabun-Regular':    'Sarabun_400Regular',   // Sarabun weight 400
  'Sarabun-SemiBold':   'Sarabun_600SemiBold',  // Sarabun weight 600
  'Fraunces-SemiBold':  'Fraunces_600SemiBold', // Fraunces weight 600 (EN bilingual only)
} as const;

export type FontFamilyName = keyof typeof REQUIRED_FONTS;

/**
 * Fallback font family for:
 *   a) TH locale: all Fraunces references fall back to this
 *   b) Fraunces load failure: entire Fraunces usage degrades to this
 * §2.2: "Fraunces load failure must NOT crash the app — it degrades silently."
 */
export const THAI_FALLBACK_FONT: FontFamilyName = 'Sarabun-SemiBold';

/**
 * True: Fraunces is an optional enhancement, not a required dependency.
 * If useFonts returns an error for Fraunces only, the app continues with
 * Sarabun-SemiBold in all positions that would have shown Fraunces.
 * §2.2: "If useFonts returns error for Fraunces only: continue."
 */
export const FRAUNCES_IS_OPTIONAL = true;
