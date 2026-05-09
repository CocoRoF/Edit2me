'use client';

import {
  Plus, Download, Loader2, FileText, Minus, ZoomIn, Undo2, Redo2,
  HelpCircle, AlertTriangle, Menu,
} from 'lucide-react';
import { Kbd } from '@/components/ui/Kbd';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { useI18n } from '@/lib/i18n/context';

interface Props {
  docName: string;
  pageCount: number;
  zoom: number;
  setZoom: (z: number) => void;
  resetZoom: () => void;
  addTextMode: boolean;
  toggleAddText: () => void;
  onDownload: () => void;
  downloading: boolean;
  modified: boolean;
  onHome: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  diagnosticCount: number;
  onOpenDiagnostics: () => void;
  onOpenHelp: () => void;
  /** 모바일에서 sidebar drawer 열기 */
  onToggleSidebar?: () => void;
}

export function Toolbar({
  docName,
  pageCount,
  zoom,
  setZoom,
  resetZoom,
  addTextMode,
  toggleAddText,
  onDownload,
  downloading,
  modified,
  onHome,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  diagnosticCount,
  onOpenDiagnostics,
  onOpenHelp,
  onToggleSidebar,
}: Props) {
  const { t } = useI18n();
  return (
    <header
      className="h-14 flex items-center px-2 sm:px-3 gap-1.5 sm:gap-2 shrink-0 border-b"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-line)' }}
    >
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="btn btn-ghost btn-icon md:hidden"
          aria-label="페이지 목록"
        >
          <Menu size={18} />
        </button>
      )}

      <button
        onClick={onHome}
        className="hidden sm:flex items-center gap-2 px-2 py-1 rounded hover:bg-[color:var(--color-surface-2)]"
      >
        <span className="text-sm font-semibold">Edit2me</span>
      </button>

      <span className="hidden sm:inline mx-1 text-[color:var(--color-line-strong)]">/</span>

      <FileText size={14} className="hidden sm:inline text-[color:var(--color-muted)]" />
      <span className="text-sm truncate max-w-[40vw] sm:max-w-xs" title={docName}>
        {docName}
      </span>
      <span className="hidden sm:inline text-xs text-[color:var(--color-muted)]">{pageCount}p</span>
      <span
        className="hidden sm:inline text-xs px-1.5 py-0.5 rounded"
        style={{
          background: modified ? 'var(--color-accent-soft)' : 'transparent',
          color: modified ? 'var(--color-accent)' : 'var(--color-muted)',
        }}
      >
        {modified ? t('editor.modified') : t('editor.saved')}
      </span>

      <div className="flex-1" />

      <div className="flex items-stretch gap-0.5">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="btn btn-ghost btn-icon"
          title="실행 취소 (⌘Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="btn btn-ghost btn-icon"
          title="다시 실행 (⌘⇧Z)"
        >
          <Redo2 size={16} />
        </button>
      </div>

      <button
        onClick={toggleAddText}
        className={addTextMode ? 'btn btn-primary' : 'btn'}
        title={t('editor.addText')}
      >
        <Plus size={16} />
        <span className="hidden sm:inline">{t('editor.addText')}</span>
        <span className="hidden md:inline"><Kbd>T</Kbd></span>
      </button>

      <div
        className="hidden sm:flex items-stretch border rounded overflow-hidden"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <button
          className="px-2 hover:bg-[color:var(--color-surface-2)]"
          onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
          aria-label="Zoom out"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={resetZoom}
          className="px-2 text-xs w-14 text-center hover:bg-[color:var(--color-surface-2)]"
          title="100% 로 (⌘0)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="px-2 hover:bg-[color:var(--color-surface-2)]"
          onClick={() => setZoom(Math.min(3, zoom + 0.1))}
          aria-label="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
      </div>

      {diagnosticCount > 0 && (
        <button
          onClick={onOpenDiagnostics}
          className="btn btn-ghost btn-icon relative"
          title={`${diagnosticCount}개의 진단`}
        >
          <AlertTriangle size={16} className="text-[color:var(--color-warn)]" />
          <span
            className="absolute -top-0.5 -right-0.5 text-[10px] rounded-full px-1.5 py-px"
            style={{ background: 'var(--color-warn)', color: '#0b1020' }}
          >
            {diagnosticCount}
          </span>
        </button>
      )}

      <button
        onClick={onOpenHelp}
        className="hidden sm:inline-flex btn btn-ghost btn-icon"
        title={t('editor.help')}
      >
        <HelpCircle size={16} />
      </button>

      <span className="hidden md:inline-flex">
        <LocaleToggle />
      </span>

      <button onClick={onDownload} disabled={downloading} className="btn btn-primary">
        {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        <span className="hidden sm:inline">{t('editor.download')}</span>
        <span className="hidden md:inline"><Kbd>⌘S</Kbd></span>
      </button>
    </header>
  );
}
