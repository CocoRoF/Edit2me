import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n/context';

export const metadata: Metadata = {
  title: 'Edit2me — 자체 엔진 PDF 편집기',
  description:
    'PDF를 브라우저에서 편집/재배치/병합. 외부 PDF 라이브러리 없이 자체 엔진으로 동작.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
