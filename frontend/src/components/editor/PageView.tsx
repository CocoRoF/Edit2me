'use client';

import { useState, useEffect } from 'react';
import type { PageMeta, PageText, TextBlock } from '@/lib/api';
import { svgUrl } from '@/lib/api';
import { useIntersection } from '@/hooks/useIntersection';

interface Props {
  docId: string;
  page: PageMeta;
  pageText: PageText | null;
  zoom: number;
  revision: number;
  onEditText?: (blockId: string, newText: string) => void;
  onCanvasClick?: (pageIndex: number, x: number, y: number) => void;
  addTextMode?: boolean;
  active?: boolean;
}

export function PageView({
  docId,
  page,
  pageText,
  zoom,
  revision,
  onEditText,
  onCanvasClick,
  addTextMode,
  active,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ref, inView] = useIntersection<HTMLDivElement>('1000px');
  const [svgLoaded, setSvgLoaded] = useState(false);

  const w = page.width * zoom;
  const h = page.height * zoom;
  const rotate = page.rotate ?? 0;

  // SVG src — inView 일 때만 fetch (lazy via <object> data 자체가 lazy하지 않으므로 attribute swap)
  const src = inView ? svgUrl(docId, page.index, revision) : '';

  // 회전된 페이지 visual bbox: 90/270 도면 W,H 가 swap
  // 그러나 SVG element 자체는 page native dims; CSS transform 으로 회전.
  return (
    <div
      ref={ref}
      // shrink-0: 부모가 flex-col 이라 default flex-shrink:1 이면 모든 페이지 합산 높이가
      // 부모보다 클 때 균등 축소되어 zoom 을 키워도 height 가 거의 안 자라는 증상이 생김
      // (예: z=2.5 에서 4 페이지 × 2105px = 8420px > 부모 ≈ 1100px → 각 ~275px 로 짜부됨).
      // overflow-auto 가 부모에 있어도 shrink 가 먼저 적용됨. 명시적으로 0 으로 막는다.
      className="relative paper shrink-0"
      style={{
        width: w,
        height: h,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        cursor: addTextMode ? 'crosshair' : 'default',
      }}
      onDoubleClick={(e) => {
        if (!addTextMode || !onCanvasClick) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const cx = (e.clientX - rect.left) / zoom;
        const cy = (e.clientY - rect.top) / zoom;
        const W = page.width;
        const H = page.height;
        let x: number;
        let y: number;
        switch (rotate) {
          case 90:
            x = cy; y = cx; break;
          case 180:
            x = W - cx; y = cy; break;
          case 270:
            x = W - cy; y = H - cx; break;
          default:
            x = cx; y = H - cy;
        }
        onCanvasClick(page.index, x, y);
      }}
    >
      {/* Layer 1: SVG vector render (도형/이미지/텍스트) */}
      {inView && (
        <img
          src={src}
          alt={`page ${page.index + 1}`}
          width={w}
          height={h}
          draggable={false}
          onLoad={() => setSvgLoaded(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            pointerEvents: 'none',
            userSelect: 'none',
            opacity: svgLoaded ? 1 : 0,
            transition: 'opacity 120ms ease',
          }}
        />
      )}
      {/* Layer 2: invisible text overlay for inline editing */}
      {pageText &&
        active &&
        pageText.blocks.map((b) => (
          <TextBlockEditor
            key={b.blockId}
            block={b}
            pageHeight={page.height}
            zoom={zoom}
            isEditing={editingId === b.blockId}
            canEdit={!!onEditText && b.editable}
            onBeginEdit={() => setEditingId(b.blockId)}
            onCommit={(newText) => {
              setEditingId(null);
              if (newText !== b.text && onEditText) onEditText(b.blockId, newText);
            }}
            onCancel={() => setEditingId(null)}
          />
        ))}
      {/* SVG 로딩 전 회색 깜빡임 방지 */}
      {!svgLoaded && inView && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--color-muted-2)]"
          style={{ pointerEvents: 'none' }}
        >
          렌더 중…
        </div>
      )}
    </div>
  );
}

function TextBlockEditor({
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
  const left = b.x * zoom;
  const top = (pageHeight - b.y - b.height) * zoom;
  const width = Math.max(0, b.width * zoom);
  const height = Math.max(8, b.height * zoom);
  const cls = `text-block ${canEdit ? 'editable' : 'readonly'} ${isEditing ? 'editing' : ''}`;
  const title = !b.editable
    ? b.isComposite
      ? '복합 폰트 (CID-keyed) — v1에서 편집 불가'
      : '디코드 불가 텍스트 — 편집 비활성화'
    : '더블클릭하여 편집';
  // Editing 중에만 텍스트 표시. 평소엔 클릭/hover 영역만 (SVG 가 visual 담당).
  return (
    <span
      className={cls}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        // 평소엔 transparent text — SVG 의 글자 위에 겹치지 않게
        color: isEditing ? 'inherit' : 'transparent',
        background: isEditing ? undefined : undefined,
        fontSize: `${height}px`,
        lineHeight: 1,
        whiteSpace: 'pre',
        overflow: 'hidden',
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
