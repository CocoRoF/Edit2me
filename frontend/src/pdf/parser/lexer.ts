// Lexer: 토크나이저 위에서 PDF 객체 1개를 파싱.
//
// 입력 byte buffer + 시작 offset → { obj, end }.

import {
  PdfDict,
  PdfObject,
  PdfStream,
  isInt,
  isName,
  pdfArray,
  pdfDict,
  pdfHexString,
  pdfInt,
  pdfLiteralString,
  pdfName,
  pdfReal,
  pdfRef,
  pdfStream,
  PdfNull,
  PdfTrue,
  PdfFalse,
} from '../core/object';
import { ParseError, Token, Tokenizer, isWhitespace } from '../core/tokenizer';

export interface ParsedObject {
  obj: PdfObject;
  end: number;
}

export interface ParsedIndirect {
  num: number;
  gen: number;
  obj: PdfObject;
  end: number; // endobj 키워드의 끝 + 1
}

export class Lexer {
  constructor(public buf: Uint8Array) {}

  // start offset에서 단일 객체 파싱 (top-level의 'N G obj ... endobj'가 아닌 안쪽).
  parseObject(start: number): ParsedObject {
    const tk = new Tokenizer(this.buf, start);
    return this.parseObjectFromTokens(tk);
  }

  // 'N G obj ... endobj' 직접 파싱.
  parseIndirectObject(start: number): ParsedIndirect {
    const tk = new Tokenizer(this.buf, start);
    const t1 = tk.next();
    const t2 = tk.next();
    const t3 = tk.next();
    if (t1.type !== 'int' || t2.type !== 'int' || t3.type !== 'keyword' || t3.value !== 'obj') {
      throw new ParseError(`Expected 'N G obj' at ${start}`, start);
    }
    const num = t1.value as number;
    const gen = t2.value as number;
    const parsed = this.parseObjectFromTokens(tk);
    let obj = parsed.obj;
    // 다음 토큰: 'endobj' 또는 'stream'
    const peekStart = tk.pos;
    tk.skipWhitespaceAndComments();
    // dict 다음에 'stream'이 오면 obj는 stream으로 변환.
    if (obj.kind === 'dict') {
      const peek = peekKeyword(this.buf, tk.pos);
      if (peek === 'stream') {
        const streamStart = tk.pos + 'stream'.length;
        // 'stream' 키워드 직후 EOL 1개 (CRLF 또는 LF 또는 CR)
        let bodyStart = streamStart;
        if (this.buf[bodyStart] === 0x0d) {
          bodyStart += 1;
          if (this.buf[bodyStart] === 0x0a) bodyStart += 1;
        } else if (this.buf[bodyStart] === 0x0a) {
          bodyStart += 1;
        }
        // 본문 길이 결정: dict의 /Length가 indirect ref면 후처리해야 하지만
        // 일단 직접 정수면 사용. 그 외는 'endstream' 검색.
        const lenObj = obj.map.get('Length');
        let bodyEnd: number;
        if (lenObj && isInt(lenObj)) {
          bodyEnd = bodyStart + lenObj.value;
          // sanity: bodyEnd 이후에 'endstream'이 있어야 함
          const expected = peekKeyword(this.buf, skipWs(this.buf, bodyEnd));
          if (expected !== 'endstream') {
            // 길이 어긋남 → endstream 검색으로 fallback
            bodyEnd = findEndstream(this.buf, bodyStart);
          }
        } else {
          bodyEnd = findEndstream(this.buf, bodyStart);
        }
        const raw = this.buf.subarray(bodyStart, bodyEnd);
        const stream: PdfStream = pdfStream(obj, new Uint8Array(raw));
        // 'endstream' 키워드 소비
        const tk2 = new Tokenizer(this.buf, bodyEnd);
        const tEs = tk2.next();
        if (tEs.type !== 'keyword' || tEs.value !== 'endstream') {
          throw new ParseError(`Expected endstream at ${bodyEnd}`, bodyEnd);
        }
        // 'endobj' 소비
        const tEob = tk2.next();
        if (tEob.type !== 'keyword' || tEob.value !== 'endobj') {
          // 비표준 — endobj가 빠진 경우 무시
        }
        return { num, gen, obj: stream, end: tk2.pos };
      }
    }
    // 일반 'endobj'
    const tEob = tk.next();
    if (tEob.type !== 'keyword' || tEob.value !== 'endobj') {
      // 관용: endobj 누락 — 그냥 진행
      return { num, gen, obj, end: peekStart };
    }
    return { num, gen, obj, end: tk.pos };
  }

