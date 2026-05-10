// 페이지 → SVG. 결과는 entry.svgCache 에 (revision, pageIndex) 키로 캐시.
// 에러 시 인라인 placeholder SVG 반환 (200) — 사용자 화면이 갑자기 깨지지 않게.

import { NextRequest } from 'next/server';
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

  const cacheKey = `${entry.revision}:${pageIndex}`;
  let svg = entry.svgCache.get(cacheKey);
  if (!svg) {
    try {
      svg = renderPageSvg(entry.doc, page.dict, pageIndex).svg;
      entry.svgCache.set(cacheKey, svg);
      if (entry.svgCache.size > 256) {
        const oldest = entry.svgCache.keys().next().value;
        if (oldest) entry.svgCache.delete(oldest);
      }
    } catch (e) {
      const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
      const w = urx - llx;
      const h = ury - lly;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fef3c7"/><text x="50%" y="50%" text-anchor="middle" font-size="${Math.min(w, h) / 24}" fill="#92400e">page ${pageIndex + 1} render failed: ${(e as Error).message.slice(0, 100)}</text></svg>`;
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
