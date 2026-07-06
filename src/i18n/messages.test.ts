/**
 * i18n catalog (messages.ts) — unit tests (TDD, written BEFORE the implementation).
 *
 * Verifies:
 *  - catalog has all required keys for both locales
 *  - Thai values match what existing auth tests assert (non-enumeration / non-blaming)
 *  - English values are non-empty and warm in tone
 *  - MONTHS arrays have exactly 12 entries
 *  - formatCivilDate produces locale-correct date strings
 *  - t() template interpolation works
 *
 * These tests complement (not replace) loginScreenLogic.test.ts,
 * registerScreenLogic.test.ts, and verifyEmailScreenLogic.test.ts — those tests
 * continue to assert that loginStrings / registerStrings / verifyStrings
 * (re-derived from this catalog) retain the same Thai copy.
 */

import { catalog, MONTHS, formatCivilDate, interpolate } from './messages';
import type { MessageKey } from './messages';

// ─── Key presence ─────────────────────────────────────────────────────────────

describe('catalog key presence', () => {
  const REQUIRED: MessageKey[] = [
    // Auth - Login
    'login.title', 'login.emailLabel', 'login.passwordLabel', 'login.submit',
    'login.forgotPassword', 'login.createAccount', 'login.wrongCredentials',
    'login.rateLimited', 'login.offline', 'login.serverError', 'login.emailHint',
    'login.emailPlaceholder', 'login.showPassword', 'login.hidePassword',
    // Auth - Register
    'register.title', 'register.subtitle', 'register.emailLabel',
    'register.passwordLabel', 'register.submit', 'register.signIn',
    'register.emailPlaceholder', 'register.emailHint', 'register.passwordHint',
    'register.passwordTooShort', 'register.passwordBreached', 'register.rateLimited',
    'register.offline', 'register.serverError', 'register.showPassword',
    'register.hidePassword', 'register.disclaimer',
    // Auth - Verify
    'verify.title', 'verify.stepLabel', 'verify.sentToPrefix', 'verify.openLinkHint',
    'verify.spamTip', 'verify.resend', 'verify.resentConfirm', 'verify.changeEmail',
    'verify.rateLimited', 'verify.tokenInvalid', 'verify.offline', 'verify.serverError',
    'verify.storageErrorHint',
    // Welcome
    'welcome.tagline', 'welcome.createAccount', 'welcome.signIn', 'welcome.disclaimer',
    'welcome.createAccountA11y', 'welcome.signInA11y',
    // Stage labels
    'stage.T1', 'stage.T2', 'stage.T3',
    // General
    'general.or', 'general.cancel', 'general.retry',
    // Home
    'home.loading', 'home.pregnancyProgress', 'home.daysBeforeDue',
    'home.overdueCard', 'home.overdueSubline', 'home.deliveryWindow',
    'home.birthCta', 'home.birthCtaA11y',
    'home.weekDisplay', 'home.weekDisplayDays', 'home.eddLine',
    'home.postpartumStage', 'home.babyAgeDays', 'home.babyAgeWeeks',
    'home.babyAgeWeeksAndDays', 'home.daysSinceBirth', 'home.birthDateLine',
    'home.progressA11y',
    'home.errorHeadline', 'home.errorSubline', 'home.logout',
    'home.logoutTitle', 'home.logoutMessage', 'home.logoutCancel', 'home.logoutConfirm',
    // Profile Setup
    'profile.headline', 'profile.subline', 'profile.methodPrompt',
    'profile.methodDueDate', 'profile.methodCurrentWeek',
    'profile.fieldDueDate', 'profile.fieldCurrentWeek', 'profile.datePlaceholder',
    'profile.lmpLink', 'profile.lmpModalTitle', 'profile.lmpModalHint',
    'profile.lmpEstimatePrefix', 'profile.lmpEstimateSuffix',
    'profile.dateModalTitle', 'profile.dateModalHint',
    'profile.dateModalCancel', 'profile.dateModalConfirm',
    'profile.dateFormatAlertTitle', 'profile.dateFormatAlertMsg',
    'profile.eddPreviewPrefix', 'profile.deliveryWindow', 'profile.stageEchoPrefix',
    'profile.weekDisplay', 'profile.stepperDecrease', 'profile.stepperIncrease',
    'profile.next', 'profile.save', 'profile.footnote', 'profile.emptyHint',
    'profile.errorLogin', 'profile.errorConsentRequired', 'profile.errorConflict',
    'profile.errorDateInvalid', 'profile.errorPreconditionFailed',
    'profile.errorGeneric', 'profile.errorOffline',
    // Birth Event
    'birth.headline', 'birth.subline', 'birth.fieldBirthDate',
    'birth.datePlaceholder', 'birth.fieldDeliveryType', 'birth.fieldNote',
    'birth.notePlaceholder', 'birth.encryptionNote', 'birth.consequence',
    'birth.save', 'birth.emptyHint',
    'birth.dateModalTitle', 'birth.dateModalHint',
    'birth.dateModalCancel', 'birth.dateModalConfirm',
    'birth.dateFormatAlertTitle', 'birth.dateFormatAlertMsg',
    'birth.futureDateTitle', 'birth.futureDateMessage',
    'birth.futureDateCancel', 'birth.futureDateContinue',
    'birth.errorLogin', 'birth.errorConsentRequired', 'birth.errorConflict',
    'birth.errorDateInvalid', 'birth.errorPreconditionFailed',
    'birth.errorNotFound', 'birth.errorGeneric', 'birth.errorOffline',
    'birth.delivery.vaginal', 'birth.delivery.cesarean',
    'birth.delivery.other', 'birth.delivery.prefer_not',
    // Calendar home-shortcut button (self-descriptive label replacing 'calendar.viewAll')
    'calendar.shortcutBtn',
  ];

  it('has all required keys with non-empty Thai values', () => {
    for (const key of REQUIRED) {
      const val = catalog.th[key];
      expect(val).toBeTruthy();
      expect(typeof val).toBe('string');
    }
  });

  it('has all required keys with non-empty English values', () => {
    for (const key of REQUIRED) {
      const val = catalog.en[key];
      expect(val).toBeTruthy();
      expect(typeof val).toBe('string');
    }
  });
});

