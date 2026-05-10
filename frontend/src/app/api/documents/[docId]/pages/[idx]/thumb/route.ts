// 페이지 썸네일.
// 현재는 SVG renderer 의 결과를 그대로 보냄. 브라우저에서 작은 사이즈로 표시되므로
// raster 변환 불필요.

import { NextRequest } from 'next/server';
import { getDoc } from '@/lib/doc-cache';
import { renderPageSvg } from '@/pdf/render/svg-renderer';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ docId: string; idx: string }> },
) {
  const { docId, idx } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return new Response('Not found', { status: 404 });
  const pageIndex = Number(idx);
  const page = entry.doc.getPages()[pageIndex];
  if (!page) return new Response('Page not found', { status: 404 });

  const cacheKey = `thumb:${entry.revision}:${pageIndex}`;
  let svg = entry.svgCache.get(cacheKey);
  if (!svg) {
    try {
      const r = renderPageSvg(entry.doc, page.dict, pageIndex);
      svg = r.svg;
      entry.svgCache.set(cacheKey, svg);
    } catch (e) {
      // 렌더 실패 시 빈 placeholder
      const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
      const w = urx - llx;
      const h = ury - lly;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" text-anchor="middle" font-size="${h / 20}" fill="#9ca3af">render error</text></svg>`;
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
