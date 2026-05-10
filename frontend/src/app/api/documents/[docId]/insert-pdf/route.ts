// 다른 PDF 의 페이지를 현재 doc 에 insert. multipart 로 source PDF 업로드.
//
// 구현: mergePdfs 를 재사용해 [기존 0..insertAt-1] + [업로드 전체 페이지]
// + [기존 insertAt..end] 순서로 새 byte 배열 생성 → replaceDocBytes 로 현재
// docId 에 덮어쓰기. 한계: undo 히스토리가 reset 됨. 향후 op-replay 모델로 진정한
// undo 지원 필요.

import { NextRequest, NextResponse } from 'next/server';
import { getDoc, replaceDocBytes } from '@/lib/doc-cache';
import { mergePdfs, type MergeSpec } from '@/pdf/ops/merge';
import { PdfDocument } from '@/pdf/parser/document';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: { code: 'op-invalid', message: 'multipart required' } }, { status: 400 });
  }
  const file = form.get('file');
  const insertAtRaw = form.get('insertAt');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: { code: 'op-invalid', message: 'file required' } }, { status: 400 });
  }
  const insertAt = Math.max(0, Number(insertAtRaw ?? 0) | 0);

  const buf = new Uint8Array(await file.arrayBuffer());
  let srcDoc: PdfDocument;
  try {
    srcDoc = PdfDocument.open(buf);
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'pdf-parse-failed', message: (e as Error).message } },
      { status: 422 },
    );
  }

  const curCount = entry.doc.pageCount();
  const srcCount = srcDoc.pageCount();
  if (srcCount === 0) {
    return NextResponse.json({ error: { code: 'op-invalid', message: 'source has no pages' } }, { status: 400 });
  }
  const at = Math.min(curCount, insertAt);

  // specs: [현재 doc 의 0..at-1 페이지] + [source 의 모든 페이지] + [현재 doc 의 at..end]
  const specs: MergeSpec[] = [];
  for (let i = 0; i < at; i += 1) specs.push({ source: 0, pageIndex: i });
  for (let i = 0; i < srcCount; i += 1) specs.push({ source: 1, pageIndex: i });
  for (let i = at; i < curCount; i += 1) specs.push({ source: 0, pageIndex: i });

  let merged: Uint8Array;
  try {
    merged = mergePdfs([entry.doc, srcDoc], specs);
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'merge-failed', message: (e as Error).message } },
      { status: 422 },
    );
  }

  const newEntry = await replaceDocBytes(docId, merged);
  if (!newEntry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });

  const pages = newEntry.doc.getPages().map((p, i) => {
    const [llx, lly, urx, ury] = newEntry.doc.pageMediaBox(p.dict);
    return {
      index: i,
      width: urx - llx,
      height: ury - lly,
      rotate: newEntry.doc.pageRotation(p.dict),
    };
  });

  process.stdout.write(
    `[edit2me] insert-pdf docId=${docId.slice(0, 8)} src=${srcCount}p insertAt=${at} → total=${pages.length}p\n`,
  );

  return NextResponse.json({
    revision: newEntry.revision,
    pageCount: pages.length,
    pages,
    canUndo: false,
    canRedo: false,
    /** 새로 삽입된 페이지의 첫 인덱스 — frontend 가 그 페이지로 scroll */
    insertedFirstIndex: at,
    insertedCount: srcCount,
  });
}
