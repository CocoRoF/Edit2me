// Adobe-Japan1 CID → Unicode 매핑 (ASCII 영역만 포함).
// 전체는 `npm run build:cmaps` 로 가져와 data/adobe-japan1.json 에 둔다.

import type { CidUnicodeMap } from './types';

export const ADOBE_JAPAN1_BASIC: CidUnicodeMap = {
  registry: 'Adobe',
  ordering: 'Japan1',
  ranges: [
    [1, 95, 0x20], // CID 1..95 = ASCII 0x20..0x7E
  ],
};
