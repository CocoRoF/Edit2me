'use client';

import { X } from 'lucide-react';
import { Kbd } from '@/components/ui/Kbd';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: Array<{
  title: string;
  items: Array<{ keys: string[]; label: string }>;
}> = [
  {
    title: '편집',
    items: [
      { keys: ['T'], label: '텍스트 추가 모드 토글' },
      { keys: ['더블클릭'], label: '텍스트 블록 인라인 편집' },
      { keys: ['Enter'], label: '편집 commit' },
      { keys: ['Esc'], label: '편집 취소 / 모드 해제' },
    ],
  },
  {
    title: '실행 취소 / 다시',
    items: [
      { keys: ['⌘', 'Z'], label: '실행 취소' },
      { keys: ['⌘', '⇧', 'Z'], label: '다시 실행' },
      { keys: ['⌘', 'Y'], label: '다시 실행 (Windows 스타일)' },
    ],
  },
  {
    title: '페이지',
    items: [
      { keys: ['Click'], label: '페이지 활성화' },
      { keys: ['Shift', 'Click'], label: '범위 선택' },
      { keys: ['⌘', 'Click'], label: '다중 선택' },
      { keys: ['Drag'], label: '페이지 순서 변경' },
      { keys: ['Delete'], label: '선택 페이지 삭제' },
      { keys: ['j', '↓'], label: '다음 페이지' },
      { keys: ['k', '↑'], label: '이전 페이지' },
    ],
  },
  {
    title: '뷰 / 저장',
    items: [
      { keys: ['⌘', '0'], label: '줌 100%' },
      { keys: ['⌘', 'S'], label: '다운로드' },
      { keys: ['?'], label: '이 도움말' },
    ],
  },
];

export function HelpDialog({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg w-[560px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto thin-scroll"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-line)',
          boxShadow: 'var(--shadow-pop)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="h-12 px-5 flex items-center justify-between border-b sticky top-0"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-line)' }}
        >
          <h2 className="text-sm font-medium">키보드 단축키</h2>
          <button
            className="text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3 className="text-xs uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
                {s.title}
              </h3>
              <ul className="space-y-1.5">
                {s.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[color:var(--color-ink)]">{it.label}</span>
                    <span className="flex gap-1">
                      {it.keys.map((k, j) => (
                        <Kbd key={j}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer
          className="px-5 py-3 text-[11px] text-[color:var(--color-muted)] border-t"
          style={{ borderColor: 'var(--color-line)' }}
        >
          Mac 의 ⌘ 는 Windows 에서 Ctrl 로 동일하게 동작합니다.
        </footer>
      </div>
    </div>
  );
}
