// Batch text endpoint:
//   GET /api/documents/{id}/pages/text?pages=0,1,2  → 지정 페이지들
//   GET /api/documents/{id}/pages/text?range=0-9    → 인덱스 범위
//   GET /api/documents/{id}/pages/text              → 모든 페이지 (큰 PDF 주의)

import { NextRequest, NextResponse } from 'next/server';
import { getDoc, getPageText } from '@/lib/doc-cache';
import { groupRuns } from '@/pdf/graphics/text-group';

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
      blockIds: string[];
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
    // 시각 단위로 grouping: 같은 baseline + 같은 폰트 + 인접 segment → 하나의 박스.
    // 사용자에게 "한 줄짜리 단어/구절" 이 한 box 로 보이고, 그룹 단위 편집.
    const groups = groupRuns(result.runs);
    out.push({
      pageIndex: i,
      width: urx - llx,
      height: ury - lly,
      rotate: entry.doc.pageRotation(page.dict),
      blocks: groups.map((g) => ({
        // 그룹의 primary id 가 blockId 가 됨. 편집 commit 시 backend 가 blockIds 로 group edit.
        blockId: g.groupId,
        blockIds: g.blockIds,
        text: g.text,
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        fontBaseName: g.fontBaseName,
        fontSize: g.fontSize,
        isComposite: g.isComposite,
        fullyDecoded: g.fullyDecoded,
        // 편집 가능 = 그룹 내부 모두 디코드 가능 + 폰트 인코딩 가능 + 같은 op (group-edit OK).
        editable: g.fullyDecoded && g.fontEncodable && g.groupEditable,
      })),
      fontWarnings: result.fontDiagnostics
        .filter((f) => f.warnings.length > 0)
        .map((f) => ({ font: f.baseName, warnings: f.warnings })),
    });
  }

  return NextResponse.json({ pages: out, revision: entry.revision });
}
