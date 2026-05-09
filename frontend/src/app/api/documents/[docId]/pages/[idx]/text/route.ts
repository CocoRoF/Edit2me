import { NextRequest, NextResponse } from 'next/server';
import { getPageText } from '@/lib/doc-cache';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ docId: string; idx: string }> },
) {
  const { docId, idx } = await ctx.params;
  const pageIndex = Number(idx);
  const got = await getPageText(docId, pageIndex);
  if (!got) {
    return NextResponse.json({ error: { code: 'doc-or-page-not-found' } }, { status: 404 });
  }
  const { entry, result } = got;
  const pages = entry.doc.getPages();
  const page = pages[pageIndex]!;
  const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
  const rotate = entry.doc.pageRotation(page.dict);

  // 폰트 진단으로 페이지 레벨 경고 합치기
  const editableMap = new Map<string, boolean>();
  for (const f of result.fontDiagnostics) {
    editableMap.set(f.name, f.hasUnicodeMap);
  }

  const blocks = result.runs.map((r) => ({
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
  }));

  // 페이지 진단: 어떤 폰트가 매핑 부족인가 — UI에 배너 가능
  const fontWarnings = result.fontDiagnostics
    .filter((f) => f.warnings.length > 0)
    .map((f) => ({ font: f.baseName, warnings: f.warnings }));

  return NextResponse.json({
    pageIndex,
    width: urx - llx,
    height: ury - lly,
    rotate,
    blocks,
    fontWarnings,
  });
}
