// 페이지에 사용된 임베디드 TrueType 폰트들을 base64 data URL 로 응답.
// 편집 박스가 @font-face 로 등록해 PDF 와 동일한 폰트로 텍스트를 렌더하기 위함.

import { NextRequest, NextResponse } from 'next/server';
import { getDoc } from '@/lib/doc-cache';
import { buildFontMap } from '@/pdf/fonts/font-info';

export const runtime = 'nodejs';

function toBase64(bytes: Uint8Array): string {
  // Node Buffer 가 가장 빠름.
  return Buffer.from(bytes).toString('base64');
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ docId: string; idx: string }> },
) {
  const { docId, idx } = await ctx.params;
  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
  const pageIndex = Number(idx);
  const page = entry.doc.getPages()[pageIndex];
  if (!page) return NextResponse.json({ error: { code: 'page-not-found' } }, { status: 404 });

  const fontMap = buildFontMap(entry.doc, page.dict);
  const fonts: Array<{
    resourceName: string;
    baseName: string;
    isComposite: boolean;
    /** data:font/ttf;base64,... */
    dataUrl: string;
    bytes: number;
  }> = [];
  for (const [name, f] of fontMap) {
    if (!f.ttfBytes) continue;
    fonts.push({
      resourceName: name,
      baseName: f.baseName,
      isComposite: f.isComposite,
      dataUrl: `data:font/ttf;base64,${toBase64(f.ttfBytes)}`,
      bytes: f.ttfBytes.length,
    });
  }

  return NextResponse.json({
    pageIndex,
    fonts,
  });
}
