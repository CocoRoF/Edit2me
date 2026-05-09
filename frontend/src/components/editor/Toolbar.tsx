'use client';

import { Type, Plus, Download, Loader2, Undo2 } from 'lucide-react';

interface Props {
  docName: string;
  pageCount: number;
  zoom: number;
  setZoom: (z: number) => void;
  addTextMode: boolean;
  toggleAddText: () => void;
  onDownload: () => void;
  downloading: boolean;
  modified: boolean;
}

export function Toolbar({
  docName,
  pageCount,
  zoom,
  setZoom,
  addTextMode,
  toggleAddText,
  onDownload,
  downloading,
  modified,
}: Props) {
  return (
    <header className="h-12 border-b border-[color:var(--color-line)] flex items-center px-3 gap-3 bg-[color:var(--color-paper)]">
      <span className="text-sm font-medium truncate" title={docName}>
        {docName}
      </span>
      <span className="text-xs text-[color:var(--color-muted)]">{pageCount} 페이지</span>
      <span className="text-xs text-[color:var(--color-muted)]">
        {modified ? '· 변경됨' : '· 저장됨'}
      </span>
      <div className="flex-1" />

      <button
        onClick={toggleAddText}
        className={`flex items-center gap-1 text-sm px-2 py-1 rounded ${
          addTextMode
            ? 'bg-[color:var(--color-accent)] text-white'
            : 'hover:bg-gray-100'
        }`}
        title="텍스트 추가 (T)"
      >
        <Plus size={16} />
        <span>텍스트</span>
      </button>

      <div className="flex items-center gap-1 border rounded text-sm">
        <button className="px-2 py-1 hover:bg-gray-100" onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}>−</button>
        <span className="px-1 text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button className="px-2 py-1 hover:bg-gray-100" onClick={() => setZoom(Math.min(3, zoom + 0.1))}>+</button>
      </div>

      <button
        onClick={onDownload}
        disabled={downloading}
        className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-[color:var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
      >
        {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        <span>다운로드</span>
      </button>
    </header>
  );
}
