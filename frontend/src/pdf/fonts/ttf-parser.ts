// TrueType font parser (TTF / OTF with TrueType outlines).
// 외부 라이브러리 0개 — opentype.js / fontkit 사용 안 함 (ADR-0001).
//
// 다루는 테이블:
//   - 'head': unitsPerEm, indexToLocFormat
//   - 'maxp': numGlyphs
//   - 'hhea': ascender, descender, numberOfHMetrics
//   - 'hmtx': advanceWidth / lsb per glyph
//   - 'cmap': format 4 (BMP) + format 12 (full Unicode), unicode → glyph index
//
// 다루지 않는 것 (subsetting / 렌더링): glyf, loca, post 등.
//   서브셋팅은 별도 모듈 (ttf-subsetter.ts) 에서. 일단 *전체 임베딩* 만 지원.

const TAG_head = 0x68656164; // 'head'
const TAG_maxp = 0x6d617870;
const TAG_hhea = 0x68686561;
const TAG_hmtx = 0x686d7478;
const TAG_cmap = 0x636d6170;

export interface ParsedTtf {
  /** 원본 바이트 (PDF /FontFile2 임베딩에 그대로 사용) */
  raw: Uint8Array;
  unitsPerEm: number;
  /** Glyph 1 unit = unitsPerEm 단위 → PDF 1/1000 em 으로 정규화 시 1000/unitsPerEm 곱셈 */
  numGlyphs: number;
  ascender: number;
  descender: number;
  /** glyph index → advance width (in font units, not normalized) */
  advanceWidthByGid: number[];
  /** unicode codepoint → glyph index (0 if missing) */
  unicodeToGid: Map<number, number>;
  /** 가장 흔히 PDF embedding 에 들어가는 키 메트릭 */
  toPdfWidths: () => { gid: number; w1000: number }[];
}

/** 진입점. 잘못된 TTF 면 throw. */
export function parseTtf(raw: Uint8Array): ParsedTtf {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.byteLength < 12) throw new Error('TTF: too short');
  const sfnt = dv.getUint32(0);
  // Acceptable scaler types: 0x00010000 (TT), 'true' = 0x74727565, 'OTTO' = 0x4F54544F (CFF — outline format different).
  // OTTO/CFF는 우리 v0.3 범위 밖 — 명시적으로 거부.
  if (sfnt === 0x4f54544f) throw new Error('TTF: OpenType/CFF (OTTO) not supported in v0.3 — needs CFF outline parser');
  if (sfnt !== 0x00010000 && sfnt !== 0x74727565) throw new Error(`TTF: unknown sfnt scaler 0x${sfnt.toString(16)}`);
  const numTables = dv.getUint16(4);

  // 디렉토리 테이블
  const dir = new Map<number, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i += 1) {
    const base = 12 + i * 16;
    const tag = dv.getUint32(base);
    const offset = dv.getUint32(base + 8);
    const length = dv.getUint32(base + 12);
    dir.set(tag, { offset, length });
  }

  function tableView(tag: number): DataView {
    const e = dir.get(tag);
    if (!e) throw new Error(`TTF: missing required table 0x${tag.toString(16)}`);
    if (e.offset + e.length > raw.byteLength) throw new Error(`TTF: table out-of-bounds`);
    return new DataView(raw.buffer, raw.byteOffset + e.offset, e.length);
  }

  // ---- head ----
  const head = tableView(TAG_head);
  const unitsPerEm = head.getUint16(18);
  const indexToLocFormat = head.getInt16(50); // 0 = short, 1 = long
  void indexToLocFormat; // glyf/loca 안 다룸 (서브셋팅에 필요)

  // ---- maxp ----
  const maxp = tableView(TAG_maxp);
  const numGlyphs = maxp.getUint16(4);

  // ---- hhea ----
  const hhea = tableView(TAG_hhea);
  const ascender = hhea.getInt16(4);
  const descender = hhea.getInt16(6);
  const numberOfHMetrics = hhea.getUint16(34);

  // ---- hmtx ----
  const hmtx = tableView(TAG_hmtx);
  const advanceWidthByGid: number[] = new Array(numGlyphs).fill(0);
  let lastAdvance = 0;
  for (let g = 0; g < numGlyphs; g += 1) {
    if (g < numberOfHMetrics) {
      lastAdvance = hmtx.getUint16(g * 4);
      advanceWidthByGid[g] = lastAdvance;
    } else {
      // numberOfHMetrics 이후는 lsb-only entries — width 는 last advance 반복.
      advanceWidthByGid[g] = lastAdvance;
    }
  }

  // ---- cmap ----
  const cmap = tableView(TAG_cmap);
  const cmapNumTables = cmap.getUint16(2);
  let bestSubtableOffset = -1;
  let bestPriority = -1;
  for (let i = 0; i < cmapNumTables; i += 1) {
    const platformID = cmap.getUint16(4 + i * 8);
    const encodingID = cmap.getUint16(6 + i * 8);
    const offset = cmap.getUint32(8 + i * 8);
    // 우선순위: Microsoft Unicode UCS-4 (3,10) > MS Unicode BMP (3,1) > Unicode 4 (0,4) > Unicode (0,3)
    let pri = -1;
    if (platformID === 3 && encodingID === 10) pri = 4;
    else if (platformID === 0 && encodingID === 4) pri = 3;
    else if (platformID === 3 && encodingID === 1) pri = 2;
    else if (platformID === 0) pri = 1;
    if (pri > bestPriority) {
      bestPriority = pri;
      bestSubtableOffset = offset;
    }
  }
  const unicodeToGid = new Map<number, number>();
  if (bestSubtableOffset >= 0) {
    parseCmapSubtable(cmap, bestSubtableOffset, unicodeToGid);
  }

  return {
    raw,
    unitsPerEm,
    numGlyphs,
    ascender,
    descender,
    advanceWidthByGid,
    unicodeToGid,
    toPdfWidths() {
      // PDF는 1/1000 em. font unit → 1000 * w / unitsPerEm.
      const out: { gid: number; w1000: number }[] = [];
      for (let g = 0; g < numGlyphs; g += 1) {
        const w = (advanceWidthByGid[g] ?? 0) * 1000 / unitsPerEm;
        out.push({ gid: g, w1000: Math.round(w) });
      }
      return out;
    },
  };
}

