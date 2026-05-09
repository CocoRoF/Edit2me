import { NextRequest, NextResponse } from 'next/server';
import { PdfDocument } from '@/pdf/parser/document';
import { registerNewDoc } from '@/lib/doc-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = (Number(process.env.EDIT2ME_MAX_UPLOAD_MB) || 200) * 1024 * 1024;

export async function POST(req: NextRequest) {
  let buf: Uint8Array;
  let name = 'document.pdf';

  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) {
        return NextResponse.json(
          { error: { code: 'no-file', message: 'file field is required' } },
          { status: 400 },
        );
      }
      if (file instanceof File) name = file.name || name;
      const arr = new Uint8Array(await file.arrayBuffer());
      buf = arr;
    } else {
      // raw application/pdf
      const arr = new Uint8Array(await req.arrayBuffer());
      buf = arr;
      const cd = req.headers.get('content-disposition') ?? '';
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/.exec(cd);
      if (match) name = decodeURIComponent(match[1]!);
    }
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'bad-request', message: String((e as Error).message) } },
      { status: 400 },
    );
  }

  if (buf.length === 0) {
    return NextResponse.json(
      { error: { code: 'empty', message: 'empty body' } },
      { status: 400 },
    );
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: 'too-large', message: `Max ${MAX_BYTES} bytes` } },
      { status: 413 },
    );
  }
  // 빠른 헤더 체크
  const headerOk = (() => {
    for (let i = 0; i < Math.min(buf.length, 1024) - 4; i += 1) {
      if (
        buf[i] === 0x25 &&
        buf[i + 1] === 0x50 &&
        buf[i + 2] === 0x44 &&
        buf[i + 3] === 0x46 &&
        buf[i + 4] === 0x2d
      ) return true;
    }
    return false;
  })();
  if (!headerOk) {
    return NextResponse.json(
      { error: { code: 'not-pdf', message: 'No %PDF- header' } },
      { status: 415 },
    );
  }

  let regResult;
  try {
    regResult = await registerNewDoc(buf, name);
  } catch (e: unknown) {
    const err = e as Error & { code?: string };
    if (err.code === 'unsupported-encrypted') {
      return NextResponse.json(
        { error: { code: 'unsupported-encrypted', message: 'Encrypted PDFs are not supported' } },
        { status: 415 },
      );
    }
    return NextResponse.json(
      { error: { code: 'parse-failed', message: err.message ?? 'Parse failed' } },
      { status: 422 },
    );
  }

  const doc = regResult.entry.doc;
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
    docId: regResult.docId,
    name,
    pageCount: pages.length,
    version: doc.version,
    encrypted: false,
    diagnostics: doc.diagnostics,
    pages,
    revision: 0,
    createdAt: new Date().toISOString(),
  });
}