  parseObjectFromTokens(tk: Tokenizer): ParsedObject {
    const t = tk.next();
    return this.parseFromToken(tk, t);
  }

  private parseFromToken(tk: Tokenizer, t: Token): ParsedObject {
    switch (t.type) {
      case 'int': {
        // ref 가능성: 'N G R' 패턴 lookahead
        const save = tk.pos;
        const t2 = tk.next();
        if (t2.type === 'int') {
          const t3 = tk.next();
          if (t3.type === 'keyword' && t3.value === 'R') {
            return { obj: pdfRef(t.value as number, t2.value as number), end: tk.pos };
          }
        }
        // ref가 아님 → 첫 토큰만 정수로 사용, lookahead 되돌리기
        tk.pos = save;
        return { obj: pdfInt(t.value as number), end: save };
      }
      case 'real':
        return { obj: pdfReal(t.value as number), end: tk.pos };
      case 'name':
        return { obj: pdfName(t.value as string), end: tk.pos };
      case 'literal_string':
        return { obj: pdfLiteralString(t.value as Uint8Array), end: tk.pos };
      case 'hex_string':
        return { obj: pdfHexString(t.value as Uint8Array), end: tk.pos };
      case 'array_open': {
        const items: PdfObject[] = [];
        while (true) {
          const t2 = tk.next();
          if (t2.type === 'array_close') return { obj: pdfArray(items), end: tk.pos };
          if (t2.type === 'eof') throw new ParseError('Unclosed array', t.start);
          // 마찬가지로 ref lookahead 처리
          const parsed = this.parseFromToken(tk, t2);
          items.push(parsed.obj);
        }
      }
      case 'dict_open': {
        const dict = pdfDict();
        while (true) {
          const tKey = tk.next();
          if (tKey.type === 'dict_close') return { obj: dict, end: tk.pos };
          if (tKey.type === 'eof') throw new ParseError('Unclosed dict', t.start);
          if (tKey.type !== 'name') {
            throw new ParseError(`Expected name in dict, got ${tKey.type}`, tKey.start);
          }
          const tVal = tk.next();
          const parsed = this.parseFromToken(tk, tVal);
          dict.map.set(tKey.value as string, parsed.obj);
        }
      }
      case 'keyword': {
        const v = t.value as string;
        if (v === 'true') return { obj: PdfTrue, end: tk.pos };
        if (v === 'false') return { obj: PdfFalse, end: tk.pos };
        if (v === 'null') return { obj: PdfNull, end: tk.pos };
        throw new ParseError(`Unexpected keyword ${v}`, t.start);
      }
      case 'eof':
        throw new ParseError('Unexpected EOF', t.start);
      default:
        throw new ParseError(`Unexpected token ${t.type}`, t.start);
    }
  }
}

function peekKeyword(buf: Uint8Array, pos: number): string | undefined {
  let p = skipWs(buf, pos);
  const start = p;
  while (
    p < buf.length &&
    !isWhitespace(buf[p]!) &&
    buf[p]! >= 0x21 &&
    !isDelim(buf[p]!)
  )
    p += 1;
  if (p === start) return undefined;
  return new TextDecoder('latin1').decode(buf.subarray(start, p));
}

function skipWs(buf: Uint8Array, pos: number): number {
  while (pos < buf.length && isWhitespace(buf[pos]!)) pos += 1;
  return pos;
}

function isDelim(b: number): boolean {
  return (
    b === 0x28 ||
    b === 0x29 ||
    b === 0x3c ||
    b === 0x3e ||
    b === 0x5b ||
    b === 0x5d ||
    b === 0x7b ||
    b === 0x7d ||
    b === 0x2f ||
    b === 0x25
  );
}

// 'endstream' 키워드 검색. EOL 직전 byte까지를 본문 끝으로 한다 (§7.3.8.1).
export function findEndstream(buf: Uint8Array, from: number): number {
  // 안전한 방법: 'endstream' 패턴 brute search
  const pattern = new TextEncoder().encode('endstream');
  for (let i = from; i + pattern.length <= buf.length; i += 1) {
    let match = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (buf[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      // 직전 EOL 제거
      let end = i;
      if (end > from && buf[end - 1] === 0x0a) end -= 1;
      if (end > from && buf[end - 1] === 0x0d) end -= 1;
      return end;
    }
  }
  throw new ParseError(`endstream not found from ${from}`, from);
}
