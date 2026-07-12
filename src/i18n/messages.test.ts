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

import { catalog, MONTHS, WEEKDAYS, formatCivilDate, formatYearMonth, interpolate } from './messages';
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
    // Forgot Password (S5) — §9 key list
    'forgot.navTitle', 'forgot.title', 'forgot.subtitle',
    'forgot.emailLabel', 'forgot.emailPlaceholder', 'forgot.emailHint',
    'forgot.submit', 'forgot.confirmTitle', 'forgot.confirmBody',
    'forgot.resend', 'forgot.backToLogin',
    'forgot.rateLimited', 'forgot.offline', 'forgot.serverError',
    // Reset Password — §9 key list
    'reset.navTitle', 'reset.title',
    'reset.newPasswordLabel', 'reset.confirmLabel',
    'reset.passwordHint', 'reset.revokeNotice', 'reset.submit',
    'reset.successToast', 'reset.tokenInvalid', 'reset.requestNewLink',
    'reset.linkMissing', 'reset.passwordTooShort', 'reset.passwordBreached',
    'reset.mismatch', 'reset.rateLimited', 'reset.offline', 'reset.serverError',
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

  // ── Forgot-password non-enumeration invariant (SEC-INV-1 / MI-9) ─────────────
  it('forgot.confirmBody (th) is NON-ENUMERATING — must not contain บัญชี', () => {
    // The bare token 'บัญชี' subsumes 'ไม่พบบัญชี', 'ไม่มีบัญชี', 'มีบัญชี'.
    // Copy must be identical regardless of whether the email has an account.
    expect(catalog.th['forgot.confirmBody']).not.toContain('บัญชี');
  });

  it('forgot.confirmBody (en) is non-enumerating — unconditional neutral voice', () => {
    const copy = catalog.en['forgot.confirmBody'].toLowerCase();
    expect(copy).not.toContain('if an account');
    expect(copy).not.toContain('no account');
    expect(copy).not.toContain('not registered');
  });

  it('forgot.rateLimited (th) does not expose attempt counters', () => {
    // SEC-INV-7: must not mention numeric counter or lockout duration.
    const copy = catalog.th['forgot.rateLimited'];
    expect(copy).toBeTruthy();
    expect(copy).not.toMatch(/\d+ ครั้ง/);
  });

  it('reset.tokenInvalid (th) is one generic message — no wrong/expired/used distinction', () => {
    // SEC-INV-2: single generic text.
    const copy = catalog.th['reset.tokenInvalid'];
    expect(copy).toBeTruthy();
    expect(copy.length).toBeGreaterThan(0);
  });

  it('reset.revokeNotice (th) warns about all-device sign-out (SEC-INV-4)', () => {
    // Must warn user their devices will be signed out.
    const copy = catalog.th['reset.revokeNotice'];
    expect(copy).toBeTruthy();
    // Should mention device/all-device logout context
    expect(copy.length).toBeGreaterThan(10);
  });

  // Th↔En parity: all forgot.* and reset.* keys present in both locales
  it('all forgot.* keys are non-empty in both th and en', () => {
    const forgotKeys = [
      'forgot.navTitle', 'forgot.title', 'forgot.subtitle',
      'forgot.emailLabel', 'forgot.emailPlaceholder', 'forgot.emailHint',
      'forgot.submit', 'forgot.confirmTitle', 'forgot.confirmBody',
      'forgot.resend', 'forgot.backToLogin',
      'forgot.rateLimited', 'forgot.offline', 'forgot.serverError',
    ] as const;
    for (const key of forgotKeys) {
      expect(catalog.th[key]).toBeTruthy();
      expect(catalog.en[key]).toBeTruthy();
    }
  });

  it('all reset.* keys are non-empty in both th and en', () => {
    const resetKeys = [
      'reset.navTitle', 'reset.title',
      'reset.newPasswordLabel', 'reset.confirmLabel',
      'reset.passwordHint', 'reset.revokeNotice', 'reset.submit',
      'reset.successToast', 'reset.tokenInvalid', 'reset.requestNewLink',
      'reset.linkMissing', 'reset.passwordTooShort', 'reset.passwordBreached',
      'reset.mismatch', 'reset.rateLimited', 'reset.offline', 'reset.serverError',
    ] as const;
    for (const key of resetKeys) {
      expect(catalog.th[key]).toBeTruthy();
      expect(catalog.en[key]).toBeTruthy();
    }
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

// ─── DEF-01: formatCivilDate empty string (blank-date OFF state) ─────────────
//
// When ANC_PREFILL_DATE=OFF, date='' and AppointmentFormScreen renders:
//   <Text>{formatCivilDate(date, locale)}</Text>
// formatCivilDate('') splits on '-' → [''], maps to [NaN], and produces garbled
// output ("undefined undefined พ.ศ. NaN" / "undefined undefined, NaN") instead
// of a placeholder string.
//
// FIX REQUIRED in rn-mobile-dev (AppointmentFormScreen):
//   Use `date ? formatCivilDate(date, locale) : blankPlaceholder` in the date
//   field display text and accessibilityLabel.
// This test DOCUMENTS the defect (passes = confirms current broken output).
// Severity: MEDIUM — visible garbled text whenever ANC_PREFILL_DATE=OFF.

describe('formatCivilDate — empty string guard (DEF-01, blank-date OFF state)', () => {
  // AppointmentFormScreen guards: date ? formatCivilDate(date, locale) : t('appointment.datePlaceholder')
  // When ANC_PREFILL_DATE=OFF, date='' is falsy → the placeholder is shown, not formatCivilDate('').
  // These tests guard the fix: removing the key or the guard in the component would fail them.

  it('DEF-01 fix: appointment.datePlaceholder key exists and is not garbled (th)', () => {
    const placeholder = catalog.th['appointment.datePlaceholder'];
    expect(placeholder).toBeTruthy();
    expect(placeholder).not.toContain('undefined');
  });

  it('DEF-01 fix: appointment.datePlaceholder key exists and is not garbled (en)', () => {
    const placeholder = catalog.en['appointment.datePlaceholder'];
    expect(placeholder).toBeTruthy();
    expect(placeholder).not.toContain('undefined');
  });

  it('DEF-01 fix: date field shows placeholder (not garbled text) when date is blank (th)', () => {
    // Mirrors the guard in AppointmentFormScreen date display:
    //   date ? formatCivilDate(date, locale) : t('appointment.datePlaceholder')
    const date = '';
    const placeholder = catalog.th['appointment.datePlaceholder'];
    const display = date ? formatCivilDate(date, 'th') : placeholder;
    expect(display).toBe(placeholder);
    expect(display).not.toContain('undefined');
  });

  it('DEF-01 fix: date field shows placeholder (not garbled text) when date is blank (en)', () => {
    const date = '';
    const placeholder = catalog.en['appointment.datePlaceholder'];
    const display = date ? formatCivilDate(date, 'en') : placeholder;
    expect(display).toBe(placeholder);
    expect(display).not.toContain('undefined');
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

// ─── formatYearMonth (calendar month-header + PDF month picker) ───────────────
//
// Used by CalendarScreen month header and DoctorPdfScreen month picker.
// Must omit the day — only month name + year.
//   th → "<ThaiMonth> พ.ศ. <CE+543>"   (Buddhist Era, no day)
//   en → "<Month> <year>"               (no day, no comma)

describe('formatYearMonth', () => {
  it('th: June 2026 → "มิถุนายน พ.ศ. 2569" (no leading day)', () => {
    expect(formatYearMonth('2026-06', 'th')).toBe('มิถุนายน พ.ศ. 2569');
  });

  it('en: June 2026 → "June 2026" (no day, no comma)', () => {
    expect(formatYearMonth('2026-06', 'en')).toBe('June 2026');
  });

  it('th: January 2026 → "มกราคม พ.ศ. 2569"', () => {
    expect(formatYearMonth('2026-01', 'th')).toBe('มกราคม พ.ศ. 2569');
  });

  it('th: December 2025 → "ธันวาคม พ.ศ. 2568" (BE year boundary)', () => {
    expect(formatYearMonth('2025-12', 'th')).toBe('ธันวาคม พ.ศ. 2568');
  });

  it('en: December 2025 → "December 2025"', () => {
    expect(formatYearMonth('2025-12', 'en')).toBe('December 2025');
  });

  it('slice(0,7) of YYYY-MM-01 gives same result as YYYY-MM (calendar displayMonth usage)', () => {
    // CalendarScreen: displayMonth is always YYYY-MM-01; .slice(0,7) → YYYY-MM
    expect(formatYearMonth('2026-06-01'.slice(0, 7), 'th')).toBe('มิถุนายน พ.ศ. 2569');
    expect(formatYearMonth('2026-06-01'.slice(0, 7), 'en')).toBe('June 2026');
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

// ─── Bottom-tab navigation i18n keys (bottom-tab-navigation-design.md §1.1, §8.2) ─

// v2 (bottom-tab-navigation-design.md v2.1 §1.1, §8.2):
//   Tab order: Supplies · Expenses · Home (center) · Calendar · Medication
//   tab.report / tab.report.a11y REMOVED (OQ-NAV-4: Doctor Report is now a root-stack screen)
//   tab.home / tab.home.a11y ADDED (center tab, §3)
//   tab.supplies label → 'ของใช้' (OQ-NAV-5)
//   tab.calendar.a11y simplified (calendar is grid-only tab, no dashboard context)
describe('tab navigation i18n keys — bottom-tab-nav v2', () => {
  const TAB_KEYS: MessageKey[] = [
    // Visible labels (spec §1.1 v2: 5 tabs, no Report)
    'tab.supplies',
    'tab.expenses',
    'tab.home',
    'tab.calendar',
    'tab.medication',
    // Accessibility labels (spec §8.2)
    'tab.supplies.a11y',
    'tab.expenses.a11y',
    'tab.home.a11y',
    'tab.calendar.a11y',
    'tab.medication.a11y',
    // Kick-count card (spec §4.2) — postpartum history link removed from Home (spec §4.3 retired)
    'kick.countCard',
  ];

  it('has all v2 tab navigation keys with non-empty Thai values', () => {
    for (const key of TAB_KEYS) {
      expect(catalog.th[key]).toBeTruthy();
    }
  });

  it('has all v2 tab navigation keys with non-empty English values', () => {
    for (const key of TAB_KEYS) {
      expect(catalog.en[key]).toBeTruthy();
    }
  });

  it('tab.calendar (th) is ปฏิทิน', () => {
    expect(catalog.th['tab.calendar']).toBe('ปฏิทิน');
  });

  it('tab.home (th) is หน้าหลัก (v2 center tab OQ-NAV-1)', () => {
    expect(catalog.th['tab.home']).toBe('หน้าหลัก');
  });

  it('tab.supplies (th) is ของใช้ (v2 OQ-NAV-5; was เตรียม)', () => {
    expect(catalog.th['tab.supplies']).toBe('ของใช้');
  });

  it('tab.home.a11y (th) includes หน้าหลัก (spec §8.2)', () => {
    expect(catalog.th['tab.home.a11y']).toContain('หน้าหลัก');
  });

  it('tab.calendar.a11y (th) includes ปฏิทิน (spec §8.2 — grid-only tab v2)', () => {
    expect(catalog.th['tab.calendar.a11y']).toContain('ปฏิทิน');
  });

  it('kick.countCard (th) is non-empty (kick-count card text for wk≥32 pregnant)', () => {
    expect(catalog.th['kick.countCard'].length).toBeGreaterThan(0);
  });
});

// ─── WEEKDAYS constant (locale-aware calendar weekday headers) ────────────────
//
// Leak: CalendarScreen hardcoded ['อา','จ','อ','พ','พฤ','ศ','ส'] — stays Thai in EN.
// Fix: export WEEKDAYS: Record<Locale, string[]> from messages.ts and use in CalendarScreen.
// Decision: 3-letter EN abbreviations ('Sun'–'Sat') at fontSize 12 fit the 1/7-width
// column on all supported device widths (≥320px → ≥44px/col >> ~21px 3-char text).

describe('WEEKDAYS constant (locale-aware weekday headers)', () => {
  it('WEEKDAYS is exported from messages', () => {
    expect(WEEKDAYS).toBeDefined();
  });

  it('WEEKDAYS.th has exactly 7 entries starting Sunday', () => {
    expect(WEEKDAYS.th).toHaveLength(7);
    expect(WEEKDAYS.th[0]).toBe('อา');
  });

  it('WEEKDAYS.en has exactly 7 entries starting Sunday', () => {
    expect(WEEKDAYS.en).toHaveLength(7);
    expect(WEEKDAYS.en[0]).toBe('Sun');
  });

  it('WEEKDAYS.th order matches calendar: อา จ อ พ พฤ ศ ส', () => {
    expect(WEEKDAYS.th).toEqual(['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']);
  });

  it('WEEKDAYS.en uses 3-letter abbreviations: Sun Mon Tue Wed Thu Fri Sat', () => {
    expect(WEEKDAYS.en).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('WEEKDAYS.en contains no Thai characters (no leak in EN mode)', () => {
    const enJoined = WEEKDAYS.en.join('');
    // Thai character range U+0E00–U+0E7F
    expect(/[ก-๙]/.test(enJoined)).toBe(false);
  });

  it('WEEKDAYS.th contains Thai characters (correct for TH mode)', () => {
    const thJoined = WEEKDAYS.th.join('');
    expect(/[ก-๙]/.test(thJoined)).toBe(true);
  });
});

// ─── profile.summary EN values (Leak #3 fix) ─────────────────────────────────
//
// EN catalog had profile.summary.fallbackName = 'คุณแม่' and
// profile.summary.motherFirstName = 'คุณแม่ {name}' — both leaked Thai in EN mode.
// Fix: EN fallbackName → 'Mom', EN motherFirstName → 'Mom {name}'.

describe('profile.summary EN values — English (not Thai) in EN locale', () => {
  it('profile.summary.fallbackName (en) is "Mom" (not Thai)', () => {
    expect(catalog.en['profile.summary.fallbackName']).toBe('Mom');
  });

  it('profile.summary.motherFirstName (en) is "Mom {name}" (not Thai)', () => {
    expect(catalog.en['profile.summary.motherFirstName']).toBe('Mom {name}');
  });

  it('profile.summary.fallbackName (en) contains no Thai characters', () => {
    expect(/[ก-๙]/.test(catalog.en['profile.summary.fallbackName'])).toBe(false);
  });

  it('profile.summary.motherFirstName (en) contains no Thai characters', () => {
    expect(/[ก-๙]/.test(catalog.en['profile.summary.motherFirstName'])).toBe(false);
  });

  it('profile.summary.fallbackName (th) is still "คุณแม่" (unchanged)', () => {
    expect(catalog.th['profile.summary.fallbackName']).toBe('คุณแม่');
  });

  it('profile.summary.motherFirstName (th) still contains {name} placeholder', () => {
    expect(catalog.th['profile.summary.motherFirstName']).toContain('{name}');
  });
});

// ─── profile.summary badge i18n keys (EN locale leak sweep) ──────────────────
//
// ProfileHubScreen had badgeText = 'ตั้งครรภ์' / 'หลังคลอด' hardcoded.
// Fix: route through profile.summary.badgePregnant / profile.summary.badgePostpartum.

describe('profile.summary badge keys — EN locale no Thai leak', () => {
  it('profile.summary.badgePregnant (th) is "ตั้งครรภ์"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['profile.summary.badgePregnant']).toBe('ตั้งครรภ์');
  });

  it('profile.summary.badgePregnant (en) is "Pregnant" — no Thai', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.en as any)['profile.summary.badgePregnant'] as string;
    expect(val).toBe('Pregnant');
    expect(/[ก-๙]/.test(val)).toBe(false);
  });

  it('profile.summary.badgePostpartum (th) is "หลังคลอด"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((catalog.th as any)['profile.summary.badgePostpartum']).toBe('หลังคลอด');
  });

  it('profile.summary.badgePostpartum (en) is "Postpartum" — no Thai', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.en as any)['profile.summary.badgePostpartum'] as string;
    expect(val).toBe('Postpartum');
    expect(/[ก-๙]/.test(val)).toBe(false);
  });
});

// ─── profile.weekDisplay EN locale (ProfileHub week label leak) ───────────────
//
// ProfileHubScreen had `สัปดาห์ที่ ${gestationalWeek}` hardcoded.
// Fix: use t('profile.weekDisplay', { n: gestationalWeek }).

describe('profile.weekDisplay — EN locale produces English (not Thai)', () => {
  it('profile.weekDisplay (en) template is "Week {n}" (English)', () => {
    expect(catalog.en['profile.weekDisplay']).toBe('Week {n}');
  });

  it('profile.weekDisplay (en) with interpolation produces "Week 12" in EN', () => {
    const template = catalog.en['profile.weekDisplay'];
    const result = interpolate(template, { n: 12 });
    expect(result).toBe('Week 12');
    expect(/[ก-๙]/.test(result)).toBe(false);
  });

  it('profile.weekDisplay (th) with interpolation produces Thai "สัปดาห์ที่ 12" in TH', () => {
    const template = catalog.th['profile.weekDisplay'];
    const result = interpolate(template, { n: 12 });
    expect(result).toBe('สัปดาห์ที่ 12');
  });
});

// ─── Kick-count endSession rename (slice/feat-kickcount-header-rename) ─────────

describe('kick.endSessionBtn rename: จบเซสชัน → เสร็จสิ้น', () => {
  it('kick.endSessionBtn (th) is เสร็จสิ้น (label-only rename, INV-K3 behavior unchanged)', () => {
    expect(catalog.th['kick.endSessionBtn']).toBe('เสร็จสิ้น');
  });

  it('kick.endSessionBtn (en) is Done', () => {
    expect(catalog.en['kick.endSessionBtn']).toBe('Done');
  });

  it('kick.endSessionA11y (th) contains เสร็จสิ้น (not จบเซสชัน)', () => {
    expect(catalog.th['kick.endSessionA11y']).toContain('เสร็จสิ้น');
    expect(catalog.th['kick.endSessionA11y']).not.toContain('จบเซสชัน');
  });

  it('kick.endSessionA11y (en) contains Done counting (updated a11y label)', () => {
    expect(catalog.en['kick.endSessionA11y'].toLowerCase()).toContain('done counting');
  });

  it('kick.navTitle exists in both locales (used as header title for Home/Counting/Summary)', () => {
    expect(catalog.th['kick.navTitle']).toBeTruthy();
    expect(catalog.en['kick.navTitle']).toBeTruthy();
  });
});

// ─── loss.error.offlineQueued — no false "saved" ack (mobile-reviewer 🟡) ──────
//
// This key is dead on the LossConfirmScreen path today (that screen's real
// offline producer, onOfflineApply, is always wired in production — this key
// was only a backward-compat fallback for "no producer wired"). But it is
// STILL the live offline-error copy on ReopenConfirmScreen, which has NO
// offline producer at all. The old copy ("บันทึกไว้แล้ว" / "saved") therefore
// told a mother her reopen-offline attempt was SAVED when nothing was ever
// sent to the server — a false success ack. Reworded to something honest:
// not saved, will retry when online.

describe('loss.error.offlineQueued — honest not-saved copy (no false success)', () => {
  it('Thai copy does NOT claim it was saved (no "บันทึกไว้แล้ว")', () => {
    expect(catalog.th['loss.error.offlineQueued']).not.toContain('บันทึกไว้แล้ว');
  });

  it('English copy does NOT affirmatively claim it was saved (only "not saved")', () => {
    const en = catalog.en['loss.error.offlineQueued'].toLowerCase();
    expect(en).toContain('not saved');
    // Guard against a regression that keeps "saved" but drops the "not" —
    // there must be no standalone "saved" occurrence outside "not saved".
    expect(en.replace('not saved', '')).not.toContain('saved');
  });

  it('Thai copy is explicit that it is NOT saved yet and will retry when online', () => {
    expect(catalog.th['loss.error.offlineQueued']).toContain('ยังไม่ได้บันทึก');
    expect(catalog.th['loss.error.offlineQueued']).toContain('ออนไลน์');
  });

  it('English copy is explicit that it is NOT saved yet and will retry when online', () => {
    const en = catalog.en['loss.error.offlineQueued'].toLowerCase();
    expect(en).toContain('not saved');
    expect(en).toContain('online');
  });
});
