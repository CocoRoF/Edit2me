'use client';

import { useState } from 'react';

const FONTS = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Courier',
  'Courier-Bold',
] as const;

interface Props {
  pageIndex: number;
  x: number;
  y: number;
  onCancel: () => void;
  onConfirm: (params: {
    pageIndex: number;
    x: number;
    y: number;
    text: string;
    font: (typeof FONTS)[number];
    fontSize: number;
    color: { r: number; g: number; b: number };
  }) => void;
}

export function AddTextDialog({ pageIndex, x, y, onCancel, onConfirm }: Props) {
  const [text, setText] = useState('');
  const [font, setFont] = useState<(typeof FONTS)[number]>('Helvetica');
  const [fontSize, setFontSize] = useState(12);
  const [color, setColor] = useState('#000000');

  function submit() {
    if (!text.trim()) return;
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    onConfirm({ pageIndex, x, y, text, font, fontSize, color: { r, g, b } });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg p-5 w-[420px] max-w-[calc(100vw-2rem)]"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-line)',
          boxShadow: 'var(--shadow-pop)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-medium mb-1">텍스트 추가</h2>
        <p className="text-xs text-[color:var(--color-muted)] mb-3">
          페이지 {pageIndex + 1} · ({x.toFixed(0)}, {y.toFixed(0)})
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="텍스트를 입력하세요. (코어 14 폰트는 한글 표시 불가 — 한글은 v0.2 사용자 TTF 업로드로)"
          className="w-full h-24 rounded p-2.5 text-sm font-mono resize-y"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-line)',
            color: 'var(--color-ink)',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="flex items-center gap-2 mt-3 text-sm flex-wrap">
          <select
            value={font}
            onChange={(e) => setFont(e.target.value as (typeof FONTS)[number])}
            className="rounded px-2 py-1.5"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              color: 'var(--color-ink)',
            }}
          >
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="rounded px-2 py-1.5"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              color: 'var(--color-ink)',
            }}
          >
            {[8, 10, 12, 14, 16, 20, 24, 36, 48].map((s) => (
              <option key={s} value={s}>
                {s}pt
              </option>
            ))}
          </select>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-9 rounded cursor-pointer"
            style={{ border: '1px solid var(--color-line)' }}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="btn">
            취소
          </button>
          <button onClick={submit} disabled={!text.trim()} className="btn btn-primary">
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
