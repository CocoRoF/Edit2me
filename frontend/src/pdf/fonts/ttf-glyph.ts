// TTF glyf 테이블 → SVG path 변환.
// loca, glyf, head(indexToLocFormat) 를 사용. 외부 라이브러리 없음.
//
// 다루는 범위:
//   - Simple glyph (numberOfContours >= 0)
//   - Composite glyph (재귀 — argument 1, 2 unsigned/signed; scale; xy scale; 2x2 matrix)
//
// SVG path 좌표는 *font unit* (head.unitsPerEm 기준). PDF Tfs 와 결합되어
// 호출자가 transform 으로 스케일링.

const TAG_head = 0x68656164;
const TAG_loca = 0x6c6f6361;
const TAG_glyf = 0x676c7966;
const TAG_maxp = 0x6d617870;

export interface GlyphOutlineCache {
  /** glyph id → SVG path d ('' if blank/notdef) */
  outline: (gid: number) => string;
}

// 모듈 레벨 cache — 같은 raw bytes (PdfDocument resolve 캐시 덕에 same identity)
// 에 대해 glyph outline 빌더를 한 번만 생성. 페이지마다 buildFontInfo 가 호출되더라도
// 비싼 TTF 테이블 파싱은 1회.
const moduleCache = new WeakMap<Uint8Array, GlyphOutlineCache | null>();

export function buildGlyphOutlineCache(raw: Uint8Array): GlyphOutlineCache | null {
  if (moduleCache.has(raw)) return moduleCache.get(raw)!;
  const result = buildGlyphOutlineCacheUncached(raw);
  moduleCache.set(raw, result);
  return result;
}

function buildGlyphOutlineCacheUncached(raw: Uint8Array): GlyphOutlineCache | null {
  try {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw.byteLength < 12) return null;
    const sfnt = dv.getUint32(0);
    if (sfnt !== 0x00010000 && sfnt !== 0x74727565) {
      // OTF/CFF — outline 추출은 CFF 파서가 필요하므로 미지원
      return null;
    }
    const numTables = dv.getUint16(4);
    const dir = new Map<number, { offset: number; length: number }>();
    for (let i = 0; i < numTables; i += 1) {
      const base = 12 + i * 16;
      const tag = dv.getUint32(base);
      const offset = dv.getUint32(base + 8);
      const length = dv.getUint32(base + 12);
      dir.set(tag, { offset, length });
    }
    const headEntry = dir.get(TAG_head);
    const locaEntry = dir.get(TAG_loca);
    const glyfEntry = dir.get(TAG_glyf);
    const maxpEntry = dir.get(TAG_maxp);
    if (!headEntry || !locaEntry || !glyfEntry || !maxpEntry) return null;

    const head = new DataView(raw.buffer, raw.byteOffset + headEntry.offset, headEntry.length);
    const indexToLocFormat = head.getInt16(50); // 0 short, 1 long
    const maxp = new DataView(raw.buffer, raw.byteOffset + maxpEntry.offset, maxpEntry.length);
    const numGlyphs = maxp.getUint16(4);
    const loca = new DataView(raw.buffer, raw.byteOffset + locaEntry.offset, locaEntry.length);
    const glyf = new DataView(raw.buffer, raw.byteOffset + glyfEntry.offset, glyfEntry.length);

    function glyphRange(gid: number): { start: number; end: number } | null {
      if (gid < 0 || gid >= numGlyphs) return null;
      let start: number;
      let end: number;
      if (indexToLocFormat === 0) {
        start = loca.getUint16(gid * 2) * 2;
        end = loca.getUint16((gid + 1) * 2) * 2;
      } else {
        start = loca.getUint32(gid * 4);
        end = loca.getUint32((gid + 1) * 4);
      }
      if (start === end) return null; // empty glyph
      return { start, end };
    }

    const cache = new Map<number, string>();

    function outline(gid: number, depth = 0): string {
      if (depth > 8) return '';
      const cached = cache.get(gid);
      if (cached !== undefined) return cached;
      const r = glyphRange(gid);
      if (!r) {
        cache.set(gid, '');
        return '';
      }
      const numberOfContours = glyf.getInt16(r.start);
      let d: string;
      if (numberOfContours >= 0) {
        d = parseSimpleGlyph(glyf, r.start, numberOfContours, r.end);
      } else {
        d = parseCompositeGlyph(glyf, r.start, outline, depth);
      }
      cache.set(gid, d);
      return d;
    }

    return { outline };
  } catch {
    return null;
  }
}

// ---- Simple glyph ----

