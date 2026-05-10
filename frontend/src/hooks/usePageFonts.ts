'use client';

// PDF 의 임베디드 폰트들을 fetch 해 document.fonts API 또는 @font-face 규칙으로
// 등록. 편집 박스가 PDF 와 동일한 폰트로 텍스트를 렌더하기 위함.
//
// 페이지마다 폰트가 다를 수 있으므로 page 단위로 캐시 (key = docId:pageIndex:revision).

import { useEffect, useState } from 'react';
import { getPageFonts, type PageFont } from '@/lib/api';

const fontFamilyForKey = (docId: string, pageIndex: number, resourceName: string): string =>
  `pdfFont-${docId.slice(0, 12)}-p${pageIndex}-${resourceName.replace(/[^A-Za-z0-9]/g, '_')}`;

// 등록된 (docId|pageIndex|resourceName) 조합 — 중복 등록 방지.
const registered = new Set<string>();

export interface UsePageFontsResult {
  /** 등록된 폰트들. 편집 박스의 fontFamily 후보로 사용. */
  fonts: Array<{ font: PageFont; family: string }>;
}

export function usePageFonts(
  docId: string,
  pageIndex: number,
  revision: number,
  enabled: boolean = true,
): UsePageFontsResult {
  const [fonts, setFonts] = useState<UsePageFontsResult['fonts']>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const list = await getPageFonts(docId, pageIndex);
      if (cancelled) return;
      const out: UsePageFontsResult['fonts'] = [];
      for (const f of list) {
        const family = fontFamilyForKey(docId, pageIndex, f.resourceName);
        const key = `${docId}|${pageIndex}|${f.resourceName}|${revision}`;
        if (!registered.has(key)) {
          registered.add(key);
          try {
            // FontFace API 가 있으면 우선 (Next.js + 모던 브라우저).
            // 없으면 fallback: <style> 노드에 @font-face rule 삽입.
            if (typeof FontFace !== 'undefined' && document.fonts) {
              const ff = new FontFace(family, `url(${f.dataUrl})`, {
                style: 'normal',
                weight: 'normal',
                display: 'block',
              });
              await ff.load();
              document.fonts.add(ff);
            } else {
              const style = document.createElement('style');
              style.textContent = `@font-face { font-family: '${family}'; src: url(${f.dataUrl}) format('truetype'); font-display: block; }`;
              document.head.appendChild(style);
            }
          } catch (e) {
            // 등록 실패 → fallback (시스템 폰트). 사용자에게 silent.
          }
        }
        out.push({ font: f, family });
      }
      if (!cancelled) setFonts(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, pageIndex, revision, enabled]);

  return { fonts };
}
