// CID → Unicode 매핑 데이터 형식.
//
// Adobe character collection (Adobe-Korea1, Adobe-Japan1, Adobe-GB1, Adobe-CNS1)
// 의 표준 CID → Unicode 매핑을 *압축된 range 배열* 로 보관한다.

export interface CidUnicodeMap {
  /** Registry (보통 'Adobe') */
  registry: string;
  /** Ordering ('Korea1', 'Japan1', 'GB1', 'CNS1') */
  ordering: string;
  /**
   * Range 배열. 각 entry: [cidStart, cidEnd, unicodeStart].
   * cidStart..cidEnd 범위의 CID가 unicodeStart..unicodeStart+(cidEnd-cidStart) 로 매핑.
   * 단일 매핑은 cidStart == cidEnd.
   * 정렬: cidStart 오름차순.
   */
  ranges: ReadonlyArray<readonly [number, number, number]>;
  /**
   * Range로 표현 안 되는 단일 매핑 (범위로 묶기 어려운 1:1 항목).
   * 압축률 위해 별도 두지만 lookup 시 둘 다 검사.
   */
  singles?: ReadonlyMap<number, string>;
}

export type CidMapLookup = (cid: number) => string | null;

export function buildLookup(map: CidUnicodeMap): CidMapLookup {
  const { ranges, singles } = map;
  return function lookup(cid: number): string | null {
    if (singles) {
      const s = singles.get(cid);
      if (s !== undefined) return s;
    }
    // Binary search ranges by cidStart
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const r = ranges[mid]!;
      if (cid < r[0]) hi = mid - 1;
      else if (cid > r[1]) lo = mid + 1;
      else return String.fromCodePoint(r[2] + (cid - r[0]));
    }
    return null;
  };
}
