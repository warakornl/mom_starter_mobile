/**
 * profileInfoEdit.i18n.test.ts — TDD: i18n keys for ProfileInfoEditScreen.
 *
 * Covers all new keys for:
 *   - ProfileInfoEditScreen (profileInfo.*)
 *   - ProfileHub "edit personal info" row label
 *   - Summary card mother first-name display format
 *   - ≤100-char validation message
 *
 * Every key must be present in BOTH th and en catalogs (locale parity).
 * The parity test in profileHub.i18n.test.ts is the authoritative full-catalog
 * parity check; this file only checks keys for the name-fields feature.
 */

import { catalog } from '../i18n/messages';

// ─── Keys that must exist for ProfileInfoEditScreen ──────────────────────────

const PROFILE_INFO_KEYS = [
  'profileInfo.navTitle',
  'profileInfo.subtitle',
  'profileInfo.field.motherFirstName',
  'profileInfo.field.motherLastName',
  'profileInfo.field.babyName',
  'profileInfo.field.optional',
  'profileInfo.placeholder.motherFirstName',
  'profileInfo.placeholder.motherLastName',
  'profileInfo.placeholder.babyName',
  'profileInfo.validation.nameTooLong',
  'profileInfo.save',
  'profileInfo.saving',
  'profileInfo.saved',
  'profileInfo.error.login',
  'profileInfo.error.conflict',
  'profileInfo.error.generic',
  'profileInfo.note.optional',
  'profile.summary.motherFirstName',
  'profile.infoEdit.rowLabel',
  'profile.infoEdit.rowSubtitle',
] as const;

describe('ProfileInfoEdit — i18n keys present in th catalog', () => {
  for (const key of PROFILE_INFO_KEYS) {
    it(`th catalog has non-empty value for '${key}'`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (catalog.th as any)[key];
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect((val as string).length).toBeGreaterThan(0);
    });
  }
});

describe('ProfileInfoEdit — i18n keys present in en catalog', () => {
  for (const key of PROFILE_INFO_KEYS) {
    it(`en catalog has non-empty value for '${key}'`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (catalog.en as any)[key];
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect((val as string).length).toBeGreaterThan(0);
    });
  }
});

// ─── Specific value assertions ─────────────────────────────────────────────

describe('ProfileInfoEdit — key values', () => {
  it('profileInfo.navTitle (th) is non-empty Thai string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.th as any)['profileInfo.navTitle'] as string;
    expect(val.length).toBeGreaterThan(0);
  });

  it('profileInfo.validation.nameTooLong (th) contains "100"', () => {
    // The validation message must reference the 100-char limit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.th as any)['profileInfo.validation.nameTooLong'] as string;
    expect(val).toContain('100');
  });

  it('profileInfo.validation.nameTooLong (en) contains "100"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.en as any)['profileInfo.validation.nameTooLong'] as string;
    expect(val).toContain('100');
  });

  it('profile.summary.motherFirstName (th) contains "{name}" placeholder', () => {
    // The format string for the summary card mother-name display
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.th as any)['profile.summary.motherFirstName'] as string;
    expect(val).toContain('{name}');
  });

  it('profile.summary.motherFirstName (en) contains "{name}" placeholder', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.en as any)['profile.summary.motherFirstName'] as string;
    expect(val).toContain('{name}');
  });

  it('profile.infoEdit.rowLabel (th) is non-empty string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.th as any)['profile.infoEdit.rowLabel'] as string;
    expect(val.length).toBeGreaterThan(0);
  });
});

// ─── Locale parity for new keys specifically ─────────────────────────────────

describe('ProfileInfoEdit — locale parity (th ↔ en)', () => {
  it('every new profileInfo.* key present in th is also in en', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const th = catalog.th as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const en = catalog.en as any;
    const thProfileInfoKeys = Object.keys(th).filter(
      (k) => k.startsWith('profileInfo.') || k === 'profile.summary.motherFirstName' || k.startsWith('profile.infoEdit.')
    );
    const missing = thProfileInfoKeys.filter((k) => en[k] === undefined);
    expect(missing).toEqual([]);
  });

  it('every new profileInfo.* key present in en is also in th', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const th = catalog.th as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const en = catalog.en as any;
    const enProfileInfoKeys = Object.keys(en).filter(
      (k) => k.startsWith('profileInfo.') || k === 'profile.summary.motherFirstName' || k.startsWith('profile.infoEdit.')
    );
    const missing = enProfileInfoKeys.filter((k) => th[k] === undefined);
    expect(missing).toEqual([]);
  });
});
