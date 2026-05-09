// 페이지 리소스의 폰트를 *추출용 가벼운 인터페이스*로 정규화.
//
// width 추출, byte → unicode 디코드, ToUnicode CMap parse를 담는다.

import {
  PdfDict,
  PdfObject,
  asNumber,
  dictGet,
  isArray,
  isDict,
  isInt,
  isName,
  isReal,
  isStream,
  isString,
} from '../core/object';
import { decodeStream } from '../core/stream';
import { PdfDocument } from '../parser/document';
import { CORE_14, isCore14, CoreFontMetrics } from './core14';
import { parseToUnicodeCMap } from './cmap';

export interface FontInfo {
  resourceName: string; // 페이지 자원 dict의 키 (예: 'F1')
  baseName: string;
  isCore14: boolean;
  isCJK: boolean;
  // byte 시퀀스를 char code들로 분해하는 함수.
  // 단순 8bit 폰트면 byte 1개 = code 1개. composite은 2바이트.
  // returns: { codes: number[], byteLengths: number[] } (바이트 단위 길이도 같이)
  decodeBytes: (bytes: Uint8Array) => { codes: number[]; lengths: number[] };
  // code → unicode (ToUnicode 우선, 없으면 추정)
  toUnicode: (code: number) => string | undefined;
  // code → advance width (1/1000 em, 폰트 크기에 곱하면 pt)
  widthOf: (code: number) => number;
  ascent: number;
  descent: number;
  // raw font dict (for downstream)
  dict: PdfDict;
}

const SIMPLE_LATIN_BACKUP: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  // ASCII identity
  for (let i = 0x20; i <= 0x7e; i += 1) m[i] = String.fromCharCode(i);
  return m;
})();

export function buildFontInfo(
  doc: PdfDocument,
  resourceName: string,
  fontDict: PdfDict,
): FontInfo {
  const subtype = dictGet(fontDict, 'Subtype');
  const baseFont = dictGet(fontDict, 'BaseFont');
  const baseName =
    baseFont && isName(baseFont) ? stripSubsetPrefix(baseFont.value) : 'Unknown';
  const subtypeName = subtype && isName(subtype) ? subtype.value : '';
  const isComposite = subtypeName === 'Type0';
  const isCore = isCore14(baseName) && !isComposite;

  // ToUnicode CMap
  let toUni: Map<number, string> | undefined;
  const tuObj = dictGet(fontDict, 'ToUnicode');
  if (tuObj) {
    const stream = doc.resolve(tuObj);
    if (isStream(stream)) {
      try {
        toUni = parseToUnicodeCMap(decodeStream(stream));
      } catch {
        toUni = undefined;
      }
    }
  }

  // Widths
  const widthMap = new Map<number, number>();
  let defaultWidth = 500;
  const widthsObj = dictGet(fontDict, 'Widths');
  const firstChar = asNumber(dictGet(fontDict, 'FirstChar'));
  if (widthsObj) {
    const arr = doc.resolve(widthsObj);
    if (isArray(arr) && firstChar !== undefined) {
      for (let i = 0; i < arr.items.length; i += 1) {
        const v = doc.resolve(arr.items[i]!);
        const n = asNumber(v);
        if (n !== undefined) widthMap.set(firstChar + i, n);
      }
    }
  }
  // Type0 폰트의 widths는 W array (CID 기반). 단순 처리:
  if (isComposite) {
    const descendants = dictGet(fontDict, 'DescendantFonts');
    if (descendants && isArray(descendants)) {
      const dRef = descendants.items[0];
      if (dRef) {
        const cidFont = doc.resolve(dRef);
        if (isDict(cidFont)) {
          const w = dictGet(cidFont, 'W');
          if (w && isArray(w)) {
            parseCIDWidths(w, doc, widthMap);
          }
          const dw = asNumber(dictGet(cidFont, 'DW'));
          if (dw !== undefined) defaultWidth = dw;
        }
      }
    }
  }

  // 코어14는 메트릭으로 보강
  let coreMetrics: CoreFontMetrics | undefined;
  if (isCore) {
    coreMetrics = CORE_14[baseName];
    if (coreMetrics) {
      for (const [k, v] of coreMetrics.widths) {
        if (!widthMap.has(k)) widthMap.set(k, v);
      }
      defaultWidth = coreMetrics.defaultWidth;
    }
  }

  const decodeBytes = isComposite
    ? (bytes: Uint8Array) => {
        const codes: number[] = [];
        const lengths: number[] = [];
        // 가장 흔한 케이스: 2바이트 고정 (Identity-H, UniKS-UCS2-H 등)
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          codes.push((bytes[i]! << 8) | bytes[i + 1]!);
          lengths.push(2);
        }
        return { codes, lengths };
      }
    : (bytes: Uint8Array) => {
        const codes: number[] = [];
        const lengths: number[] = [];
        for (const b of bytes) {
          codes.push(b);
          lengths.push(1);
        }
        return { codes, lengths };
      };

  return {
    resourceName,
    baseName,
    isCore14: isCore,
    isCJK: isComposite,
    decodeBytes,
    toUnicode(code) {
      if (toUni) {
        const u = toUni.get(code);
        if (u !== undefined) return u;
      }
      // 코어14의 경우 ASCII identity
      if (isCore && code in SIMPLE_LATIN_BACKUP) return SIMPLE_LATIN_BACKUP[code];
      // 그 외는 ASCII는 통과
      if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
      return undefined;
    },
    widthOf(code) {
      const w = widthMap.get(code);
      if (w !== undefined) return w;
      return defaultWidth;
    },
    ascent: coreMetrics?.ascent ?? 700,
    descent: coreMetrics?.descent ?? -200,
    dict: fontDict,
  };
}

