'use client';

import { useState, useEffect, useRef } from 'react';
import type { PageMeta, PageText, TextBlock } from '@/lib/api';
import { svgUrl } from '@/lib/api';
import { useIntersection } from '@/hooks/useIntersection';
import { usePageFonts } from '@/hooks/usePageFonts';
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
  // 1 click → 선택 (highlight), 2 click → 편집 진입.
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [ref, inView] = useIntersection<HTMLDivElement>('1000px');
  const [svgLoaded, setSvgLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // PDF 내장 폰트들을 @font-face 로 등록 — 편집 박스가 PDF 와 동일한 폰트로 그려짐.
  // page 가 inView 일 때만 fetch (큰 폰트 byte 절약).
  const { fonts: pdfFonts } = usePageFonts(docId, page.index, revision, inView);

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
      // wrapper 어디 클릭이든 (라벨/paper/배경) activate + 선택된 text-block 이 있으면 해제.
      // 액션 버튼/편집 중 text-block 은 자체에서 stopPropagation 하므로 안 영향.
      onClick={() => {
        onActivate?.();
        setSelectedBlockId(null);
      }}
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
        pageText.blocks.map((b) => {
          // baseBaseName 으로 매칭되는 PDF 폰트 family. 없으면 system fallback.
          const matchedFont = pdfFonts.find(
            (pf) => pf.font.baseName === b.fontBaseName,
          );
          return (
          <TextBlockEditor
            key={b.blockId}
            block={b}
            pageHeight={page.height}
            pageWidth={page.width}
            zoom={zoom}
            isEditing={editingId === b.blockId}
            isSelected={selectedBlockId === b.blockId}
            canEdit={b.editable && !!onEditText}
            availableChars={pageText.availableChars}
            pdfFontFamily={matchedFont?.family}
            onSelect={() => {
              if (!active) onActivate?.();
              setSelectedBlockId(b.blockId);
            }}
            onBeginEdit={() => {
              if (!active) onActivate?.();
              setEditingId(b.blockId);
              setSelectedBlockId(null);
            }}
            onCommit={(newText) => {
              setEditingId(null);
              if (newText !== b.text && onEditText) onEditText(b.blockIds, newText);
            }}
            onCancel={() => setEditingId(null)}
          />
          );
        })}
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
  pageWidth,
  zoom,
  isEditing,
  isSelected,
  canEdit,
  availableChars,
  pdfFontFamily,
  onSelect,
  onBeginEdit,
  onCommit,
  onCancel,
}: {
  block: TextBlock;
  pageHeight: number;
  pageWidth: number;
  zoom: number;
  isEditing: boolean;
  isSelected: boolean;
  canEdit: boolean;
  availableChars: string;
  /** PDF 임베디드 폰트 family 이름. 있으면 편집 박스가 그 폰트로 렌더. */
  pdfFontFamily: string | undefined;
  onSelect: () => void;
  onBeginEdit: () => void;
  onCommit: (newText: string) => void;
  onCancel: () => void;
}) {
  const left = b.x * zoom;
  const top = (pageHeight - b.y - b.height) * zoom;
  const width = Math.max(0, b.width * zoom);
  const height = Math.max(8, b.height * zoom);
  const cls = `text-block ${canEdit ? 'editable' : 'readonly'} ${isEditing ? 'editing' : ''} ${isSelected ? 'selected' : ''}`;
  const title = !b.editable
    ? '이 텍스트는 편집할 수 없습니다 (폰트 인코딩 미지원 또는 디코드 실패)'
    : isSelected
      ? '한 번 더 클릭하여 편집 (또는 Enter)'
      : '클릭하여 선택, 두 번 클릭하면 편집';
  // 편집 진입 시 contentEditable element 에 안정적으로 focus + select-all.
  // setTimeout 보다 useEffect + ref 가 안정적 (React commit phase 직후 실행).
  const editRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!isEditing) return;
    const el = editRef.current;
    if (!el) return;
    // RAF 한 사이클 미루기 — contentEditable=true 가 DOM 에 반영된 다음.
    const rafId = requestAnimationFrame(() => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    return () => cancelAnimationFrame(rafId);
  }, [isEditing]);
  // 편집 중에는 width 를 auto + min-width 로 — 새 텍스트가 길어지면 박스도 같이 확장.
  // max-width 는 페이지 너비에서 left 만큼 빼 overflow 방지.
  const maxEditWidth = Math.max(0, pageWidth * zoom - left - 8);
  return (
    <>
      <span
        ref={editRef}
        className={cls}
        style={{
          left: `${left}px`,
          top: `${top}px`,
          height: `${height}px`,
          fontSize: `${height}px`,
          lineHeight: 1,
          whiteSpace: 'pre',
          overflow: 'visible',
          ...(isEditing
            ? {
                // 편집 중: width auto 로 텍스트 따라 확장. 원본 width 를 minWidth 로 잡아
                // 텍스트가 짧아져도 박스가 안 줄어듦. underlying SVG 글자 가리기 위해
                // 흰 배경 + 명확한 outline + 항상 검은 텍스트 (다크 모드 ink 는 흐림).
                width: 'auto',
                minWidth: `${width}px`,
                maxWidth: `${maxEditWidth}px`,
                background: '#ffffff',
                color: '#0b1020',
                fontWeight: 500,
                outline: '2px solid var(--color-accent)',
                outlineOffset: '2px',
                boxShadow: '0 4px 14px -4px var(--color-accent)',
                zIndex: 20,
                padding: '0 4px',
                // PDF 의 임베디드 폰트가 있으면 그걸 우선. 없으면 시스템 폰트 fallback.
                // PDF subset 폰트는 원문에 등장한 글자만 갖고 있어서 missing 글리프는
                // fallback 폰트로 보임 → 사용자가 어떤 글자가 안 되는지 시각적으로 즉시 인지.
                fontFamily: pdfFontFamily
                  ? `"${pdfFontFamily}", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`
                  : '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
                // antialiasing 강화
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
                textRendering: 'optimizeLegibility',
              }
            : {
                width: `${width}px`,
                color: 'transparent',
              }),
        }}
        contentEditable={canEdit && isEditing}
        suppressContentEditableWarning
        onClick={(e) => {
          if (!canEdit) return;
          // wrapper 의 onClick (페이지 deselect) 막기.
          e.stopPropagation();
          if (isEditing) return; // caret 이동만
          if (isSelected) {
            // 두 번째 클릭: 편집 시작.
            onBeginEdit();
          } else {
            onSelect();
          }
        }}
        onMouseDown={(e) => {
          // 더블클릭 시 mousedown → blur 가 발생할 수 있어 stopPropagation 으로 wrapper 까지
          // bubble 만 막고 default 는 유지 (caret 위치 잡힘).
          if (isEditing) e.stopPropagation();
        }}
        onDoubleClick={(e) => {
          // 더블클릭 = 즉시 편집 진입 (편의)
          if (!canEdit) return;
          e.stopPropagation();
          if (!isEditing) onBeginEdit();
        }}
        onBlur={(e) => {
          if (!isEditing) return;
          const newText = (e.currentTarget as HTMLElement).innerText;
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
          className="absolute z-30 flex flex-col gap-1 p-1.5 rounded-md text-[11px] shadow-pop"
          style={{
            left: `${left}px`,
            top: `${Math.max(0, top - 56)}px`,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-line)',
            whiteSpace: 'nowrap',
            pointerEvents: 'auto',
            minWidth: '220px',
          }}
          onMouseDown={(e) => {
            // 마우스 down 으로 contentEditable 가 blur 되는 걸 방지.
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <span className="text-[color:var(--color-muted)]">편집 중</span>
            <span className="text-[color:var(--color-line-strong)]">·</span>
            <button
              className="px-1.5 py-0.5 rounded text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-soft)] font-medium"
              onClick={(e) => {
                e.stopPropagation();
                const root = e.currentTarget.closest('div')?.parentElement; // toolbar root
                const span = root?.previousElementSibling as HTMLElement | null;
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
          {/* PDF subset 폰트 한계 안내 — 사용자가 입력한 글자가 PDF 폰트에 없으면 reject. */}
          {availableChars.length > 0 && (
            <div
              className="text-[10px] text-[color:var(--color-muted-2)] truncate"
              style={{ maxWidth: '320px' }}
              title={`이 PDF 폰트가 가진 모든 글자 (총 ${availableChars.length}자):\n${availableChars}`}
            >
              💡 이 PDF 의 폰트 글자만 사용 가능 ({availableChars.length}자)
            </div>
          )}
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