// ─── Auth string invariants (guard against regression) ────────────────────────

describe('auth string invariants (guards existing test assertions)', () => {
  it('login.wrongCredentials (th) mentions reset concept', () => {
    expect(catalog.th['login.wrongCredentials']).toContain('รีเซ็ต');
  });

  it('login.wrongCredentials (en) mentions reset, not enumeration', () => {
    const copy = catalog.en['login.wrongCredentials'].toLowerCase();
    expect(copy).toContain('reset');
    expect(copy).not.toContain('not found');
    expect(copy).not.toContain('no account');
    expect(copy).not.toContain("doesn't exist");
  });

  it('login.offline (th) contains ออฟไลน์', () => {
    expect(catalog.th['login.offline']).toContain('ออฟไลน์');
  });

  it('login.offline (en) is calm and non-blaming', () => {
    const copy = catalog.en['login.offline'].toLowerCase();
    expect(copy).not.toContain('error');
    expect(copy).toContain('offline');
  });

  it('register th copy has no enumeration hints', () => {
    const allTh = Object.values(catalog.th).join(' ');
    expect(allTh).not.toContain('ใช้แล้ว');
    expect(allTh).not.toContain('มีอยู่แล้ว');
    expect(allTh).not.toContain('ถูกลงทะเบียน');
  });

  it('register en copy has no enumeration hints', () => {
    const allEn = Object.values(catalog.en).join(' ').toLowerCase();
    expect(allEn).not.toContain('already registered');
    expect(allEn).not.toContain('already taken');
    expect(allEn).not.toContain('already in use');
    expect(allEn).not.toContain('email exists');
  });

  it('register.passwordBreached (th) does not blame the user', () => {
    expect(catalog.th['register.passwordBreached']).not.toContain('ถูกแฮก');
  });

  it('register.offline (th) contains ออฟไลน์', () => {
    expect(catalog.th['register.offline']).toContain('ออฟไลน์');
  });

  it('register.offline (en) is calm and non-blaming', () => {
    const copy = catalog.en['register.offline'].toLowerCase();
    expect(copy).not.toContain('error');
    expect(copy).toContain('offline');
  });

  it('verify.title (th) mentions email/อีเมล', () => {
    expect(catalog.th['verify.title']).toContain('อีเมล');
  });

  it('verify.resentConfirm (th) is non-enumerating', () => {
    const copy = catalog.th['verify.resentConfirm'];
    expect(copy).not.toContain('มีบัญชี');
    expect(copy).not.toContain('ถูกลงทะเบียน');
  });

  it('verify.tokenInvalid (th) is non-empty', () => {
    expect(catalog.th['verify.tokenInvalid'].length).toBeGreaterThan(0);
  });
});

// ─── Month names ──────────────────────────────────────────────────────────────

describe('MONTHS', () => {
  it('Thai month array has exactly 12 entries', () => {
    expect(MONTHS.th).toHaveLength(12);
  });

  it('English month array has exactly 12 entries', () => {
    expect(MONTHS.en).toHaveLength(12);
  });

  it('Thai months start with มกราคม and end with ธันวาคม', () => {
    expect(MONTHS.th[0]).toBe('มกราคม');
    expect(MONTHS.th[11]).toBe('ธันวาคม');
  });

  it('English months start with January and end with December', () => {
    expect(MONTHS.en[0]).toBe('January');
    expect(MONTHS.en[11]).toBe('December');
  });
});

