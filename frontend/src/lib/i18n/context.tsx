'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Locale, SUPPORTED_LOCALES, translate } from './dict';

interface I18nApi {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nCtx = createContext<I18nApi | null>(null);

export function useI18n(): I18nApi {
  const ctx = useContext(I18nCtx);
  if (!ctx) {
    // 비-Provider 사용 시 안전 fallback (SSR 또는 단독 컴포넌트 테스트)
    return {
      locale: 'ko',
      setLocale: () => {},
      t: (key: string) => translate('ko', key),
    };
  }
  return ctx;
}

const STORAGE_KEY = 'edit2me.locale';

function detectInitial(): Locale {
  if (typeof navigator === 'undefined') return 'ko';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
      return saved as Locale;
    }
  } catch {
    /* ignore */
  }
  const lang = (navigator.language || 'ko').toLowerCase();
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ko');

  // 클라이언트에서 초기값 결정 (SSR 일관성을 위해 hydration 후 적용)
  useEffect(() => {
    setLocaleState(detectInitial());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  return <I18nCtx.Provider value={{ locale, setLocale, t }}>{children}</I18nCtx.Provider>;
}
