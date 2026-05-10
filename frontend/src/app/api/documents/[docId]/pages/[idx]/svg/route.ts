// 페이지 → SVG 렌더링 endpoint.
// 결과는 entry.svgCache 에 (revision, pageIndex) 키로 캐시됨.

import { NextRequest, NextResponse } from 'next/server';
import { getDoc } from '@/lib/doc-cache';
import { renderPageSvg } from '@/pdf/render/svg-renderer';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ docId: string; idx: string }> },
) {
  const { docId, idx } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return new Response('doc not found', { status: 404 });
  const pageIndex = Number(idx);
  const pages = entry.doc.getPages();
  const page = pages[pageIndex];
  if (!page) return new Response('page not found', { status: 404 });

  // 서버 사이드 캐시 (revision 단위)
  const cacheKey = `${entry.revision}:${pageIndex}`;
  let svg = entry.svgCache.get(cacheKey);
  if (!svg) {
    try {
      const r = renderPageSvg(entry.doc, page.dict, pageIndex);
      svg = r.svg;
      entry.svgCache.set(cacheKey, svg);
      // 메모리 보호: 페이지당 최대 ~256 entries 유지
      if (entry.svgCache.size > 256) {
        const oldest = entry.svgCache.keys().next().value;
        if (oldest) entry.svgCache.delete(oldest);
      }
    } catch (e) {
      return new Response(`render failed: ${(e as Error).message}`, { status: 500 });
    }
  }

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=600',
    },
  });
}
