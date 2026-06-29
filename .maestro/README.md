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
2. **Dev Build** — แนะนำให้ใช้ dev build แทน Expo Go เพราะ Maestro ต้องการ `bundleIdentifier` (`com.momstarter.app`) ที่แน่นอน:

   ```bash
   cd mom_starter_mobile
   npx expo run:ios
   ```

3. **Backend รันอยู่** — branch `slice/feat-birth-event` (หรือ sync กับ main) ต้องรันที่ `localhost:8080` ก่อน เพราะ flow E2E ทะลุ API จริง
4. **Dev account** — ต้องมี account `dev@momstarter.local` / password `DevTest-Password-2026` ในฐานข้อมูล dev (seed ก่อนรัน)

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
```

---

## Flow แต่ละไฟล์

| ไฟล์ | Flow | Prerequisite พิเศษ |
|------|------|--------------------|
| `01-login.yaml` | launch → login → assert `home-week-hero` | dev account มี profile T3 |
| `02-register.yaml` | launch → register (email ใหม่ timestamp) → assert VerifyEmail | - |
| `03-pregnancy.yaml` | login → ตั้ง week 38 → assert `home-week-hero` | account ยังไม่มี profile |
| `04-birth-event.yaml` | login → birth CTA → กรอกวันคลอด → assert `home-postpartum-banner` | profile เป็น T3 (week >= 28) |

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
| `home-birth-cta` | HomeScreen | ปุ่ม "ลูกคลอดแล้ว" (T3 เท่านั้น) |
| `home-postpartum-banner` | HomeScreen | banner postpartum |
| `birth-date` | BirthEventScreen | ช่องเลือกวันคลอด |
| `birth-save` | BirthEventScreen | ปุ่ม Save |

---

## หมายเหตุ

- **E2E จริงทะลุ API** — ต้องเปิด backend + simulator พร้อมกัน; ถ้า backend ไม่รัน flow จะ timeout ที่ step หลัง login
- **Expo Go มีข้อจำกัด** — Maestro ระบุ app ด้วย `bundleIdentifier`; Expo Go ใช้ bundle id ของตัวเอง ไม่ใช่ `com.momstarter.app` ทำให้ `launchApp` ไม่ตรง → ใช้ dev build (`npx expo run:ios`) เสมอ
- **CI** — ยังไม่ได้ตั้งค่า; เมื่อพร้อมให้เพิ่ม `maestro cloud` หรือ GitHub Actions + iOS runner ในภายหลัง
- **flow 03** ใช้การ tap ปุ่ม increment 18 ครั้ง (week 20 → 38) เพราะ Maestro ไม่มี loop native; หากต้องการ week อื่นให้แก้จำนวน tap
- **flow 04** ต้องมี profile ที่เป็น T3 อยู่แล้ว; รัน flow 03 ก่อน หรือ seed ผ่าน API โดยตรง
