/**
 * profileHub.i18n.test.ts — TDD: 14 new i18n keys for ProfileHub (RED → GREEN).
 *
 * Design spec §13.1 enumerates every new key that must be present in both
 * the Thai (th) and English (en) catalogs before ProfileHubScreen can be built.
 *
 * Also verifies locale parity (en catalog has every key that th catalog has).
 */

import { catalog } from '../i18n/messages';

// ─── New keys (must be added — §13.1) ────────────────────────────────────────

const NEW_KEYS = [
  'tab.profile',
  'tab.profile.short',
  'tab.profile.a11y',
  'profile.section.profile',
  'profile.section.accountData',
  'profile.section.account',
  'profile.loading',
  'profile.summary.fallbackName',
  'profile.editPregnancy.subtitle',
  'profile.downloadData.label',
  'profile.downloadData.subtitle',
  'profile.deleteAccount.label',
  'profile.deleteAccount.subtitle',
  'profile.logout.message',
] as const;

describe('ProfileHub — new i18n keys present in th catalog (§13.1)', () => {
  for (const key of NEW_KEYS) {
    it(`th catalog has non-empty value for '${key}'`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (catalog.th as any)[key];
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect((val as string).length).toBeGreaterThan(0);
    });
  }
});

describe('ProfileHub — new i18n keys present in en catalog (§13.1)', () => {
  for (const key of NEW_KEYS) {
    it(`en catalog has non-empty value for '${key}'`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (catalog.en as any)[key];
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect((val as string).length).toBeGreaterThan(0);
    });
  }
});

// ─── Specific value assertions ────────────────────────────────────────────────

describe('ProfileHub — i18n key values (§13.1 exact strings)', () => {
  it('tab.profile (th) = "โปรไฟล์"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['tab.profile']).toBe('โปรไฟล์');
  });

  it('tab.profile.short (th) = "ฉัน" (short-label fallback)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['tab.profile.short']).toBe('ฉัน');
  });

  it('tab.profile.a11y (th) = "โปรไฟล์และบัญชี"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['tab.profile.a11y']).toBe('โปรไฟล์และบัญชี');
  });

  it('profile.logout.message (th) contains "ล้างข้อมูล" (consequence statement, NOT a question)', () => {
    // Must be the consequence statement "ระบบจะล้างข้อมูลทั้งหมดในอุปกรณ์นี้"
    // NOT "home.logoutMessage" which is "คุณต้องการออกจากระบบใช่ไหม?" (§3.6, §13.1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = (catalog.th as any)['profile.logout.message'] as string;
    expect(msg).toContain('ล้างข้อมูล');
    // Must NOT be the yes/no question from home.logoutMessage
    expect(msg).not.toContain('ต้องการ');
  });

  it('profile.logout.message is different from home.logoutMessage (§3.6)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const th = catalog.th as any;
    expect(th['profile.logout.message']).not.toBe(th['home.logoutMessage']);
  });

  it('profile.section.profile (th) = "โปรไฟล์"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['profile.section.profile']).toBe('โปรไฟล์');
  });

  it('profile.section.accountData (th) = "บัญชีและข้อมูล"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['profile.section.accountData']).toBe('บัญชีและข้อมูล');
  });

  it('profile.section.account (th) = "บัญชี"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['profile.section.account']).toBe('บัญชี');
  });
});

// ─── Locale parity (en must mirror th shape exactly) ─────────────────────────

describe('i18n locale parity — en catalog has every key th catalog has', () => {
  it('every th key is present in en (parity)', () => {
    const thKeys = Object.keys(catalog.th);
    const enKeys = new Set(Object.keys(catalog.en));
    const missing = thKeys.filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('every en key is present in th (no orphan en keys)', () => {
    const enKeys = Object.keys(catalog.en);
    const thKeys = new Set(Object.keys(catalog.th));
    const missing = enKeys.filter((k) => !thKeys.has(k));
    expect(missing).toEqual([]);
  });
});
