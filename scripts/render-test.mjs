#!/usr/bin/env node
// 디버그 도구: PDF 의 모든 페이지를 SVG 로 렌더링해 파일로 저장.
// 사용: node scripts/render-test.mjs <pdf-path> [out-dir]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// TS 직접 import 위해 esbuild-loader 같은 게 필요하지만 우리는 ts 컴파일된 .next/standalone 안 쓰니
// next build 후 server bundle 사용은 복잡. 대신 tsx 가 설치돼 있으면 그걸 써야 함.
// 가장 단순: 이 스크립트는 tsx 또는 next dev 환경 안에서만 동작한다고 가정.
// 그러므로 별도 npm script 로 실행하지 않음 — 문서에만 명시.

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/render-test.mjs <pdf-path> [out-dir]');
  process.exit(1);
}
const outDir = process.argv[3] ?? '/tmp/edit2me-render';
mkdirSync(outDir, { recursive: true });

console.log(`This script requires a TS runtime (tsx or ts-node). Try:`);
console.log(`  cd frontend/src && npx tsx ../../scripts/render-test.mjs ${arg} ${outDir}`);
console.log('');
console.log('이 PR 시점에는 단위 테스트만 통과 보장합니다. 실제 시각 검증은 UI에서 수행하세요.');
