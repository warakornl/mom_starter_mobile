/**
 * renderedIconReplacements.test.ts — TDD guard for task #40 Wave 2
 * (emoji/text-glyph "icons" rendered in the UI → stroke-icon components).
 *
 * Two concerns:
 *
 * 1. CONTRACT: every new icon component is exported from the barrel, is a
 *    function (React component), and its source uses strokeWidth="1.5"
 *    with the {color, size} prop contract — mirroring iconStroke.test.ts's
 *    technique (read source as text; stroke width is a compile-time
 *    constant for these decorative icons).
 *
 * 2. FAIL-ON-REVERT: grep the specific screens we touched for the specific
 *    emoji/glyph characters we replaced. If a regression reintroduces
 *    '🌀' / '✕' / '👁' etc. as a rendered Text glyph, this fails.
 *    Scoped ONLY to the touched screens + ONLY the specific glyphs replaced,
 *    so it does NOT flag comment-marker emoji (🔴🟡🟢) elsewhere in the
 *    codebase, nor emoji left intentionally in i18n catalog copy.
 *
 * Pure-Node environment — no react-native-svg imports for part 1
 * (react-native-svg is stubbed, matching tabCoinsIcon.test.ts's technique).
 */

import * as fs from 'fs';
import * as path from 'path';

const ICONS_DIR = path.join(__dirname);
const REPO_ROOT = path.join(__dirname, '..', '..');

// ─── Part 1: new icon contract ────────────────────────────────────────────────

const NEW_ICONS = [
  'EnvelopeIcon.tsx',
  'EyeIcon.tsx',
  'EyeOffIcon.tsx',
  'BookIcon.tsx',
  'ReceiptIcon.tsx',
  'LockIcon.tsx',
  'CloseIcon.tsx',
  'EditIcon.tsx',
  'BagIcon.tsx',
  'NotebookIcon.tsx',
] as const;

describe('New rendered-icon replacements — strokeWidth 1.5 + {color,size} contract', () => {
  for (const iconFile of NEW_ICONS) {
    const filePath = path.join(ICONS_DIR, iconFile);

    it(`${iconFile} — file exists`, () => {
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it(`${iconFile} — contains strokeWidth="1.5"`, () => {
      const src = fs.readFileSync(filePath, 'utf-8');
      expect(src).toContain('strokeWidth="1.5"');
    });

    it(`${iconFile} — does not hardcode a hex color`, () => {
      const src = fs.readFileSync(filePath, 'utf-8');
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });

    it(`${iconFile} — exposes the {color = 'currentColor', size = 24} prop contract`, () => {
      const src = fs.readFileSync(filePath, 'utf-8');
      expect(src).toContain("color = 'currentColor'");
      expect(src).toContain('size = 24');
    });

    it(`${iconFile} — uses viewBox="0 0 24 24"`, () => {
      const src = fs.readFileSync(filePath, 'utf-8');
      expect(src).toContain('viewBox="0 0 24 24"');
    });
  }
});

describe('New icon barrel exports', () => {
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

  const names = [
    'EnvelopeIcon',
    'EyeIcon',
    'EyeOffIcon',
    'BookIcon',
    'ReceiptIcon',
    'LockIcon',
    'CloseIcon',
    'EditIcon',
    'BagIcon',
    'NotebookIcon',
  ] as const;

  for (const name of names) {
    it(`${name} is exported from src/icons/index.ts and is a function`, () => {
      expect(typeof icons[name]).toBe('function');
    });
  }
});

// ─── Part 2: fail-on-revert emoji/glyph guard ─────────────────────────────────
// Scoped to the exact screens touched + the exact glyphs replaced (task #40).
// Does NOT scan the whole repo — comment-marker emoji (🔴🟡🟢) and i18n
// catalog copy are intentionally out of scope and must not be flagged.

interface GuardCase {
  file: string;
  /** Glyphs that must NOT appear as a rendered UI string in this file anymore. */
  forbidden: string[];
}

const GUARD_CASES: GuardCase[] = [
  {
    file: 'src/suggestion/SuggestionFlowScreen.tsx',
    forbidden: ['🌀', '💊', '📋', '🎒', '📓', '🌱'],
  },
  {
    file: 'src/suggestion/SuggestionBanner.tsx',
    forbidden: ['🌀', '💊', '📋', '🎒', '📓', '🌱', '✕'],
  },
  {
    file: 'src/auth/VerifyEmailScreen.tsx',
    forbidden: ['✉️', '✉'],
  },
  {
    file: 'src/auth/LoginScreen.tsx',
    forbidden: ['🙈', '👁'],
  },
  {
    file: 'src/auth/RegisterScreen.tsx',
    forbidden: ['🙈', '👁'],
  },
  {
    file: 'src/auth/ResetPasswordScreen.tsx',
    forbidden: ['🙈', '👁'],
  },
  {
    file: 'src/kickCount/KickCountDetailScreen.tsx',
    forbidden: ['📖'],
  },
  {
    file: 'src/kickCount/KickCountSummaryScreen.tsx',
    forbidden: ['📖'],
  },
  {
    file: 'src/expenses/ExpensesScreen.tsx',
    forbidden: ['🧾'],
  },
  {
    file: 'src/medication/MedicationPlanFormSheet.tsx',
    forbidden: ['🔒', '✕'],
  },
  {
    file: 'src/home/BabySizeSection.tsx',
    forbidden: ['✕'],
  },
  {
    file: 'src/autoStockDecrement/AutoDecrementSettingsScreen.tsx',
    forbidden: ['✕'],
  },
  {
    file: 'src/calendar/ReminderFormScreen.tsx',
    forbidden: ['✕'],
  },
  {
    file: 'src/capture/CaptureScreen.tsx',
    forbidden: ['✎'],
  },
  {
    // Found via the repo-wide self-inventory grep (not in the original task
    // list) — same colorful-emoji-clashes-with-stroke-system class as the
    // MedicationPlanFormSheet 💊/🔒 instances, so it is in scope.
    file: 'src/medication/MedicationPlanListScreen.tsx',
    forbidden: ['💊', '🔒'],
  },
];

/**
 * Strips single-line `//` comments before scanning for a rendered glyph.
 * This is deliberately narrow (task #40 explicitly says code-comment review
 * markers like 🔴🟡🟢, and historical "🟡 fix: ..." annotations quoting the
 * old glyph in prose, are OUT OF SCOPE and must not be flagged). Only JSX/
 * string-literal occurrences of the glyph (i.e. still-rendered code) fail.
 */
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('Fail-on-revert guard — no rendered emoji/glyph icon remains (task #40 Wave 2)', () => {
  for (const { file, forbidden } of GUARD_CASES) {
    for (const glyph of forbidden) {
      it(`${file} — does not render the "${glyph}" glyph`, () => {
        const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
        const codeOnly = stripLineComments(src);
        expect(codeOnly).not.toContain(glyph);
      });
    }
  }
});
