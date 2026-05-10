// 페이지 → SVG. 결과는 entry.svgCache 에 (revision, pageIndex) 키로 캐시.
// 에러 시 인라인 placeholder SVG 반환 (200) — 사용자 화면이 갑자기 깨지지 않게.

import { NextRequest } from 'next/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getDoc } from '@/lib/doc-cache';
import { renderPageSvg } from '@/pdf/render/svg-renderer';

export const runtime = 'nodejs';
export const maxDuration = 60;

// dev 진단용. 컨테이너 안에서 docker exec edit2me-frontend cat /tmp/edit2me-svg/<file> 로 확인.
function dumpSvg(kind: 'page' | 'thumb', docId: string, pageIndex: number, rev: number, svg: string): void {
  try {
    mkdirSync('/tmp/edit2me-svg', { recursive: true });
    const safeDoc = docId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const path = `/tmp/edit2me-svg/${kind}-${safeDoc}-rev${rev}-p${pageIndex}.svg`;
    writeFileSync(path, svg);
    process.stdout.write(`[edit2me] ${kind} ${pageIndex} dumped → ${path}\n`);
  } catch (e) {
    process.stderr.write(`[edit2me] svg dump failed: ${(e as Error).message}\n`);
  }
}

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
  if (svg) {
    process.stdout.write(
      `[edit2me] page ${pageIndex} CACHE HIT (${svg.length} bytes, key=${cacheKey})\n`,
    );
  }
  if (!svg) {
    process.stdout.write(`[edit2me] page ${pageIndex} CACHE MISS — rendering (key=${cacheKey})\n`);
    try {
      const t0 = Date.now();
      const r = renderPageSvg(entry.doc, page.dict, pageIndex);
      svg = r.svg;
      const dt = Date.now() - t0;
      process.stdout.write(
        `[edit2me] page ${pageIndex} rendered in ${dt}ms (${svg.length} bytes${r.diagnostics.length > 0 ? `, ${r.diagnostics.length} diags` : ''})\n`,
      );
      if (r.diagnostics.length > 0) {
        process.stdout.write(
          `[edit2me] page ${pageIndex} diagnostics: ${r.diagnostics.slice(0, 10).join(' | ')}\n`,
        );
      }
      if (!svg || svg.length < 50) {
        const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
        const w = urx - llx;
        const h = ury - lly;
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/></svg>`;
        process.stderr.write(`[edit2me] page ${pageIndex} produced empty SVG\n`);
      }
      entry.svgCache.set(cacheKey, svg);
      dumpSvg('page', docId, pageIndex, entry.revision, svg);
      if (entry.svgCache.size > 256) {
        const oldest = entry.svgCache.keys().next().value;
        if (oldest) entry.svgCache.delete(oldest);
      }
    } catch (e) {
      process.stderr.write(`[edit2me] page ${pageIndex} render threw: ${(e as Error).stack ?? e}\n`);
      const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
      const w = urx - llx;
      const h = ury - lly;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fef3c7"/><text x="50%" y="50%" text-anchor="middle" font-size="${Math.min(w, h) / 24}" fill="#92400e">page ${pageIndex + 1}: ${(e as Error).message.slice(0, 100)}</text></svg>`;
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
