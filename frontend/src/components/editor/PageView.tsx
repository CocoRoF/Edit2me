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
  /** group 편집 시 모든 underlying segment id 들을 받음. */
  onEditText?: (blockIds: string[], newText: string) => void;
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
      // wrapper 어디 클릭이든 (라벨/paper/배경) activate. 단 액션 버튼들은 자체에서
      // stopPropagation 하므로 안 영향. text-block 더블클릭 시에도 activate 가 자연스럽게
      // 발사됨 (text-block 의 onMouseDown 도 stopPropagation 안 하므로 bubble 됨).
      onClick={() => onActivate?.()}
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
              <DeleteConfirmBtn onConfirm={onDelete} />
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
      // onClick 은 wrapper 에 위임 — bubble 로 wrapper 가 받아 activate.
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
      {/* Layer 2: invisible text overlay for inline editing.
          모든 페이지에 항상 렌더 — 비active 페이지의 텍스트도 더블클릭 한 번에
          편집을 시작할 수 있게. canEdit 은 폰트가 인코딩 가능 (b.editable) 인지로만
          판정하고, 비active 페이지면 onBeginEdit 가 먼저 onActivate 호출 후 편집 시작. */}
      {pageText &&
        pageText.blocks.map((b) => (
          <TextBlockEditor
            key={b.blockId}
            block={b}
            pageHeight={page.height}
            zoom={zoom}
            isEditing={editingId === b.blockId}
            canEdit={b.editable && !!onEditText}
            onBeginEdit={() => {
              if (!active) onActivate?.();
              setEditingId(b.blockId);
            }}
            onCommit={(newText) => {
              setEditingId(null);
              if (newText !== b.text && onEditText) onEditText(b.blockIds, newText);
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
    ? '이 텍스트는 편집할 수 없습니다 (폰트 인코딩 미지원 또는 디코드 실패)'
    : '더블클릭하여 편집';
  return (
    <>
      <span
        className={cls}
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
          color: isEditing ? 'inherit' : 'transparent',
          fontSize: `${height}px`,
          lineHeight: 1,
          whiteSpace: 'pre',
          overflow: 'hidden',
          // 편집 중에는 hover 변색 안 되게 (이미 outline 으로 강조됨)
          ...(isEditing
            ? {
                background: 'rgba(255, 255, 255, 0.95)',
                color: 'var(--color-ink)',
                zIndex: 20,
              }
            : {}),
        }}
        contentEditable={canEdit && isEditing}
        suppressContentEditableWarning
        onClick={(e) => {
          // 편집 모드 중 단일 클릭은 텍스트 안 caret 이동만 — 페이지 activate (parent
          // wrapper) 이벤트 차단.
          if (isEditing) e.stopPropagation();
        }}
        onMouseDown={(e) => {
          if (isEditing) e.stopPropagation();
        }}
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
          // 빈 문자열이거나 원본과 동일 → cancel (실수 방지). 모두 commit 안 함.
          if (newText.trim() === '' || newText === b.text) {
            onCancel();
            (e.currentTarget as HTMLElement).innerText = b.text;
            return;
          }
          onCommit(newText);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).innerText = b.text;
            onCancel();
            (e.currentTarget as HTMLElement).blur();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
        }}
        title={title}
      >
        {b.text}
      </span>
      {/* 편집 중일 때 노출되는 toolbar — 위쪽에 띄움. 키보드 외에 마우스로도 저장/취소 가능.
          mousedown 으로 onBlur 트리거되지 않도록 preventDefault. */}
      {isEditing && (
        <div
          className="absolute z-30 inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] shadow-pop"
          style={{
            left: `${left}px`,
            top: `${Math.max(0, top - 32)}px`,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-line)',
            whiteSpace: 'nowrap',
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => {
            // 마우스 down 으로 contentEditable 가 blur 되는 걸 방지.
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[color:var(--color-muted)]">편집 중</span>
          <span className="text-[color:var(--color-line-strong)]">·</span>
          <button
            className="px-1.5 py-0.5 rounded text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-soft)] font-medium"
            onClick={(e) => {
              e.stopPropagation();
              const span = (e.currentTarget.parentElement?.previousElementSibling) as HTMLElement | null;
              if (span) {
                const newText = span.innerText;
                if (newText.trim() === '' || newText === b.text) onCancel();
                else onCommit(newText);
              }
            }}
          >
            저장 (Enter)
          </button>
          <span className="text-[color:var(--color-line-strong)]">·</span>
          <button
            className="px-1.5 py-0.5 rounded text-[color:var(--color-muted)] hover:bg-[color:var(--color-surface-2)]"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            취소 (Esc)
          </button>
        </div>
      )}
    </>
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

// 2-step confirm 삭제 — 첫 클릭은 "확인하시겠어요?" 상태 (빨간 배경 + 메시지), 3 초 안에
// 두 번째 클릭하면 실제 삭제. 그 사이에 다른 곳 클릭하거나 timeout 되면 reset.
function DeleteConfirmBtn({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed) {
    return (
      <PageActionBtn title="페이지 삭제" onClick={() => setArmed(true)} danger>
        <Trash2 size={14} />
      </PageActionBtn>
    );
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onConfirm();
      }}
      title="다시 클릭하여 정말 삭제 (3 초 후 취소)"
      className="h-7 px-2 inline-flex items-center gap-1 rounded text-[11px] font-semibold transition-colors"
      style={{
        background: 'var(--color-danger)',
        color: '#fff',
      }}
    >
      <Trash2 size={12} /> 정말 삭제?
    </button>
  );
}
