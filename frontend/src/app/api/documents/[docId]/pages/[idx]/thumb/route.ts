// Thumbnail = full page SVG (browser 가 작게 표시). 단일 cache 사용.

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

  const cacheKey = `${entry.revision}:${pageIndex}`;
  let svg = entry.svgCache.get(cacheKey);
  if (svg) {
    process.stdout.write(
      `[edit2me] thumb ${pageIndex} CACHE HIT (${svg.length} bytes, key=${cacheKey})\n`,
    );
  }
  if (!svg) {
    process.stdout.write(`[edit2me] thumb ${pageIndex} CACHE MISS — rendering (key=${cacheKey})\n`);
    try {
      const t0 = Date.now();
      const r = renderPageSvg(entry.doc, page.dict, pageIndex);
      svg = r.svg;
      process.stdout.write(
        `[edit2me] thumb ${pageIndex} rendered in ${Date.now() - t0}ms (${svg.length} bytes${r.diagnostics.length > 0 ? `, ${r.diagnostics.length} diags` : ''})\n`,
      );
      if (!svg || svg.length < 50) {
        const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
        const w = urx - llx;
        const h = ury - lly;
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/></svg>`;
      }
      entry.svgCache.set(cacheKey, svg);
    } catch (e) {
      process.stderr.write(`[edit2me] thumb page ${pageIndex} threw: ${(e as Error).stack ?? e}\n`);
      const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
      const w = urx - llx;
      const h = ury - lly;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" text-anchor="middle" font-size="${h / 20}" fill="#9ca3af">${(e as Error).message.slice(0, 80)}</text></svg>`;
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
