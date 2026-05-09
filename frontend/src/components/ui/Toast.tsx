'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

type ToastKind = 'error' | 'warn' | 'success' | 'info';
interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (kind: ToastKind, message: string, opts?: { ttl?: number }) => void;
  error: (m: string) => void;
  warn: (m: string) => void;
  success: (m: string) => void;
  info: (m: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: string) => {
    setItems((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (kind, message, opts) => {
      const id = `t${idRef.current++}`;
      setItems((cur) => [...cur, { id, kind, message }]);
      const ttl = opts?.ttl ?? (kind === 'error' ? 8000 : 4000);
      setTimeout(() => remove(id), ttl);
    },
    [remove],
  );

  const api: ToastApi = {
    show,
    error: (m) => show('error', m),
    warn: (m) => show('warn', m),
    success: (m) => show('success', m),
    info: (m) => show('info', m),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none w-80 max-w-[calc(100vw-2rem)]">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const Icon =
    item.kind === 'error'
      ? AlertCircle
      : item.kind === 'warn'
        ? AlertTriangle
        : item.kind === 'success'
          ? CheckCircle2
          : AlertCircle;
  const cls =
    item.kind === 'error'
      ? 'toast toast-error'
      : item.kind === 'warn'
        ? 'toast toast-warn'
        : item.kind === 'success'
          ? 'toast toast-success'
          : 'toast';
  const iconColor =
    item.kind === 'error'
      ? 'text-[color:var(--color-danger)]'
      : item.kind === 'warn'
        ? 'text-[color:var(--color-warn)]'
        : item.kind === 'success'
          ? 'text-[color:var(--color-success)]'
          : 'text-[color:var(--color-accent)]';
  return (
    <div className={`${cls} flex items-start gap-3 pointer-events-auto`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${iconColor}`} />
      <span className="flex-1 break-words">{item.message}</span>
      <button
        className="text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}
