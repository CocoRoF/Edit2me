import { NextRequest } from 'next/server';
import { consumeDownloadToken } from '@/lib/doc-cache';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ docId: string; token: string }> },
) {
  const { token } = await ctx.params;
  const t = consumeDownloadToken(token);
  if (!t) return new Response('Token expired', { status: 410 });
  // Cast for BodyInit (Node 22+ typings issue with Uint8Array generic)
  const body = t.bytes as unknown as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(t.fileName)}"`,
      'Content-Length': String(t.bytes.length),
      'Cache-Control': 'no-store',
    },
  });
}
