import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Edit2me — PDF online editor',
  description:
    'Edit, reorder, merge PDFs in your browser. Powered by a self-built engine — no external PDF libraries.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
