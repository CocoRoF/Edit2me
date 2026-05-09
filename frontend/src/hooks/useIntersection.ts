'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * IntersectionObserver 기반 가시성 훅.
 * rootMargin 으로 prefetch 영역 확장 가능.
 */
export function useIntersection<T extends HTMLElement>(
  rootMargin = '300px',
  threshold: number | number[] = 0.01,
): readonly [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // SSR 또는 매우 옛 브라우저 — 항상 보이는 것으로 처리.
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setInView(entry.isIntersecting);
      },
      { rootMargin, threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin, threshold]);

  return [ref, inView] as const;
}
