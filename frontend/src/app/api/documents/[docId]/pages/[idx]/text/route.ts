import { NextRequest, NextResponse } from 'next/server';
import { getDoc } from '@/lib/doc-cache';
import { extractTextFromPage } from '@/pdf/graphics/text-extract';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ docId: string; idx: string }> },
) {
  const { docId, idx } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
  const pageIndex = Number(idx);
  const pages = entry.doc.getPages();
  const page = pages[pageIndex];
  if (!page) return NextResponse.json({ error: { code: 'page-not-found' } }, { status: 404 });

  const runs = extractTextFromPage(entry.doc, page.dict, pageIndex);
  const [llx, lly, urx, ury] = entry.doc.pageMediaBox(page.dict);
  const blocks = runs.map((r) => ({
    blockId: r.blockId,
    text: r.text,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    fontBaseName: r.fontBaseName,
    fontSize: r.fontSize,
    isCJK: r.isCJK,
    fullyDecoded: r.fullyDecoded,
    editable: r.fullyDecoded && !r.isCJK,
  }));
  return NextResponse.json({
    pageIndex,
    width: urx - llx,
    height: ury - lly,
    rotate: entry.doc.pageRotation(page.dict),
    blocks,
  });
}
