// PdfDocument: 진입점. open()으로 PDF byte → 문서 객체.

import {
  PdfArray,
  PdfDict,
  PdfObject,
  PdfRef,
  PdfStream,
  asNumber,
  cloneObject,
  dictGet,
  dictSet,
  isArray,
  isDict,
  isInt,
  isName,
  isRef,
  isStream,
  pdfArray,
  pdfDict,
  pdfInt,
  pdfName,
  pdfRef,
  pdfStream,
  PdfNull,
} from '../core/object';
import { ParseError, Tokenizer } from '../core/tokenizer';
import { decodeStream } from '../core/stream';
import { FullXref, XrefEntry, loadAllXref } from '../core/xref';
import { Lexer } from './lexer';

export interface OpenOptions {
  maxBytes?: number; // 기본 200 MB
}

export interface Diagnostic {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  offset?: number;
}

export interface PageHandle {
  index: number; // 0-based
  ref: PdfRef; // 페이지 객체 참조
  dict: PdfDict;
}

export class PdfDocument {
  readonly buf: Uint8Array; // 원본 바이트 (incremental update의 base)
  readonly version: string;
  readonly xref: FullXref;
  readonly trailer: PdfDict;
  readonly diagnostics: Diagnostic[] = [];

  // 객체 캐시. key = `${num}_${gen}`. compressed object는 stream 단위로 한 번에 로드.
  private cache = new Map<string, PdfObject>();
  // 신규/수정된 객체. 직렬화 시 사용.
  readonly dirty = new Map<number, { gen: number; obj: PdfObject }>();
  // 다음 객체 번호 (할당용).
  private nextNum: number;

  constructor(buf: Uint8Array, version: string, xref: FullXref) {
    this.buf = buf;
    this.version = version;
    this.xref = xref;
    this.trailer = xref.trailer;
    // /Size 가 다음 사용 가능 번호
    const size = asNumber(dictGet(xref.trailer, 'Size')) ?? 1;
    this.nextNum = size;
  }

  static open(buf: Uint8Array, opts: OpenOptions = {}): PdfDocument {
    const max = (opts.maxBytes ?? 200 * 1024 * 1024);
    if (buf.length > max) throw new Error(`File too large: ${buf.length} > ${max}`);

    // 헤더에서 버전 추출 + 보정 (앞에 garbage가 있을 수 있음)
    let headerOffset = -1;
    const limit = Math.min(buf.length, 1024);
    for (let i = 0; i + 4 < limit; i += 1) {
      if (
        buf[i] === 0x25 &&
        buf[i + 1] === 0x50 &&
        buf[i + 2] === 0x44 &&
        buf[i + 3] === 0x46 &&
        buf[i + 4] === 0x2d
      ) {
        headerOffset = i;
        break;
      }
    }
    if (headerOffset < 0) throw new ParseError('PDF header not found');
    let version = '1.4';
    let p = headerOffset + 5;
    while (p < buf.length && buf[p] !== 0x0d && buf[p] !== 0x0a) p += 1;
    version = new TextDecoder('latin1').decode(buf.subarray(headerOffset + 5, p)).trim();

    // 암호화 PDF reject
    const xref = loadAllXref(buf);
    if (dictGet(xref.trailer, 'Encrypt')) {
      const e = new Error('Encrypted PDFs are not supported');
      (e as Error & { code?: string }).code = 'unsupported-encrypted';
      throw e;
    }

    return new PdfDocument(buf, version, xref);
  }

  // ---- 객체 resolve ----

  // ref → 실제 객체. 비-ref이면 그대로 반환.
  resolve(obj: PdfObject | undefined): PdfObject {
    if (!obj) return PdfNull;
    if (obj.kind !== 'ref') return obj;
    return this.getObject(obj.num, obj.gen);
  }

