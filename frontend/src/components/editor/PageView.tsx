'use client';

import { useEffect, useState } from 'react';
import type { PageMeta, TextBlock } from '@/lib/api';
import { getPageText } from '@/lib/api';

interface Props {
  docId: string;
  page: PageMeta;
  zoom: number;
  // 콜백: 텍스트 블록 편집 완료
  onEditText?: (blockId: string, newText: string) => void;
  // 페이지 빈 곳 클릭 (텍스트 추가용)
  onCanvasClick?: (pageIndex: number, x: number, y: number) => void;
  addTextMode?: boolean;
  reload?: number;
}

const FONT_MAP: Record<string, string> = {
  Helvetica: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
  'Helvetica-Bold': 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
  'Helvetica-Oblique': 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
  'Times-Roman': '"Times New Roman", Times, serif',
  'Times-Bold': '"Times New Roman", Times, serif',
  'Times-Italic': '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
  'Courier-Bold': '"Courier New", Courier, monospace',
};

export function PageView({
  docId,
  page,
  zoom,
  onEditText,
  onCanvasClick,
  addTextMode,
  reload,
}: Props) {
  const [blocks, setBlocks] = useState<TextBlock[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPageText(docId, page.index)
      .then((res) => {
        if (!cancelled) setBlocks(res.blocks);
      })
      .catch(() => {
        if (!cancelled) setBlocks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [docId, page.index, reload]);

  const w = page.width * zoom;
  const h = page.height * zoom;
  const rotate = page.rotate ?? 0;

  return (
    <div
      className="paper relative my-4"
      style={{
        width: w,
        height: h,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        cursor: addTextMode ? 'crosshair' : 'default',
      }}
      onDoubleClick={(e) => {
        if (!addTextMode || !onCanvasClick) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const x = cx / zoom;
        const y = page.height - cy / zoom; // CSS top-down → PDF bottom-up
        onCanvasClick(page.index, x, y);
      }}
    >
      {blocks?.map((b) => {
        const fontFamily =
          FONT_MAP[b.fontBaseName] ??
          (b.isCJK ? 'sans-serif' : 'system-ui, sans-serif');
        const fontWeight = b.fontBaseName.includes('Bold') ? 600 : 400;
        const fontStyle = b.fontBaseName.includes('Italic') || b.fontBaseName.includes('Oblique') ? 'italic' : 'normal';
        const left = b.x * zoom;
        // PDF 좌표(좌하 원점) → CSS top-down
        const top = (page.height - b.y - b.height) * zoom;
        const fontSize = b.fontSize * zoom;
        const isEditing = editingId === b.blockId;
        return (
          <span
            key={b.blockId}
            className={`text-block ${isEditing ? 'editing' : ''}`}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              fontFamily,
              fontSize: `${fontSize}px`,
              fontWeight,
              fontStyle,
              minWidth: `${b.width * zoom}px`,
              lineHeight: 1,
            }}
            contentEditable={b.editable && isEditing}
            suppressContentEditableWarning
            onDoubleClick={(e) => {
              if (!b.editable) return;
              e.stopPropagation();
              setEditingId(b.blockId);
              setTimeout(() => {
                const el = e.currentTarget as HTMLElement;
                if (document.activeElement !== el) el.focus();
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }, 0);
            }}
            onBlur={(e) => {
              if (!isEditing) return;
              const newText = (e.currentTarget as HTMLElement).innerText;
              setEditingId(null);
              if (newText !== b.text && onEditText) onEditText(b.blockId, newText);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                (e.currentTarget as HTMLElement).innerText = b.text;
                setEditingId(null);
                (e.currentTarget as HTMLElement).blur();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                (e.currentTarget as HTMLElement).blur();
              }
            }}
            title={
              !b.editable
                ? b.isCJK
                  ? 'CJK/composite 폰트 — v1에서 편집 불가'
                  : '디코드 불가 텍스트 — 편집 비활성화'
                : '더블클릭하여 편집'
            }
          >
            {b.text}
          </span>
        );
      })}
      {!blocks && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--color-muted)]">
          텍스트 로드 중...
        </div>
      )}
    </div>
  );
}
