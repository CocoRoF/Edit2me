'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getDocument, mergeDocs, thumbUrl, type DocumentMeta } from '@/lib/api';
import { Combine, Loader2, X, Plus } from 'lucide-react';

interface SelectedPage {
  uid: string; // unique id for drag tracking
  source: number; // index into docs
  pageIndex: number;
}

export default function MergePage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null);
  const [seq, setSeq] = useState<SelectedPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragUid, setDragUid] = useState<string | null>(null);

  // sessionStorage에서 docId들 로드
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
          if (!cancelled) setError((e as Error).message);
        });
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      cancelled = true;
    };
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
    setError(null);
    try {
      const result = await mergeDocs(
        docs.map((d) => ({ docId: d.docId })),
        seq.map((s) => ({ source: s.source, pageIndex: s.pageIndex })),
        'merged.pdf',
      );
      // 병합 결과 docId의 에디터로 이동
      router.push(`/e/${result.docId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !docs) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-[color:var(--color-danger)] mb-3">{error}</p>
          <button onClick={() => router.push('/')} className="underline text-sm">
            처음으로
          </button>
        </div>
      </main>
    );
  }
  if (!docs) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-[color:var(--color-muted)]">
        문서 로드 중...
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col">
      <header className="h-12 border-b border-[color:var(--color-line)] flex items-center px-3 gap-3 bg-[color:var(--color-paper)]">
        <Combine size={18} />
        <span className="text-sm font-medium">PDF 병합</span>
        <span className="text-xs text-[color:var(--color-muted)]">
          {docs.length} 문서 · {seq.length} 페이지 선택됨
        </span>
        <div className="flex-1" />
        <button onClick={() => router.push('/')} className="text-sm hover:underline">
          처음으로
        </button>
        <button
          disabled={busy || seq.length === 0}
          onClick={handleMerge}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-[color:var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Combine size={16} />}
          <span>병합 완료</span>
        </button>
      </header>
      {error && (
        <div className="bg-red-50 text-red-700 text-xs px-3 py-1.5 border-b border-red-200">
          {error}
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 shrink-0 border-r border-[color:var(--color-line)] overflow-y-auto">
          {docs.map((d, srcIdx) => (
            <details key={d.docId} open className="border-b border-[color:var(--color-line)]">
              <summary className="px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-gray-50">
                <span className="truncate">{d.name}</span>
                <span className="text-xs text-[color:var(--color-muted)]">{d.pageCount}p</span>
              </summary>
              <div className="p-2 grid grid-cols-3 gap-2">
                {d.pages.map((p) => (
                  <button
                    key={p.index}
                    onClick={() => addToSeq(srcIdx, p.index)}
                    className="relative group hover:ring-2 hover:ring-[color:var(--color-accent)] rounded overflow-hidden"
                    title="추가"
                  >
                    <img
                      src={thumbUrl(d.docId, p.index, 80)}
                      alt={`p${p.index + 1}`}
                      className="w-full h-auto block"
                    />
                    <span className="absolute bottom-0 right-0 text-[9px] bg-white/80 px-1">
                      {p.index + 1}
                    </span>
                    <Plus
                      size={20}
                      className="absolute inset-0 m-auto opacity-0 group-hover:opacity-100 text-[color:var(--color-accent)]"
                    />
                  </button>
                ))}
              </div>
            </details>
          ))}
        </aside>
        <section className="flex-1 overflow-auto bg-gray-100 dark:bg-neutral-900 p-4">
          {seq.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[color:var(--color-muted)]">
              ← 왼쪽에서 페이지를 클릭해 결과 시퀀스에 추가하세요
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
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
                      src={thumbUrl(d.docId, s.pageIndex, 120)}
                      alt={`seq${i}`}
                      className="w-full h-auto block"
                      draggable={false}
                    />
                    <span className="absolute bottom-0 right-0 text-[10px] bg-white/85 px-1">
                      {i + 1}
                    </span>
                    <span
                      className="absolute top-0 left-0 text-[10px] bg-black/40 text-white px-1 max-w-[80%] truncate"
                      title={d.name}
                    >
                      {d.name}
                    </span>
                    <button
                      onClick={() => removeFromSeq(s.uid)}
                      className="absolute top-1 right-1 bg-white/80 hover:bg-white rounded p-0.5"
                      title="제거"
                    >
                      <X size={12} />
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
