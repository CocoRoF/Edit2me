'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { listFonts, uploadFont, type UploadedFontMeta } from '@/lib/api';

const CORE_FONTS = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Courier',
  'Courier-Bold',
] as const;

type CoreFont = (typeof CORE_FONTS)[number];

interface Props {
  docId: string;
  pageIndex: number;
  x: number;
  y: number;
  onCancel: () => void;
  onConfirm: (params: {
    pageIndex: number;
    x: number;
    y: number;
    text: string;
    /** core 14 이름 또는 { kind: 'ttf', uploadId } */
    font: CoreFont | { kind: 'ttf'; uploadId: string };
    fontSize: number;
    color: { r: number; g: number; b: number };
  }) => void;
}

export function AddTextDialog({ docId, pageIndex, x, y, onCancel, onConfirm }: Props) {
  const [text, setText] = useState('');
  const [fontKey, setFontKey] = useState<string>('Helvetica'); // 'Helvetica' or 'ttf:<uploadId>'
  const [fontSize, setFontSize] = useState(12);
  const [color, setColor] = useState('#000000');
  const [uploaded, setUploaded] = useState<UploadedFontMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listFonts(docId).then(setUploaded).catch(() => {});
  }, [docId]);

  async function handleUpload(f: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const meta = await uploadFont(docId, f);
      setUploaded((cur) => [...cur, meta]);
      setFontKey(`ttf:${meta.uploadId}`);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    if (!text.trim()) return;
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    let font: CoreFont | { kind: 'ttf'; uploadId: string };
    if (fontKey.startsWith('ttf:')) {
      font = { kind: 'ttf', uploadId: fontKey.slice(4) };
    } else {
      font = fontKey as CoreFont;
    }
    onConfirm({ pageIndex, x, y, text, font, fontSize, color: { r, g, b } });
  }

  const isTtf = fontKey.startsWith('ttf:');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg p-5 w-[460px] max-w-[calc(100vw-2rem)]"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-line)',
          boxShadow: 'var(--shadow-pop)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-medium mb-1">텍스트 추가</h2>
        <p className="text-xs text-[color:var(--color-muted)] mb-3">
          페이지 {pageIndex + 1} · ({x.toFixed(0)}, {y.toFixed(0)})
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isTtf ? '한글 등 어떤 문자든 입력 가능' : '한글이 필요하면 폰트 업로드'}
          className="w-full h-24 rounded p-2.5 text-sm resize-y"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-line)',
            color: 'var(--color-ink)',
            fontFamily: isTtf
              ? '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif'
              : 'monospace',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="flex items-center gap-2 mt-3 text-sm flex-wrap">
          <select
            value={fontKey}
            onChange={(e) => setFontKey(e.target.value)}
            className="rounded px-2 py-1.5 max-w-[180px]"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              color: 'var(--color-ink)',
            }}
          >
            <optgroup label="Core 14">
              {CORE_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </optgroup>
            {uploaded.length > 0 && (
              <optgroup label="업로드한 폰트">
                {uploaded.map((u) => (
                  <option key={u.uploadId} value={`ttf:${u.uploadId}`}>
                    {u.displayName}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="rounded px-2 py-1.5"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              color: 'var(--color-ink)',
            }}
          >
            {[8, 10, 12, 14, 16, 20, 24, 36, 48].map((s) => (
              <option key={s} value={s}>
                {s}pt
              </option>
            ))}
          </select>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-9 rounded cursor-pointer"
            style={{ border: '1px solid var(--color-line)' }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn btn-ghost text-xs"
            title="TTF 폰트 업로드 (한글 등을 추가 시)"
          >
            <Upload size={14} />
            <span>{uploading ? '업로드 중…' : 'TTF 추가'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf,application/font-sfnt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
        </div>
        {uploadError && (
          <p className="mt-2 text-xs text-[color:var(--color-danger)]">{uploadError}</p>
        )}
        {!isTtf && /[가-힣　-鿿]/.test(text) && (
          <p className="mt-2 text-xs text-[color:var(--color-warn)]">
            ⚠ Core 14 폰트는 CJK 표시 불가입니다. 위 "TTF 추가" 로 한글 폰트를 업로드하세요.
          </p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="btn">
            취소
          </button>
          <button onClick={submit} disabled={!text.trim()} className="btn btn-primary">
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
