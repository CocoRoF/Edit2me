'use client';

import { X, AlertTriangle, FileText } from 'lucide-react';
import type { PageText } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  pageTexts: Map<number, PageText>;
}

export function DiagnosticPanel({ open, onClose, pageTexts }: Props) {
  if (!open) return null;

  // 페이지별 폰트 warning 모으기
  const entries: Array<{ pageIndex: number; font: string; warnings: string[] }> = [];
  for (const [idx, pt] of pageTexts) {
    for (const fw of pt.fontWarnings) {
      entries.push({ pageIndex: idx, font: fw.font, warnings: fw.warnings });
    }
  }
  entries.sort((a, b) => a.pageIndex - b.pageIndex);

  // 폰트별 그룹화 — 같은 폰트가 여러 페이지에 있는 경우 압축
  const grouped = new Map<string, { font: string; warnings: string[]; pages: number[] }>();
  for (const e of entries) {
    const key = `${e.font}::${e.warnings.join('||')}`;
    const existing = grouped.get(key);
    if (existing) existing.pages.push(e.pageIndex);
    else grouped.set(key, { font: e.font, warnings: e.warnings, pages: [e.pageIndex] });
  }

  return (
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.25)' }}
        onClick={onClose}
      />
      {/* panel */}
      <aside
        className="fixed top-0 right-0 bottom-0 z-50 w-96 max-w-[calc(100vw-2rem)] flex flex-col shadow-2xl"
        style={{
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-line)',
        }}
      >
        <header
          className="h-12 px-4 flex items-center justify-between border-b shrink-0"
          style={{ borderColor: 'var(--color-line)' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[color:var(--color-warn)]" />
            <h2 className="text-sm font-medium">진단</h2>
            <span className="text-xs text-[color:var(--color-muted)]">
              {grouped.size}건
            </span>
          </div>
          <button
            className="text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-4">
          {grouped.size === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">
              감지된 진단이 없습니다. 모든 폰트가 정상적으로 디코드됐어요.
            </p>
          )}
          {[...grouped.values()].map((g, i) => (
            <div
              key={i}
              className="rounded p-3 border"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} className="text-[color:var(--color-muted)]" />
                <span className="text-sm font-medium">{g.font}</span>
              </div>
              <ul className="text-xs text-[color:var(--color-muted)] space-y-1 mb-2">
                {g.warnings.map((w, j) => (
                  <li key={j} className="leading-relaxed">
                    · {w}
                  </li>
                ))}
              </ul>
              <div className="text-[11px] text-[color:var(--color-muted-2)]">
                {g.pages.length === 1
                  ? `페이지 ${g.pages[0]! + 1}`
                  : `페이지 ${humanRanges(g.pages)} (${g.pages.length}개)`}
              </div>
            </div>
          ))}
        </div>
        <footer
          className="px-4 py-3 text-[11px] text-[color:var(--color-muted)] border-t"
          style={{ borderColor: 'var(--color-line)' }}
        >
          ToUnicode CMap 부재 시 <code className="kbd">npm run build:cmaps</code> 실행 권장.
          <br />
          자세한 정책은 <a className="underline" href="https://github.com/CocoRoF/Edit2me/blob/main/docs/13-quality-review.md" target="_blank" rel="noreferrer">audit 문서</a>.
        </footer>
      </aside>
    </>
  );
}

function humanRanges(pages: number[]): string {
  // 정렬 후 연속 구간 압축: 1,2,3,7,8 → "1–3, 7–8"
  const sorted = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i]!;
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      end = sorted[++i]!;
    }
    out.push(start === end ? `${start + 1}` : `${start + 1}–${end + 1}`);
    i++;
  }
  return out.join(', ');
}
