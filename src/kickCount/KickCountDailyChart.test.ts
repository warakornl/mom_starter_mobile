/**
 * KickCountDailyChart.test.ts — TDD (RED → GREEN) structural tests.
 *
 * Jest runs in node, so native modules (react-native, react-native-svg) must be
 * stubbed. We test:
 *   1. The component is exported as a named function.
 *   2. The design-token constants (rose bar fill, hairline color) are accessible.
 *   3. i18n keys for chart A11y, empty state, and chart title exist.
 *   4. K-8: the component module contains NO console.* calls.
 *
 * Full SVG render tests are excluded (no @testing-library/react-native in this
 * jest environment); rendering is verified via manual QA + the existing node-env
 * pattern used by icons/tabCoinsIcon.test.ts.
 */

// ─── Stubs ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (o: unknown) => o },
  Platform: { OS: 'ios' },
}));

jest.mock('react-native-svg', () => {
  const mk = (n: string) => n;
  return {
    default: mk('Svg'),
    Svg: mk('Svg'),
    Rect: mk('Rect'),
    Line: mk('Line'),
    Text: mk('Text'),
    G: mk('G'),
    SvgXml: mk('SvgXml'),
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { catalog } from '../i18n/messages';

// ─── 1. Component export ──────────────────────────────────────────────────────

describe('KickCountDailyChart — component export', () => {
  it('KickCountDailyChart is exported as a function (React component)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountDailyChart') as Record<string, unknown>;
    expect(typeof mod['KickCountDailyChart']).toBe('function');
  });
});

// ─── 2. Design tokens ────────────────────────────────────────────────────────

describe('KickCountDailyChart — design tokens (B3 reskin)', () => {
  it('exports CHART_AMBER_FILL color matching T.color.accent.milestone (#B8720E)', () => {
    // B3 reskin: rose bars (#A8505A) → amber-600 (#B8720E) K-5b uniform fill
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountDailyChart') as Record<string, unknown>;
    expect(mod['CHART_AMBER_FILL']).toBe('#B8720E');
  });

  it('exports CHART_DIVIDER color matching T.color.surface.divider (#E8DDD5)', () => {
    // B3 reskin: hairline (#E3D8CE) → divider token (#E8DDD5)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountDailyChart') as Record<string, unknown>;
    expect(mod['CHART_DIVIDER']).toBe('#E8DDD5');
  });

  it('exports CHART_LABEL_COLOR matching T.color.text.primary roselle-700 (#7A3A52)', () => {
    // B3 reskin: ink (#1A1A1A) → roselle-700 (#7A3A52) axis labels
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountDailyChart') as Record<string, unknown>;
    expect(mod['CHART_LABEL_COLOR']).toBe('#7A3A52');
  });
});

// ─── 3. i18n key coverage ────────────────────────────────────────────────────

describe('KickCountDailyChart — i18n key coverage', () => {
  it('kick.chartA11y exists in Thai catalog and contains {n} and {max}', () => {
    const val = catalog.th['kick.chartA11y'];
    expect(val).toBeTruthy();
    expect(val).toContain('{n}');
    expect(val).toContain('{max}');
  });

  it('kick.chartA11y exists in English catalog', () => {
    const val = catalog.en['kick.chartA11y'];
    expect(val).toBeTruthy();
    expect(val).toContain('{n}');
    expect(val).toContain('{max}');
  });

  it('kick.chartEmpty exists in Thai catalog', () => {
    expect(catalog.th['kick.chartEmpty']).toBeTruthy();
  });

  it('kick.chartEmpty exists in English catalog', () => {
    expect(catalog.en['kick.chartEmpty']).toBeTruthy();
  });

  it('kick.chartTitle exists in both catalogs', () => {
    expect(catalog.th['kick.chartTitle']).toBeTruthy();
    expect(catalog.en['kick.chartTitle']).toBeTruthy();
  });
});

// ─── 4. K-8: no logging of session data ──────────────────────────────────────

describe('KickCountDailyChart — K-8 no session data logging', () => {
  it('module source does not contain console.log calls', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'KickCountDailyChart.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/);
  });
});