// ─── formatCivilDate ──────────────────────────────────────────────────────────

describe('formatCivilDate', () => {
  it('formats th as D MonthTH พ.ศ. YYYY+543 (no วันที่ prefix)', () => {
    expect(formatCivilDate('2026-06-29', 'th')).toBe('29 มิถุนายน พ.ศ. 2569');
  });

  it('formats en as MonthEN D, YYYY', () => {
    expect(formatCivilDate('2026-06-29', 'en')).toBe('June 29, 2026');
  });

  it('handles day 1 and January correctly', () => {
    expect(formatCivilDate('2026-01-01', 'th')).toBe('1 มกราคม พ.ศ. 2569');
    expect(formatCivilDate('2026-01-01', 'en')).toBe('January 1, 2026');
  });

  it('handles December 31', () => {
    expect(formatCivilDate('2026-12-31', 'th')).toBe('31 ธันวาคม พ.ศ. 2569');
    expect(formatCivilDate('2026-12-31', 'en')).toBe('December 31, 2026');
  });
});

// ─── interpolate (template substitution) ─────────────────────────────────────

describe('interpolate', () => {
  it('returns the string unchanged when no params', () => {
    expect(interpolate('สวัสดี', {})).toBe('สวัสดี');
  });

  it('replaces {n} placeholder with the given value', () => {
    expect(interpolate('สัปดาห์ที่ {n}', { n: 12 })).toBe('สัปดาห์ที่ 12');
  });

  it('replaces multiple placeholders', () => {
    expect(
      interpolate('สัปดาห์ที่ {n} +{d} วัน', { n: 10, d: 3 }),
    ).toBe('สัปดาห์ที่ 10 +3 วัน');
  });

  it('replaces all occurrences of the same placeholder', () => {
    expect(interpolate('{n} / {n}', { n: 5 })).toBe('5 / 5');
  });

  it('replaces {date} with a date string', () => {
    expect(
      interpolate('กำหนดคลอด {date} (อีก {days} วัน)', { date: '1 ม.ค.', days: 100 }),
    ).toBe('กำหนดคลอด 1 ม.ค. (อีก 100 วัน)');
  });

  it('English template substitution', () => {
    expect(interpolate('Week {n}', { n: 20 })).toBe('Week 20');
  });
});

// ─── Task 5: reminder.snooze.* i18n keys ─────────────────────────────────────

describe('reminder.snooze.* keys (Task 5 — medication snooze chooser)', () => {
  it('has reminder.snooze.title in both th and en', () => {
    expect(catalog.th['reminder.snooze.title']).toBeTruthy();
    expect(catalog.en['reminder.snooze.title']).toBeTruthy();
  });

  it('has reminder.snooze.opt.10 in both th and en', () => {
    expect(catalog.th['reminder.snooze.opt.10']).toBeTruthy();
    expect(catalog.en['reminder.snooze.opt.10']).toBeTruthy();
  });

  it('has reminder.snooze.opt.30 in both th and en', () => {
    expect(catalog.th['reminder.snooze.opt.30']).toBeTruthy();
    expect(catalog.en['reminder.snooze.opt.30']).toBeTruthy();
  });

  it('has reminder.snooze.opt.60 in both th and en', () => {
    expect(catalog.th['reminder.snooze.opt.60']).toBeTruthy();
    expect(catalog.en['reminder.snooze.opt.60']).toBeTruthy();
  });

  it('has reminder.snooze.cancel in both th and en', () => {
    expect(catalog.th['reminder.snooze.cancel']).toBeTruthy();
    expect(catalog.en['reminder.snooze.cancel']).toBeTruthy();
  });

  it('has reminder.snooze.alertsAt in both th and en (contains {time} placeholder)', () => {
    expect(catalog.th['reminder.snooze.alertsAt']).toContain('{time}');
    expect(catalog.en['reminder.snooze.alertsAt']).toContain('{time}');
  });

  it('has reminder.snoozedUntil in both th and en (contains {time} placeholder)', () => {
    expect(catalog.th['reminder.snoozedUntil']).toContain('{time}');
    expect(catalog.en['reminder.snoozedUntil']).toContain('{time}');
  });

  it('th snooze title matches "เลื่อนเตือน" (spec §2.4)', () => {
    expect(catalog.th['reminder.snooze.title']).toBe('เลื่อนเตือน');
  });
});