function parseSimpleGlyph(
  glyf: DataView,
  glyphStart: number,
  numberOfContours: number,
  glyphEnd: number,
): string {
  // Header: 10 bytes (numContours + xMin + yMin + xMax + yMax)
  let p = glyphStart + 10;

  const endPts: number[] = [];
  for (let i = 0; i < numberOfContours; i += 1) {
    endPts.push(glyf.getUint16(p));
    p += 2;
  }
  const numPts = endPts[endPts.length - 1]! + 1;

  const instructionLength = glyf.getUint16(p);
  p += 2;
  p += instructionLength; // skip hinting

  // Flags
  const flags: number[] = [];
  while (flags.length < numPts && p < glyphEnd) {
    const f = glyf.getUint8(p);
    p += 1;
    flags.push(f);
    if (f & 0x08) {
      // repeat
      const repeat = glyf.getUint8(p);
      p += 1;
      for (let r = 0; r < repeat && flags.length < numPts; r += 1) flags.push(f);
    }
  }
  if (flags.length !== numPts) return ''; // malformed

  // X coords
  const xs: number[] = [];
  let curX = 0;
  for (let i = 0; i < numPts; i += 1) {
    const f = flags[i]!;
    if (f & 0x02) {
      // 1 byte
      const dx = glyf.getUint8(p);
      p += 1;
      curX += f & 0x10 ? dx : -dx;
    } else if (!(f & 0x10)) {
      // 2 byte signed
      const dx = glyf.getInt16(p);
      p += 2;
      curX += dx;
    } // else: same as previous
    xs.push(curX);
  }

  // Y coords
  const ys: number[] = [];
  let curY = 0;
  for (let i = 0; i < numPts; i += 1) {
    const f = flags[i]!;
    if (f & 0x04) {
      const dy = glyf.getUint8(p);
      p += 1;
      curY += f & 0x20 ? dy : -dy;
    } else if (!(f & 0x20)) {
      const dy = glyf.getInt16(p);
      p += 2;
      curY += dy;
    }
    ys.push(curY);
  }

  // Build path d. 각 contour 별로:
  //   - 첫 점이 on-curve 면 M 으로 시작
  //   - 첫 점이 off-curve 면 마지막 on-curve 또는 implicit midpoint 로 시작
  //   - 중간: on-on → L, on-off-on → Q, off-off → implicit midpoint
  let d = '';
  let contourStart = 0;
  for (let ci = 0; ci < numberOfContours; ci += 1) {
    const contourEnd = endPts[ci]!;
    d += contourPath(xs, ys, flags, contourStart, contourEnd);
    contourStart = contourEnd + 1;
  }
  return d;
}

function contourPath(
  xs: number[],
  ys: number[],
  flags: number[],
  start: number,
  end: number,
): string {
  const n = end - start + 1;
  if (n < 2) return '';
  // helper
  const isOn = (i: number) => (flags[start + ((i + n) % n)]! & 0x01) !== 0;
  const x = (i: number) => xs[start + ((i + n) % n)]!;
  const y = (i: number) => ys[start + ((i + n) % n)]!;

  // 시작점: 첫 on-curve 점.
  let firstOn = -1;
  for (let i = 0; i < n; i += 1) {
    if (isOn(i)) {
      firstOn = i;
      break;
    }
  }
  let parts: string[];
  if (firstOn < 0) {
    // 모두 off-curve — 첫 점들 사이 implicit midpoint
    const mx = (x(0) + x(1)) / 2;
    const my = (y(0) + y(1)) / 2;
    parts = [`M${fmt(mx)} ${fmt(my)}`];
    firstOn = -1; // virtual
  } else {
    parts = [`M${fmt(x(firstOn))} ${fmt(y(firstOn))}`];
  }

  let i = firstOn < 0 ? 0 : firstOn;
  const stop = firstOn < 0 ? n : firstOn + n;
  while (i < stop) {
    i += 1;
    if (i - (firstOn < 0 ? -1 : firstOn) > n) break;
    const idx = i % n;
    if (isOn(idx)) {
      parts.push(`L${fmt(x(idx))} ${fmt(y(idx))}`);
    } else {
      // off-curve — control. 다음이 on 인지 off 인지 확인.
      const nextIdx = (idx + 1) % n;
      if (isOn(nextIdx)) {
        parts.push(`Q${fmt(x(idx))} ${fmt(y(idx))} ${fmt(x(nextIdx))} ${fmt(y(nextIdx))}`);
        i += 1;
      } else {
        // implicit on-curve at midpoint
        const mx = (x(idx) + x(nextIdx)) / 2;
        const my = (y(idx) + y(nextIdx)) / 2;
        parts.push(`Q${fmt(x(idx))} ${fmt(y(idx))} ${fmt(mx)} ${fmt(my)}`);
      }
    }
  }
  parts.push('Z');
  return parts.join('');
}

