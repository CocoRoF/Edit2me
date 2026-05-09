import { NextRequest, NextResponse } from 'next/server';
import { redoDoc } from '@/lib/doc-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  const result = await redoDoc(docId);
  if (!result) return NextResponse.json({ error: { code: 'doc-not-found' } }, { status: 404 });
  return NextResponse.json(result);
}
