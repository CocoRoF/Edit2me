// CID → Unicode mapping registry.
//
// CIDSystemInfo (Registry, Ordering)을 받아 매핑 모듈을 반환.
// 런타임에 data/<ordering>.json 이 있으면 우선 (build:cmaps 로 채움).
// 없으면 코드 안에 번들된 기본 매핑(BASIC) 사용.

import { CidMapLookup, CidUnicodeMap, buildLookup } from './types';
import { ADOBE_KOREA1_BASIC } from './adobe-korea1';
import { ADOBE_JAPAN1_BASIC } from './adobe-japan1';
import { ADOBE_GB1_BASIC } from './adobe-gb1';
import { ADOBE_CNS1_BASIC } from './adobe-cns1';

const builtins: Record<string, CidUnicodeMap> = {
  'Adobe:Korea1': ADOBE_KOREA1_BASIC,
  'Adobe:Japan1': ADOBE_JAPAN1_BASIC,
  'Adobe:GB1': ADOBE_GB1_BASIC,
  'Adobe:CNS1': ADOBE_CNS1_BASIC,
};

const fileLoaded = new Map<string, CidUnicodeMap | null>();
const lookupCache = new Map<string, CidMapLookup>();

/**
 * CIDSystemInfo로 lookup 함수를 반환. 매핑이 전혀 없으면 null.
 *
 * 우선순위:
 *   1. 외부 데이터 파일 (data/<ordering-lower>.json) — `npm run build:cmaps` 결과
 *   2. 코드에 번들된 기본 매핑 (ASCII 영역만)
 */
export function getCidLookup(registry: string, ordering: string): CidMapLookup | null {
  const key = `${registry}:${ordering}`;
  const cached = lookupCache.get(key);
  if (cached) return cached;

  // 1. data/ 파일 시도 (Node only — fs/path 동적 import)
  const fromFile = tryLoadFromFile(registry, ordering);
  let map: CidUnicodeMap | null = fromFile;
  if (!map) map = builtins[key] ?? null;
  if (!map) {
    lookupCache.set(key, () => null);
    return null;
  }
  const lookup = buildLookup(map);
  lookupCache.set(key, lookup);
  return lookup;
}

function tryLoadFromFile(registry: string, ordering: string): CidUnicodeMap | null {
  // 브라우저에서는 사용 불가
  if (typeof process === 'undefined' || typeof process.versions?.node === 'undefined') {
    return null;
  }
  const key = `${registry}:${ordering}`;
  if (fileLoaded.has(key)) return fileLoaded.get(key) ?? null;

  try {
    // require는 dynamic — webpack/Next의 server bundle에서 런타임에만 평가
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs: typeof import('node:fs') = require('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path: typeof import('node:path') = require('node:path');
    const filename = `${registry.toLowerCase()}-${ordering.toLowerCase()}.json`;
    // 다양한 경로 후보 (Next standalone vs dev)
    const candidates = [
      path.join(process.cwd(), 'pdf', 'fonts', 'cid-mappings', 'data', filename),
      path.join(process.cwd(), 'src', 'pdf', 'fonts', 'cid-mappings', 'data', filename),
      path.join(__dirname, 'data', filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const data = JSON.parse(raw) as {
          registry: string;
          ordering: string;
          ranges: Array<[number, number, number]>;
          singles?: Record<string, string>;
        };
        const map: CidUnicodeMap = {
          registry: data.registry,
          ordering: data.ordering,
          ranges: data.ranges,
          singles: data.singles
            ? new Map(Object.entries(data.singles).map(([k, v]) => [Number(k), v]))
            : undefined,
        };
        fileLoaded.set(key, map);
        return map;
      }
    }
  } catch {
    // 무시
  }
  fileLoaded.set(key, null);
  return null;
}
