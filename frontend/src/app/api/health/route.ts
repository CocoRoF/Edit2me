import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Module 평가 시 1회 banner 출력 — docker logs 첫 요청에서 코드 식별 가능.
const VERSION = '0.4.1';
// eslint-disable-next-line no-console
console.log(`[edit2me] health route loaded — Edit2me ${VERSION} (commit ${process.env.EDIT2ME_GIT_SHA ?? 'unknown'})`);

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: VERSION,
    commit: process.env.EDIT2ME_GIT_SHA ?? 'unknown',
    builtAt: process.env.EDIT2ME_BUILT_AT ?? 'unknown',
    runtime: 'nodejs',
  });
}

