/**
 * iconStroke.test.ts — TDD guard: Tab + Stage icon strokeWidth = 1.5dp
 *
 * Spec: docs/design/mother-room-build-spec.md §4 (Tab+Stage icon stroke)
 *   "All tab and stage-picker SVG icons: strokeWidth 1.75 → 1.5dp
 *    (thinner weight integrates with the botanical motif language)"
 *
 * Tests verify that every Tab and Stage icon:
 *   1. Contains strokeWidth="1.5"  (correct after migration)
 *   2. Does NOT contain strokeWidth="1.75" (old value, fully replaced)
 *
 * Technique: read source file as text (pure-Node; no SVG/RN imports needed).
 * This is valid because the stroke width is a compile-time constant, not
 * runtime state — the source IS the spec for these decorative icons.
 *
 * BabySize* / BabyFootprint icons are intentionally OUT OF SCOPE for this
 * commit: the spec only specifies Tab and Stage icons (§4).
 *
 * Pure-Node environment — no react-native-svg imports.
 */

import * as fs from 'fs';
import * as path from 'path';

const ICONS_DIR = path.join(__dirname); // test lives alongside the icon files

// §4: ONLY Tab and Stage icons are in scope for stroke-width update
const TAB_STAGE_ICONS = [
  'TabChecklistIcon.tsx',
  'TabCoinsIcon.tsx',
  'TabHomeIcon.tsx',
  'TabCalendarIcon.tsx',
  'TabPillIcon.tsx',
  'TabPersonIcon.tsx',
  'StageT1Icon.tsx',
  'StageT2Icon.tsx',
  'StageT3Icon.tsx',
  'PostpartumStageIcon.tsx',
] as const;

// ─── Stroke-width assertions ──────────────────────────────────────────────────

describe('Tab + Stage icon strokeWidth = 1.5dp (§4 mother-room build spec)', () => {
  for (const iconFile of TAB_STAGE_ICONS) {
    const filePath = path.join(ICONS_DIR, iconFile);

    it(`${iconFile} — no strokeWidth="1.75" (old value fully replaced)`, () => {
      const src = fs.readFileSync(filePath, 'utf-8');
      expect(src).not.toContain('strokeWidth="1.75"');
    });

    it(`${iconFile} — contains strokeWidth="1.5" (new botanical stroke weight)`, () => {
      const src = fs.readFileSync(filePath, 'utf-8');
      expect(src).toContain('strokeWidth="1.5"');
    });
  }
});

// ─── BabySize icons NOT changed (scope guard) ─────────────────────────────────

describe('BabySize icons — OUT OF SCOPE for this commit (unchanged at 1.75)', () => {
  const babySizeIcons = [
    'BabySizeAppleIcon.tsx',
    'BabySizeAvocadoIcon.tsx',
    'BabySizeBananaIcon.tsx',
    'BabySizeCarrotIcon.tsx',
    'BabySizeCornIcon.tsx',
    'BabySizeEggplantIcon.tsx',
    'BabySizeLargeRibbedRoundIcon.tsx',
    'BabySizeMangoIcon.tsx',
    'BabySizePapayaIcon.tsx',
    'BabySizePearIcon.tsx',
    'BabySizePineappleIcon.tsx',
    'BabySizeSmallRoundIcon.tsx',
    'BabySizeSquashIcon.tsx',
    'BabySizeStrawberryIcon.tsx',
    'BabySizeWatermelonIcon.tsx',
  ] as const;

  for (const iconFile of babySizeIcons) {
    it(`${iconFile} — still exists (not deleted by this commit)`, () => {
      expect(fs.existsSync(path.join(ICONS_DIR, iconFile))).toBe(true);
    });
  }
});
