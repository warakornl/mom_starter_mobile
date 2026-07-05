# Maestro E2E Tests — Mom-Starter Mobile

## ติดตั้ง Maestro CLI

```bash
curl -fsSL https://get.maestro.mobile.dev | bash
```

จากนั้น restart terminal แล้วตรวจสอบ:

```bash
maestro --version
```

---

## สิ่งที่ต้องเตรียมก่อนรัน

1. **iOS Simulator** — เปิด simulator ไว้ (Xcode → Open Simulator หรือ `xcrun simctl boot`)

2. **Dev Build** — ต้องใช้ dev build เท่านั้น (ไม่ใช่ Expo Go) เพราะ Maestro ระบุ app ด้วย `bundleIdentifier` (`com.momstarter.app`) และ flow ที่ใช้ notifications/biometric (flow 18–23) ต้องการ dev build เพื่อเข้าถึง native API:

   ```bash
   cd mom_starter_mobile
   npx expo run:ios
   ```

   Expo Go ใช้ bundle id ของตัวเอง → `launchApp` ไม่ตรง และ notification/biometric API ไม่พร้อมใช้งาน

3. **Backend รันอยู่** — ต้องรันที่ `localhost:8080` พร้อม **local Spring profile** (`--spring.profiles.active=local`) เพราะ:
   - Profile `local` เปิด `momstarter.dev.auto-verify-email=true` ซึ่งทำให้ `DevModeSeeder` สร้างบัญชีทดสอบอัตโนมัติ
   - Flow E2E ทะลุ API จริง ทุก flow ต้องมี backend รันอยู่

4. **บัญชีทดสอบ** — บัญชีเดียวที่ code สร้างให้อัตโนมัติคือ:
   - `dev@momstarter.local` / `DevTest-Password-2026`
   - สร้าง + email-verified อัตโนมัติโดย `DevModeSeeder` **เฉพาะเมื่อ** backend รันด้วย local Spring profile (`momstarter.dev.auto-verify-email=true`)
   - ไม่ต้องสมัครหรือ verify email เอง — ล็อกอินได้ทันทีหลัง backend start

   > หมายเหตุ: ไม่มีบัญชี `mom@test.local` ใน codebase — ไม่มีโค้ดไหน seed บัญชีนี้ อย่าใช้

5. **API URL บน physical device** — app auto-derive URL จาก Expo host IP เป็น `http://<LAN-IP>:8080` (ดู `src/config.ts`) บน physical device ต้องแน่ใจว่า:
   - backend bind ที่ `0.0.0.0` (ไม่ใช่แค่ `127.0.0.1`)
   - device กับ dev machine อยู่ใน Wi-Fi เดียวกัน
   - firewall เปิด port 8080
   - หรือ override ผ่าน `app.json extra.apiBaseUrl`
   - บน Simulator ใช้ `localhost:8080` ได้ปกติ

6. **Pregnancy profile** — flow ที่ต้องการ pregnancy profile (03, 04, 05, 06, 07, 07b, 08, 09, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25; 11/12/13 consent-only):
   - รัน `03-pregnancy.yaml` ก่อน (ตั้ง week 38) หรือ seed ผ่าน API โดยตรง
   - Flow 09 ต้องการ profile pregnant ที่ week >= 32 (gate `shouldShowModule`)

---

## รัน Tests

รันทุก flow ทีเดียว:

```bash
maestro test .maestro/
```

รัน flow เดี่ยว:

```bash
maestro test .maestro/01-login.yaml
maestro test .maestro/02-register.yaml
maestro test .maestro/03-pregnancy.yaml
maestro test .maestro/04-birth-event.yaml
maestro test .maestro/05-supplies-add.yaml
maestro test .maestro/06-appointment-create.yaml
maestro test .maestro/07-reminder-create.yaml
maestro test .maestro/07b-reminder-weekly.yaml
maestro test .maestro/08-settings-logout.yaml
maestro test .maestro/09-kick-count.yaml
maestro test .maestro/10-reminder-edit.yaml
maestro test .maestro/11-capture-self-log-happy.yaml
maestro test .maestro/12-capture-self-log-consent-gate.yaml
maestro test .maestro/13-logout-clears-self-logs.yaml
maestro test .maestro/14-medication-plan-add.yaml
maestro test .maestro/15-medication-log-dose-taken.yaml
maestro test .maestro/16-medication-log-dose-missed.yaml
maestro test .maestro/17-medication-pdf-adherence.yaml
```

