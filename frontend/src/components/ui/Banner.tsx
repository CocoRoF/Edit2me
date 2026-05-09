'use client';

import { Info, AlertTriangle, AlertCircle, X } from 'lucide-react';
import { useState } from 'react';

export function Banner({
  kind = 'info',
  children,
  dismissible = true,
}: {
  kind?: 'info' | 'warn' | 'error';
  children: React.ReactNode;
  dismissible?: boolean;
}) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  const Icon = kind === 'error' ? AlertCircle : kind === 'warn' ? AlertTriangle : Info;
  const cls = kind === 'error' ? 'banner banner-error' : kind === 'warn' ? 'banner banner-warn' : 'banner banner-info';
  return (
    <div className={cls}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
      {dismissible && (
        <button
          onClick={() => setClosed(true)}
          aria-label="Dismiss"
          className="text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
