'use client';

import { useState } from 'react';
import type { PageMeta } from '@/lib/api';
import { thumbUrl } from '@/lib/api';
import { Trash2, RotateCw, RotateCcw, Layers, X, GripVertical } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface BaseProps {
  docId: string;
  pages: PageMeta[];
  activeIndex: number;
  selected: Set<number>;
  onSelect: (index: number, mode: 'single' | 'toggle' | 'range') => void;
  onActivate: (index: number) => void;
  onReorder: (perm: number[]) => void;
  onDelete: (indices: number[]) => void;
  onRotate: (indices: number[], angle: 90 | -90) => void;
  reload?: number;
  /** 현재 문서 revision — thumb URL cache 무효화에 사용 */
  revision?: number;
}

interface Props extends BaseProps {
  /** 모바일 drawer 모드: visibility + 닫기 */
  mobile?: { open: boolean; onClose: () => void };
}

export function Sidebar(props: Props) {
  const { mobile, ...base } = props;

  if (mobile) {
    return (
      <>
        {mobile.open && (
          <div
            className="md:hidden fixed inset-0 z-30"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={mobile.onClose}
          />
        )}
        <aside
          className="md:hidden fixed left-0 top-0 bottom-0 z-40 w-64 flex flex-col border-r transition-transform"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-line)',
            transform: mobile.open ? 'none' : 'translateX(-100%)',
          }}
        >
          <header
            className="h-12 px-3 flex items-center justify-between border-b shrink-0"
            style={{ borderColor: 'var(--color-line)' }}
          >
            <span className="text-sm font-medium">페이지</span>
            <button
              onClick={mobile.onClose}
              className="text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </header>
          <SidebarBody
            {...base}
            onActivate={(i) => {
              base.onActivate(i);
              mobile.onClose();
            }}
          />
        </aside>
      </>
    );
  }

  return (
    <aside
      className="hidden md:flex w-64 shrink-0 flex-col border-r"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-line)' }}
    >
      <SidebarBody {...base} />
    </aside>
  );
}