// ---- Composite glyph ----

function parseCompositeGlyph(
  glyf: DataView,
  glyphStart: number,
  outline: (gid: number, depth: number) => string,
  depth: number,
): string {
  let p = glyphStart + 10; // skip header
  let combined = '';
  while (true) {
    const flag = glyf.getUint16(p);
    p += 2;
    const componentGid = glyf.getUint16(p);
    p += 2;
    let arg1: number;
    let arg2: number;
    if (flag & 0x0001) {
      // ARG_1_AND_2_ARE_WORDS
      if (flag & 0x0002) {
        arg1 = glyf.getInt16(p);
        arg2 = glyf.getInt16(p + 2);
      } else {
        arg1 = glyf.getUint16(p);
        arg2 = glyf.getUint16(p + 2);
      }
      p += 4;
    } else {
      if (flag & 0x0002) {
        arg1 = glyf.getInt8(p);
        arg2 = glyf.getInt8(p + 1);
      } else {
        arg1 = glyf.getUint8(p);
        arg2 = glyf.getUint8(p + 1);
      }
      p += 2;
    }
    let xx = 1;
    let xy = 0;
    let yx = 0;
    let yy = 1;
    if (flag & 0x0008) {
      // SCALE
      const s = f2dot14(glyf.getInt16(p));
      p += 2;
      xx = s; yy = s;
    } else if (flag & 0x0040) {
      // XY scale
      xx = f2dot14(glyf.getInt16(p));
      yy = f2dot14(glyf.getInt16(p + 2));
      p += 4;
    } else if (flag & 0x0080) {
      // 2x2 matrix
      xx = f2dot14(glyf.getInt16(p));
      xy = f2dot14(glyf.getInt16(p + 2));
      yx = f2dot14(glyf.getInt16(p + 4));
      yy = f2dot14(glyf.getInt16(p + 6));
      p += 8;
    }
    let dx = 0;
    let dy = 0;
    if (flag & 0x0002) {
      // arg1/arg2 are signed offsets
      dx = arg1;
      dy = arg2;
    }
    // 자식 glyph outline 가져와 변환 후 합치기.
    const childPath = outline(componentGid, depth + 1);
    if (childPath) {
      combined += transformSvgPath(childPath, xx, xy, yx, yy, dx, dy);
    }
    if (!(flag & 0x0020)) break; // MORE_COMPONENTS
  }
  return combined;
}

function f2dot14(v: number): number {
  return v / 16384;
}

// 매우 단순 path 변환 — 모든 명령어의 좌표를 (a x + c y + e, b x + d y + f) 로.
// 본 함수는 우리가 직접 emit 한 path 만 다루므로 명령어가 M/L/Q/Z 한정.
function transformSvgPath(
  d: string,
  a: number,
  b: number,
  c: number,
  e: number,
  tx: number,
  ty: number,
): string {
  // tokens: command letter or number
  let out = '';
  let i = 0;
  const n = d.length;
  while (i < n) {
    const ch = d[i]!;
    if (ch === 'M' || ch === 'L' || ch === 'Q' || ch === 'Z') {
      out += ch;
      i += 1;
      continue;
    }
    if (/[0-9.\-]/.test(ch)) {
      // 좌표 페어들 — 이번 명령어가 M/L 이면 (x, y), Q 이면 (x1, y1, x, y)
      // 단순 접근: 이전 명령자에 따라 인자 개수 결정. 여기서는 lookback.
      // 그냥 모든 숫자 페어를 (x, y) 로 변환.
      const numbers: number[] = [];
      while (i < n && /[0-9.\-eE\s]/.test(d[i]!)) {
        const start = i;
        while (i < n && /[0-9.\-eE]/.test(d[i]!)) i += 1;
        if (i > start) numbers.push(parseFloat(d.substring(start, i)));
        while (i < n && d[i] === ' ') i += 1;
        if (d[i] && /[MLQZ]/.test(d[i]!)) break;
      }
      for (let k = 0; k + 1 < numbers.length; k += 2) {
        const x = numbers[k]!;
        const y = numbers[k + 1]!;
        const nx = a * x + c * y + tx;
        const ny = b * x + e * y + ty;
        out += `${k === 0 ? '' : ' '}${fmt(nx)} ${fmt(ny)}`;
      }
      continue;
    }
    i += 1;
  }
  return out;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(2);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