---

## Flow แต่ละไฟล์

| ไฟล์ | Flow | Prerequisite พิเศษ |
|------|------|--------------------|
| `01-login.yaml` | launch → login → assert `home-week-hero` | dev account มี profile T3 |
| `02-register.yaml` | launch → register (email ใหม่ timestamp) → assert VerifyEmail | - |
| `03-pregnancy.yaml` | login → ตั้ง week 38 → assert `home-week-hero` | account ยังไม่มี profile |
| `04-birth-event.yaml` | login → birth CTA → กรอกวันคลอด → assert `home-postpartum-banner` | profile เป็น T3 (week >= 28) |
| `05-supplies-add.yaml` | login → Supplies → เพิ่มรายการ → assert `supplies-item` | profile ใดก็ได้; REGRESSION: uuid-crypto fix |
| `06-appointment-create.yaml` | login → Calendar → add appointment (default date/time = today) → save → assert appointment appears in agenda (`calendar-agenda-item`) | profile ใดก็ได้; REGRESSION: REG-02 refresh-on-focus + REG-05 pendingCalendarFocusDate auto-select; assertion reliable เพราะปฏิทินเด้งมาวันที่สร้างเสมอ |
| `07-reminder-create.yaml` | login → Calendar → add reminder (one_off, default start date = today) → save → assert reminder appears in agenda (`calendar-agenda-item`) | profile ใดก็ได้; REGRESSION: REG-02 refresh-on-focus + REG-05 pendingCalendarFocusDate auto-select; assertion reliable เพราะปฏิทินเด้งมาวัน start date เสมอ |
| `07b-reminder-weekly.yaml` | login → Calendar → add reminder (weekly / byDay MO,WE,FR / default start date) → verify byday chips → save → assert CalendarScreen returned | profile ใดก็ได้; FEATURE #7 weekly recurrence; **ไม่ assert `calendar-agenda-item`** เพราะ default start date = today (Thursday) ไม่ตรงกับ MO/WE/FR — ดูหมายเหตุ |
| `08-settings-logout.yaml` | login → ☰ Settings → logout → confirm → assert WelcomeScreen | profile ใดก็ได้; REGRESSION: logout 2-level-deep (ปุ่มเปลี่ยนจาก ⚙ เป็น ☰; testID เหมือนเดิม) |
| `09-kick-count.yaml` | login → KickCountHome → tap×5 → undo → leave-guard-continue → tap×5 → end session → assert summary count = "9" | profile pregnant wk>=32; REGRESSION: REG-03 Y-7 rapid-tap fix (numeric count asserted) |
| `10-reminder-edit.yaml` | login → Calendar → create one-off reminder → tap agenda row → tap "แก้ไข" (Alert) → ReminderFormScreen edit mode → change title → save → assert CalendarScreen returned | profile ใดก็ได้; FEATURE #13 reminder-edit; **Alert targeting**: `tapOn: text: "แก้ไข"` — ดูหมายเหตุ Alert |
| `11-capture-self-log-happy.yaml` | login → Calendar → `calendar-add-capture-btn` → CaptureScreen → weight "64.2" → echo line → Save → Calendar | general_health GRANTED; **REQUIRES NAV WIRING**: `calendar-add-capture-btn` ต้องเพิ่มใน CalendarScreen ก่อน — ดูหมายเหตุ Slice 1 |
| `12-capture-self-log-consent-gate.yaml` | login → Capture → "63.0" → Save (consent absent) → nudge modal → Grant → value persists → Calendar | general_health DECLINED ก่อน; **REQUIRES NAV WIRING**: เหมือนกัน |
| `13-logout-clears-self-logs.yaml` | login → seed weight "70.0" → logout confirm → re-login → Calendar loads clean (store cleared) | general_health GRANTED; **REQUIRES NAV WIRING**: เหมือนกัน; PDPA 1.1 store-reset assertion ครอบคลุมที่ unit test `performLogout.test.ts` + `selfLogSyncStore.test.ts::reset()` |
| `14-medication-plan-add.yaml` | login → Home → `home-medication-shortcut` → MedicationPlans → `med-add-top` → กรอก name/dose → daily freq → save → assert `med-plan-list` | general_health GRANTED; account pregnancy profile; **Slice 2 Medication** |
| `15-medication-log-dose-taken.yaml` | login → MedicationPlans → tap "บันทึกการกินยา" → Capture (pre-set medication mode) → taken chip → echo line → save → assert `med-plan-list` | plan exists (run flow 14 first); INV-M2 equal-weight — same steps as missed |
| `16-medication-log-dose-missed.yaml` | login → MedicationPlans → tap "บันทึกการกินยา" → Capture → tap `capture-medication-missed` → echo line → save → assert `med-plan-list` | plan exists (run flow 14); INV-M2: no shame/amber marker on missed |
| `17-medication-pdf-adherence.yaml` | login → Home → `home-doctor-pdf-btn` → DoctorPdfScreen → assert `pdf-screen-builder` (no error); adherence text inside WebView = manual TC-MED-04 | flows 14+15 run first; WebView content inspection manual (jest covers content) |