function SidebarBody(props: BaseProps) {
  const {
    docId,
    pages,
    activeIndex,
    selected,
    onSelect,
    onActivate,
    onReorder,
    onDelete,
    onRotate,
    reload,
    revision,
  } = props;

  // dnd-kit: 8px 이상 움직여야 drag 시작 — 클릭과 충돌 방지.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // sortable item 의 stable id — page.index 가 reorder 후에도 보존됨.
  const itemIds = pages.map((p) => `pg-${p.index}`);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = itemIds.indexOf(String(active.id));
    const to = itemIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    // 현재 순서 (0..n-1) 를 arrayMove 로 재배열 → permutation 으로 backend 에 전달.
    const perm = arrayMove(
      pages.map((_, i) => i),
      from,
      to,
    );
    onReorder(perm);
  }

  const activeIdx = activeDragId ? itemIds.indexOf(activeDragId) : -1;
  const activePage = activeIdx >= 0 ? pages[activeIdx] : null;

  return (
    <>
      <div className="px-3 py-2.5 flex items-center justify-between text-xs border-b border-[color:var(--color-line)]">
        <div className="flex items-center gap-1.5 text-[color:var(--color-muted)]">
          <Layers size={13} />
          <span>
            {pages.length} 페이지{selected.size > 0 ? ` · ${selected.size} 선택` : ''}
          </span>
        </div>
        {selected.size > 0 && (
          <div className="flex gap-0.5">
            <IconBtn title="역회전" onClick={() => onRotate([...selected], -90)}>
              <RotateCcw size={13} />
            </IconBtn>
            <IconBtn title="회전" onClick={() => onRotate([...selected], 90)}>
              <RotateCw size={13} />
            </IconBtn>
            <IconBtn title="삭제" onClick={() => onDelete([...selected])} danger>
              <Trash2 size={13} />
            </IconBtn>
          </div>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <ol className="flex-1 overflow-y-auto thin-scroll px-2.5 py-3 flex flex-col gap-2.5">
            {pages.map((p, i) => (
              <SortableThumb
                key={`${p.index}-${reload ?? 0}`}
                id={itemIds[i]!}
                docId={docId}
                pageIndex={i}
                originalIndex={p.index}
                isActive={i === activeIndex}
                isSelected={selected.has(i)}
                isDraggingThis={activeDragId === itemIds[i]}
                revision={revision}
                onClick={(e) => {
                  if (e.shiftKey) onSelect(i, 'range');
                  else if (e.metaKey || e.ctrlKey) onSelect(i, 'toggle');
                  else onSelect(i, 'single');
                  onActivate(i);
                }}
              />
            ))}
          </ol>
        </SortableContext>

        {/* DragOverlay: 드래그 중 cursor 옆에 따라다니는 floating clone — 어떤 페이지를
            옮기는지 명확히 보임. 원본 위치엔 placeholder 자리. */}
        <DragOverlay dropAnimation={null}>
          {activePage ? (
            <DragPreview
              docId={docId}
              originalIndex={activePage.index}
              pageNumber={activeIdx + 1}
              revision={revision}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function SortableThumb({
  id,
  docId,
  pageIndex,
  originalIndex,
  isActive,
  isSelected,
  isDraggingThis,
  revision,
  onClick,
}: {
  id: string;
  docId: string;
  pageIndex: number;
  originalIndex: number;
  isActive: boolean;
  isSelected: boolean;
  isDraggingThis: boolean;
  revision?: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isOver,
  } = useSortable({ id });

  // 원본 자리: 드래그 중 빈 placeholder 처럼 흐리게.
  const placeholderStyle = isDraggingThis
    ? { opacity: 0.25, transition }
    : { transform: CSS.Transform.toString(transform), transition };

  // selected/active 강조: outline 두껍게 + accent halo (box-shadow). 다크 테마에서도
  // accent-ring 은 alpha 라 잘 안 보이는 문제 → 직접 accent 색상 강하게.
  let outlineCss = '1px solid var(--color-line)';
  let shadowCss = 'none';
  if (isActive) {
    outlineCss = '3px solid var(--color-accent)';
    shadowCss = '0 0 0 4px var(--color-accent-soft), 0 4px 14px -4px var(--color-accent)';
  } else if (isSelected) {
    outlineCss = '3px solid var(--color-accent)';
    shadowCss = '0 0 0 3px var(--color-accent-soft)';
  }

  return (
    // 썸네일 전체가 drag 영역 — listeners/attributes 를 li 에 직접 적용.
    // PointerSensor distance:8px 가 click 과 drag 를 자동 구분 (8px 이상 움직이면 drag,
    // 아니면 pointerup 시 click 통과). hover 시 cursor:grab 으로 drag 가능함을 명시.
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        ...placeholderStyle,
        cursor: isDraggingThis ? 'grabbing' : 'grab',
        touchAction: 'none', // 모바일 scroll 과 drag 분리
      }}
      className="relative"
      onClick={onClick}
      aria-label={`페이지 ${pageIndex + 1} — 클릭하여 선택, 드래그하여 순서 변경`}
    >
      {/* drop position indicator — drag over 시 위쪽에 accent line */}
      {isOver && !isDraggingThis && (
        <div
          className="absolute left-0 right-0 -top-1.5 h-1 rounded-full pointer-events-none"
          style={{
            background: 'var(--color-accent)',
            boxShadow: '0 0 0 2px var(--color-accent-soft), 0 0 8px var(--color-accent)',
          }}
        />
      )}
      <div
        className="relative rounded transition-shadow"
        style={{
          outline: outlineCss,
          outlineOffset: '0',
          boxShadow: shadowCss,
        }}
      >
        <img
          src={thumbUrl(docId, pageIndex, 220, revision ?? 0)}
          alt={`page ${pageIndex + 1}`}
          className="w-full h-auto block rounded-sm"
          draggable={false}
        />
        {/* 좌상단 grip indicator — drag affordance (visual hint). hover 시 더 진하게.
            actual drag 는 li 전체에 걸려있어 이 아이콘이 안 보여도 drag 됨. */}
        <span
          aria-hidden
          className="absolute top-1 left-1 w-6 h-6 rounded inline-flex items-center justify-center pointer-events-none transition-opacity"
          style={{
            background: 'rgba(0,0,0,0.5)',
            color: '#fff',
            opacity: isDraggingThis ? 1 : 0.55,
          }}
        >
          <GripVertical size={14} />
        </span>
      </div>
      <div
        className="mt-1 text-[11px] text-center"
        style={{
          color: isActive ? 'var(--color-accent)' : 'var(--color-muted)',
          fontWeight: isActive ? 700 : 400,
        }}
      >
        {pageIndex + 1}
      </div>
      {void originalIndex}
    </li>
  );
}

function DragPreview({
  docId,
  originalIndex,
  pageNumber,
  revision,
}: {
  docId: string;
  originalIndex: number;
  pageNumber: number;
  revision?: number;
}) {
  return (
    <div
      className="rounded-md overflow-hidden shadow-2xl"
      style={{
        outline: '2px solid var(--color-accent)',
        background: '#fff',
        cursor: 'grabbing',
        // 살짝 기울여서 drag 중임을 강조
        transform: 'rotate(-2deg) scale(1.04)',
      }}
    >
      <img
        src={thumbUrl(docId, pageNumber - 1, 220, revision ?? 0)}
        alt={`dragging page ${pageNumber}`}
        className="w-full h-auto block"
        draggable={false}
      />
      <div
        className="text-center text-[11px] py-1 font-semibold"
        style={{ background: 'var(--color-accent)', color: '#fff' }}
      >
        페이지 {pageNumber}
      </div>
      {void originalIndex}
    </div>
  );
}

function IconBtn({
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
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[color:var(--color-surface-2)]"
      style={{
        color: danger ? 'var(--color-danger)' : 'var(--color-muted)',
      }}
    >
      {children}
    </button>
  );
}
