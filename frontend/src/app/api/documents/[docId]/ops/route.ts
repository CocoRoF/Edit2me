import { NextRequest, NextResponse } from 'next/server';
import { applyOpsToDoc, getDoc } from '@/lib/doc-cache';
import { validateOps } from '@/lib/op-validate';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  let body: { baseRevision?: unknown; ops?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: { code: 'op-invalid', message: 'invalid JSON body' } },
      { status: 400 },
    );
  }

  const v = validateOps(body.ops);
  if (!v.ok) {
    return NextResponse.json(
      { error: { code: 'op-invalid', message: v.error } },
      { status: 400 },
    );
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
    const result = await applyOpsToDoc(docId, v.ops!);
    if (!result) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
    return NextResponse.json({ ...result, appliedOps: v.ops!.length });
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'op-failed', message: (e as Error).message } },
      { status: 422 },
    );
  }
}
