'use client';

import { useState, useEffect, useRef } from 'react';
import type { PageMeta, PageText, TextBlock } from '@/lib/api';
import { svgUrl } from '@/lib/api';
import { useIntersection } from '@/hooks/useIntersection';
import { RotateCcw, RotateCw, Trash2, FilePlus } from 'lucide-react';

interface Props {
  docId: string;
  page: PageMeta;
  pageText: PageText | null;
  zoom: number;
  revision: number;
  /** 1-based 표시용 페이지 번호 (배열 위치) */
  displayIndex: number;
  /** 총 페이지 수 — 라벨에 "n / m" 표기 */
  totalPages: number;
  onEditText?: (blockId: string, newText: string) => void;
  onCanvasClick?: (pageIndex: number, x: number, y: number) => void;
  addTextMode?: boolean;
  active?: boolean;
  /** 다중 선택 상태에 포함되면 라벨 옆 actions 노출 */
  selected?: boolean;
  /** 페이지 회전 (active or selected 일 때 캔버스 라벨에서 호출) */
  onRotate?: (angle: 90 | -90) => void;
  /** 페이지 삭제 */
  onDelete?: () => void;
  /** 페이지 paper 자체 클릭 시 activate 시그널 — 사이드바 selection 동기화용 */
  onActivate?: () => void;
  /** 이 페이지 *위에* PDF file 을 삽입. 호출 시 새로 삽입된 첫 페이지 index 를 반환하면
      (또는 promise resolve 시) 부모가 scroll 등 후처리를 수행. */
  onInsertPdf?: (file: File) => void;
}

export function PageView({
  docId,
  page,
  pageText,
  zoom,
  revision,
  displayIndex,
  totalPages,
  onEditText,
  onCanvasClick,
  addTextMode,
  active,
  selected,
  onRotate,
  onDelete,
  onActivate,
  onInsertPdf,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ref, inView] = useIntersection<HTMLDivElement>('1000px');
  const [svgLoaded, setSvgLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      // 외곽 wrapper: 페이지 라벨 + paper. shrink-0 (zoom 시 height 짜부 방지).
      // data-page-index: parent 가 op 후 이 페이지로 scrollIntoView 할 때 lookup.
      data-page-index={displayIndex - 1}
      className="flex flex-col items-center gap-2 shrink-0"
      style={{ width: w }}
    >
      {/* 페이지 구분 라벨 — accent dot + "페이지 N / 총 M". active 페이지면 강조.
          selected 또는 active 일 때 라벨 옆에 회전/삭제 액션 노출. */}
      <div
        className="flex items-center gap-2 text-xs select-none"
        style={{ color: active ? 'var(--color-accent)' : 'var(--color-muted)' }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            background: active ? 'var(--color-accent)' : 'var(--color-line-strong)',
          }}
        />
        <span style={{ fontWeight: active ? 600 : 500 }}>
          페이지 {displayIndex} <span className="opacity-60">/ {totalPages}</span>
        </span>
        <span className="w-12 h-px" style={{ background: 'var(--color-line)' }} />
        {(active || selected) && (onRotate || onDelete || onInsertPdf) && (
          <div
            className="inline-flex items-center gap-0.5 ml-1 rounded-md border px-0.5"
            style={{
              borderColor: 'var(--color-line)',
              background: 'var(--color-surface)',
            }}
          >
            {onRotate && (
              <PageActionBtn title="역회전 (반시계 90°)" onClick={() => onRotate(-90)}>
                <RotateCcw size={14} />
              </PageActionBtn>
            )}
            {onRotate && (
              <PageActionBtn title="회전 (시계 90°)" onClick={() => onRotate(90)}>
                <RotateCw size={14} />
              </PageActionBtn>
            )}
            {onInsertPdf && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onInsertPdf(f);
                    if (e.target) e.target.value = ''; // 같은 파일 재선택 가능
                  }}
                />
                <PageActionBtn
                  title="이 페이지 위에 PDF 추가"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FilePlus size={14} />
                </PageActionBtn>
              </>
            )}
            {onDelete && (
              <PageActionBtn title="페이지 삭제" onClick={onDelete} danger>
                <Trash2 size={14} />
              </PageActionBtn>
            )}
          </div>
        )}
      </div>
    <div
      className="relative paper"
      style={{
        width: w,
        height: h,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        cursor: addTextMode ? 'crosshair' : 'default',
        // active 페이지는 accent ring 으로 시각적으로 더 명확.
        outline: active ? '2px solid var(--color-accent)' : '1px solid var(--color-line)',
        outlineOffset: '2px',
      }}
      onClick={(e) => {
        // text block editor 내부 클릭은 통과 (편집 모드 유지). paper 자체 클릭만 activate.
        const target = e.target as HTMLElement;
        if (target.closest('.text-block')) return;
        onActivate?.();
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

// 캔버스 페이지 라벨 옆에 노출되는 작은 ghost icon button — segmented group 안의 cell.
function PageActionBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="w-7 h-7 inline-flex items-center justify-center rounded transition-colors"
      style={{
        color: danger ? 'var(--color-danger)' : 'var(--color-muted)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? 'var(--color-danger-soft)'
          : 'var(--color-surface-2)';
        (e.currentTarget as HTMLButtonElement).style.color = danger
          ? 'var(--color-danger)'
          : 'var(--color-ink)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = danger
          ? 'var(--color-danger)'
          : 'var(--color-muted)';
      }}
    >
      {children}
    </button>
  );
}
