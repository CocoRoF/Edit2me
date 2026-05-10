'use client';

import {
  Type, Download, Loader2, FileText, Minus, Plus, Undo2, Redo2,
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

      {/* 모든 ghost 액션은 동일 사이즈 (.tb-icon = 36×36) 의 정사각 ghost icon button.
          그룹 사이는 얇은 vertical divider 로 시각 구분. Download 만 primary CTA. */}
      <div className="flex items-center gap-0.5">
        <ToolbarIcon onClick={onUndo} disabled={!canUndo} title="실행 취소 (⌘Z)">
          <Undo2 size={16} />
        </ToolbarIcon>
        <ToolbarIcon onClick={onRedo} disabled={!canRedo} title="다시 실행 (⌘⇧Z)">
          <Redo2 size={16} />
        </ToolbarIcon>
      </div>

      <ToolbarDivider />

      <ToolbarIcon
        onClick={toggleAddText}
        active={addTextMode}
        title={`${t('editor.addText')} (T)`}
      >
        <Type size={16} />
      </ToolbarIcon>

      <ToolbarDivider />

      {/* Zoom segmented control — height/border-radius 를 ghost icon 과 맞춤 */}
      <div className="hidden sm:flex items-center h-9 rounded-md border overflow-hidden"
        style={{ borderColor: 'var(--color-line)' }}>
        <button
          onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
          className="h-full px-2 inline-flex items-center hover:bg-[color:var(--color-surface-2)] text-[color:var(--color-muted)]"
          aria-label="Zoom out"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={resetZoom}
          className="h-full px-2 text-xs w-14 inline-flex items-center justify-center hover:bg-[color:var(--color-surface-2)] border-x"
          style={{ borderColor: 'var(--color-line)' }}
          title="100% 로 (⌘0)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoom(Math.min(3, zoom + 0.1))}
          className="h-full px-2 inline-flex items-center hover:bg-[color:var(--color-surface-2)] text-[color:var(--color-muted)]"
          aria-label="Zoom in"
        >
          <Plus size={14} />
        </button>
      </div>

      <ToolbarDivider />

      {diagnosticCount > 0 && (
        <ToolbarIcon
          onClick={onOpenDiagnostics}
          title={`${diagnosticCount}개의 진단`}
          className="relative"
        >
          <AlertTriangle size={16} className="text-[color:var(--color-warn)]" />
          <span
            className="absolute -top-0.5 -right-0.5 text-[10px] rounded-full px-1.5 py-px"
            style={{ background: 'var(--color-warn)', color: '#0b1020' }}
          >
            {diagnosticCount}
          </span>
        </ToolbarIcon>
      )}

      <ToolbarIcon onClick={onOpenHelp} title={t('editor.help')} className="hidden sm:inline-flex">
        <HelpCircle size={16} />
      </ToolbarIcon>

      <span className="hidden md:inline-flex">
        <LocaleToggle />
      </span>

      <button onClick={onDownload} disabled={downloading} className="btn btn-primary h-9">
        {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        <span className="hidden sm:inline">{t('editor.download')}</span>
        <span className="hidden md:inline"><Kbd>⌘S</Kbd></span>
      </button>
    </header>
  );
}

// 36×36 정사각 ghost icon button — toolbar 의 모든 단순 액션 통일.
// active=true 면 accent 배경/색상으로 토글 상태 표시.
function ToolbarIcon({
  children, onClick, disabled, title, active, className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-9 w-9 inline-flex items-center justify-center rounded-md transition-colors ${className}`}
      style={{
        background: active ? 'var(--color-accent-soft)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-muted)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (disabled || active) return;
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface-2)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-ink)';
      }}
      onMouseLeave={(e) => {
        if (disabled || active) return;
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-muted)';
      }}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="hidden sm:inline-block w-px h-5 mx-1" style={{ background: 'var(--color-line)' }} />;
}
