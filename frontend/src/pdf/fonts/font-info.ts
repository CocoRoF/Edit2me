// 페이지 리소스의 폰트를 *추출용 가벼운 인터페이스*로 정규화.

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
import { CidMapLookup, getCidLookup } from './cid-mappings';

export interface FontInfo {
  resourceName: string;
  baseName: string;
  isCore14: boolean;
  isComposite: boolean; // Type0 (CID-keyed) 폰트
  /** byte 시퀀스를 char code 시퀀스로 분해. composite은 보통 2-byte 고정. */
  decodeBytes: (bytes: Uint8Array) => { codes: number[]; lengths: number[] };
  /** code → unicode (또는 매핑 부재 시 null). ASCII fallback 안 함 — 호출자 책임. */
  toUnicode: (code: number) => string | null;
  /** code → advance width (1/1000 em) */
  widthOf: (code: number) => number;
  ascent: number;
  descent: number;
  dict: PdfDict;
  /** 디코드 실패 진단 */
  warnings: string[];
  /** 이 폰트로 표시된 텍스트가 *완전히* 추출 가능한가 (편집 가능성 판단에 사용) */
  hasUnicodeMap: boolean;
}

const SIMPLE_LATIN_BACKUP: Map<number, string> = (() => {
  const m = new Map<number, string>();
  for (let i = 0x20; i <= 0x7e; i += 1) m.set(i, String.fromCharCode(i));
  return m;
})();

// WinAnsiEncoding 의 비ASCII 영역 일부 (Latin1 호환).
// PDF 1.7 Appendix D 참고. 단순화를 위해 0xa0 이상은 Latin1 그대로.
function winAnsiUnicode(code: number): string | undefined {
  if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
  if (code >= 0xa0 && code <= 0xff) return String.fromCharCode(code);
  // 0x80-0x9f는 공식 매핑이 다양 — 건너뛴다.
  return undefined;
}

// MacRomanEncoding 등은 v0.2에서. 현재는 식별만.

