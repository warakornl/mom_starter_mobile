/**
 * tokens.motherRoom.test.ts — TDD tests for the Mother's Room token system.
 *
 * Spec: docs/design/mother-room-build-spec.md §1
 *
 * Tests:
 *   1. Backward-compat T aliases carry Mother's Room values (§1.8 migration map)
 *   2. Light semantic color tokens match spec §1.2
 *   3. Dark semantic color tokens match spec §1.5
 *   4. Spacing scale (8dp base) §1.6
 *   5. Radius scale §1.6
 *   6. Type scale meets ≥1.6× Thai line-height rule §1.7 / §0 R2
 *   7. Component tokens (button, tab, list, botanical) §1.3
 *   8. tokens.light and tokens.dark structured export
 *
 * Pure-Node environment — no RN imports required.
 */

import { T, tokens } from './tokens';

// ─── 1. Backward-compat aliases — §1.8 migration map ────────────────────────

describe('T — §1.8 backward-compat aliases (Mother Room values)', () => {
  it('T.hairline is new divider #E8DDD5 (was #E3D8CE)', () => {
    expect(T.hairline).toBe('#E8DDD5');
  });

  it('T.cardRadius is 12 / radius.md (was 8; warmer per spec §1.6)', () => {
    expect(T.cardRadius).toBe(12);
  });

  it('T.pillRadius is still 999 / radius.pill', () => {
    expect(T.pillRadius).toBe(999);
  });

  it('T.heroFontSize is 32 / type.display.size (was 28)', () => {
    expect(T.heroFontSize).toBe(32);
  });

  it('T.heroFontFamily is Sarabun-SemiBold (was IBMPlexSans-SemiBold)', () => {
    expect(T.heroFontFamily).toBe('Sarabun-SemiBold');
  });

  it('T.sectionLabelFontSize is 15 / type.label.size (was 11)', () => {
    expect(T.sectionLabelFontSize).toBe(15);
  });

  it('T.sectionLabelFontFamily is Sarabun-SemiBold (was IBMPlexSans-SemiBold)', () => {
    expect(T.sectionLabelFontFamily).toBe('Sarabun-SemiBold');
  });

  it('T.sectionLabelLetterSpacing is 0 (was 0.8; Thai no tracking)', () => {
    expect(T.sectionLabelLetterSpacing).toBe(0);
  });

  it('T.sectionLabelColor is #2F5042 / color.text.botanical (was #5F4A52)', () => {
    expect(T.sectionLabelColor).toBe('#2F5042');
  });
});

// ─── 2. Light semantic color tokens — §1.2 ───────────────────────────────────

