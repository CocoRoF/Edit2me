// Adobe-Korea1 CID → Unicode 매핑.
//
// 본 파일은 *수동으로 검증된 안전한 부분*만 포함한다.
//   - CIDs 1..95: ASCII 영역 (대부분의 한국어 PDF에서 Latin 표시에 사용)
//
// 전체 매핑(~18,352 entries)을 포함하려면 `npm run build:cmaps` 실행 → Adobe 공식
// CMap resources를 fetch해 `data/adobe-korea1.json` 으로 저장. 런타임에 그 파일이
// 있으면 우선 사용한다 (registry.ts).
//
// 출처: Adobe-Korea1-UCS2 (BSD-style 라이선스).

import type { CidUnicodeMap } from './types';

export const ADOBE_KOREA1_BASIC: CidUnicodeMap = {
  registry: 'Adobe',
  ordering: 'Korea1',
  ranges: [
    // CID 1 = SPACE, CID 2 = !, ..., CID 95 = ~
    // 표준 Adobe Latin glyph 순서. 대부분의 한국어 PDF의 Latin 텍스트가 여기 매핑됨.
    [1, 95, 0x20],
  ],
};
