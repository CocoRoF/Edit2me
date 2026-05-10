import { NextRequest, NextResponse } from 'next/server';
import { getDoc, listUploadedFonts, uploadFont } from '@/lib/doc-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FONT_BYTES = 30 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  const ct = req.headers.get('content-type') ?? '';
  let bytes: Uint8Array;
  let displayName = 'font.ttf';
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
      if (file instanceof File) displayName = file.name || displayName;
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      bytes = new Uint8Array(await req.arrayBuffer());
    }
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'bad-request', message: (e as Error).message } },
      { status: 400 },
    );
  }
  if (bytes.length === 0) {
    return NextResponse.json({ error: { code: 'empty' } }, { status: 400 });
  }
  if (bytes.length > MAX_FONT_BYTES) {
    return NextResponse.json(
      { error: { code: 'too-large', message: `Max ${MAX_FONT_BYTES} bytes` } },
      { status: 413 },
    );
  }
  try {
    const result = await uploadFont(docId, bytes, displayName);
    if (!result) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
    return NextResponse.json({ uploadId: result.uploadId, displayName, ...result.sample });
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'ttf-parse-failed', message: (e as Error).message } },
      { status: 422 },
    );
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
  return NextResponse.json({ fonts: listUploadedFonts(entry) });
}
