/**
 * LanguageContext — app-wide locale state + t() translation hook.
 *
 * Usage:
 *   // Wrap the root of the app (App.tsx):
 *   <LanguageProvider>
 *     <NavigationContainer>...</NavigationContainer>
 *   </LanguageProvider>
 *
 *   // Inside any component:
 *   const { t, locale, setLocale } = useT();
 *   t('login.title')                          // → 'เข้าสู่ระบบ' (th) or 'Sign in' (en)
 *   t('home.weekDisplay', { n: 12 })          // → 'สัปดาห์ที่ 12' (th) or 'Week 12' (en)
 *
 * Locale persistence:
 *   The selected locale is persisted via expo-secure-store (already in the project).
 *   On first launch, the default locale is 'th'.
 *   Persistence failures (native module unavailable, storage full) are silently
 *   ignored — the in-memory locale still works for the current session.
 *
 * Security: locale is not sensitive health data; it is stored without encryption
 * options (plain SecureStore.setItemAsync). No PII is stored here.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';

import { catalog, interpolate, type MessageKey } from './messages';
import type { Locale } from '../auth/types';

// ─── Storage key ──────────────────────────────────────────────────────────────

const LOCALE_STORE_KEY = 'mom_starter_locale';

async function loadPersistedLocale(): Promise<Locale | null> {
  try {
    const val = await SecureStore.getItemAsync(LOCALE_STORE_KEY);
    if (val === 'th' || val === 'en') return val as Locale;
    return null;
  } catch {
    // Native module unavailable (e.g. test environment) — fall back to default
    return null;
  }
}

async function persistLocale(locale: Locale): Promise<void> {
  try {
    await SecureStore.setItemAsync(LOCALE_STORE_KEY, locale);
  } catch {
    // Non-fatal — in-memory locale still works for the current session
  }
}

// ─── Context shape ────────────────────────────────────────────────────────────

export interface LanguageContextValue {
  /** Current app locale ('th' | 'en'). */
  locale: Locale;
  /** Switch locale and persist it. */
  setLocale: (locale: Locale) => void;
  /**
   * Translate a message key, with optional template interpolation.
   *
   * @param key    - A key from the catalog (e.g. 'login.title').
   * @param params - Optional {placeholder: value} pairs for template strings.
   * @returns The translated string in the current locale.
   *
   * @example
   *   t('home.weekDisplay', { n: 12 })  // 'สัปดาห์ที่ 12' or 'Week 12'
   */
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface LanguageProviderProps {
  children: React.ReactNode;
  /** Override the initial locale (useful in tests that render with a specific locale). */
  initialLocale?: Locale;
}

export function LanguageProvider({
  children,
  initialLocale,
}: LanguageProviderProps): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? 'th');

  // On mount, load the persisted locale from SecureStore.
  // If the user has previously selected English, restore it before the first render.
  useEffect(() => {
    if (initialLocale) return; // skip persistence load if overridden
    loadPersistedLocale()
      .then((persisted) => {
        if (persisted) setLocaleState(persisted);
      })
      .catch(() => {
        // Swallowed — default 'th' is already set
      });
  }, [initialLocale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void persistLocale(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>): string => {
      const str = catalog[locale][key];
      if (params) {
        return interpolate(str, params);
      }
      return str;
    },
    [locale],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Access the current locale, the setLocale switcher, and the t() translator.
 *
 * Must be used inside a <LanguageProvider> subtree.
 *
 * @throws Error if called outside of a LanguageProvider.
 */
export function useT(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useT() must be used inside <LanguageProvider>');
  }
  return ctx;
}
