// 같은 baseline + 같은 폰트 + 인접한 TextRun 들을 하나의 시각적 group 으로 합치기.
// 사용자에게 "한 줄짜리 단어/구절" 이 한 박스로 보이게 + 그룹 단위로 편집 가능하게.
//
// 그룹 분리 기준:
//   - 다른 baseline (y 차이 > 1pt)
//   - 다른 폰트 또는 다른 font size
//   - x 갭이 너무 큼 (advance 평균 > 1.0 × fontSize, 즉 column-jump 같은 것)
//   - 다른 op (서로 다른 BT/ET 또는 다른 opIndex 의 Tj 들끼리는 시각적으로 합쳐도 편집은
//     불가능 — 그래서 그룹 는 같은 opIndex 의 TJ segment 들로만 함, 다른 op 끼리는 분리.)
//
// 본 helper 는 client/server 모두 동일하게 사용.

import type { TextRun } from './text-extract';

export interface TextGroup {
  groupId: string; // primary blockId
  blockIds: string[];
  text: string;
  // 그룹 bounding box (페이지 좌표)
  x: number;
  y: number;
  width: number;
  height: number;
  fontBaseName: string;
  fontSize: number;
  isComposite: boolean;
  /** 이 그룹을 group-edit 으로 한 번에 바꿀 수 있는가 — 같은 opIndex 의 인접 TJ segment 들이면 true */
  groupEditable: boolean;
  /** 모든 segment 의 폰트가 새 텍스트를 인코딩할 수 있는가 (편집 가능 여부의 일부) */
  fontEncodable: boolean;
  fullyDecoded: boolean;
}

/**
 * runs 를 visual group 으로 묶는다. runs 는 PDF 의 TextRun (text-extract 결과).
 * 출력 그룹은 사용자가 보는 단위 (예: "학위수여증명서" 한 줄).
 */
export function groupRuns(runs: TextRun[]): TextGroup[] {
  if (runs.length === 0) return [];

  // 1) y 좌표 기준 정렬 후 같은 line bucket 으로 묶기. 같은 line 내에서 x 정렬.
  // y 허용 오차 = max(fontSize * 0.3, 1pt). 작은 sub/superscript 는 별도 line 으로 취급.
  const sorted = [...runs].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.5) return b.y - a.y; // 위에서 아래로
    return a.x - b.x;
  });

  const groups: TextGroup[] = [];
  let cur: TextRun[] | null = null;

  function flush() {
    if (!cur || cur.length === 0) return;
    const first = cur[0]!;
    const last = cur[cur.length - 1]!;
    const text = cur.map((r) => r.text).join('');
    const minX = Math.min(...cur.map((r) => r.x));
    const minY = Math.min(...cur.map((r) => r.y));
    // bbox 의 right edge = last segment 의 x + width
    const maxRight = Math.max(...cur.map((r) => r.x + r.width));
    const maxTop = Math.max(...cur.map((r) => r.y + r.height));
    const sameOp = cur.every((r) => r.source.opIndex === first.source.opIndex);
    const fontEncodable = cur.every((r) => r.fontEncodable);
    const fullyDecoded = cur.every((r) => r.fullyDecoded);
    groups.push({
      groupId: first.blockId,
      blockIds: cur.map((r) => r.blockId),
      text,
      x: minX,
      y: minY,
      width: maxRight - minX,
      height: maxTop - minY,
      fontBaseName: first.fontBaseName,
      fontSize: first.fontSize,
      isComposite: first.isComposite,
      groupEditable: sameOp,
      fontEncodable,
      fullyDecoded,
    });
    void last;
    cur = null;
  }

  for (const r of sorted) {
    if (!cur || cur.length === 0) {
      cur = [r];
      continue;
    }
    const prev = cur[cur.length - 1]!;
    const sameLine = Math.abs(r.y - prev.y) <= Math.max(prev.fontSize * 0.3, 0.5);
    const sameFont = r.fontBaseName === prev.fontBaseName && Math.abs(r.fontSize - prev.fontSize) < 0.01;
    // 갭 = 새 run 의 x 와 이전 run 의 right edge (x+width) 차이.
    const prevRight = prev.x + prev.width;
    const gap = r.x - prevRight;
    // 임계: 한 글자 폭 (fontSize * 0.6) 이하면 같은 group.
    const sameGroup = sameLine && sameFont && gap < prev.fontSize * 0.7 && gap > -prev.fontSize;
    if (sameGroup) {
      cur.push(r);
    } else {
      flush();
      cur = [r];
    }
  }
  flush();
  return groups;
}
