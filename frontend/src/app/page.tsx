'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { uploadPdf } from '@/lib/api';
import { Edit3, Plus, ArrowUpDown, Trash2, Combine, FileLock2 } from 'lucide-react';
import { DropZone } from '@/components/upload/DropZone';

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
        setProgress(`${arr.length}개 파일 업로드 준비...`);
        const docs: Array<{ docId: string; name: string; pageCount: number }> = [];
        for (let i = 0; i < arr.length; i += 1) {
          setProgress(`${i + 1} / ${arr.length} 업로드 중...`);
          const meta = await uploadPdf(arr[i]!);
          docs.push({ docId: meta.docId, name: meta.name, pageCount: meta.pageCount });
        }
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
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-4 flex items-baseline justify-between border-b border-[color:var(--color-line)]">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Edit2me</h1>
          <span className="text-xs text-[color:var(--color-muted)]">자체 엔진 PDF 편집기</span>
        </div>
        <a
          href="https://github.com/CocoRoF/Edit2me"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
        >
          GitHub →
        </a>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <section className="w-full max-w-2xl mb-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
            PDF를 브라우저에서 바로 편집
          </h2>
          <p className="text-sm text-[color:var(--color-muted)] max-w-lg mx-auto">
            텍스트 편집·페이지 재배치·병합. 외부 PDF 라이브러리 없이 자체 엔진으로 동작하며,
            업로드한 파일은 24시간 후 자동 삭제됩니다.
          </p>
        </section>

        <div className="w-full max-w-2xl">
          <DropZone onFiles={handleFiles} busy={busy} progress={progress} />
          {error && (
            <p className="mt-3 text-sm text-[color:var(--color-danger)] text-center">{error}</p>
          )}
        </div>

        <section className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl">
          <FeatureCard icon={<Edit3 size={16} />} label="텍스트 편집" />
          <FeatureCard icon={<Plus size={16} />} label="텍스트 추가" />
          <FeatureCard icon={<ArrowUpDown size={16} />} label="페이지 재배치" />
          <FeatureCard icon={<Trash2 size={16} />} label="페이지 삭제" />
        </section>

        <section className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
          <FeatureCard icon={<Combine size={16} />} label="여러 PDF 병합" hint="여러 파일 업로드" />
          <FeatureCard
            icon={<FileLock2 size={16} />}
            label="암호화 PDF 거부"
            hint="안전 정책"
            muted
          />
        </section>
      </div>

      <footer className="px-6 py-5 text-center text-xs text-[color:var(--color-muted-2)] border-t border-[color:var(--color-line)]">
        <p>외부 PDF 라이브러리를 사용하지 않는 자체 엔진. PDF 명세 ISO 32000-1을 직접 구현.</p>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  label,
  hint,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-3 flex items-center gap-3 text-sm border"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-line)',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
      >
        {icon}
      </div>
      <div className="flex flex-col">
        <span>{label}</span>
        {hint && (
          <span className="text-[11px] text-[color:var(--color-muted)]">{hint}</span>
        )}
      </div>
    </div>
  );
}
