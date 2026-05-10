import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: '0.4',
    commit: process.env.EDIT2ME_GIT_SHA ?? 'unknown',
    builtAt: process.env.EDIT2ME_BUILT_AT ?? 'unknown',
    runtime: 'nodejs',
  });
}

