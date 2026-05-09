'use client';

import { Languages } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  const next = locale === 'ko' ? 'en' : 'ko';
  return (
    <button
      onClick={() => setLocale(next)}
      className="btn btn-ghost btn-icon"
      title={locale === 'ko' ? 'Switch to English' : '한국어로 전환'}
      aria-label="Toggle language"
    >
      <Languages size={16} />
      <span className="text-[11px] font-medium uppercase">{locale}</span>
    </button>
  );
}