---

## testID ที่ใช้ใน Flow

| testID | หน้าจอ | Element |
|--------|---------|---------|
| `welcome-register-btn` | WelcomeScreen | ปุ่มสร้างบัญชี |
| `welcome-login-btn` | WelcomeScreen | ปุ่มเข้าสู่ระบบ |
| `lang-toggle` | WelcomeScreen | ปุ่มสลับภาษา |
| `login-email` | LoginScreen | ช่องอีเมล |
| `login-password` | LoginScreen | ช่องรหัสผ่าน |
| `login-submit` | LoginScreen | ปุ่ม Submit |
| `register-email` | RegisterScreen | ช่องอีเมล |
| `register-password` | RegisterScreen | ช่องรหัสผ่าน |
| `register-submit` | RegisterScreen | ปุ่ม Submit |
| `profile-mode-week` | ProfileSetupScreen | ปุ่ม segment "อายุครรภ์ตอนนี้" |
| `profile-week-stepper` | ProfileSetupScreen | แถว stepper สัปดาห์ |
| `profile-save` | ProfileSetupScreen | ปุ่ม Save/Next |
| `home-week-hero` | HomeScreen | การ์ด StageBanner (pregnant) |
| `home-postpartum-banner` | HomeScreen | banner postpartum |
| `home-birth-cta` | HomeScreen | ปุ่ม "ลูกคลอดแล้ว" (T3 เท่านั้น) |
| `home-settings-btn` | HomeScreen | ปุ่ม ☰ (แฮมเบอร์เกอร์; เปลี่ยนจาก ⚙ ใน merge ล่าสุด) |
| `home-supplies-shortcut` | HomeScreen | ลิงก์ไป SuppliesScreen |
| `home-calendar-shortcut` | HomeScreen | ลิงก์ไป CalendarScreen |
| `home-kick-count-shortcut` | HomeScreen | ลิงก์ไป KickCountHome (wk>=32 pregnant หรือ postpartum) |
| `birth-date` | BirthEventScreen | ช่องเลือกวันคลอด |
| `birth-save` | BirthEventScreen | ปุ่ม Save |
| `supplies-add` | SuppliesScreen | FAB เพิ่มรายการ |
| `supplies-item` | SuppliesScreen | แต่ละแถวของรายการ (FlatList) |
| `supplies-refresh` | SuppliesScreen | ปุ่ม pull-to-sync |
| `supplies-form-name` | SuppliesScreen (Modal) | TextInput ชื่อสินค้า |
| `supplies-form-save` | SuppliesScreen (Modal) | ปุ่มบันทึกใน form |
| `supplies-sync-error` | SuppliesScreen | banner แจ้ง sync error |
| `calendar-screen` | CalendarScreen | SafeAreaView container |
| `calendar-add-appointment-btn` | CalendarScreen | ปุ่ม "+ นัดหมายใหม่" |
| `calendar-add-reminder-btn` | CalendarScreen | ปุ่ม "+ เตือนความจำใหม่" |
| `calendar-add-capture-btn` | CalendarScreen | ปุ่ม "+ บันทึกสุขภาพ" (self-log) — **ต้องเพิ่มใน Slice 2+** (ยังไม่มีใน Slice 1; ใช้ใน flow 11/12/13) |
| `calendar-agenda-item` | CalendarScreen | แต่ละแถวใน agenda (ทั้ง checklist และ occurrence rows) |
| `appointment-title` | AppointmentFormScreen | TextInput ชื่อนัดหมาย |
| `appointment-date` | AppointmentFormScreen | ปุ่มเปิด date picker |
| `appointment-date-picker-done` | AppointmentFormScreen | ปุ่ม Done บน iOS date picker Modal |
| `appointment-time` | AppointmentFormScreen | ปุ่มเปิด time picker (ซ่อนเมื่อ allDay=on) |
| `appointment-time-picker-done` | AppointmentFormScreen | ปุ่ม Done บน iOS time picker Modal |
| `appointment-allday` | AppointmentFormScreen | Switch all-day toggle |
| `appointment-save` | AppointmentFormScreen | ปุ่มบันทึก |
| `appointment-cancel` | AppointmentFormScreen | ปุ่มยกเลิก |
| `reminder-title` | ReminderFormScreen | TextInput ชื่อ reminder |
| `reminder-startdate` | ReminderFormScreen | ปุ่มเปิด start-date picker |
| `reminder-starttime` | ReminderFormScreen | ปุ่มเปิด start-time picker |
| `reminder-picker-done` | ReminderFormScreen | ปุ่ม Done บน iOS picker Modal (shared สำหรับทุก picker ใน reminder form) |
| `reminder-freq-one_off` | ReminderFormScreen | ชิปความถี่ "ครั้งเดียว" |
| `reminder-freq-daily` | ReminderFormScreen | ชิปความถี่ "ทุกวัน" |
| `reminder-freq-every_n_days` | ReminderFormScreen | ชิปความถี่ "ทุก N วัน" |
| `reminder-freq-weekly` | ReminderFormScreen | ชิปความถี่ "เลือกวันในสัปดาห์" (FEATURE #7) |
| `reminder-interval-weeks` | ReminderFormScreen | TextInput จำนวนสัปดาห์ (แสดงเฉพาะ freq=weekly, 1–52) |
| `reminder-byday-mo` | ReminderFormScreen | ชิปวัน จันทร์ (MO) ใน 7-day selector |
| `reminder-byday-tu` | ReminderFormScreen | ชิปวัน อังคาร (TU) |
| `reminder-byday-we` | ReminderFormScreen | ชิปวัน พุธ (WE) |
| `reminder-byday-th` | ReminderFormScreen | ชิปวัน พฤหัสบดี (TH) |
| `reminder-byday-fr` | ReminderFormScreen | ชิปวัน ศุกร์ (FR) |
| `reminder-byday-sa` | ReminderFormScreen | ชิปวัน เสาร์ (SA) |
| `reminder-byday-su` | ReminderFormScreen | ชิปวัน อาทิตย์ (SU) |
| `reminder-save` | ReminderFormScreen | ปุ่มบันทึก |
| `reminder-cancel` | ReminderFormScreen | ปุ่มยกเลิก |
| `settings-screen` | SettingsScreen | SafeAreaView container |
| `settings-logout` | SettingsScreen | แถว "ออกจากระบบ" |
| `kick-home-loading` | KickCountHomeScreen | loading skeleton |
| `kick-home-error` | KickCountHomeScreen | error state |
| `kick-home-ready` | KickCountHomeScreen | ready-state container |
| `kick-offline-pill` | KickCountHomeScreen | offline pill |
| `kick-start-btn` | KickCountHomeScreen | ปุ่ม "เริ่มนับ" |
| `kick-consent-caption` | KickCountHomeScreen | caption consent gate |
| `kick-postpartum-banner` | KickCountHomeScreen | banner postpartum (ไม่มีปุ่มเริ่มนับ) |
| `kick-view-history-btn` | KickCountHomeScreen | ปุ่ม "ดูประวัติทั้งหมด" |
| `kick-safety-strip` | KickCountHomeScreen | safety strip (always-on) |
| `kick-counting-screen` | KickCountCountingScreen | container counting state |
| `kick-counting-loading` | KickCountCountingScreen | container loading phase |
| `kick-tap-btn` | KickCountCountingScreen | ปุ่มนับ (+1) |
| `kick-undo-btn` | KickCountCountingScreen | ปุ่ม undo (−1) |
| `kick-end-session-btn` | KickCountCountingScreen | ปุ่ม "จบเซสชัน" (always-on) |
| `kick-cancel-btn` | KickCountCountingScreen | ปุ่ม "ยกเลิก" |
| `kick-save-error` | KickCountCountingScreen | panel แจ้ง save error |
| `kick-leave-guard-modal` | KickCountCountingScreen | Leave Guard modal |
| `kick-leave-guard-save-btn` | KickCountCountingScreen | "บันทึก+จบ" ใน leave guard |
| `kick-leave-guard-continue-btn` | KickCountCountingScreen | "นับต่อ" ใน leave guard |
| `kick-leave-guard-discard-btn` | KickCountCountingScreen | "ยกเลิก+ทิ้งข้อมูล" ใน leave guard |
| `kick-draft-resume-sheet` | KickCountCountingScreen | draft-resume sheet (SC-K2) |
| `kick-draft-resume-btn` | KickCountCountingScreen | ปุ่ม "นับต่อจาก draft" |
| `kick-draft-finalize-btn` | KickCountCountingScreen | ปุ่ม "จบและบันทึก draft" |
| `kick-draft-discard-btn` | KickCountCountingScreen | ปุ่ม "ทิ้ง draft" |
| `kick-summary-screen` | KickCountSummaryScreen | container |
| `kick-summary-loading` | KickCountSummaryScreen | loading state |
| `kick-summary-stats` | KickCountSummaryScreen | กล่องแสดงสถิติ |
| `kick-summary-count` | KickCountSummaryScreen | ตัวเลข count |
| `kick-summary-duration` | KickCountSummaryScreen | duration |
| `kick-summary-view-history-btn` | KickCountSummaryScreen | ปุ่ม "ดูประวัติ" |
| `kick-summary-done-btn` | KickCountSummaryScreen | ปุ่ม "เสร็จ" กลับ Home |
| `capture-type-control` | CaptureScreen | segmented control เลือกประเภท self-log (ซ่อนเมื่อ pre-set) |
| `capture-type-{type}` | CaptureScreen | แต่ละ segment; type ∈ weight, blood_pressure, swelling, lochia, symptom |
| `capture-weight-input` | CaptureScreen | ช่องตัวเลข น้ำหนัก (kg) |
| `capture-systolic-input` | CaptureScreen | ช่องตัวเลข ความดัน systolic |
| `capture-diastolic-input` | CaptureScreen | ช่องตัวเลข ความดัน diastolic |
| `capture-text-input` | CaptureScreen | ช่องข้อความสำหรับ swelling/lochia/symptom |
| `capture-time-display` | CaptureScreen | ปุ่ม/ข้อความเวลา (floating-civil HH:mm) |
| `capture-note-input` | CaptureScreen | ช่อง note (ไม่บังคับ, never parsed) |
| `capture-echo-line` | CaptureScreen | echo line — preview verbatim ของ Day-Detail row (INV-S1) |
| `capture-save-btn` | CaptureScreen | ปุ่มบันทึก Save |
| `capture-consent-modal` | CaptureScreen | modal nudge JIT consent (แสดงเมื่อ general_health ยังไม่ grant) |
| `capture-consent-grant` | CaptureScreen | ปุ่ม Grant ใน consent modal |
| `capture-consent-not-now` | CaptureScreen | ปุ่ม Not Now ใน consent modal |
| `capture-save-error` | CaptureScreen | panel แจ้ง save error |

---

## testID ที่เพิ่งเพิ่ม (merged to main)

### รอบก่อน (calendar + reminder create)
testID ทั้ง 9 รายการต่อไปนี้ขาดอยู่ใน review รอบก่อน และได้ merge เข้า main แล้ว
Flow 06 และ 07 อัปเดตให้ใช้ `id:` selector สำหรับทุก element เหล่านี้ — ไม่มี `text:` หรือ `accessibilityLabel:` workaround อีกต่อไป

| testID | หน้าจอ | Flow ที่ได้ประโยชน์ |
|---|---|---|
| `calendar-screen` | CalendarScreen | 06, 07, 07b, 10 |
| `calendar-add-appointment-btn` | CalendarScreen | 06 |
| `calendar-add-reminder-btn` | CalendarScreen | 07, 07b, 10 |
| `calendar-agenda-item` | CalendarScreen | 06, 07, 10 |
| `appointment-title` | AppointmentFormScreen | 06 |
| `appointment-date-picker-done` | AppointmentFormScreen | 06 |
| `appointment-time-picker-done` | AppointmentFormScreen | 06 |
| `reminder-title` | ReminderFormScreen | 07, 10 |
| `reminder-picker-done` | ReminderFormScreen | 07, 07b, 10 |

### รอบนี้ — Medication (Slice 2, Task 11 + Task 12 QA)

testID ทั้งหมดต่อไปนี้เพิ่มมาใน Slice 2 (`MedicationPlanListScreen.tsx` + `MedicationPlanFormSheet.tsx` + `CaptureScreen.tsx`) และได้ merge เข้า branch `slice/feat-medication` แล้ว

**MedicationPlanListScreen**

| testID | หน้าจอ | Flow | หมายเหตุ |
|---|---|---|---|
| `home-medication-shortcut` | HomeScreen (pregnant) | 14, 15, 16 | ลิงก์ไป MedicationPlans |
| `home-medication-shortcut-postpartum` | HomeScreen (postpartum) | 14, 15, 16 | ลิงก์ไป MedicationPlans (postpartum) |
| `home-doctor-pdf-btn` | HomeScreen | 17 | ลิงก์ไป DoctorPdf |
| `med-empty-state` | MedicationPlanListScreen | 14 | empty state (ยังไม่มีแผน) |
| `med-add-top` | MedicationPlanListScreen | 14 | FAB / เพิ่มแผนใหม่ (มุมบนขวา) |
| `med-add-first` | MedicationPlanListScreen | 14 | ปุ่มในหน้า empty state |
| `med-plan-list` | MedicationPlanListScreen | 14, 15, 16 | FlatList หลัก |
| `med-plan-card-${plan.id}` | MedicationPlanListScreen | (dynamic) | แต่ละ plan card (ID dynamic) |
| `med-plan-toggle-${plan.id}` | MedicationPlanListScreen | (dynamic) | active/inactive toggle |
| `med-plan-log-btn-${plan.id}` | MedicationPlanListScreen | 15, 16 | ปุ่ม "บันทึกการกินยา" (ID dynamic; ใช้ `text:` selector ใน Maestro) |
| `med-error-retry` | MedicationPlanListScreen | - | error/retry |
| `med-toast` | MedicationPlanListScreen | 15, 16 | toast หลัง save |
| `consent-home-health-logging-nudge-banner` | MedicationPlanListScreen | - | nudge banner เมื่อไม่มี general_health |

**MedicationPlanFormSheet**

| testID | หน้าจอ | Flow | หมายเหตุ |
|---|---|---|---|
| `med-name-input` | MedicationPlanFormSheet | 14 | ช่องชื่อยา (base64 ciphertext) |
| `med-dose-input` | MedicationPlanFormSheet | 14 | ช่องขนาดยา (optional, base64) |
| `med-freq-chip-daily` | MedicationPlanFormSheet | 14 | chip ความถี่ "ทุกวัน" |
| `med-freq-chip-every_n_days` | MedicationPlanFormSheet | - | chip "ทุก N วัน" (interval≥2 required) |
| `med-freq-chip-one_off` | MedicationPlanFormSheet | - | chip "ครั้งเดียว" |
| `med-interval-dec` / `med-interval-value` / `med-interval-inc` | MedicationPlanFormSheet | - | stepper interval (every_n_days; min=2) |
| `med-start-date` | MedicationPlanFormSheet | - | start date picker (iOS wheel; manual only) |
| `med-start-time` | MedicationPlanFormSheet | - | start time picker (iOS wheel; manual only) |
| `med-echo` | MedicationPlanFormSheet | 14 | echo row (first occurrence preview) |
| `med-active-toggle` | MedicationPlanFormSheet | - | active switch |
| `med-save-btn` | MedicationPlanFormSheet | 14 | ปุ่มบันทึก |
| `med-delete-trigger` | MedicationPlanFormSheet | - | ปุ่มลบ (confirm dialog) |
| `med-delete-confirm` | MedicationPlanFormSheet | - | confirm ลบ |
| `med-delete-cancel` | MedicationPlanFormSheet | - | cancel ลบ |

**CaptureScreen (medication family)**

| testID | หน้าจอ | Flow | หมายเหตุ |
|---|---|---|---|
| `capture-medication-taken` | CaptureScreen | 15 | chip "กินแล้ว" (INV-M2 equal weight) |
| `capture-medication-missed` | CaptureScreen | 16 | chip "ลืมกิน" (INV-M2 equal weight) |
| `capture-echo-line` | CaptureScreen | 15, 16 | echo line — plan name verbatim (INV-M4) |
| `capture-save-btn` | CaptureScreen | 15, 16 | ปุ่ม Save |

**DoctorPdfScreen**

| testID | หน้าจอ | Flow | หมายเหตุ |
|---|---|---|---|
| `pdf-screen-generating` | DoctorPdfScreen | 17 | loading ขณะ buildDoctorReportHtml รัน |
| `pdf-screen-preview` | DoctorPdfScreen | 17 | WebView HTML (content = manual check) |
| `pdf-screen-builder` | DoctorPdfScreen | 17 | builder UI ก่อน generate |
| `pdf-screen-consent-blocked` | DoctorPdfScreen | - | ถ้า sensitive_lab_results ไม่ grant |
| `pdf-screen-error` | DoctorPdfScreen | - | error state |
| `pdf-screen-print-btn` | DoctorPdfScreen | - | ปุ่ม Print |
| `pdf-screen-share-btn` | DoctorPdfScreen | - | ปุ่ม Share |

### รอบก่อน — weekly recurrence (#7) + reminder-edit (#13)
testID ทั้ง 11 รายการต่อไปนี้เพิ่มมาพร้อม PR #7 (weekly) และได้ merge เข้า main แล้ว
ยืนยันแล้วด้วย grep `/src/calendar/ReminderFormScreen.tsx`

| testID | หน้าจอ | Flow ที่ได้ประโยชน์ | หมายเหตุ |
|---|---|---|---|
| `reminder-freq-weekly` | ReminderFormScreen | 07b | ชิป "เลือกวันในสัปดาห์"; template `reminder-freq-${f}` |
| `reminder-freq-one_off` | ReminderFormScreen | (อ้างอิง) | ชิป "ครั้งเดียว" |
| `reminder-freq-daily` | ReminderFormScreen | (อ้างอิง) | ชิป "ทุกวัน" |
| `reminder-freq-every_n_days` | ReminderFormScreen | (อ้างอิง) | ชิป "ทุก N วัน" |
| `reminder-interval-weeks` | ReminderFormScreen | 07b | แสดงเฉพาะ freq=weekly |
| `reminder-byday-mo` | ReminderFormScreen | 07b | จ (จันทร์) |
| `reminder-byday-tu` | ReminderFormScreen | 07b (assert) | อ (อังคาร) |
| `reminder-byday-we` | ReminderFormScreen | 07b | พ (พุธ) |
| `reminder-byday-th` | ReminderFormScreen | 07b (assert) | พฤ (พฤหัสบดี) |
| `reminder-byday-fr` | ReminderFormScreen | 07b | ศ (ศุกร์) |
| `reminder-byday-sa` | ReminderFormScreen | (อ้างอิง) | ส (เสาร์) |
| `reminder-byday-su` | ReminderFormScreen | (อ้างอิง) | อา (อาทิตย์) |

หมายเหตุ: "แก้ไข" ใน flow 10 ไม่ใช่ testID — เป็น text label จาก messages.ts
`'calendar.editReminder': 'แก้ไข'` ที่ใช้เป็น Alert button label (UIAlertAction บน iOS)

---

## หมายเหตุ

- **E2E จริงทะลุ API** — ต้องเปิด backend + simulator พร้อมกัน; ถ้า backend ไม่รัน flow จะ timeout ที่ step หลัง login
- **Expo Go มีข้อจำกัด** — Maestro ระบุ app ด้วย `bundleIdentifier`; Expo Go ใช้ bundle id ของตัวเอง ไม่ใช่ `com.momstarter.app` ทำให้ `launchApp` ไม่ตรง → ใช้ dev build (`npx expo run:ios`) เสมอ
- **CI** — ยังไม่ได้ตั้งค่า; เมื่อพร้อมให้เพิ่ม `maestro cloud` หรือ GitHub Actions + iOS runner ในภายหลัง
- **flow 03** ใช้การ tap ปุ่ม increment 18 ครั้ง (week 20 → 38) เพราะ Maestro ไม่มี loop native; หากต้องการ week อื่นให้แก้จำนวน tap
- **flow 04** ต้องมี profile ที่เป็น T3 อยู่แล้ว; รัน flow 03 ก่อน หรือ seed ผ่าน API โดยตรง
- **flow 06/07 date/time picker** — Maestro ไม่สามารถ scroll wheel ของ iOS spinner picker ได้อย่างน่าเชื่อถือ; flow ทดสอบเฉพาะ "เปิด picker → Done → save" ด้วยค่า default; การเลือกวันเวลาเฉพาะเจาะจงให้ทดสอบ manual (TC-CAL-01, TC-REM-01)
- **flow 08 ปุ่ม Settings** — ไอคอนเปลี่ยนจาก ⚙ (gear) เป็น ☰ (hamburger) ใน merge ล่าสุด แต่ `testID="home-settings-btn"` ยังเหมือนเดิม → flow ไม่ต้องแก้ selector ใดๆ ใช้งานได้ทันที
- **flow 08 Alert text** — ปุ่ม confirm logout ("ออกจากระบบ") มีข้อความเดียวกับ title ของ Alert; Maestro เลือก interactive element ก่อน (ปุ่ม) ดังนั้นใช้งานได้ปกติ แต่หาก fail ให้ลอง tapOn โดย index หรือ Maestro `id:` ถ้าเพิ่ม testID ให้ปุ่ม alert ได้ในอนาคต
- **flow 09 draft-resume** — `clearState: true` clear Keychain ทำให้ไม่มี draft; SC-K2 draft-resume sheet (`kick-draft-resume-sheet`) ต้องทดสอบ manual (TC-KIC-07 ถึง TC-KIC-07d) หรือด้วย flow ใหม่ที่ใช้ `stopApp` + `launchApp` (ไม่มี clearState)
- **flow 09b (draft-resume) — ยังไม่ได้สร้าง** — หากต้องการ E2E coverage สำหรับ draft-resume outcomes ให้สร้าง `09b-kick-count-draft-resume.yaml` โดยใช้ `stopApp` + `launchApp` (ไม่มี clearState) เพื่อให้ draft ยังอยู่; TC-KIC-07b/c/d ครอบคลุมใน manual plan ไว้แล้วในระหว่างนี้
- **flow 09 wk32 gate** — `home-kick-count-shortcut` จะไม่ปรากฏถ้า profile pregnant week < 32; ต้องรัน flow 03 ก่อนหรือใช้ account ที่ seed week >= 32 ไว้
- **flow 07b weekly recurrence (FEATURE #7)** — ทดสอบ UI interaction ของ weekly chip และ byday chips ครบ; ไม่ assert `calendar-agenda-item` เพราะ default start date = today (Thursday 2026-07-02) ไม่ตรงกับ byDay=[MO,WE,FR] — occurrence แรกจะอยู่ในวันศุกร์ถัดไป แต่ปฏิทิน focus วันพฤหัส (start date) จึงไม่มี item นั้นปรากฏ; agenda spot-check = manual เท่านั้น (TC-REM-07)
- **flow 10 reminder edit + Alert button (FEATURE #13)** — ใช้ `tapOn: text: "แก้ไข"` เพื่อกด native UIAlertAction; ทำงานได้เมื่อ "แก้ไข" เป็น string ที่ unique ใน Alert นั้น (ปุ่มอื่นคือ "ทำแล้ว" / "เลื่อน 1 ชั่วโมง" / "ยกเลิก"); หาก Maestro ไม่สามารถ target ได้ (native Alert limitation) → fallback เป็น manual TC-REM-05; `calendar-agenda-item` ที่แตะในขั้นตอนที่ 2 อาจเป็น appointment row แทน reminder row ถ้า account มีรายการอื่นในวันนั้น → ใช้ account ที่ clearState (flow นี้ใช้ `clearState: true` แล้ว)
- **flow 11/12/13 — NAV WIRING PREREQUISITE (Self-log Capture)** — CaptureScreen มี testID ครบแล้ว แต่ CalendarScreen ยังไม่มีปุ่ม `calendar-add-capture-btn` ใน Slice 1 (navigation.navigate('Capture') ไม่ได้ถูก wire ที่ไหนเลยใน production UI) ทำให้ flow 11/12/13 ยังรันไม่ได้จนกว่าจะเพิ่มปุ่มนี้ใน Slice 2+. ต้องเพิ่มใน CalendarScreen: `<TouchableOpacity testID="calendar-add-capture-btn" onPress={onAddCapture}>` และ wire `onAddCapture={() => navigation.navigate('Capture')}` ใน RootNavigator (ดูหมายเหตุใน flow 11). Logic chain ครอบคลุมที่ `selfLogChain.integration.test.ts` แล้ว — flow 11/12/13 เป็น UI layer coverage เท่านั้น.
- **flow 12 consent prerequisite** — ต้อง decline general_health ก่อนรัน flow 12; ทำได้โดย: Home → ☰ Settings → Manage consents → Health logging → Decline. หลังรัน flow 12 สำเร็จ consent จะถูก grant — account กลับสู่สภาวะ granted อัตโนมัติ.
- **flow 13 offline isolation** — เพื่อยืนยัน local-store clearing (ไม่ใช่แค่ server data) ให้เปิด Airplane Mode บน Simulator ก่อน re-login (step C); ข้อมูลจาก pull จะไม่มา; Day-Detail จะว่างเปล่า = store cleared. PDPA 1.1 invariant ยืนยันแล้วที่ unit test `performLogout.test.ts` + `selfLogSyncStore.test.ts`.
