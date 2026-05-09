// Cross-reference table 파싱 (§7.5.4 + §7.5.8 xref-stream)

import {
  PdfDict,
  PdfObject,
  PdfRef,
  PdfStream,
  asNumber,
  dictGet,
  isArray,
  isDict,
  isInt,
  isStream,
} from './object';
import { ParseError, Tokenizer, isWhitespace } from './tokenizer';
import { Lexer } from '../parser/lexer';
import { decodeStream } from './stream';

export type XrefEntry =
  | { type: 'free'; nextFree: number; gen: number }
  | { type: 'inUse'; offset: number; gen: number }
  | { type: 'compressed'; streamObjNum: number; index: number };

export interface XrefResult {
  entries: Map<number, XrefEntry>;
  trailer: PdfDict;
}

// ---- startxref offset 찾기 ----

const STARTXREF = new TextEncoder().encode('startxref');

export function locateStartxref(buf: Uint8Array): number {
  // 마지막 1024 byte에서 'startxref' 검색
  const tail = Math.max(0, buf.length - 4096);
  for (let i = buf.length - STARTXREF.length; i >= tail; i -= 1) {
    let match = true;
    for (let j = 0; j < STARTXREF.length; j += 1) {
      if (buf[i + j] !== STARTXREF[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      // startxref 다음 정수
      const tk = new Tokenizer(buf, i + STARTXREF.length);
      const t = tk.next();
      if (t.type === 'int') return t.value as number;
    }
  }
  throw new ParseError('startxref not found');
}

// ---- 단일 xref 섹션 파싱 (xref가 'xref' 키워드로 시작하면 classical, 아니면 stream) ----

export function parseXrefAt(buf: Uint8Array, offset: number): XrefResult {
  const tk = new Tokenizer(buf, offset);
  // 'xref' 키워드?
  const save = tk.pos;
  const t = tk.next();
  if (t.type === 'keyword' && t.value === 'xref') {
    return parseClassicalXref(buf, tk);
  }
  // xref-stream: 'N G obj << /Type /XRef ... >>'
  tk.pos = save;
  return parseXrefStream(buf, offset);
}

function parseClassicalXref(buf: Uint8Array, tk: Tokenizer): XrefResult {
  const entries = new Map<number, XrefEntry>();
  while (true) {
    // 다음 토큰: 첫 번째 정수 (subsection start) 또는 'trailer'
    const save = tk.pos;
    const t = tk.next();
    if (t.type === 'keyword' && t.value === 'trailer') {
      // trailer dict 파싱
      const lexer = new Lexer(buf);
      const parsed = lexer.parseObjectFromTokens(tk);
      if (parsed.obj.kind !== 'dict') throw new ParseError('Trailer is not a dict');
      return { entries, trailer: parsed.obj };
    }
    if (t.type !== 'int') {
      throw new ParseError(`Expected subsection or trailer, got ${t.type}`, t.start);
    }
    const start = t.value as number;
    const tCount = tk.next();
    if (tCount.type !== 'int') throw new ParseError('Bad subsection', tCount.start);
    const count = tCount.value as number;
    // 이후 count개 entry. 각 20-byte (10 + 5 + 'n'/'f' + 2-byte EOL) 형식이지만
    // 토큰 기반으로 파싱하면 줄바꿈 변종에도 안전.
    for (let i = 0; i < count; i += 1) {
      const tA = tk.next();
      const tB = tk.next();
      const tC = tk.next();
      if (tA.type !== 'int' || tB.type !== 'int' || tC.type !== 'keyword') {
        throw new ParseError(`Bad xref entry at ${tA.start}`, tA.start);
      }
      const a = tA.value as number;
      const b = tB.value as number;
      const tag = tC.value as string;
      const objNum = start + i;
      if (tag === 'f') {
        if (!entries.has(objNum)) entries.set(objNum, { type: 'free', nextFree: a, gen: b });
      } else if (tag === 'n') {
        if (!entries.has(objNum))
          entries.set(objNum, { type: 'inUse', offset: a, gen: b });
      } else {
        throw new ParseError(`Bad xref tag '${tag}'`, tC.start);
      }
    }
  }
}

function parseXrefStream(buf: Uint8Array, offset: number): XrefResult {
  const lexer = new Lexer(buf);
  const parsed = lexer.parseIndirectObject(offset);
  if (parsed.obj.kind !== 'stream') {
    throw new ParseError('Expected xref stream object');
  }
  const stream = parsed.obj as PdfStream;
  const data = decodeStream(stream);
  const dict = stream.dict;
  const wObj = dictGet(dict, 'W');
  if (!isArray(wObj)) throw new ParseError('xref stream: missing /W');
  const W = wObj.items.map((x) => asNumber(x) ?? 0);
  if (W.length < 3) throw new ParseError('xref stream: bad /W');
  const entryWidth = W[0]! + W[1]! + W[2]!;

  // /Index 또는 [0 /Size]
  const indexObj = dictGet(dict, 'Index');
  const sizeObj = dictGet(dict, 'Size');
  const size = asNumber(sizeObj) ?? 0;
  let pairs: Array<[number, number]>;
  if (isArray(indexObj)) {
    pairs = [];
    for (let i = 0; i + 1 < indexObj.items.length; i += 2) {
      pairs.push([asNumber(indexObj.items[i]) ?? 0, asNumber(indexObj.items[i + 1]) ?? 0]);
    }
  } else {
    pairs = [[0, size]];
  }

  const entries = new Map<number, XrefEntry>();
  let dataPos = 0;
  for (const [start, count] of pairs) {
    for (let i = 0; i < count; i += 1) {
      const objNum = start + i;
      const f0 = readField(data, dataPos, W[0]!) ?? 1; // 기본 type=1 (in-use)
      const f1 = readField(data, dataPos + W[0]!, W[1]!) ?? 0;
      const f2 = readField(data, dataPos + W[0]! + W[1]!, W[2]!) ?? 0;
      dataPos += entryWidth;
      if (entries.has(objNum)) continue; // 가장 먼저 본 것이 우선
      if (f0 === 0) entries.set(objNum, { type: 'free', nextFree: f1, gen: f2 });
      else if (f0 === 1) entries.set(objNum, { type: 'inUse', offset: f1, gen: f2 });
      else if (f0 === 2)
        entries.set(objNum, { type: 'compressed', streamObjNum: f1, index: f2 });
      // 그 외 type은 무시
    }
  }
  return { entries, trailer: dict };
}

function readField(data: Uint8Array, pos: number, width: number): number | null {
  if (width === 0) return null;
  let v = 0;
  for (let i = 0; i < width; i += 1) {
    v = v * 256 + (data[pos + i] ?? 0);
  }
  return v;
}

// ---- 모든 xref 섹션 합치기 (/Prev 따라가며) ----

export interface FullXref {
  entries: Map<number, XrefEntry>;
  trailer: PdfDict; // 가장 *최신* trailer (체인의 head)
  startxrefOffsets: number[];
}

export function loadAllXref(buf: Uint8Array): FullXref {
  let offset = locateStartxref(buf);
  const visited = new Set<number>();
  const merged = new Map<number, XrefEntry>();
  let headTrailer: PdfDict | undefined;
  const offsets: number[] = [];

  while (!visited.has(offset)) {
    visited.add(offset);
    offsets.push(offset);
    let result: XrefResult;
    try {
      result = parseXrefAt(buf, offset);
    } catch (e) {
      // 관용 처리: ±10 byte 보정
      let recovered: XrefResult | undefined;
      for (const delta of [-1, 1, -2, 2, -10, 10]) {
        try {
          recovered = parseXrefAt(buf, offset + delta);
          break;
        } catch {
          /* try next */
        }
      }
      if (!recovered) throw e;
      result = recovered;
    }
    if (!headTrailer) headTrailer = result.trailer;
    // 머지: 가장 *최신* (head 우선)이 우선이므로, 이미 있는 키는 덮지 않음.
    for (const [k, v] of result.entries) {
      if (!merged.has(k)) merged.set(k, v);
    }
    const prev = dictGet(result.trailer, 'Prev');
    const prevOffset = asNumber(prev);
    if (typeof prevOffset !== 'number') break;
    offset = prevOffset;
  }
  if (!headTrailer) throw new ParseError('No trailer found');
  return { entries: merged, trailer: headTrailer, startxrefOffsets: offsets };
}
