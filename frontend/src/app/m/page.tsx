'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getDocument, mergeDocs, thumbUrl, type DocumentMeta } from '@/lib/api';
import { Combine, Loader2, X, ArrowLeft } from 'lucide-react';
import { ToastProvider, useToast } from '@/components/ui/Toast';

interface SelectedPage {
  uid: string;
  source: number;
  pageIndex: number;
}

export default function MergePageWrapper() {
  return (
    <ToastProvider>
      <MergePage />
    </ToastProvider>
  );
}

function MergePage() {
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null);
  const [seq, setSeq] = useState<SelectedPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragUid, setDragUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem('edit2me-merge');
      if (!raw) {
        router.replace('/');
        return;
      }
      const items = JSON.parse(raw) as Array<{ docId: string }>;
      Promise.all(items.map((it) => getDocument(it.docId)))
        .then((metas) => {
          if (!cancelled) setDocs(metas);
        })
        .catch((e) => {
          if (!cancelled) toast.error((e as Error).message);
        });
    } catch (e) {
      toast.error((e as Error).message);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const addToSeq = useCallback((source: number, pageIndex: number) => {
    setSeq((cur) => [
      ...cur,
      { uid: `${Date.now()}-${Math.random()}`, source, pageIndex },
    ]);
  }, []);

  const removeFromSeq = useCallback((uid: string) => {
    setSeq((cur) => cur.filter((s) => s.uid !== uid));
  }, []);

  const reorderSeq = useCallback((from: string, toIndex: number) => {
    setSeq((cur) => {
      const idx = cur.findIndex((s) => s.uid === from);
      if (idx < 0) return cur;
      const next = [...cur];
      const [moved] = next.splice(idx, 1);
      next.splice(toIndex, 0, moved!);
      return next;
    });
  }, []);

  const handleMerge = async () => {
    if (!docs || seq.length === 0) return;
    setBusy(true);
    try {
      const result = await mergeDocs(
        docs.map((d) => ({ docId: d.docId })),
        seq.map((s) => ({ source: s.source, pageIndex: s.pageIndex })),
        'merged.pdf',
      );
      router.push(`/e/${result.docId}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!docs) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-[color:var(--color-muted)]">
        문서 로드 중...
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col">
      <header
        className="h-14 flex items-center px-3 gap-3 border-b shrink-0"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-line)' }}
      >
        <button
          onClick={() => router.push('/')}
          className="btn btn-ghost"
        >
          <ArrowLeft size={14} />
          <span>처음으로</span>
        </button>
        <span className="mx-1 text-[color:var(--color-line-strong)]">/</span>
        <Combine size={16} className="text-[color:var(--color-muted)]" />
        <span className="text-sm font-medium">병합</span>
        <span className="text-xs text-[color:var(--color-muted)]">
          {docs.length} 문서 · {seq.length} 페이지 선택
        </span>
        <div className="flex-1" />
        <button
          disabled={busy || seq.length === 0}
          onClick={handleMerge}
          className="btn btn-primary"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Combine size={16} />}
          <span>병합 완료</span>
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside
          className="w-80 shrink-0 overflow-y-auto thin-scroll border-r"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-line)' }}
        >
          {docs.map((d, srcIdx) => (
            <details
              key={d.docId}
              open
              className="border-b border-[color:var(--color-line)]"
            >
              <summary className="px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-[color:var(--color-surface-2)]">
                <span className="truncate">{d.name}</span>
                <span className="text-xs text-[color:var(--color-muted)]">{d.pageCount}p</span>
              </summary>
              <div className="p-2 grid grid-cols-3 gap-2">
                {d.pages.map((p) => (
                  <button
                    key={p.index}
                    onClick={() => addToSeq(srcIdx, p.index)}
                    className="relative group rounded overflow-hidden hover:opacity-80"
                    style={{ outline: '1px solid var(--color-line)' }}
                    title={`페이지 ${p.index + 1} 추가`}
                  >
                    <img
                      src={thumbUrl(d.docId, p.index, 100)}
                      alt={`p${p.index + 1}`}
                      className="w-full h-auto block"
                    />
                    <span
                      className="absolute bottom-0 right-0 text-[9px] px-1 rounded-tl"
                      style={{ background: 'rgba(255,255,255,0.85)', color: '#0b1020' }}
                    >
                      {p.index + 1}
                    </span>
                  </button>
                ))}
              </div>
            </details>
          ))}
        </aside>
        <section
          className="flex-1 overflow-auto thin-scroll p-6"
          style={{ background: 'var(--color-canvas)' }}
        >
          {seq.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-[color:var(--color-muted)] gap-1">
              <span>← 왼쪽 사이드바에서 페이지를 클릭해 추가</span>
              <span className="text-xs text-[color:var(--color-muted-2)]">
                추가된 페이지는 드래그로 순서 변경, X로 제거
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {seq.map((s, i) => {
                const d = docs[s.source]!;
                return (
                  <div
                    key={s.uid}
                    draggable
                    onDragStart={() => setDragUid(s.uid)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragUid && dragUid !== s.uid) reorderSeq(dragUid, i);
                      setDragUid(null);
                    }}
                    className="paper relative rounded overflow-hidden"
                  >
                    <img
                      src={thumbUrl(d.docId, s.pageIndex, 140)}
                      alt={`seq${i}`}
                      className="w-full h-auto block"
                      draggable={false}
                    />
                    <div
                      className="absolute top-0 left-0 right-0 px-1.5 py-0.5 text-[10px] truncate"
                      style={{
                        background: 'rgba(0,0,0,0.55)',
                        color: '#fff',
                      }}
                      title={d.name}
                    >
                      {d.name}
                    </div>
                    <div
                      className="absolute bottom-0 left-0 px-1.5 py-0.5 text-[10px] rounded-tr"
                      style={{ background: 'rgba(255,255,255,0.85)', color: '#0b1020' }}
                    >
                      {i + 1} · p{s.pageIndex + 1}
                    </div>
                    <button
                      onClick={() => removeFromSeq(s.uid)}
                      className="absolute top-1 right-1 rounded p-0.5"
                      style={{ background: 'rgba(255,255,255,0.85)' }}
                      title="제거"
                    >
                      <X size={12} color="#0b1020" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
