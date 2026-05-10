import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Module 평가 시 1회 banner 출력 — docker logs 첫 요청에서 코드 식별 가능.
const VERSION = '0.4.3';
// process.stdout.write 직접 사용 — console.log 가 line-buffered 일 수 있어 즉시 flush 안 됨.
process.stdout.write(
  `[edit2me] health route loaded — Edit2me ${VERSION} (commit ${process.env.EDIT2ME_GIT_SHA ?? 'unknown'})\n`,
);

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: VERSION,
    renderer: 'svg-vector-v0.4.3',
    commit: process.env.EDIT2ME_GIT_SHA ?? 'unknown',
    builtAt: process.env.EDIT2ME_BUILT_AT ?? 'unknown',
    runtime: 'nodejs',
  });
}

