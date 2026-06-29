# คู่มือทดสอบ UAT และ Build แอป Mom-Starter

> **สำหรับใคร:** ผู้ที่ไม่มีพื้นฐาน Mobile Dev — อ่านทีละขั้น ทำตามได้จริง

---

## สารบัญ

1. [ข้อกำหนดเบื้องต้น (Prerequisites)](#1-ขอกำหนดเบองตน-prerequisites)
2. [วิธี A — Expo Go (ง่ายสุด ฟรี ไม่ต้อง build)](#2-วธ-a--expo-go-งายสด-ฟร-ไมตอง-build)
3. [วิธี B — iOS Simulator บน Mac (มี Xcode แล้ว)](#3-วธ-b--ios-simulator-บน-mac-ม-xcode-แลว)
4. [วิธี C — Android Emulator](#4-วธ-c--android-emulator)
5. [วิธี D — EAS Build (cloud build)](#5-วธ-d--eas-build-cloud-build)
6. [ตารางสรุปเลือกวิธี](#6-ตารางสรปเลอกวธ)
7. [คำเตือนสำคัญ — baseUrl ใน standalone build (EAS)](#7-คำเตอนสำคญ--baseurl-ใน-standalone-build-eas)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. ข้อกำหนดเบื้องต้น (Prerequisites)

### ทุกวิธีต้องมี

| รายการ | วิธีติดตั้ง | หมายเหตุ |
|--------|------------|---------|
| **Node.js 20 LTS** | ดาวน์โหลดที่ [nodejs.org](https://nodejs.org) | ตรวจสอบด้วย `node -v` |
| **บัญชี Expo** | สมัครฟรีที่ [expo.dev](https://expo.dev) | ใช้สำหรับ EAS Build |

### สำหรับวิธี D เท่านั้น (EAS Build)

```bash
npm install -g eas-cli
```

ตรวจสอบด้วย:
```bash
eas --version
```

### สำหรับ iOS บน iPhone จริง / TestFlight

- **Apple Developer Account** — สมัครที่ [developer.apple.com](https://developer.apple.com)
- ค่าใช้จ่าย: **$99 USD/ปี ≈ ฿3,300 บาท/ปี** (คำนวณที่ $1 ≈ ฿33.3 อ้างอิงมิถุนายน 2025)
- หมายเหตุ: **ไม่ต้องมี Apple Developer account** ถ้าใช้แค่ Expo Go หรือ iOS Simulator

### สำหรับ Android บน Play Store

- Google Play Developer Console — สมัครที่ [play.google.com/console](https://play.google.com/console)
- ค่าสมัครครั้งเดียว: **$25 USD ≈ ฿832 บาท** (ไม่มีรายปี)
- หมายเหตุ: **แจก .apk ให้ทดสอบได้ฟรี** ไม่ต้องขึ้น Play Store

---

## 2. วิธี A — Expo Go (ง่ายสุด ฟรี ไม่ต้อง build)

> เหมาะสำหรับทดสอบ UI และ logic พื้นฐานระหว่าง development

### ขั้นตอน

**ขั้นที่ 1:** ติดตั้ง dependency

```bash
cd mom_starter_mobile
npm install
npx expo install
```

> ใช้ `npx expo install` เสมอ (ไม่ใช่ `npm install` อย่างเดียว) เพราะ Expo จะเลือก version ที่เข้ากันได้ให้

**ขั้นที่ 2:** เปิดแอปฝั่ง backend ก่อน
- ตรวจสอบว่า Spring Boot API รันอยู่ที่พอร์ต 8080
- คำสั่ง: `./mvnw spring-boot:run` ในโฟลเดอร์ mom_starter_api

**ขั้นที่ 3:** เริ่ม Metro bundler

```bash
npx expo start
```

จะเห็น QR code ใน terminal

**ขั้นที่ 4:** ลง Expo Go บนมือถือ
- **iOS:** ค้นหา "Expo Go" ใน App Store
- **Android:** ค้นหา "Expo Go" ใน Play Store

**ขั้นที่ 5:** สแกน QR code
- **iOS:** เปิดกล้องมือถือแล้วสแกน QR code ในหน้าจอ terminal
- **Android:** เปิดแอป Expo Go แล้วกด "Scan QR code"

> **สำคัญ:** มือถือและ Mac ต้องอยู่ใน **Wi-Fi วงเดียวกัน** เท่านั้นถึงจะต่อกันได้

### Auto-resolve IP

`src/config.ts` ดึง IP เครื่อง dev จาก Expo อัตโนมัติ ไม่ต้องแก้ค่า IP เองใน Expo Go

---

## 3. วิธี B — iOS Simulator บน Mac (มี Xcode แล้ว)

> เหมาะสำหรับ dev บน Mac ที่มี Xcode ติดตั้งแล้ว — ฟรี ไม่ต้องมี Apple account

**ขั้นที่ 1:** ติดตั้ง Xcode Command Line Tools (ถ้ายังไม่มี)

```bash
xcode-select --install
```

**ขั้นที่ 2:** เริ่ม Metro bundler

```bash
npx expo start
```

**ขั้นที่ 3:** กด `i` ในหน้าต่าง terminal

Expo จะเปิด iOS Simulator ให้อัตโนมัติ

> ถ้า Simulator ไม่เปิดขึ้นมา ให้เปิด Xcode → menu **Xcode → Open Developer Tool → Simulator** ก่อน แล้วกด `i` ใหม่

---

## 4. วิธี C — Android Emulator

> ต้องติดตั้ง Android Studio ก่อน

**ขั้นที่ 1:** ดาวน์โหลด [Android Studio](https://developer.android.com/studio) แล้วติดตั้ง

**ขั้นที่ 2:** สร้าง Virtual Device (AVD)
- เปิด Android Studio → **Device Manager** → **Create Device**
- เลือก: Pixel 7 หรือ Pixel 8 (แนะนำ)
- เลือก System Image: **API 34 (Android 14)**

**ขั้นที่ 3:** เริ่ม Emulator
- กดปุ่ม Play ข้างชื่อ device ใน Device Manager

**ขั้นที่ 4:** เริ่ม Metro bundler

```bash
npx expo start
```

**ขั้นที่ 5:** กด `a` ใน terminal เพื่อเปิดบน emulator

---

## 5. วิธี D — EAS Build (cloud build)

> EAS Build = ให้ Expo cloud build ไฟล์ .ipa / .apk ให้ ไม่ต้องทำบนเครื่องตัวเอง

### ขั้นเตรียมการครั้งแรก (ทำครั้งเดียว)

**ขั้นที่ 1:** Login เข้า Expo account

```bash
eas login
```

ใส่ email และ password ที่สมัครไว้

**ขั้นที่ 2:** เชื่อม project กับ EAS

```bash
eas init
```

คำสั่งนี้จะ:
- สร้าง Project ใน Expo dashboard
- เติม `projectId` ใน `app.json` → `extra.eas.projectId` ให้อัตโนมัติ (แทนที่ค่า placeholder `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

> **ต้องทำขั้นนี้ก่อนสั่ง build ทุกครั้ง** มิฉะนั้น EAS จะไม่รู้ว่า build ของใคร

---

### D-1: iOS Simulator build (ไม่ต้องมี Apple Developer account)

> วิธีนี้พิเศษมาก — ได้ไฟล์ .app ที่รันบน iOS Simulator ได้โดยไม่ต้องเซ็นต์ certificate ใดๆ

**สั่ง build:**

```bash
eas build -p ios --profile preview-ios-simulator
```

รอ 5–15 นาที (build บน cloud ของ Expo)

เมื่อ build เสร็จ จะได้ลิงก์ดาวน์โหลดไฟล์ `.app`

**วิธีติดตั้งบน Simulator:**

วิธีที่ 1 — ใช้คำสั่ง (ง่ายสุด):
```bash
eas build:run -p ios
```
EAS จะหา build ล่าสุดและติดตั้งบน Simulator ที่เปิดอยู่อัตโนมัติ

วิธีที่ 2 — ลากไฟล์:
- ดาวน์โหลดไฟล์ `.app` จากลิงก์ที่ได้
- เปิด iOS Simulator
- ลากไฟล์ `.app` ทิ้งบนหน้าจอ Simulator

---

### D-2: iOS ลง iPhone จริง / TestFlight (ต้องมี Apple Developer $99/ปี)

**สั่ง build:**

```bash
eas build -p ios --profile production
```

EAS จะถามข้อมูล Apple Developer account ครั้งแรก (Apple ID, Team ID)

**ส่งขึ้น TestFlight:**

```bash
eas submit -p ios
```

จากนั้น tester รับ invitation email จาก Apple แล้วดาวน์โหลดผ่านแอป **TestFlight**

---

### D-3: Android .apk แจก tester (ฟรี ไม่ต้องขึ้น Play Store)

**สั่ง build:**

```bash
eas build -p android --profile preview
```

รอ 5–15 นาที

เมื่อ build เสร็จ จะได้ลิงก์ดาวน์โหลดไฟล์ `.apk`

**วิธีติดตั้งบน Android:**
- ส่งลิงก์ให้ tester
- tester เปิด browser บนมือถือ → ดาวน์โหลด .apk → เปิดไฟล์
- ถ้ามือถือถาม "Allow install from unknown sources" → กด Allow (ปกติสำหรับ .apk นอก Play Store)

---

## 6. ตารางสรุปเลือกวิธี

| วิธี | ต้องมีอะไร | ค่าใช้จ่าย | เหมาะกับ |
|------|-----------|-----------|---------|
| **A — Expo Go** | Node, บัญชี Expo (ฟรี), Wi-Fi เดียวกัน | ฟรี | ทดสอบ UI ระหว่าง dev รวดเร็ว |
| **B — iOS Simulator** | Mac + Xcode | ฟรี | dev + ทดสอบ iOS บน Mac |
| **C — Android Emulator** | Android Studio + AVD | ฟรี | dev + ทดสอบ Android |
| **D-1 — EAS iOS Simulator** | บัญชี Expo | ฟรี (build quota มี) | ทดสอบ .ipa บน Simulator ไม่มี Xcode |
| **D-2 — EAS iOS real device** | Apple Developer account | ฿3,300/ปี | ส่ง tester ผ่าน TestFlight |
| **D-3 — EAS Android .apk** | บัญชี Expo | ฟรี | แจก .apk ให้ Android tester |
| **D-4 — Play Store** | Google Play Console | ฿832 ครั้งเดียว | release บน Play Store |

---

## 7. คำเตือนสำคัญ — baseUrl ใน standalone build (EAS)

### ปัญหาคืออะไร?

`src/config.ts` ดึง IP เครื่อง dev จาก `hostUri` ของ Expo — แต่ `hostUri` มีเฉพาะใน **Expo Go / development mode** เท่านั้น

เมื่อ build เป็น standalone app ด้วย EAS:
- `hostUri` จะเป็น `undefined`
- app จะ **fallback ไปใช้ `localhost:8080`**
- localhost ในมือถือ = ตัวมือถือเอง ไม่ใช่ Mac ของคุณ
- ผลลัพธ์: **ต่อ backend ไม่ติด**

### วิธีแก้ — ตั้ง `apiBaseUrl` ใน `app.json` ก่อน build

เปิดไฟล์ `app.json` แล้วแก้ส่วน `extra`:

```json
"extra": {
  "apiBaseUrl": "http://192.168.1.10:8080",
  "eas": {
    "projectId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

แทนที่ `192.168.1.10` ด้วย IP จริงของเครื่อง Mac ของคุณ

**วิธีหา IP เครื่อง Mac:**
```bash
ipconfig getifaddr en0
```
หรือไปที่ System Settings → Wi-Fi → ชื่อ Wi-Fi ที่เชื่อมต่อ → Details → IP Address

### ตัวอย่างสถานการณ์

| สถานการณ์ | ค่า apiBaseUrl ที่ต้องตั้ง |
|----------|--------------------------|
| ทดสอบในออฟฟิศ (LAN เดียวกัน) | `http://192.168.1.10:8080` (IP Mac ในวง LAN) |
| ทดสอบผ่าน ngrok (ไม่ได้ LAN เดียวกัน) | `https://xxxx.ngrok.io` |
| Deploy backend บน AWS | `https://api.yourapp.com` |

> **จำไว้:** เปลี่ยน `apiBaseUrl` แล้ว **ต้อง build ใหม่** — ค่านี้ถูกฝังในแอปตอน build ไม่ใช่ตอน run

---

## 8. Troubleshooting

### มือถือต่อ backend ไม่ติด (ใน Expo Go)

**อาการ:** แอปเปิดได้แต่ login / register ไม่ทำงาน มี error "Network request failed"

**เช็คตามลำดับ:**

1. **Wi-Fi เดียวกันไหม?**
   - มือถือและ Mac ต้องอยู่ Wi-Fi วงเดียวกัน
   - ถ้าใช้ hotspot มือถือ → Mac ต้องเชื่อม hotspot นั้นด้วย

2. **Spring Boot bind ถูก address ไหม?**
   - Spring Boot ต้องรับ connection จากทุก interface ไม่ใช่แค่ localhost
   - ใน `application.properties` ควรมี:
     ```properties
     server.address=0.0.0.0
     ```
   - ถ้าไม่ตั้ง Spring Boot อาจรับแค่ localhost → มือถือเชื่อมไม่ได้

3. **Firewall บน Mac บล็อกพอร์ต 8080 ไหม?**
   - ไปที่ System Settings → Network → Firewall
   - ถ้า Firewall เปิดอยู่ → ให้อนุญาต incoming connections สำหรับ Java / Spring Boot

4. **Spring Boot รันอยู่ไหม?**
   - เปิด browser บน Mac แล้วไปที่ `http://localhost:8080/health`
   - ถ้าไม่ตอบ → Spring Boot ยังไม่รัน

### QR code สแกนแล้วไม่ขึ้นแอป

**วิธีแก้ — ใช้ tunnel mode:**

```bash
npx expo start --tunnel
```

Expo จะสร้าง URL ผ่าน ngrok แทน LAN — ใช้ได้แม้ไม่ได้อยู่ Wi-Fi เดียวกัน

> **หมายเหตุ:** tunnel mode ช้ากว่า LAN — ใช้เฉพาะตอนที่ LAN ไม่ work

### iOS Simulator เปิดไม่ขึ้น

```bash
# ตรวจสอบว่า Xcode Command Line Tools ติดตั้งแล้ว
xcode-select -p

# ถ้าไม่ขึ้น path → ติดตั้ง
xcode-select --install
```

### EAS build ล้มเหลว — "projectId not found"

แสดงว่ายังไม่ได้รัน `eas init` — รันคำสั่งนี้ก่อน:

```bash
eas init
```

---

*อัปเดตล่าสุด: มิถุนายน 2025 — Expo SDK 51 / EAS CLI 8+*