function parseCmapSubtable(cmap: DataView, offset: number, out: Map<number, number>): void {
  const format = cmap.getUint16(offset);
  if (format === 4) parseCmapFormat4(cmap, offset, out);
  else if (format === 6) parseCmapFormat6(cmap, offset, out);
  else if (format === 12) parseCmapFormat12(cmap, offset, out);
  else if (format === 0) parseCmapFormat0(cmap, offset, out);
  // 그 외 format은 무시 (희귀)
}

function parseCmapFormat0(cmap: DataView, offset: number, out: Map<number, number>): void {
  // 256-byte glyph table
  for (let cp = 0; cp < 256; cp += 1) {
    const gid = cmap.getUint8(offset + 6 + cp);
    if (gid !== 0) out.set(cp, gid);
  }
}

function parseCmapFormat4(cmap: DataView, offset: number, out: Map<number, number>): void {
  const segCountX2 = cmap.getUint16(offset + 6);
  const segCount = segCountX2 / 2;
  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segCountX2 + 2; // +2 for reservedPad
  const idDeltaOffset = startCodeOffset + segCountX2;
  const idRangeOffsetOffset = idDeltaOffset + segCountX2;
  for (let i = 0; i < segCount; i += 1) {
    const endCode = cmap.getUint16(endCodeOffset + i * 2);
    const startCode = cmap.getUint16(startCodeOffset + i * 2);
    const idDelta = cmap.getInt16(idDeltaOffset + i * 2);
    const idRangeOff = cmap.getUint16(idRangeOffsetOffset + i * 2);
    if (startCode === 0xffff && endCode === 0xffff) break;
    for (let cp = startCode; cp <= endCode; cp += 1) {
      let gid: number;
      if (idRangeOff === 0) {
        gid = (cp + idDelta) & 0xffff;
      } else {
        // glyphIdArray indirect: idRangeOffset[i] + (cp - startCode) * 2 + (offset of idRangeOffset[i])
        const glyphIdAddr =
          idRangeOffsetOffset + i * 2 + idRangeOff + (cp - startCode) * 2;
        if (glyphIdAddr + 2 > cmap.byteLength) continue;
        const v = cmap.getUint16(glyphIdAddr);
        gid = v === 0 ? 0 : (v + idDelta) & 0xffff;
      }
      if (gid !== 0) out.set(cp, gid);
    }
  }
}

function parseCmapFormat6(cmap: DataView, offset: number, out: Map<number, number>): void {
  const firstCode = cmap.getUint16(offset + 6);
  const entryCount = cmap.getUint16(offset + 8);
  for (let i = 0; i < entryCount; i += 1) {
    const gid = cmap.getUint16(offset + 10 + i * 2);
    if (gid !== 0) out.set(firstCode + i, gid);
  }
}

function parseCmapFormat12(cmap: DataView, offset: number, out: Map<number, number>): void {
  const numGroups = cmap.getUint32(offset + 12);
  for (let i = 0; i < numGroups; i += 1) {
    const start = cmap.getUint32(offset + 16 + i * 12);
    const end = cmap.getUint32(offset + 20 + i * 12);
    const startGid = cmap.getUint32(offset + 24 + i * 12);
    for (let cp = start; cp <= end; cp += 1) {
      out.set(cp, startGid + (cp - start));
    }
  }
}
