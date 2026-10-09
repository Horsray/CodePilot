'use client';

import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { type Locale, type TranslationKey, translate } from '@/i18n';

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({
  children,
  initialLocale = 'en',
}: {
  children: ReactNode;
  /**
   * Locale resolved by RootLayout on the server (DB setting, or Accept-Language
   * on first run). Seeding state with it keeps the SSR first paint in the right
   * language — otherwise every cold start flashes English until the settings
   * fetch resolves.
   */
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // The first paint already carries the right language via initialLocale; on
  // mount we only reconcile edge cases:
  // 1) A persisted setting the server didn't see (keeps other clients' edits in sync).
  // 2) First run with no persisted locale — detect from navigator and persist it.
  useEffect(() => {
    let cancelled = false;

    async function syncLocale() {
      try {
        const res = await fetch('/api/settings/app');
        if (res.ok) {
          const data = await res.json();
          const saved = data.settings?.locale;
          if (saved === 'en' || saved === 'zh') {
            if (!cancelled) setLocaleState(saved);
            return;
          }
        }
      } catch { /* ignore */ }

      // No persisted locale — detect system language
      // Works across: Electron (Chromium OS locale), browser, SSR (skipped)
      if (typeof navigator !== 'undefined') {
        const candidates = [
          ...(navigator.languages || []),  // user's preferred language list
          navigator.language,               // primary browser/OS language
        ].filter(Boolean);
        const isZh = candidates.some(lang => lang.startsWith('zh'));
        if (!cancelled) setLocaleState(isZh ? 'zh' : 'en');
        if (isZh) {
          fetch('/api/settings/app', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { locale: 'zh' } }),
          }).catch(() => {});
        }
      }
    }

    syncLocale();
    return () => { cancelled = true; };
  }, []);

  // Keep <html lang> aligned with the active locale (the server sets it for the
  // first paint; later switches flow through here).
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    }
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    // Persist to app settings
    fetch('/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { locale: newLocale } }),
    }).catch(() => {});
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}
