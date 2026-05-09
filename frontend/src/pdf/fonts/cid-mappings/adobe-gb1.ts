// Adobe-GB1 (Simplified Chinese) CID → Unicode (ASCII 영역).
// 전체는 build:cmaps 로 fetch.

import type { CidUnicodeMap } from './types';

export const ADOBE_GB1_BASIC: CidUnicodeMap = {
  registry: 'Adobe',
  ordering: 'GB1',
  ranges: [
    [1, 95, 0x20],
  ],
};
