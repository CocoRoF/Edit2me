'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyOps as apiApplyOps,
  finalizeDoc,
  getDocument,
  type DocumentMeta,
  type PageMeta,
} from '@/lib/api';
import type { Op } from '@/pdf/ops/types';
import { Sidebar } from '@/components/editor/Sidebar';
import { Toolbar } from '@/components/editor/Toolbar';
import { PageView } from '@/components/editor/PageView';
import { AddTextDialog } from '@/components/editor/AddTextDialog';

export default function EditorPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = use(params);
  const router = useRouter();
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [activeIndex, setActive] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [modified, setModified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addTextMode, setAddTextMode] = useState(false);
  const [addTextAt, setAddTextAt] = useState<{ pageIndex: number; x: number; y: number } | null>(null);

  // 초기 로드
  useEffect(() => {
    let cancelled = false;
    getDocument(docId)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // 키보드 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if ((e.target as HTMLInputElement | HTMLTextAreaElement)?.tagName === 'INPUT' ||
          (e.target as HTMLInputElement | HTMLTextAreaElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 't' || e.key === 'T') {
        setAddTextMode((m) => !m);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size > 0) {
          e.preventDefault();
          handleDelete([...selected]);
        }
      } else if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleDownload();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, meta, modified]);

  const runOps = useCallback(
    async (ops: Op[]) => {
      if (!meta) return;
      try {
        const res = await apiApplyOps(docId, meta.revision, ops);
        const fresh = await getDocument(docId);
        setMeta(fresh);
        setReload((x) => x + 1);
        setModified(true);
        // 활성 페이지 보정
        if (fresh.pageCount > 0 && activeIndex >= fresh.pageCount) {
          setActive(fresh.pageCount - 1);
        }
        // 선택은 비움
        setSelected(new Set());
        return res;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [docId, meta, activeIndex],
  );

  const handleSelect = useCallback(
    (i: number, mode: 'single' | 'toggle' | 'range') => {
      setSelected((cur) => {
        const next = new Set(cur);
        if (mode === 'single') {
          next.clear();
          next.add(i);
        } else if (mode === 'toggle') {
          if (next.has(i)) next.delete(i);
          else next.add(i);
        } else if (mode === 'range') {
          const last = activeIndex;
          const lo = Math.min(last, i);
          const hi = Math.max(last, i);
          for (let k = lo; k <= hi; k += 1) next.add(k);
        }
        return next;
      });
    },
    [activeIndex],
  );

  const handleReorder = (perm: number[]) => runOps([{ op: 'reorder-pages', permutation: perm }]);
  const handleDelete = (indices: number[]) => runOps([{ op: 'delete-pages', indices }]);
  const handleRotate = (indices: number[], angle: 90 | -90) =>
    runOps([{ op: 'rotate-pages', indices, angle }]);
  const handleEditText = (blockId: string, newText: string) =>
    runOps([{ op: 'edit-text', pageIndex: activeIndex, blockId, newText }]);

  const handleCanvasClick = (pageIndex: number, x: number, y: number) => {
    if (!addTextMode) return;
    setAddTextAt({ pageIndex, x, y });
  };
  const handleAddTextConfirm = async (params: Parameters<NonNullable<Parameters<typeof AddTextDialog>[0]['onConfirm']>>[0]) => {
    setAddTextAt(null);
    setAddTextMode(false);
    await runOps([
      {
        op: 'add-text',
        pageIndex: params.pageIndex,
        x: params.x,
        y: params.y,
        text: params.text,
        font: params.font,
        fontSize: params.fontSize,
        color: params.color,
      },
    ]);
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const r = await finalizeDoc(docId, 'incremental');
      // 다운로드 트리거
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setModified(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  if (error && !meta) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[color:var(--color-danger)] mb-4">{error}</p>
          <button onClick={() => router.push('/')} className="text-sm underline">
            처음으로
          </button>
        </div>
      </main>
    );
  }
  if (!meta) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-[color:var(--color-muted)]">
        문서 로드 중...
      </main>
    );
  }

  const activePage: PageMeta | undefined = meta.pages[activeIndex];

  return (
    <main className="h-screen flex flex-col">
      <Toolbar
        docName={meta.name}
        pageCount={meta.pageCount}
        zoom={zoom}
        setZoom={setZoom}
        addTextMode={addTextMode}
        toggleAddText={() => setAddTextMode((m) => !m)}
        onDownload={handleDownload}
        downloading={downloading}
        modified={modified}
      />
      {error && (
        <div className="bg-red-50 text-red-700 text-xs px-3 py-1.5 border-b border-red-200">
          {error}
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          docId={docId}
          pages={meta.pages}
          activeIndex={activeIndex}
          selected={selected}
          onSelect={handleSelect}
          onActivate={setActive}
          onReorder={handleReorder}
          onDelete={handleDelete}
          onRotate={handleRotate}
          reload={reload}
        />
        <div className="flex-1 overflow-auto bg-gray-100 dark:bg-neutral-900 flex flex-col items-center px-6">
          {meta.pages.map((p) =>
            p.index === activeIndex || isNear(p.index, activeIndex) ? (
              <PageView
                key={`${p.index}-${reload}`}
                docId={docId}
                page={p}
                zoom={zoom}
                onEditText={p.index === activeIndex ? handleEditText : undefined}
                onCanvasClick={addTextMode ? handleCanvasClick : undefined}
                addTextMode={addTextMode && p.index === activeIndex}
                reload={reload}
              />
            ) : (
              <div
                key={`${p.index}-${reload}`}
                className="paper my-4"
                style={{
                  width: p.width * zoom,
                  height: p.height * zoom,
                }}
                onClick={() => setActive(p.index)}
              />
            ),
          )}
        </div>
      </div>
      {addTextAt && (
        <AddTextDialog
          pageIndex={addTextAt.pageIndex}
          x={addTextAt.x}
          y={addTextAt.y}
          onCancel={() => setAddTextAt(null)}
          onConfirm={handleAddTextConfirm}
        />
      )}
    </main>
  );
}

function isNear(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}