export function buildFontInfo(
  doc: PdfDocument,
  resourceName: string,
  fontDict: PdfDict,
): FontInfo {
  const warnings: string[] = [];
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
        const cmap = parseToUnicodeCMap(decodeStream(stream));
        toUni = cmap.toUnicode;
        if (cmap.usesParent) {
          warnings.push(
            `ToUnicode CMap inherits from "${cmap.usesParent}" — parent CMap not bundled (some glyphs may be missing)`,
          );
        }
        if (toUni.size === 0) {
          warnings.push('ToUnicode CMap parsed empty — text extraction will fall back');
          toUni = undefined;
        }
      } catch (e) {
        warnings.push(`ToUnicode CMap parse failed: ${(e as Error).message}`);
        toUni = undefined;
      }
    }
  }

  // Widths (단순 폰트 + 코어 14)
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

  // Composite 폰트의 W array + CIDSystemInfo
  let cidLookup: CidMapLookup | null = null;
  let cidSystemInfo: { registry: string; ordering: string } | null = null;
  if (isComposite) {
    const descendants = dictGet(fontDict, 'DescendantFonts');
    if (descendants && isArray(descendants)) {
      const dRef = descendants.items[0];
      if (dRef) {
        const cidFont = doc.resolve(dRef);
        if (isDict(cidFont)) {
          const w = dictGet(cidFont, 'W');
          if (w && isArray(w)) parseCIDWidths(w, doc, widthMap);
          const dw = asNumber(dictGet(cidFont, 'DW'));
          if (dw !== undefined) defaultWidth = dw;
          // CIDSystemInfo 추출 → CID 매핑 lookup
          const cidSysObj = dictGet(cidFont, 'CIDSystemInfo');
          if (cidSysObj) {
            const cidSys = doc.resolve(cidSysObj);
            if (isDict(cidSys)) {
              const reg = doc.resolve(dictGet(cidSys, 'Registry') ?? { kind: 'null' });
              const ord = doc.resolve(dictGet(cidSys, 'Ordering') ?? { kind: 'null' });
              const regStr = isString(reg)
                ? new TextDecoder('latin1').decode(reg.bytes)
                : isName(reg)
                  ? reg.value
                  : '';
              const ordStr = isString(ord)
                ? new TextDecoder('latin1').decode(ord.bytes)
                : isName(ord)
                  ? ord.value
                  : '';
              if (regStr && ordStr) {
                cidSystemInfo = { registry: regStr, ordering: ordStr };
                cidLookup = getCidLookup(regStr, ordStr);
                if (!cidLookup && !toUni) {
                  warnings.push(
                    `No bundled CID mapping for ${regStr}-${ordStr}. ` +
                      'Run `npm run build:cmaps` to fetch Adobe CMap data, or rely on PDF\'s own ToUnicode.',
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  // 코어 14는 메트릭으로 보강
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

  // ---- decodeBytes: byte 시퀀스 → code 시퀀스 ----

  const decodeBytes = isComposite
    ? makeCompositeDecoder(doc, fontDict, warnings)
    : makeSimpleDecoder();

  // ---- toUnicode: ASCII fallback은 *단순 폰트*에만 적용 ----

  const encoding = parseEncodingHint(fontDict);

  function toUnicodeFn(code: number): string | null {
    if (toUni) {
      const u = toUni.get(code);
      if (u !== undefined) return u;
    }
    if (isComposite) {
      // CID. ToUnicode 가 없거나 누락된 entry → bundled CID map (Adobe-Korea1 등) 시도.
      if (cidLookup) {
        const u = cidLookup(code);
        if (u !== null) return u;
      }
      // ASCII로 *절대* fallback하지 않음 (A1 버그 회피).
      return null;
    }
    // 단순 폰트: 코어14 또는 표준 인코딩 fallback
    if (isCore) {
      const u = SIMPLE_LATIN_BACKUP.get(code);
      if (u) return u;
    }
    if (encoding === 'WinAnsiEncoding' || encoding === 'StandardEncoding' || encoding === 'MacRomanEncoding') {
      const u = winAnsiUnicode(code);
      if (u) return u;
    }
    // 단순 폰트 + 알려지지 않은 인코딩이면, ASCII 영역만 통과 (관용)
    if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
    return null;
  }

  if (isComposite && !toUni && !cidLookup) {
    warnings.push(
      'Composite font without ToUnicode CMap and no bundled CID mapping — text cannot be decoded',
    );
  }

  return {
    resourceName,
    baseName,
    isCore14: isCore,
    isComposite,
    decodeBytes,
    toUnicode: toUnicodeFn,
    widthOf(code: number) {
      const w = widthMap.get(code);
      if (w !== undefined) return w;
      return defaultWidth;
    },
    ascent: coreMetrics?.ascent ?? 700,
    descent: coreMetrics?.descent ?? -200,
    dict: fontDict,
    warnings,
    hasUnicodeMap:
      toUni !== undefined ||
      (isComposite && cidLookup !== null) ||
      (!isComposite && (isCore || encoding !== undefined)),
  };
}

// ---- helpers ----

function stripSubsetPrefix(name: string): string {
  if (name.length >= 7 && name[6] === '+') return name.slice(7);
  return name;
}

function parseEncodingHint(fontDict: PdfDict): string | undefined {
  const enc = dictGet(fontDict, 'Encoding');
  if (!enc) return undefined;
  if (isName(enc)) return enc.value;
  if (isDict(enc)) {
    const base = dictGet(enc, 'BaseEncoding');
    if (isName(base)) return base.value;
  }
  return undefined;
}

function makeSimpleDecoder(): FontInfo['decodeBytes'] {
  return (bytes: Uint8Array) => {
    const codes: number[] = [];
    const lengths: number[] = [];
    for (const b of bytes) {
      codes.push(b);
      lengths.push(1);
    }
    return { codes, lengths };
  };
}

function makeCompositeDecoder(
  doc: PdfDocument,
  fontDict: PdfDict,
  warnings: string[],
): FontInfo['decodeBytes'] {
  // Encoding 분석:
  // - /Identity-H, /Identity-V → 2-byte 고정 (CID = code).
  // - 명명된 표준 CMap (UniKS-UCS2-H 등) → 2-byte 고정 (대부분 단일 바이트 단위).
  // - Stream → CMap 본문 분석으로 codeRanges 추출 → 가변 byte 가능.
  const enc = dictGet(fontDict, 'Encoding');

  let byteRanges: Array<{ low: number; high: number; bytes: number }> | null = null;

  if (enc && isStream(enc)) {
    try {
      const cmap = parseToUnicodeCMap(decodeStream(enc));
      if (cmap.codeRanges.length > 0) byteRanges = cmap.codeRanges;
    } catch (e) {
      warnings.push(`Encoding CMap parse failed: ${(e as Error).message}`);
    }
  }

  // 기본: 2-byte 고정 (Identity-H, 명명된 표준 CMap의 일반적 형태)
  if (!byteRanges) {
    return (bytes: Uint8Array) => {
      const codes: number[] = [];
      const lengths: number[] = [];
      let i = 0;
      const n = bytes.length;
      while (i + 1 < n) {
        codes.push(((bytes[i]! << 8) | bytes[i + 1]!) & 0xffff);
        lengths.push(2);
        i += 2;
      }
      // 홀수 마지막 byte가 남으면 무시 (잘못된 입력 방어)
      return { codes, lengths };
    };
  }

  // 가변 byte: codeRanges에 따라 그리디 매칭
  const sortedRanges = [...byteRanges].sort((a, b) => b.bytes - a.bytes);
  return (bytes: Uint8Array) => {
    const codes: number[] = [];
    const lengths: number[] = [];
    let i = 0;
    const n = bytes.length;
    while (i < n) {
      let matched = false;
      for (const r of sortedRanges) {
        if (i + r.bytes > n) continue;
        let v = 0;
        for (let j = 0; j < r.bytes; j += 1) v = (v << 8) | bytes[i + j]!;
        if (v >= r.low && v <= r.high) {
          codes.push(v);
          lengths.push(r.bytes);
          i += r.bytes;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 매칭 실패: 1 byte 건너뛰기 (관용 처리)
        i += 1;
      }
    }
    return { codes, lengths };
  };
}

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
      // skip 폰트 — 안전한 fallback (다른 폰트는 처리 가능하도록)
    }
  }
  return out;
}
