'use client';

import { useEffect, useState } from 'react';
import type { PageMeta, PageText, TextBlock } from '@/lib/api';
import { PageSkeleton } from '@/components/ui/Skeleton';

interface Props {
  page: PageMeta;
  pageText: PageText | null; // null = 아직 로딩 중
  zoom: number;
  onEditText?: (blockId: string, newText: string) => void;
  onCanvasClick?: (pageIndex: number, x: number, y: number) => void;
  addTextMode?: boolean;
  active?: boolean;
}

const FONT_MAP: Record<string, string> = {
  Helvetica: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
  'Helvetica-Bold': 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
  'Helvetica-Oblique': 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
  'Helvetica-BoldOblique': 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
  'Times-Roman': '"Times New Roman", Times, serif',
  'Times-Bold': '"Times New Roman", Times, serif',
  'Times-Italic': '"Times New Roman", Times, serif',
  'Times-BoldItalic': '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
  'Courier-Bold': '"Courier New", Courier, monospace',
  'Courier-Oblique': '"Courier New", Courier, monospace',
  'Courier-BoldOblique': '"Courier New", Courier, monospace',
};

function fontFamilyFor(baseName: string, isComposite: boolean): string {
  if (FONT_MAP[baseName]) return FONT_MAP[baseName]!;
  if (isComposite) {
    // CJK 폰트 — OS 한국어/일본어 폰트로 fallback
    return '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Hiragino Sans", "Yu Gothic", sans-serif';
  }
  return 'system-ui, sans-serif';
}

export function PageView({
  page,
  pageText,
  zoom,
  onEditText,
  onCanvasClick,
  addTextMode,
  active,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const w = page.width * zoom;
  const h = page.height * zoom;
  const rotate = page.rotate ?? 0;

  // 로딩 중: skeleton
  if (!pageText) {
    return <PageSkeleton width={w} height={h} />;
  }

  return (
    <div
      className="paper relative"
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
        const y = page.height - cy / zoom;
        onCanvasClick(page.index, x, y);
      }}
    >
      {pageText.blocks.map((b) => (
        <TextBlockView
          key={b.blockId}
          block={b}
          pageHeight={page.height}
          zoom={zoom}
          isEditing={editingId === b.blockId && !!active}
          canEdit={!!onEditText && b.editable && !!active}
          onBeginEdit={() => setEditingId(b.blockId)}
          onCommit={(newText) => {
            setEditingId(null);
            if (newText !== b.text && onEditText) onEditText(b.blockId, newText);
          }}
          onCancel={() => setEditingId(null)}
        />
      ))}
    </div>
  );
}

function TextBlockView({
  block: b,
  pageHeight,
  zoom,
  isEditing,
  canEdit,
  onBeginEdit,
  onCommit,
  onCancel,
}: {
  block: TextBlock;
  pageHeight: number;
  zoom: number;
  isEditing: boolean;
  canEdit: boolean;
  onBeginEdit: () => void;
  onCommit: (newText: string) => void;
  onCancel: () => void;
}) {
  const fontFamily = fontFamilyFor(b.fontBaseName, b.isComposite);
  const fontWeight = b.fontBaseName.toLowerCase().includes('bold') ? 600 : 400;
  const fontStyle =
    b.fontBaseName.toLowerCase().includes('italic') ||
    b.fontBaseName.toLowerCase().includes('oblique')
      ? 'italic'
      : 'normal';
  const left = b.x * zoom;
  const top = (pageHeight - b.y - b.height) * zoom;
  const fontSize = b.fontSize * zoom;
  const cls = `text-block ${canEdit ? 'editable' : 'readonly'} ${isEditing ? 'editing' : ''}`;
  const title = !b.editable
    ? b.isComposite
      ? '복합 폰트 (CID-keyed) — v1에서 편집 불가'
      : '디코드 불가 텍스트 — 편집 비활성화'
    : '더블클릭하여 편집';

  return (
    <span
      className={cls}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        fontFamily,
        fontSize: `${fontSize}px`,
        fontWeight,
        fontStyle,
        minWidth: `${Math.max(0, b.width * zoom)}px`,
      }}
      contentEditable={canEdit && isEditing}
      suppressContentEditableWarning
      onDoubleClick={(e) => {
        if (!canEdit) return;
        e.stopPropagation();
        onBeginEdit();
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
        onCommit(newText);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).innerText = b.text;
          onCancel();
          (e.currentTarget as HTMLElement).blur();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
      title={title}
    >
      {b.text}
    </span>
  );
}
