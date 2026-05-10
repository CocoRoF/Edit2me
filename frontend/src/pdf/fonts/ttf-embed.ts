// 업로드된 TTF 를 PDF 의 Type0 (CIDFontType2 + Identity-H) 폰트로 임베딩.
//
// 결과:
//   - 페이지 /Resources /Font 에 Type0 wrapper 가 등록됨
//   - 텍스트는 Identity-H 인코딩 (2-byte big-endian GID)
//   - ToUnicode CMap 으로 GID → Unicode 매핑 보존 (다른 뷰어에서 copy/paste 가능)
//
// 한 PDF 에 같은 TTF 를 여러 번 추가해도, 같은 ParsedTtf 인스턴스에 대해
// 한 번만 stream 을 임베드 (캐시).

import zlib from 'node:zlib';
import {
  PdfDict,
  PdfRef,
  pdfArray,
  pdfDict,
  pdfHexString,
  pdfInt,
  pdfLiteralString,
  pdfName,
  pdfRef,
  pdfStream,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { ParsedTtf } from './ttf-parser';

export interface EmbeddedTtf {
  /** 페이지 /Resources/Font 에 들어가는 ref (Type0 wrapper) */
  fontRef: PdfRef;
  /** Unicode 문자열 → 콘텐츠 stream 에 들어갈 byte 표현 (hex string `<...>` 형식, '<>' 없이 raw hex) */
  encodeHex: (text: string) => { hex: string; advance: number; missing: string[] };
  /** PostScript-style font name (BaseFont 에 사용) */
  baseName: string;
}

interface EmbedCacheValue {
  result: EmbeddedTtf;
}

const cache = new WeakMap<PdfDocument, Map<ParsedTtf, EmbedCacheValue>>();

export function embedTtf(doc: PdfDocument, ttf: ParsedTtf, baseName: string): EmbeddedTtf {
  let docCache = cache.get(doc);
  if (!docCache) {
    docCache = new Map();
    cache.set(doc, docCache);
  }
  const hit = docCache.get(ttf);
  if (hit) return hit.result;

  // 1) /FontFile2 stream — TTF binary, FlateDecode 압축, /Length1 = 비압축 크기.
  const fileBytes = ttf.raw;
  const compressed = zlib.deflateSync(Buffer.from(fileBytes));
  const fontFileStream = pdfStream(
    pdfDict([
      ['Length', pdfInt(compressed.length)],
      ['Length1', pdfInt(fileBytes.length)],
      ['Filter', pdfName('FlateDecode')],
    ]),
    new Uint8Array(compressed),
  );
  const fontFileRef = doc.allocateObject(fontFileStream);

  // 2) /FontDescriptor
  const ascent = Math.round((ttf.ascender * 1000) / ttf.unitsPerEm);
  const descent = Math.round((ttf.descender * 1000) / ttf.unitsPerEm);
  const fontBBox = pdfArray([pdfInt(0), pdfInt(descent), pdfInt(1000), pdfInt(ascent)]);
  const fontDescriptor = pdfDict([
    ['Type', pdfName('FontDescriptor')],
    ['FontName', pdfName(baseName)],
    ['Flags', pdfInt(4)], // 4 = Symbolic (안전 기본값)
    ['FontBBox', fontBBox],
    ['ItalicAngle', pdfInt(0)],
    ['Ascent', pdfInt(ascent)],
    ['Descent', pdfInt(descent)],
    ['CapHeight', pdfInt(ascent)],
    ['StemV', pdfInt(80)],
    ['FontFile2', fontFileRef],
  ]);
  const fontDescriptorRef = doc.allocateObject(fontDescriptor);

  // 3) CIDFontType2 (DescendantFont). CIDSystemInfo = Adobe-Identity. CID == GID.
  const widthsArray = buildPdfWidthsArray(ttf);
  const cidFont = pdfDict([
    ['Type', pdfName('Font')],
    ['Subtype', pdfName('CIDFontType2')],
    ['BaseFont', pdfName(baseName)],
    [
      'CIDSystemInfo',
      pdfDict([
        ['Registry', pdfLiteralString('Adobe')],
        ['Ordering', pdfLiteralString('Identity')],
        ['Supplement', pdfInt(0)],
      ]),
    ],
    ['FontDescriptor', fontDescriptorRef],
    ['CIDToGIDMap', pdfName('Identity')],
    ['W', widthsArray],
    ['DW', pdfInt(1000)],
  ]);
  const cidFontRef = doc.allocateObject(cidFont);

  // 4) ToUnicode CMap stream — copy/paste / 검색용 GID→Unicode 역매핑.
  const toUnicode = buildToUnicodeCMap(ttf, baseName);
  const toUnicodeCompressed = zlib.deflateSync(Buffer.from(toUnicode));
  const toUnicodeStream = pdfStream(
    pdfDict([
      ['Length', pdfInt(toUnicodeCompressed.length)],
      ['Filter', pdfName('FlateDecode')],
    ]),
    new Uint8Array(toUnicodeCompressed),
  );
  const toUnicodeRef = doc.allocateObject(toUnicodeStream);

  // 5) Type0 wrapper.
  const type0 = pdfDict([
    ['Type', pdfName('Font')],
    ['Subtype', pdfName('Type0')],
    ['BaseFont', pdfName(baseName)],
    ['Encoding', pdfName('Identity-H')],
    ['DescendantFonts', pdfArray([cidFontRef])],
    ['ToUnicode', toUnicodeRef],
  ]);
  const fontRef = doc.allocateObject(type0);

  const result: EmbeddedTtf = {
    fontRef,
    baseName,
    encodeHex(text: string) {
      let hex = '';
      let advance = 0;
      const missing: string[] = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        const gid = ttf.unicodeToGid.get(cp);
        if (gid === undefined || gid === 0) {
          missing.push(ch);
          // Identity-H 에서 GID 0 = .notdef → blank glyph 로 출력
          hex += '0000';
          advance += 1000; // 임의 — .notdef advance 모름
        } else {
          hex += gid.toString(16).padStart(4, '0').toUpperCase();
          const w = (ttf.advanceWidthByGid[gid] ?? 0) * 1000 / ttf.unitsPerEm;
          advance += w;
        }
      }
      return { hex, advance, missing };
    },
  };
  docCache.set(ttf, { result });
  return result;
}

