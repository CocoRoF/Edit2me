// Phase 1 썸네일: 페이지 비율 + 첫 5개 텍스트 블록을 SVG로.

import { NextRequest } from 'next/server';
import { getDoc } from '@/lib/doc-cache';
import { extractTextFromPage } from '@/pdf/graphics/text-extract';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ docId: string; idx: string }> },
) {
  const { docId, idx } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return new Response('Not found', { status: 404 });
  const pageIndex = Number(idx);
  const page = entry.doc.getPages()[pageIndex];
  if (!page) return new Response('Page not found', { status: 404 });

  const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
  const w = urx - llx;
  const h = ury - lly;

  // 텍스트 추출 — 일부만
  let runs: ReturnType<typeof extractTextFromPage> = [];
  try {
    runs = extractTextFromPage(entry.doc, page.dict, pageIndex);
  } catch {
    /* ignore */
  }

  const targetW = Number(req.nextUrl.searchParams.get('w')) || 200;
  const scale = targetW / w;

  let textSvg = '';
  for (const r of runs.slice(0, 8)) {
    const x = (r.x - llx) * scale;
    const y = (ury - r.y - r.height) * scale;
    const fs = r.fontSize * scale;
    if (fs < 2) continue;
    const safe = r.text.slice(0, 40).replace(/[<&>]/g, '');
    textSvg += `<text x="${x.toFixed(2)}" y="${(y + fs * 0.85).toFixed(2)}" font-size="${fs.toFixed(2)}" font-family="sans-serif" fill="#222">${safe}</text>`;
  }

  const targetH = h * scale;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW.toFixed(0)}" height="${targetH.toFixed(0)}" viewBox="0 0 ${targetW.toFixed(2)} ${targetH.toFixed(2)}">` +
    `<rect width="100%" height="100%" fill="white" stroke="#d4d4d4" stroke-width="1"/>` +
    textSvg +
    `</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=600',
    },
  });
}
