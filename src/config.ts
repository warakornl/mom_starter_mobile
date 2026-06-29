/**
 * App configuration — single source of truth for runtime settings.
 *
 * ── API Base URL ────────────────────────────────────────────────────────────────
 * Default: http://localhost:8080  (Spring Boot running on the same machine as Metro)
 *
 * UAT บนมือถือจริง / Android emulator บน LAN:
 *   "localhost" บนมือถือจริงจะชี้ไปที่ตัวมือถือเอง ไม่ใช่เครื่อง dev
 *   ต้องเปลี่ยนเป็น IP ของเครื่อง dev ในวง LAN เช่น:
 *     http://192.168.1.10:8080
 *   วิธีดู IP: macOS → System Settings → Wi-Fi → Details
 *
 * ข้อยกเว้น: iOS Simulator บน Mac ใช้ localhost ได้ (share network stack เดียวกับ Mac)
 *
 * วิธีแก้: เปลี่ยน API_BASE_URL ด้านล่าง หรือตั้งใน app.json "extra.apiBaseUrl"
 * แล้วอ่านผ่าน expo-constants (ดูตัวอย่างใน comment ด้านล่าง)
 *
 * ── Using app.json extra (recommended for multi-env) ───────────────────────────
 * In app.json:
 *   "extra": { "apiBaseUrl": "http://192.168.1.10:8080" }
 *
 * Then replace the export below with:
 *   import Constants from 'expo-constants';
 *   const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
 *   export const API_BASE_URL: string = extra?.apiBaseUrl ?? 'http://localhost:8080';
 */

export const API_BASE_URL = 'http://localhost:8080';
