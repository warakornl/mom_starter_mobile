/**
 * src/icons/index.ts — barrel export for all SVG line icons.
 *
 * Tab bar icons (6): used in CustomTabBar ICON_MAP
 * Stage icons (4): used in StageBanner + PostpartumBanner
 * Baby-size comparison icons (15 + 1 postpartum): used in BabySizeSection
 *
 * Spec: minimal-redesign-clean-spec.md §3
 *       baby-size-home-section.md §5 (icon set)
 */

export { TabChecklistIcon } from './TabChecklistIcon';
export { TabCoinsIcon } from './TabCoinsIcon';
export { TabHomeIcon } from './TabHomeIcon';
export { TabCalendarIcon } from './TabCalendarIcon';
export { TabPillIcon } from './TabPillIcon';
export { TabPersonIcon } from './TabPersonIcon';

export { StageT1Icon } from './StageT1Icon';
export { StageT2Icon } from './StageT2Icon';
export { StageT3Icon } from './StageT3Icon';
export { PostpartumStageIcon } from './PostpartumStageIcon';

// ── Baby-size comparison icons (16 new files) ─────────────────────────────────
// 15 fruit/object icons + 1 postpartum footprint
// Design: baby-size-home-section.md §5
export { BabySizeSmallRoundIcon }       from './BabySizeSmallRoundIcon';       // wks 5–9, 11–13
export { BabySizeStrawberryIcon }       from './BabySizeStrawberryIcon';       // wk 10
export { BabySizeAppleIcon }            from './BabySizeAppleIcon';            // wks 14–15
export { BabySizeAvocadoIcon }          from './BabySizeAvocadoIcon';          // wk 16
export { BabySizePearIcon }             from './BabySizePearIcon';             // wk 17
export { BabySizeMangoIcon }            from './BabySizeMangoIcon';            // wks 18–19
export { BabySizeBananaIcon }           from './BabySizeBananaIcon';           // wk 20
export { BabySizeCarrotIcon }           from './BabySizeCarrotIcon';           // wk 21
export { BabySizePapayaIcon }           from './BabySizePapayaIcon';           // wks 22, 26, 36
export { BabySizeCornIcon }             from './BabySizeCornIcon';             // wks 23–24
export { BabySizePineappleIcon }        from './BabySizePineappleIcon';        // wks 25, 32–33
export { BabySizeEggplantIcon }         from './BabySizeEggplantIcon';         // wks 27–28
export { BabySizeSquashIcon }           from './BabySizeSquashIcon';           // wks 29–30 (น้ำเต้า)
export { BabySizeLargeRibbedRoundIcon } from './BabySizeLargeRibbedRoundIcon'; // wks 31, 34–35, 40
export { BabySizeWatermelonIcon }       from './BabySizeWatermelonIcon';       // wks 37–39
export { BabyFootprintIcon }            from './BabyFootprintIcon';            // postpartum only
