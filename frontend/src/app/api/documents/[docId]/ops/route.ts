import { NextRequest, NextResponse } from 'next/server';
import { applyOpsToDoc, getDoc } from '@/lib/doc-cache';
import { Op } from '@/pdf/ops/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  const body = (await req.json()) as { baseRevision?: number; ops?: Op[] };
  if (!body.ops || !Array.isArray(body.ops)) {
    return NextResponse.json({ error: { code: 'op-invalid' } }, { status: 400 });
  }

  const entry = await getDoc(docId);
  if (!entry) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });

  if (typeof body.baseRevision === 'number' && body.baseRevision !== entry.revision) {
    return NextResponse.json(
      { error: { code: 'stale-revision', currentRevision: entry.revision } },
      { status: 409 },
    );
  }

  try {
    const result = await applyOpsToDoc(docId, body.ops);
    if (!result) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
    return NextResponse.json({ ...result, appliedOps: body.ops.length });
    // result already includes canUndo/canRedo
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'op-failed', message: (e as Error).message } },
      { status: 422 },
    );
  }
}
