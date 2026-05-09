'use client';

import { useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';

export function DropZone({
  onFiles,
  busy,
  progress,
}: {
  onFiles: (files: FileList | File[]) => void;
  busy: boolean;
  progress: string | null;
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
      className="rounded-xl p-12 w-full border-2 border-dashed transition-colors text-center"
      style={{
        background: hover ? 'var(--color-accent-soft)' : 'var(--color-surface)',
        borderColor: hover ? 'var(--color-accent)' : 'var(--color-line)',
      }}
    >
      {busy ? (
        <div className="flex flex-col items-center gap-3 text-[color:var(--color-muted)]">
          <Loader2 className="animate-spin" size={36} />
          <span className="text-sm">{progress ?? '처리 중...'}</span>
        </div>
      ) : (
        <>
          <div className="flex justify-center mb-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: 'var(--color-accent-soft)' }}
            >
              <Upload size={24} className="text-[color:var(--color-accent)]" />
            </div>
          </div>
          <p className="text-base mb-1">PDF를 끌어다 놓거나</p>
          <p className="text-xs text-[color:var(--color-muted)] mb-4">
            여러 파일을 한 번에 올리면 병합 모드로 진입합니다
          </p>
          <label className="btn btn-primary inline-flex cursor-pointer">
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
          <p className="text-xs text-[color:var(--color-muted-2)] mt-5">
            최대 200 MB · application/pdf
          </p>
        </>
      )}
    </div>
  );
}