describe('T.color — light semantic tokens (§1.2)', () => {
  describe('surface', () => {
    it('color.surface.base is #FBF6F1 (ivory-100 — App background)', () => {
      expect(T.color.surface.base).toBe('#FBF6F1');
    });

    it('color.surface.subtle is #F5EDE6 (ivory-200 — skeleton, pressed)', () => {
      expect(T.color.surface.subtle).toBe('#F5EDE6');
    });

    it('color.surface.divider is #E8DDD5 (decorative hairlines)', () => {
      expect(T.color.surface.divider).toBe('#E8DDD5');
    });

    it('color.surface.wash.amber is #FDF0D5 (amber-100 — CTA wash)', () => {
      expect(T.color.surface.wash.amber).toBe('#FDF0D5');
    });

    it('color.surface.wash.jade is #E4EDE7 (jade-100 — success wash)', () => {
      expect(T.color.surface.wash.jade).toBe('#E4EDE7');
    });
  });

  describe('text — WCAG ratios on ivory-100 (L=0.932)', () => {
    it('color.text.heading is #4A2230 (roselle-900; 12.57:1 AAA)', () => {
      expect(T.color.text.heading).toBe('#4A2230');
    });

    it('color.text.primary is #7A3A52 (roselle-700; 7.70:1 AAA)', () => {
      expect(T.color.text.primary).toBe('#7A3A52');
    });

    it('color.text.secondary is #4A7A5C (jade-600; 4.64:1 AA; ≥15sp only)', () => {
      expect(T.color.text.secondary).toBe('#4A7A5C');
    });

    it('color.text.botanical is #2F5042 (jade-800; 8.36:1 AAA)', () => {
      expect(T.color.text.botanical).toBe('#2F5042');
    });

    it('color.text.onDark is #FFFFFF', () => {
      expect(T.color.text.onDark).toBe('#FFFFFF');
    });

    it('inkFaint #94818A is NOT a color token (BANNED per §1.8)', () => {
      const allValues = JSON.stringify(T.color);
      expect(allValues).not.toContain('#94818A');
    });
  });

  describe('accent', () => {
    it('color.accent.identity is #B85C78 (roselle-500; brand stripe)', () => {
      expect(T.color.accent.identity).toBe('#B85C78');
    });

    it('color.accent.interactive is #9A5F0A (amber-700; CTA fill)', () => {
      expect(T.color.accent.interactive).toBe('#9A5F0A');
    });

    it('color.accent.milestone is #B8720E (amber-600; progress fill)', () => {
      expect(T.color.accent.milestone).toBe('#B8720E');
    });

    it('color.accent.botanical is #2F5042 (jade-800; SVG stroke)', () => {
      expect(T.color.accent.botanical).toBe('#2F5042');
    });
  });

  describe('list bars', () => {
    it('color.list.bar.pregnancy is #B85C78 (roselle-500)', () => {
      expect(T.color.list.bar.pregnancy).toBe('#B85C78');
    });

    it('color.list.bar.health is #2F5042 (jade-800)', () => {
      expect(T.color.list.bar.health).toBe('#2F5042');
    });
  });
});

// ─── 3. Dark tokens — §1.5 ───────────────────────────────────────────────────

describe('T.dark — dark mode tokens (§1.5)', () => {
  it('dark.surface.base is #241A1E (warm near-black; L=0.01215)', () => {
    expect(T.dark.surface.base).toBe('#241A1E');
  });

  it('dark.text.heading is #F5E6EC (14.01:1 AAA on dark base)', () => {
    expect(T.dark.text.heading).toBe('#F5E6EC');
  });

  it('dark.text.primary is #EDD4DC (12.11:1 AAA on dark base)', () => {
    expect(T.dark.text.primary).toBe('#EDD4DC');
  });

  it('dark.text.secondary is #C4D9CB (11.38:1 AAA on dark base)', () => {
    expect(T.dark.text.secondary).toBe('#C4D9CB');
  });

  it('dark.accent.identity is #D4809A (roselle-400; 5.92:1 UI ≥3:1)', () => {
    expect(T.dark.accent.identity).toBe('#D4809A');
  });

  it('dark.accent.milestone is #F5C96A (amber-300; focus ring in dark mode)', () => {
    expect(T.dark.accent.milestone).toBe('#F5C96A');
  });

  it('dark.list.bar.pregnancy is #D4809A (roselle-400; 5.92:1 UI ≥3:1)', () => {
    expect(T.dark.list.bar.pregnancy).toBe('#D4809A');
  });

  it('dark.list.bar.health is #C4D9CB (jade-200; 11.38:1 AAA)', () => {
    expect(T.dark.list.bar.health).toBe('#C4D9CB');
  });
});

// ─── 4. Spacing scale — §1.6 ────────────────────────────────────────────────

