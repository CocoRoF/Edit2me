'use client';

import { useState } from 'react';
import type { PageMeta } from '@/lib/api';
import { thumbUrl } from '@/lib/api';
import { Trash2, RotateCw, RotateCcw, Layers, X } from 'lucide-react';

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
          className="md:hidden fixed left-0 top-0 bottom-0 z-40 w-60 flex flex-col border-r transition-transform"
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
      className="hidden md:flex w-44 shrink-0 flex-col border-r"
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
  } = props;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

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

      <ol className="flex-1 overflow-y-auto thin-scroll px-2.5 py-3 flex flex-col gap-2.5">
        {pages.map((p, i) => {
          const isActive = i === activeIndex;
          const isSelected = selected.has(i);
          const isDropTarget = dropIdx === i;
          return (
            <li
              key={`${p.index}-${reload}`}
              className="relative cursor-pointer"
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setDropIdx(i);
              }}
              onDragLeave={() => setDropIdx((cur) => (cur === i ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx === null || dragIdx === i) return;
                const perm = pages.map((_, idx) => idx);
                const [moved] = perm.splice(dragIdx, 1);
                perm.splice(i, 0, moved!);
                onReorder(perm);
                setDragIdx(null);
                setDropIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setDropIdx(null);
              }}
              onClick={(e) => {
                if (e.shiftKey) onSelect(i, 'range');
                else if (e.metaKey || e.ctrlKey) onSelect(i, 'toggle');
                else onSelect(i, 'single');
                onActivate(i);
              }}
            >
              <div
                className={`relative rounded transition-shadow ${isDropTarget ? 'drag-target-hover' : ''}`}
                style={{
                  outline: isActive
                    ? `2px solid var(--color-accent)`
                    : isSelected
                      ? `2px solid var(--color-accent-ring)`
                      : `1px solid var(--color-line)`,
                  outlineOffset: '0',
                }}
              >
                <img
                  src={thumbUrl(docId, i, 160)}
                  alt={`page ${i + 1}`}
                  className="w-full h-auto block rounded-sm"
                  draggable={false}
                />
              </div>
              <div
                className="mt-1 text-[11px] text-center"
                style={{
                  color: isActive ? 'var(--color-accent)' : 'var(--color-muted)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {i + 1}
              </div>
            </li>
          );
        })}
      </ol>
    </>
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