function stripSubsetPrefix(name: string): string {
  // PDF 임베디드 서브셋 폰트 이름은 'XXXXXX+Name' 형태.
  if (name.length >= 7 && name[6] === '+') {
    return name.slice(7);
  }
  return name;
}

// CIDFont의 /W array 파싱.
// 형식 1: [c [w1 w2 w3]] — c부터 시작, 각 width
// 형식 2: [c1 c2 w] — c1..c2 모두 width w
function parseCIDWidths(
  w: { items: PdfObject[] },
  doc: PdfDocument,
  out: Map<number, number>,
): void {
  let i = 0;
  while (i < w.items.length) {
    const a = doc.resolve(w.items[i]!);
    const aN = asNumber(a);
    if (aN === undefined) {
      i += 1;
      continue;
    }
    const next = w.items[i + 1];
    if (!next) break;
    const nextR = doc.resolve(next);
    if (isArray(nextR)) {
      // form 1
      for (let j = 0; j < nextR.items.length; j += 1) {
        const wv = asNumber(doc.resolve(nextR.items[j]!));
        if (wv !== undefined) out.set(aN + j, wv);
      }
      i += 2;
    } else {
      const bN = asNumber(nextR);
      const wObj = w.items[i + 2];
      const wN = asNumber(doc.resolve(wObj ?? { kind: 'null' }));
      if (bN !== undefined && wN !== undefined) {
        for (let c = aN; c <= bN; c += 1) out.set(c, wN);
      }
      i += 3;
    }
  }
}

// 페이지 리소스에서 모든 폰트를 FontInfo로.
export function buildFontMap(doc: PdfDocument, page: PdfDict): Map<string, FontInfo> {
  const resources = doc.pageResources(page);
  const fontsObj = dictGet(resources, 'Font');
  const fonts = fontsObj ? doc.resolve(fontsObj) : undefined;
  const out = new Map<string, FontInfo>();
  if (!fonts || fonts.kind !== 'dict') return out;
  for (const [name, ref] of fonts.map) {
    const fd = doc.resolve(ref);
    if (fd.kind !== 'dict') continue;
    try {
      out.set(name, buildFontInfo(doc, name, fd));
    } catch {
      // skip 폰트 — 안전한 fallback
    }
  }
  return out;
}
