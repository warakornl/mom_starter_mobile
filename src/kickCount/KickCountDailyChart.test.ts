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

describe('KickCountDailyChart — design tokens', () => {
  it('exports CHART_ROSE_FILL color matching T.rose (#A8505A)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountDailyChart') as Record<string, unknown>;
    expect(mod['CHART_ROSE_FILL']).toBe('#A8505A');
  });

  it('exports CHART_HAIRLINE color matching T.hairline (#E3D8CE)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountDailyChart') as Record<string, unknown>;
    expect(mod['CHART_HAIRLINE']).toBe('#E3D8CE');
  });

  it('exports CHART_INK color for labels (#1A1A1A)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KickCountDailyChart') as Record<string, unknown>;
    expect(mod['CHART_INK']).toBe('#1A1A1A');
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