  getObject(num: number, gen = 0): PdfObject {
    const key = `${num}_${gen}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    // dirty가 있으면 dirty 우선
    const d = this.dirty.get(num);
    if (d && d.gen === gen) {
      this.cache.set(key, d.obj);
      return d.obj;
    }
    const entry = this.xref.entries.get(num);
    if (!entry) return PdfNull;
    if (entry.type === 'free') return PdfNull;
    let obj: PdfObject;
    if (entry.type === 'inUse') {
      const lexer = new Lexer(this.buf);
      const parsed = lexer.parseIndirectObject(entry.offset);
      obj = parsed.obj;
      // /Length가 indirect ref인 stream의 경우 후처리
      if (obj.kind === 'stream') {
        const lenObj = dictGet(obj.dict, 'Length');
        if (lenObj && isRef(lenObj)) {
          const lenVal = this.resolve(lenObj);
          if (isInt(lenVal)) {
            // stream의 raw가 endstream 검색으로 결정됐을 수 있음 — 길이가 더 짧으면 trim
            if (obj.raw.length > lenVal.value) {
              obj.raw = obj.raw.subarray(0, lenVal.value);
            }
            dictSet(obj.dict, 'Length', pdfInt(lenVal.value));
          }
        }
      }
    } else {
      // compressed: object stream에서 추출
      obj = this.loadFromObjectStream(entry.streamObjNum, entry.index, num);
    }
    this.cache.set(key, obj);
    return obj;
  }

  private loadFromObjectStream(streamObjNum: number, index: number, targetNum: number): PdfObject {
    const ostream = this.getObject(streamObjNum, 0);
    if (!isStream(ostream)) throw new ParseError(`Not an object stream: ${streamObjNum}`);
    const data = decodeStream(ostream);
    const N = asNumber(dictGet(ostream.dict, 'N')) ?? 0;
    const First = asNumber(dictGet(ostream.dict, 'First')) ?? 0;
    // 헤더: N개의 (objNum offset) pair
    const tk = new Tokenizer(data, 0);
    const offsets: Array<{ num: number; offset: number }> = [];
    for (let i = 0; i < N; i += 1) {
      const tA = tk.next();
      const tB = tk.next();
      if (tA.type !== 'int' || tB.type !== 'int') {
        throw new ParseError(`Bad object stream header at index ${i}`);
      }
      offsets.push({ num: tA.value as number, offset: tB.value as number });
    }
    if (index >= offsets.length) throw new ParseError(`Object stream index OOB: ${index}`);
    const target = offsets[index]!;
    if (target.num !== targetNum) {
      // 비표준 — 인덱스 기반으로 진행
    }
    const lexer = new Lexer(data);
    return lexer.parseObject(First + target.offset).obj;
  }

  // ---- Stream decode 헬퍼 ----

  decodeStream(stream: PdfStream): Uint8Array {
    return decodeStream(stream);
  }

  // ---- 페이지 트리 ----

  catalog(): PdfDict {
    const root = dictGet(this.trailer, 'Root');
    const obj = this.resolve(root);
    if (!isDict(obj)) throw new ParseError('Catalog is not a dict');
    return obj;
  }

  pageTreeRoot(): { ref: PdfRef; dict: PdfDict } {
    const cat = this.catalog();
    const pagesRef = dictGet(cat, 'Pages');
    if (!isRef(pagesRef)) throw new ParseError('Catalog /Pages is not a ref');
    const dict = this.resolve(pagesRef);
    if (!isDict(dict)) throw new ParseError('/Pages target is not a dict');
    return { ref: pagesRef, dict };
  }

  // 페이지 트리 평면화. 상속(MediaBox, Resources 등)은 *해석 시점에만* 사용,
  // 객체 자체는 변경하지 않음.
  getPages(): PageHandle[] {
    const out: PageHandle[] = [];
    const root = this.pageTreeRoot();
    this.walkPageTree(root.ref, root.dict, out);
    return out;
  }

  private walkPageTree(ref: PdfRef, node: PdfDict, out: PageHandle[]): void {
    const type = dictGet(node, 'Type');
    if (isName(type) && type.value === 'Page') {
      out.push({ index: out.length, ref, dict: node });
      return;
    }
    const kids = dictGet(node, 'Kids');
    if (!isArray(kids)) return;
    for (const k of kids.items) {
      if (!isRef(k)) continue;
      const child = this.resolve(k);
      if (!isDict(child)) continue;
      this.walkPageTree(k, child, out);
    }
  }

  // 페이지 dict의 효과적 키 (상속 적용).
  inheritedAttr(page: PdfDict, key: string): PdfObject | undefined {
    let cur: PdfDict | undefined = page;
    while (cur) {
      const v = dictGet(cur, key);
      if (v) return v;
      const parent = dictGet(cur, 'Parent');
      cur = parent ? (this.resolve(parent) as PdfDict | undefined) : undefined;
      if (cur && !isDict(cur)) cur = undefined;
    }
    return undefined;
  }

  // 페이지의 /Resources를 상속 적용 후 반환 (없으면 빈 dict).
  pageResources(page: PdfDict): PdfDict {
    const r = this.inheritedAttr(page, 'Resources');
    if (r) {
      const resolved = this.resolve(r);
      if (isDict(resolved)) return resolved;
    }
    return pdfDict();
  }

  // 페이지의 /MediaBox 상속 적용. 기본 A4.
  pageMediaBox(page: PdfDict): [number, number, number, number] {
    const m = this.inheritedAttr(page, 'MediaBox');
    if (m && isArray(m) && m.items.length === 4) {
      return [
        asNumber(this.resolve(m.items[0]!)) ?? 0,
        asNumber(this.resolve(m.items[1]!)) ?? 0,
        asNumber(this.resolve(m.items[2]!)) ?? 595,
        asNumber(this.resolve(m.items[3]!)) ?? 842,
      ];
    }
    return [0, 0, 595, 842];
  }

  pageRotation(page: PdfDict): 0 | 90 | 180 | 270 {
    const r = this.inheritedAttr(page, 'Rotate');
    const v = asNumber(this.resolve(r ?? PdfNull));
    if (v === 90 || v === 180 || v === 270) return v;
    return 0;
  }

  // 페이지 콘텐츠 stream 단일 byte로 합치기 (배열이면 concat). 결과는 ref 기준 캐시.
  private contentCache = new Map<string, Uint8Array>();

  pageContent(page: PdfDict): Uint8Array {
    // 캐시 키: /Contents 의 ref(s). 값이 변경되면 재계산.
    const c = dictGet(page, 'Contents');
    if (!c) return new Uint8Array();
    const key = contentCacheKey(c);
    if (key) {
      const hit = this.contentCache.get(key);
      if (hit) return hit;
    }
    let result: Uint8Array;
    if (isRef(c)) {
      const obj = this.resolve(c);
      result = isStream(obj) ? decodeStream(obj) : new Uint8Array();
    } else if (isArray(c)) {
      const parts: Uint8Array[] = [];
      for (const item of c.items) {
        const obj = this.resolve(item);
        if (isStream(obj)) parts.push(decodeStream(obj));
        // 콘텐츠 스트림 사이에 공백 1개 (§7.8.2)
        parts.push(new Uint8Array([0x20]));
      }
      result = concatBytes(parts);
    } else if (isStream(c)) {
      result = decodeStream(c);
    } else {
      result = new Uint8Array();
    }
    if (key) this.contentCache.set(key, result);
    return result;
  }

  // 콘텐츠 캐시 무효화 (페이지 콘텐츠 수정 후 호출)
  invalidateContentCache(): void {
    this.contentCache.clear();
  }

  // ---- 변경 추적 ----

  markDirty(num: number, gen: number, obj: PdfObject): void {
    this.dirty.set(num, { gen, obj });
    this.cache.set(`${num}_${gen}`, obj);
  }

  allocateObject(obj: PdfObject): PdfRef {
    const num = this.nextNum;
    this.nextNum += 1;
    this.markDirty(num, 0, obj);
    return pdfRef(num, 0);
  }

  freeObject(num: number, gen: number): void {
    // generation 1 증가 후 free 표시. 실제 xref free list 갱신은 writer가.
    this.dirty.set(num, { gen: gen + 1, obj: PdfNull });
    // free 마킹 별도 set
    this.freed.add(num);
  }

  readonly freed = new Set<number>();

  // ---- 크기/통계 ----

  pageCount(): number {
    return this.getPages().length;
  }

  // 다음 객체 번호 (writer가 사용)
  getNextNum(): number {
    return this.nextNum;
  }

  setNextNum(n: number): void {
    this.nextNum = Math.max(this.nextNum, n);
  }
}

function contentCacheKey(c: PdfObject): string | null {
  if (c.kind === 'ref') return `r${c.num}_${c.gen}`;
  if (c.kind === 'array') {
    const refs: string[] = [];
    for (const item of c.items) {
      if (item.kind === 'ref') refs.push(`${item.num}_${item.gen}`);
      else return null; // 인라인 stream은 캐시 안 함 (안전)
    }
    return 'a:' + refs.join(',');
  }
  return null;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
