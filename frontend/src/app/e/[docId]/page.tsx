'use client';

import { useEffect, useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyOps as apiApplyOps,
  finalizeDoc,
  getDocument,
  getPageTextBatch,
  insertPdfPages,
  undoOp,
  redoOp,
  type DocumentMeta,
  type PageMeta,
  type PageText,
} from '@/lib/api';
import type { Op } from '@/pdf/ops/types';
import { Sidebar } from '@/components/editor/Sidebar';
import { Toolbar } from '@/components/editor/Toolbar';
import { PageView } from '@/components/editor/PageView';
import { AddTextDialog } from '@/components/editor/AddTextDialog';
import { DiagnosticPanel } from '@/components/editor/DiagnosticPanel';
import { HelpDialog } from '@/components/editor/HelpDialog';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Banner } from '@/components/ui/Banner';

export default function EditorPageWrapper({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  return (
    <ToastProvider>
      <EditorPage params={params} />
    </ToastProvider>
  );
}

function EditorPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = use(params);
  const router = useRouter();
  const toast = useToast();

  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [activeIndex, setActive] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [modified, setModified] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [pageTexts, setPageTexts] = useState<Map<number, PageText>>(new Map());
  const [addTextMode, setAddTextMode] = useState(false);
  const [addTextAt, setAddTextAt] = useState<{ pageIndex: number; x: number; y: number } | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // op 후 scroll 복원 대상 페이지 (배열 위치). useEffect 가 잡아 scrollIntoView.
  const [scrollToIndex, setScrollToIndex] = useState<number | null>(null);

  // 초기 로드 + 모든 페이지 텍스트 batch 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await getDocument(docId);
        if (cancelled) return;
        setMeta(m);
        setCanUndo(!!m.canUndo);
        setCanRedo(!!m.canRedo);
        // batch text load (전체)
        const batch = await getPageTextBatch(docId, []);
        if (cancelled) return;
        const map = new Map<number, PageText>();
        const diag = new Set<string>();
        for (const p of batch.pages) {
          map.set(p.pageIndex, p);
          for (const fw of p.fontWarnings) {
            for (const w of fw.warnings) diag.add(`${fw.font}: ${w}`);
          }
        }
        setPageTexts(map);
        setDiagnostics([...diag]);
      } catch (e) {
        toast.error((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // op 후 영향받은 페이지의 텍스트 다시 로드
  const reloadAffected = useCallback(
    async (indices: number[]) => {
      if (indices.length === 0) return;
      try {
        const batch = await getPageTextBatch(docId, indices);
        setPageTexts((cur) => {
          const next = new Map(cur);
          for (const p of batch.pages) next.set(p.pageIndex, p);
          return next;
        });
      } catch (e) {
        toast.error('페이지 텍스트 갱신 실패');
      }
    },
    [docId, toast],
  );

  const reloadAllText = useCallback(async () => {
    try {
      const batch = await getPageTextBatch(docId, []);
      const map = new Map<number, PageText>();
      for (const p of batch.pages) map.set(p.pageIndex, p);
      setPageTexts(map);
    } catch {
      // ignore
    }
  }, [docId]);

  // Ctrl/Cmd + wheel 로 zoom — 브라우저 기본 (페이지 zoom) 을 가로채야 하므로
  // React 의 onWheel (passive) 대신 native addEventListener({passive: false}) 사용.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // deltaY > 0 = 휠 아래로 = zoom out, < 0 = zoom in. 고정 step 0.1, [0.25, 3] clamp.
      // line-mode (deltaMode === 1) wheel 은 더 큰 step 을 보내므로 보정.
      const lineNorm = e.deltaMode === 1 ? 16 : 1;
      const step = -Math.sign(e.deltaY) * 0.1 * (Math.abs(e.deltaY * lineNorm) > 50 ? 1.5 : 1);
      setZoom((z) => {
        const next = Math.min(3, Math.max(0.25, z + step));
        return Math.round(next * 100) / 100;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [meta]);

  // 키보드 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.isContentEditable) return;
      const tag = (target as HTMLInputElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 't' || e.key === 'T') {
        if (!e.metaKey && !e.ctrlKey) setAddTextMode((m) => !m);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size > 0) {
          e.preventDefault();
          handleDelete([...selected]);
        }
      } else if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleDownload();
      } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) handleRedo();
        } else {
          if (canUndo) handleUndo();
        }
      } else if ((e.key === 'y' || e.key === 'Y') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (canRedo) handleRedo();
      } else if ((e.key === '0') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setZoom(1);
      } else if (e.key === 'Escape') {
        if (addTextMode) setAddTextMode(false);
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        if (!e.metaKey && !e.ctrlKey && meta) {
          setActive((a) => Math.min(meta.pageCount - 1, a + 1));
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (!e.metaKey && !e.ctrlKey && meta) {
          setActive((a) => Math.max(0, a - 1));
        }
      } else if (e.key === '?') {
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, meta, addTextMode, canUndo, canRedo]);

  // 공통: op 응답에서 surgical update — getDocument 추가 호출 안 함.
  const applyOpResult = useCallback(
    (res: { revision: number; pages: typeof meta extends null ? never : DocumentMeta['pages']; canUndo: boolean; canRedo: boolean; newPageCount: number }) => {
      setMeta((cur) =>
        cur
          ? {
              ...cur,
              revision: res.revision,
              pages: res.pages,
              pageCount: res.newPageCount,
              canUndo: res.canUndo,
              canRedo: res.canRedo,
            }
          : cur,
      );
      setCanUndo(res.canUndo);
      setCanRedo(res.canRedo);
      setReload((x) => x + 1);
      if (res.newPageCount > 0 && activeIndex >= res.newPageCount) {
        setActive(res.newPageCount - 1);
      }
      setSelected(new Set());
    },
    [activeIndex],
  );

  const runOps = useCallback(
    async (ops: Op[], scrollTo?: number) => {
      if (!meta) return;
      try {
        const res = await apiApplyOps(docId, meta.revision, ops);
        applyOpResult(res);
        setModified(true);
        if (typeof scrollTo === 'number') {
          // 다음 layout 후 scrollIntoView 가 동작하도록 effect 가 잡음.
          setScrollToIndex(Math.max(0, Math.min(res.newPageCount - 1, scrollTo)));
        }
        if (
          ops.some(
            (o) => o.op === 'delete-pages' || o.op === 'reorder-pages' || o.op === 'rotate-pages',
          )
        ) {
          await reloadAllText();
        } else {
          await reloadAffected(res.affectedPages);
        }
        return res;
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      }
    },
    [docId, meta, applyOpResult, reloadAffected, reloadAllText, toast],
  );

  // 페이지 수정 op 후 해당 페이지가 화면에서 사라지지 않도록 scroll 복원.
  // meta.revision 이 바뀐 직후 (re-render 완료 후) 동작.
  useEffect(() => {
    if (scrollToIndex == null) return;
    // RAF 으로 layout 한 사이클 미루기 (DOM 이 새 페이지 위치 반영하도록).
    const id = requestAnimationFrame(() => {
      const root = canvasRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`[data-page-index="${scrollToIndex}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollToIndex(null);
    });
    return () => cancelAnimationFrame(id);
  }, [scrollToIndex, meta?.revision]);

  const handleInsertPdf = useCallback(
    async (file: File, insertAt: number) => {
      if (!meta) return;
      try {
        const res = await insertPdfPages(docId, file, insertAt);
        // applyOpResult 와 비슷한 처리 — 단 history 가 reset 되어 canUndo=false.
        setMeta((cur) =>
          cur
            ? {
                ...cur,
                revision: res.revision,
                pages: res.pages,
                pageCount: res.pageCount,
                canUndo: res.canUndo,
                canRedo: res.canRedo,
              }
            : cur,
        );
        setCanUndo(res.canUndo);
        setCanRedo(res.canRedo);
        setReload((x) => x + 1);
        setSelected(new Set());
        setActive(res.insertedFirstIndex);
        setScrollToIndex(res.insertedFirstIndex);
        setModified(true);
        await reloadAllText();
        toast.info(`${res.insertedCount} 페이지 추가됨`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [docId, meta, reloadAllText, toast],
  );

  const handleUndo = useCallback(async () => {
    try {
      const res = await undoOp(docId);
      applyOpResult(res);
      setModified(res.canUndo);
      await reloadAllText();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [docId, applyOpResult, reloadAllText, toast]);

  const handleRedo = useCallback(async () => {
    try {
      const res = await redoOp(docId);
      applyOpResult(res);
      setModified(true);
      await reloadAllText();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [docId, applyOpResult, reloadAllText, toast]);

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

  // 단일 페이지 op (rotate / delete) 는 그 페이지 위치로 scroll 유지. reorder/다중도
  // indices[0] 기준으로 (대표 페이지) — 일괄 삭제면 직전 page 가 자연스럽게 보임.
  const handleReorder = (perm: number[]) => runOps([{ op: 'reorder-pages', permutation: perm }]);
  const handleDelete = (indices: number[]) =>
    runOps([{ op: 'delete-pages', indices }], indices.length > 0 ? indices[0] : undefined);
  const handleRotate = (indices: number[], angle: 90 | -90) =>
    runOps([{ op: 'rotate-pages', indices, angle }], indices.length > 0 ? indices[0] : undefined);
  const handleEditText = (blockId: string, newText: string) =>
    runOps([{ op: 'edit-text', pageIndex: activeIndex, blockId, newText }]);

  const handleCanvasClick = (pageIndex: number, x: number, y: number) => {
    if (!addTextMode) return;
    setAddTextAt({ pageIndex, x, y });
  };
  const handleAddTextConfirm = async (
    params: Parameters<NonNullable<Parameters<typeof AddTextDialog>[0]['onConfirm']>>[0],
  ) => {
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
    try {
      const r = await finalizeDoc(docId, 'incremental');
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setModified(false);
      toast.success(`다운로드 시작: ${r.fileName}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  if (!meta) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-[color:var(--color-muted)]">
        문서 로드 중...
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col">
      <Toolbar
        docName={meta.name}
        pageCount={meta.pageCount}
        zoom={zoom}
        setZoom={setZoom}
        resetZoom={() => setZoom(1)}
        addTextMode={addTextMode}
        toggleAddText={() => setAddTextMode((m) => !m)}
        onDownload={handleDownload}
        downloading={downloading}
        modified={modified}
        onHome={() => router.push('/')}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        diagnosticCount={
          diagnostics.length +
          (meta.diagnostics?.filter((d) => d.level !== 'info').length ?? 0)
        }
        onOpenDiagnostics={() => setDiagnosticOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onToggleSidebar={() => setMobileSidebarOpen((o) => !o)}
      />

      {diagnostics.length > 0 && (
        <div className="px-4 py-2 border-b border-[color:var(--color-line)]" style={{ background: 'var(--color-surface)' }}>
          <Banner kind="warn">
            <div className="flex items-center justify-between gap-3">
              <div>
                <strong>일부 폰트의 텍스트는 편집/표시가 제한됩니다.</strong>{' '}
                <span className="text-[color:var(--color-muted)]">
                  {diagnostics.length}건 감지
                </span>
              </div>
              <button
                onClick={() => setDiagnosticOpen(true)}
                className="text-xs underline shrink-0"
              >
                자세히
              </button>
            </div>
          </Banner>
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
          reload={reload}
          revision={meta.revision}
        />
        <Sidebar
          docId={docId}
          pages={meta.pages}
          activeIndex={activeIndex}
          selected={selected}
          onSelect={handleSelect}
          onActivate={setActive}
          onReorder={handleReorder}
          onDelete={handleDelete}
          reload={reload}
          revision={meta.revision}
          mobile={{ open: mobileSidebarOpen, onClose: () => setMobileSidebarOpen(false) }}
        />
        <div
          ref={canvasRef}
          className="flex-1 overflow-auto thin-scroll flex flex-col items-center px-8 py-8 gap-6"
          style={{ background: 'var(--color-canvas)' }}
        >
          {meta.pages.length === 0 ? (
            <div className="text-sm text-[color:var(--color-muted)]">페이지가 없습니다</div>
          ) : (
            meta.pages.map((p, i) => (
              <PageView
                key={`${p.index}-${reload}`}
                docId={docId}
                page={p}
                pageText={pageTexts.get(p.index) ?? null}
                zoom={zoom}
                revision={meta.revision}
                displayIndex={i + 1}
                totalPages={meta.pages.length}
                onEditText={p.index === activeIndex ? handleEditText : undefined}
                onCanvasClick={addTextMode ? handleCanvasClick : undefined}
                addTextMode={addTextMode && p.index === activeIndex}
                active={p.index === activeIndex}
                selected={selected.has(i)}
                onRotate={(angle) => handleRotate([i], angle)}
                onDelete={() => handleDelete([i])}
                onInsertPdf={(file) => handleInsertPdf(file, i)}
                onActivate={() => {
                  // 캔버스 페이지 클릭 → 사이드바 선택 동기화: single 모드 select + activate.
                  handleSelect(i, 'single');
                  setActive(i);
                }}
              />
            ))
          )}
        </div>
      </div>

      {addTextAt && (
        <AddTextDialog
          docId={docId}
          pageIndex={addTextAt.pageIndex}
          x={addTextAt.x}
          y={addTextAt.y}
          onCancel={() => setAddTextAt(null)}
          onConfirm={handleAddTextConfirm}
        />
      )}
      <DiagnosticPanel
        open={diagnosticOpen}
        onClose={() => setDiagnosticOpen(false)}
        pageTexts={pageTexts}
        docDiagnostics={meta.diagnostics ?? []}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