/** PDF /W array: [c [w0 w1 w2 ...]] 형태. 길이 절약을 위해 같은 width 가 연속이면 range 로. */
function buildPdfWidthsArray(ttf: ParsedTtf) {
  const widths = ttf.advanceWidthByGid.map((w) =>
    Math.round((w * 1000) / ttf.unitsPerEm),
  );
  const items: ReturnType<typeof pdfArray>['items'] = [];
  let i = 0;
  while (i < widths.length) {
    // 연속 구간을 [c [w0 w1 w2]] 형태로
    let j = i;
    const seg: number[] = [];
    while (j < widths.length && j - i < 64) {
      seg.push(widths[j]!);
      j += 1;
    }
    items.push(pdfInt(i));
    items.push(pdfArray(seg.map((w) => pdfInt(w))));
    i = j;
  }
  return pdfArray(items);
}

/** ToUnicode CMap 본문 — GID → Unicode 매핑. Identity-H 기준 CID==GID. */
function buildToUnicodeCMap(ttf: ParsedTtf, fontName: string): Uint8Array {
  const lines: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    `/CMapName /Adobe-Identity-UCS def`,
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ];
  // Inverse: gid → unicode. Build from unicodeToGid.
  const gidToUni = new Map<number, number>();
  for (const [cp, gid] of ttf.unicodeToGid) {
    if (!gidToUni.has(gid)) gidToUni.set(gid, cp);
  }
  // bfchar 100 단위로 chunk
  const entries = [...gidToUni.entries()].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < entries.length; i += 100) {
    const slice = entries.slice(i, i + 100);
    lines.push(`${slice.length} beginbfchar`);
    for (const [gid, cp] of slice) {
      const gidHex = gid.toString(16).padStart(4, '0').toUpperCase();
      // BMP 외(supplementary)는 surrogate pair 로
      if (cp > 0xffff) {
        const high = 0xd800 + ((cp - 0x10000) >> 10);
        const low = 0xdc00 + ((cp - 0x10000) & 0x3ff);
        const cpHex =
          high.toString(16).padStart(4, '0').toUpperCase() +
          low.toString(16).padStart(4, '0').toUpperCase();
        lines.push(`<${gidHex}> <${cpHex}>`);
      } else {
        const cpHex = cp.toString(16).padStart(4, '0').toUpperCase();
        lines.push(`<${gidHex}> <${cpHex}>`);
      }
    }
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  void fontName;
  return new TextEncoder().encode(lines.join('\n'));
}
