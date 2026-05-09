import { NextRequest, NextResponse } from 'next/server';
import { getDoc, issueDownloadToken } from '@/lib/doc-cache';
import { serializeIncremental } from '@/pdf/writer/incremental';
import { serializeFull } from '@/pdf/writer/full';
import { putResult } from '@/pdf/store/minio';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });

  let body: { mode?: 'incremental' | 'optimize' } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body OK */
  }
  const mode = body.mode === 'optimize' ? 'optimize' : 'incremental';

  let bytes: Uint8Array;
  try {
    if (mode === 'optimize') {
      bytes = serializeFull(entry.doc);
    } else {
      const r = serializeIncremental(entry.doc);
      bytes = r.bytes;
    }
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'serialize-failed', message: (e as Error).message } },
      { status: 500 },
    );
  }

  // MinIO에 결과 저장 (자가 검증 자료)
  try {
    await putResult(docId, entry.revision, bytes);
  } catch {
    /* MinIO 저장 실패는 다운로드 자체엔 치명적이지 않음 */
  }

  // 다운로드 토큰 발급
  const fileNameBase = entry.name.replace(/\.pdf$/i, '');
  const downloadName = `${fileNameBase}-edited.pdf`;
  const token = issueDownloadToken(docId, bytes, downloadName);
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '/edit2me';
  return NextResponse.json({
    url: `${base}/api/documents/${docId}/download/${token}`,
    size: bytes.length,
    expiresIn: 300,
    fileName: downloadName,
  });
}
