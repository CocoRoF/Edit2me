import { NextRequest, NextResponse } from 'next/server';
import { getDoc, registerNewDoc } from '@/lib/doc-cache';
import { mergePdfs, MergeSpec } from '@/pdf/ops/merge';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface MergeBody {
  sources: Array<{ docId: string }>;
  pages: Array<{ source: number; pageIndex: number; rotation?: 0 | 90 | 180 | 270 }>;
  name?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as MergeBody;
  if (!body.sources?.length || !body.pages?.length) {
    return NextResponse.json({ error: { code: 'op-invalid' } }, { status: 400 });
  }
  const docs = [];
  for (const s of body.sources) {
    const e = await getDoc(s.docId);
    if (!e) {
      return NextResponse.json(
        { error: { code: 'doc-not-found', source: s.docId } },
        { status: 404 },
      );
    }
    docs.push(e.doc);
  }
  let bytes: Uint8Array;
  try {
    bytes = mergePdfs(docs, body.pages as MergeSpec[]);
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'merge-failed', message: (e as Error).message } },
      { status: 422 },
    );
  }
  // 결과를 새 docId로 등록
  const reg = await registerNewDoc(bytes, body.name ?? 'merged.pdf');
  const doc = reg.entry.doc;
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
    docId: reg.docId,
    name: body.name ?? 'merged.pdf',
    pageCount: pages.length,
    version: doc.version,
    pages,
    revision: 0,
  });
}
