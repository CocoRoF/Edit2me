// Adobe-CNS1 (Traditional Chinese) CID → Unicode (ASCII 영역).
// 전체는 build:cmaps 로 fetch.

import type { CidUnicodeMap } from './types';

export const ADOBE_CNS1_BASIC: CidUnicodeMap = {
  registry: 'Adobe',
  ordering: 'CNS1',
  ranges: [
    [1, 95, 0x20],
  ],
};
