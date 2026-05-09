'use client';

import { useState } from 'react';
import type { PageMeta } from '@/lib/api';
import { thumbUrl } from '@/lib/api';
import { Trash2, RotateCw, RotateCcw } from 'lucide-react';

interface Props {
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

export function Sidebar({
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
}: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  return (
    <aside className="w-32 shrink-0 border-r border-[color:var(--color-line)] bg-[color:var(--color-paper)] flex flex-col">
      <div className="px-2 py-2 text-xs text-[color:var(--color-muted)] flex items-center justify-between">
        <span>{pages.length} 페이지</span>
        {selected.size > 0 && (
          <div className="flex gap-1">
            <button
              title="회전"
              className="hover:text-[color:var(--color-ink)]"
              onClick={() => onRotate([...selected], 90)}
            >
              <RotateCw size={14} />
            </button>
            <button
              title="역회전"
              className="hover:text-[color:var(--color-ink)]"
              onClick={() => onRotate([...selected], -90)}
            >
              <RotateCcw size={14} />
            </button>
            <button
              title="삭제"
              className="hover:text-[color:var(--color-danger)]"
              onClick={() => onDelete([...selected])}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
      <ol className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-2">
        {pages.map((p, i) => {
          const isActive = i === activeIndex;
          const isSelected = selected.has(i);
          const isDropTarget = dropIdx === i;
          return (
            <li
              key={`${p.index}-${reload}`}
              className={`relative rounded-md border cursor-pointer ${
                isActive ? 'border-[color:var(--color-accent)]' : 'border-transparent'
              } ${isSelected ? 'ring-2 ring-[color:var(--color-accent)]' : ''} ${
                isDropTarget ? 'drag-target-hover' : ''
              }`}
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
              <img
                src={thumbUrl(docId, i, 110)}
                alt={`page ${i + 1}`}
                className="w-full h-auto block rounded-sm"
                draggable={false}
              />
              <span className="absolute -bottom-1 right-0 text-[10px] bg-white/80 px-1 rounded">
                {i + 1}
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
