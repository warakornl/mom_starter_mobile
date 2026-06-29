/**
 * App configuration — single source of truth for runtime settings.
 *
 * ── API Base URL (auto-resolved for same-Wi-Fi UAT) ─────────────────────────────
 * เป้าหมาย: ทดสอบบนมือถือจริงผ่าน Expo Go โดย "ไม่ต้องแก้ IP เครื่องเอง"
 *
 * เมื่อรันผ่าน Expo Go บน LAN, Expo รู้ IP ของเครื่อง dev อยู่แล้ว (ใช้เสิร์ฟ bundle)
 * เราจึงดึง host เดียวกันนั้นมาชี้ API → http://<ip-เครื่อง-dev>:8080 อัตโนมัติ
 * มือถือกับเครื่อง dev ต้องอยู่ Wi-Fi วงเดียวกัน และ Spring Boot รันที่พอร์ต 8080
 *
 * ลำดับการเลือก base URL:
 *   1) ถ้าตั้ง app.json → "extra": { "apiBaseUrl": "http://..." } ไว้ ใช้ค่านั้น (override มือ)
 *   2) ไม่งั้น ใช้ IP ที่ Expo รู้ (เคสปกติของ UAT บนมือถือจริง)
 *   3) สุดท้าย fallback เป็น localhost (iOS Simulator / รันบนเครื่องเดียวกัน)
 */
import Constants from 'expo-constants';

const BACKEND_PORT = 8080;

type ExpoRuntime = { hostUri?: string; extra?: { apiBaseUrl?: string } };
const cfg = Constants.expoConfig as ExpoRuntime | null;

/** Manual override wins — set in app.json "extra.apiBaseUrl" when needed. */
const explicitBaseUrl = cfg?.extra?.apiBaseUrl;

/**
 * Derive the dev machine's LAN host from Expo and point the API at it.
 *   hostUri example: "192.168.1.50:8081"  →  http://192.168.1.50:8080
 */
function deriveLanBaseUrl(): string {
  const hostUri =
    cfg?.hostUri ??
    (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${BACKEND_PORT}`;
  }
  return `http://localhost:${BACKEND_PORT}`;
}

export const API_BASE_URL: string = explicitBaseUrl ?? deriveLanBaseUrl();
