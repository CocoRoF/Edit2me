// Batch text endpoint:
//   GET /api/documents/{id}/pages/text?pages=0,1,2  → 지정 페이지들
//   GET /api/documents/{id}/pages/text?range=0-9    → 인덱스 범위
//   GET /api/documents/{id}/pages/text              → 모든 페이지 (큰 PDF 주의)

import { NextRequest, NextResponse } from 'next/server';
import { getDoc, getPageText } from '@/lib/doc-cache';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });

  const totalPages = entry.doc.pageCount();
  const params = req.nextUrl.searchParams;
  const pagesParam = params.get('pages');
  const rangeParam = params.get('range');

  let indices: number[];
  if (pagesParam) {
    indices = pagesParam
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n < totalPages);
  } else if (rangeParam) {
    const m = /^(\d+)-(\d+)$/.exec(rangeParam.trim());
    if (!m) return NextResponse.json({ error: { code: 'bad-range' } }, { status: 400 });
    const lo = Math.max(0, parseInt(m[1]!, 10));
    const hi = Math.min(totalPages - 1, parseInt(m[2]!, 10));
    indices = [];
    for (let i = lo; i <= hi; i += 1) indices.push(i);
  } else {
    indices = [];
    for (let i = 0; i < totalPages; i += 1) indices.push(i);
  }

  // 페이지마다 캐시된 추출 결과를 모아서 반환. (이 호출은 직렬 — Node 단일 스레드)
  const out: Array<{
    pageIndex: number;
    width: number;
    height: number;
    rotate: number;
    blocks: Array<{
      blockId: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fontBaseName: string;
      fontSize: number;
      isComposite: boolean;
      fullyDecoded: boolean;
      editable: boolean;
    }>;
    fontWarnings: Array<{ font: string; warnings: string[] }>;
  }> = [];

  for (const i of indices) {
    const got = await getPageText(docId, i);
    if (!got) continue;
    const { result } = got;
    const pages = entry.doc.getPages();
    const page = pages[i]!;
    const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
    out.push({
      pageIndex: i,
      width: urx - llx,
      height: ury - lly,
      rotate: entry.doc.pageRotation(page.dict),
      blocks: result.runs.map((r) => ({
        blockId: r.blockId,
        text: r.text,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        fontBaseName: r.fontBaseName,
        fontSize: r.fontSize,
        isComposite: r.isComposite,
        fullyDecoded: r.fullyDecoded,
        editable: r.fullyDecoded && !r.isComposite,
      })),
      fontWarnings: result.fontDiagnostics
        .filter((f) => f.warnings.length > 0)
        .map((f) => ({ font: f.baseName, warnings: f.warnings })),
    });
  }

  return NextResponse.json({ pages: out, revision: entry.revision });
}
