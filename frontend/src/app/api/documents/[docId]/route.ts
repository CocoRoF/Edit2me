import { NextRequest, NextResponse } from 'next/server';
import { disposeDoc, entryUndoState, getDoc } from '@/lib/doc-cache';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
  const doc = entry.doc;
  const pages = doc.getPages().map((p, i) => {
    const [llx, lly, urx, ury] = doc.pageMediaBox(p.dict);
    return {
      index: i,
      width: urx - llx,
      height: ury - lly,
      rotate: doc.pageRotation(p.dict),
    };
  });
  return NextResponse.json({
    docId,
    name: entry.name,
    pageCount: pages.length,
    version: doc.version,
    diagnostics: doc.diagnostics,
    pages,
    revision: entry.revision,
    ...entryUndoState(entry),
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  await disposeDoc(docId);
  return new NextResponse(null, { status: 204 });
}