describe('T.spacing — 8dp base scale (§1.6)', () => {
  it('spacing[0] is 0', () => { expect(T.spacing[0]).toBe(0); });
  it('spacing[1] is 4dp', () => { expect(T.spacing[1]).toBe(4); });
  it('spacing[2] is 8dp', () => { expect(T.spacing[2]).toBe(8); });
  it('spacing[3] is 12dp', () => { expect(T.spacing[3]).toBe(12); });
  it('spacing[4] is 16dp (screen gutter)', () => { expect(T.spacing[4]).toBe(16); });
  it('spacing[5] is 20dp', () => { expect(T.spacing[5]).toBe(20); });
  it('spacing[6] is 24dp (section gap)', () => { expect(T.spacing[6]).toBe(24); });
  it('spacing[8] is 32dp', () => { expect(T.spacing[8]).toBe(32); });
  it('spacing[10] is 40dp', () => { expect(T.spacing[10]).toBe(40); });
  it('spacing[12] is 48dp (min touch target)', () => { expect(T.spacing[12]).toBe(48); });
});

// ─── 5. Radius scale — §1.6 ─────────────────────────────────────────────────

describe('T.radius — §1.6', () => {
  it('radius.sm is 6dp (chips, status pills; was 8dp in Clean)', () => {
    expect(T.radius.sm).toBe(6);
  });

  it('radius.md is 12dp (CTA button, primary card; was 8dp in Clean)', () => {
    expect(T.radius.md).toBe(12);
  });

  it('radius.lg is 20dp (bottom sheet top corners)', () => {
    expect(T.radius.lg).toBe(20);
  });

  it('radius.pill is 999dp (tag badges, lifecycle pill)', () => {
    expect(T.radius.pill).toBe(999);
  });
});

// ─── 6. Type scale — §1.7 + §0 R2 (≥1.6× Thai line-height) ────────────────

describe('T.type — §1.7 (all line-heights ≥1.6× size for Thai stacked tone marks)', () => {
  it('type.display: 32sp / 52LH = 1.625× ≥ 1.6× (R2 resolution — bumped from 48)', () => {
    expect(T.type.display.size).toBe(32);
    expect(T.type.display.lineHeight).toBe(52);
    expect(T.type.display.lineHeight / T.type.display.size).toBeGreaterThanOrEqual(1.6);
  });

  it('type.heading1: 24sp / 39LH = 1.625× ≥ 1.6× (R2 resolution — bumped from 38)', () => {
    expect(T.type.heading1.size).toBe(24);
    expect(T.type.heading1.lineHeight).toBe(39);
    expect(T.type.heading1.lineHeight / T.type.heading1.size).toBeGreaterThanOrEqual(1.6);
  });

  it('type.heading2: 20sp / 33LH = 1.65× ≥ 1.6×', () => {
    expect(T.type.heading2.size).toBe(20);
    expect(T.type.heading2.lineHeight).toBe(33);
    expect(T.type.heading2.lineHeight / T.type.heading2.size).toBeGreaterThanOrEqual(1.6);
  });

  it('type.bodyLarge: 17sp / 28LH = 1.647× ≥ 1.6×', () => {
    expect(T.type.bodyLarge.size).toBe(17);
    expect(T.type.bodyLarge.lineHeight).toBe(28);
    expect(T.type.bodyLarge.lineHeight / T.type.bodyLarge.size).toBeGreaterThanOrEqual(1.6);
  });

  it('type.body: 15sp / 25LH = 1.667× ≥ 1.6×', () => {
    expect(T.type.body.size).toBe(15);
    expect(T.type.body.lineHeight).toBe(25);
    expect(T.type.body.lineHeight / T.type.body.size).toBeGreaterThanOrEqual(1.6);
  });

  it('type.label: 15sp / 24LH = 1.600× ≥ 1.6× (exactly)', () => {
    expect(T.type.label.size).toBe(15);
    expect(T.type.label.lineHeight).toBe(24);
    expect(T.type.label.lineHeight / T.type.label.size).toBeGreaterThanOrEqual(1.6);
  });

  it('type.caption: 13sp / 21LH = 1.615× ≥ 1.6×', () => {
    expect(T.type.caption.size).toBe(13);
    expect(T.type.caption.lineHeight).toBe(21);
    expect(T.type.caption.lineHeight / T.type.caption.size).toBeGreaterThanOrEqual(1.6);
  });

  it('type.micro: 11sp / 18LH = 1.636× ≥ 1.6× (footnotes only)', () => {
    expect(T.type.micro.size).toBe(11);
    expect(T.type.micro.lineHeight).toBe(18);
    expect(T.type.micro.lineHeight / T.type.micro.size).toBeGreaterThanOrEqual(1.6);
  });

  it('all type tokens use Sarabun-* font family (no IBM Plex)', () => {
    const families = [
      T.type.display.fontFamily,
      T.type.heading1.fontFamily,
      T.type.heading2.fontFamily,
      T.type.bodyLarge.fontFamily,
      T.type.body.fontFamily,
      T.type.label.fontFamily,
      T.type.caption.fontFamily,
      T.type.micro.fontFamily,
    ];
    for (const fam of families) {
      expect(fam).toMatch(/^Sarabun/);
    }
  });
});

