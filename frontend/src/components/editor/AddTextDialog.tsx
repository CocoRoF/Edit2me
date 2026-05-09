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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <h2 className="font-medium mb-3">텍스트 추가</h2>
        <p className="text-xs text-[color:var(--color-muted)] mb-3">
          페이지 {pageIndex + 1} · ({x.toFixed(0)}, {y.toFixed(0)})
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="텍스트를 입력하세요. 한글은 코어 폰트에서 표시되지 않을 수 있습니다."
          className="w-full h-24 border rounded p-2 text-sm font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="flex items-center gap-2 mt-3 text-sm">
          <select
            value={font}
            onChange={(e) => setFont(e.target.value as (typeof FONTS)[number])}
            className="border rounded px-2 py-1"
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
            className="border rounded px-2 py-1"
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
            className="w-8 h-7 border rounded cursor-pointer"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={!text.trim()}
            className="px-3 py-1.5 text-sm rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50 hover:opacity-90"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );

  function submit() {
    if (!text.trim()) return;
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    onConfirm({ pageIndex, x, y, text, font, fontSize, color: { r, g, b } });
  }
}
