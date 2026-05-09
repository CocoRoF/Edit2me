'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { uploadPdf } from '@/lib/api';
import { Edit3, Plus, ArrowUpDown, Trash2, Combine, Loader2 } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.size > 0);
      if (arr.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        if (arr.length === 1) {
          setProgress('업로드 중...');
          const meta = await uploadPdf(arr[0]!);
          router.push(`/e/${meta.docId}`);
          return;
        }
        // 다중 파일 → merge 모드. 모두 업로드 후 /m 으로.
        setProgress(`${arr.length}개 파일 업로드 중...`);
        const docs: Array<{ docId: string; name: string; pageCount: number }> = [];
        for (let i = 0; i < arr.length; i += 1) {
          setProgress(`${i + 1} / ${arr.length} 업로드 중...`);
          const meta = await uploadPdf(arr[i]!);
          docs.push({ docId: meta.docId, name: meta.name, pageCount: meta.pageCount });
        }
        // 세션 storage에 docId 목록 전달
        sessionStorage.setItem('edit2me-merge', JSON.stringify(docs));
        router.push('/m');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [router],
  );

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <header className="w-full max-w-3xl flex items-baseline justify-between mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">Edit2me</h1>
        <span className="text-xs text-[color:var(--color-muted)]">자체 엔진 PDF 편집기</span>
      </header>

      <DropZone onFiles={handleFiles} busy={busy} progress={progress} error={error} />

      <section className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-3xl">
        <Feature icon={<Edit3 size={18} />} label="텍스트 편집" />
        <Feature icon={<Plus size={18} />} label="텍스트 추가" />
        <Feature icon={<ArrowUpDown size={18} />} label="페이지 재배치" />
        <Feature icon={<Trash2 size={18} />} label="페이지 삭제" />
      </section>
      <p className="mt-3 text-xs text-[color:var(--color-muted)]">여러 파일을 한 번에 올리면 병합 모드로 진입합니다.</p>

      <footer className="mt-16 text-xs text-center text-[color:var(--color-muted)] max-w-md">
        <p>업로드한 파일은 24시간 후 자동 삭제됩니다.</p>
        <p>외부 PDF 라이브러리를 사용하지 않는 자체 엔진으로 동작합니다.</p>
      </footer>
    </main>
  );
}

function DropZone({
  onFiles,
  busy,
  progress,
  error,
}: {
  onFiles: (files: FileList | File[]) => void;
  busy: boolean;
  progress: string | null;
  error: string | null;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
      }}
      className={`paper rounded-xl p-12 w-full max-w-3xl border-2 border-dashed transition-colors text-center ${
        hover ? 'border-[color:var(--color-accent)] bg-blue-50/40' : 'border-[color:var(--color-line)]'
      }`}
    >
      {busy ? (
        <div className="flex flex-col items-center gap-3 text-[color:var(--color-muted)]">
          <Loader2 className="animate-spin" size={28} />
          <span>{progress ?? '처리 중...'}</span>
        </div>
      ) : (
        <>
          <p className="text-lg mb-1">PDF를 끌어다 놓거나</p>
          <label className="inline-block mt-3 px-4 py-2 rounded-md bg-[color:var(--color-accent)] text-white cursor-pointer text-sm hover:opacity-90">
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
              }}
            />
            파일 선택
          </label>
          <p className="text-xs text-[color:var(--color-muted)] mt-4">최대 200 MB · application/pdf</p>
        </>
      )}
      {error && (
        <p className="mt-4 text-sm text-[color:var(--color-danger)]">{error}</p>
      )}
    </div>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="paper rounded-md p-3 flex items-center gap-2 text-sm text-[color:var(--color-muted)]">
      {icon}
      <span>{label}</span>
    </div>
  );
}
