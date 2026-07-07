/**
 * tabCoinsIcon.test.ts — TDD tests for the TabCoinsIcon barrel swap.
 *
 * Change: TabWalletIcon (bi-fold wallet) is replaced by TabCoinsIcon
 * (stack of coins) for the Expenses tab. Owner decision.
 *
 * Tests:
 *   1. TabCoinsIcon is exported from the icons barrel (src/icons/index.ts).
 *   2. TabCoinsIcon is a function (React component).
 *   3. TabWalletIcon is NO LONGER exported from the barrel (file deleted).
 *   4. All other icon exports are still present (regression guard).
 *
 * Uses require() so the file compiles even before TabCoinsIcon exists
 * (TypeScript resolves named imports at load-time; require is runtime).
 *
 * react-native-svg cannot load in pure-node Jest; stub it before requiring icons.
 */

// Stub react-native-svg (native module that can't run in Jest/Node).
jest.mock('react-native-svg', () => {
  const mkComponent = (name: string) => name;
  return {
    default: mkComponent('Svg'),
    Svg: mkComponent('Svg'),
    Path: mkComponent('Path'),
    Circle: mkComponent('Circle'),
    Rect: mkComponent('Rect'),
    Line: mkComponent('Line'),
    G: mkComponent('G'),
    Ellipse: mkComponent('Ellipse'),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const icons = require('./index') as Record<string, unknown>;

// ─── TabCoinsIcon present ─────────────────────────────────────────────────────

describe('icons barrel — TabCoinsIcon (coins icon for Expenses tab)', () => {
  it('TabCoinsIcon is exported from src/icons/index.ts', () => {
    expect(icons['TabCoinsIcon']).toBeDefined();
  });

  it('TabCoinsIcon is a function (React component)', () => {
    expect(typeof icons['TabCoinsIcon']).toBe('function');
  });
});

// ─── TabWalletIcon removed ────────────────────────────────────────────────────

describe('icons barrel — TabWalletIcon removed', () => {
  it('TabWalletIcon is NOT exported from src/icons/index.ts (file deleted)', () => {
    expect(icons['TabWalletIcon']).toBeUndefined();
  });
});

// ─── Other exports still present (regression guard) ──────────────────────────

describe('icons barrel — unchanged exports still present', () => {
  it('TabChecklistIcon is still exported', () => {
    expect(typeof icons['TabChecklistIcon']).toBe('function');
  });

  it('TabHomeIcon is still exported', () => {
    expect(typeof icons['TabHomeIcon']).toBe('function');
  });

  it('TabCalendarIcon is still exported', () => {
    expect(typeof icons['TabCalendarIcon']).toBe('function');
  });

  it('TabPillIcon is still exported', () => {
    expect(typeof icons['TabPillIcon']).toBe('function');
  });

  it('TabPersonIcon is still exported', () => {
    expect(typeof icons['TabPersonIcon']).toBe('function');
  });

  it('StageT1Icon is still exported', () => {
    expect(typeof icons['StageT1Icon']).toBe('function');
  });

  it('StageT2Icon is still exported', () => {
    expect(typeof icons['StageT2Icon']).toBe('function');
  });

  it('StageT3Icon is still exported', () => {
    expect(typeof icons['StageT3Icon']).toBe('function');
  });

  it('PostpartumStageIcon is still exported', () => {
    expect(typeof icons['PostpartumStageIcon']).toBe('function');
  });
});