// ─── 7. Component tokens — §1.3 ──────────────────────────────────────────────

describe('T.button — component tokens (§1.3)', () => {
  it('button.primary.bg is amber-700 #9A5F0A (CTA fill)', () => {
    expect(T.button.primary.bg).toBe('#9A5F0A');
  });

  it('button.primary.text is white #FFFFFF (5.23:1 on amber-700 AA)', () => {
    expect(T.button.primary.text).toBe('#FFFFFF');
  });

  it('button.primary.radius is 12dp (radius.md)', () => {
    expect(T.button.primary.radius).toBe(12);
  });

  it('button.primary.height is 52dp', () => {
    expect(T.button.primary.height).toBe(52);
  });
});

describe('T.tab — component tokens (§1.3)', () => {
  it('tab.active.underline.color is amber-700 #9A5F0A', () => {
    expect(T.tab.active.underline.color).toBe('#9A5F0A');
  });

  it('tab.active.underline.height is 2dp', () => {
    expect(T.tab.active.underline.height).toBe(2);
  });

  it('tab.active.icon.color is roselle-900 #4A2230', () => {
    expect(T.tab.active.icon.color).toBe('#4A2230');
  });

  it('tab.inactive.icon.color is roselle-700 #7A3A52', () => {
    expect(T.tab.inactive.icon.color).toBe('#7A3A52');
  });

  it('tab.bar.background is ivory-100 #FBF6F1 (not white)', () => {
    expect(T.tab.bar.background).toBe('#FBF6F1');
  });
});

describe('T.list — component tokens (§1.3)', () => {
  it('list.row.accentBar.width is 3dp', () => {
    expect(T.list.row.accentBar.width).toBe(3);
  });

  it('list.row.accentBar.pregnancy is roselle-500 #B85C78', () => {
    expect(T.list.row.accentBar.pregnancy).toBe('#B85C78');
  });

  it('list.row.accentBar.health is jade-800 #2F5042', () => {
    expect(T.list.row.accentBar.health).toBe('#2F5042');
  });

  it('list.row.minHeight is 56dp', () => {
    expect(T.list.row.minHeight).toBe(56);
  });
});

describe('T.botanical — component tokens (§1.3)', () => {
  it('botanical.stroke.width is 1.5dp', () => {
    expect(T.botanical.stroke.width).toBe(1.5);
  });

  it('botanical.stroke.color is jade-800 #2F5042', () => {
    expect(T.botanical.stroke.color).toBe('#2F5042');
  });

  it('botanical.cap is round', () => {
    expect(T.botanical.cap).toBe('round');
  });
});

// ─── 8. Structured export tokens.light / tokens.dark ─────────────────────────

describe('tokens — structured light/dark export', () => {
  it('tokens.light exists', () => {
    expect(tokens.light).toBeDefined();
  });

  it('tokens.dark exists', () => {
    expect(tokens.dark).toBeDefined();
  });

  it('tokens.light.color.surface.base is #FBF6F1', () => {
    expect(tokens.light.color.surface.base).toBe('#FBF6F1');
  });

  it('tokens.dark.color.surface.base is #241A1E', () => {
    expect(tokens.dark.color.surface.base).toBe('#241A1E');
  });
});
