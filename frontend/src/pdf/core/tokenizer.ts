// PDF tokenizer (ISO 32000-1 §7.2)
// 바이트 스트림에서 토큰을 추출. lexer가 이 위에서 객체를 조립한다.

export type TokenType =
  | 'int'
  | 'real'
  | 'name'
  | 'literal_string'
  | 'hex_string'
  | 'array_open'
  | 'array_close'
  | 'dict_open'
  | 'dict_close'
  | 'keyword'
  | 'eof';

export interface Token {
  type: TokenType;
  start: number; // byte offset (inclusive)
  end: number; // byte offset (exclusive)
  // 즉시 파싱한 값. literal_string/hex_string은 raw bytes (디코드된 후).
  value?: number | string | Uint8Array;
}

// ---- 문자 분류 (§7.2.2) ----

// 공백: SPACE TAB CR LF FF NUL
export function isWhitespace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a || b === 0x0c || b === 0x00;
}
// EOL: CR / LF / CRLF
function isEol(b: number): boolean {
  return b === 0x0d || b === 0x0a;
}
// 구분자: ( ) < > [ ] { } / %
export function isDelimiter(b: number): boolean {
  return (
    b === 0x28 /*(*/ ||
    b === 0x29 /*)*/ ||
    b === 0x3c /*<*/ ||
    b === 0x3e /*>*/ ||
    b === 0x5b /*[*/ ||
    b === 0x5d /*]*/ ||
    b === 0x7b /*{*/ ||
    b === 0x7d /*}*/ ||
    b === 0x2f /*/*/ ||
    b === 0x25 /*%*/
  );
}
function isRegular(b: number): boolean {
  return !isWhitespace(b) && !isDelimiter(b);
}
function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

// ---- 메인 토크나이저 ----

export class Tokenizer {
  pos: number;

  constructor(public buf: Uint8Array, start = 0) {
    this.pos = start;
  }

  peekByte(): number {
    return this.pos < this.buf.length ? this.buf[this.pos]! : -1;
  }

  // 다음 토큰을 반환. EOF면 type='eof'.
  next(): Token {
    this.skipWhitespaceAndComments();
    const start = this.pos;
    if (this.pos >= this.buf.length) return { type: 'eof', start, end: start };

    const b = this.buf[this.pos]!;

    // 숫자: + - 0-9 .
    if (b === 0x2b || b === 0x2d || b === 0x2e || isDigit(b)) {
      return this.readNumber();
    }
    // 이름: /
    if (b === 0x2f) return this.readName();
    // literal string: (
    if (b === 0x28) return this.readLiteralString();
    // hex string 또는 dict open: <
    if (b === 0x3c) {
      if (this.buf[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { type: 'dict_open', start, end: this.pos };
      }
      return this.readHexString();
    }
    // dict close 또는 hex close (단독 >는 사실상 등장 안 함)
    if (b === 0x3e) {
      if (this.buf[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { type: 'dict_close', start, end: this.pos };
      }
      this.pos += 1;
      // 단독 >는 hex_string의 끝으로 readHexString 안에서 처리되므로 여기 오면 비표준.
      throw new ParseError(`Unexpected '>' at ${start}`, start);
    }
    if (b === 0x5b) {
      this.pos += 1;
      return { type: 'array_open', start, end: this.pos };
    }
    if (b === 0x5d) {
      this.pos += 1;
      return { type: 'array_close', start, end: this.pos };
    }
    // 키워드 (alpha 시작): obj endobj stream endstream xref trailer startxref true false null R 등
    return this.readKeyword();
  }

  // ---- helpers ----

  skipWhitespaceAndComments(): void {
    const buf = this.buf;
    while (this.pos < buf.length) {
      const b = buf[this.pos]!;
      if (isWhitespace(b)) {
        this.pos += 1;
      } else if (b === 0x25 /*%*/) {
        // 라인 끝까지 (단, %%EOF는 토큰이 아니라 trailer 외부에서 사용).
        while (this.pos < buf.length) {
          const c = buf[this.pos]!;
          this.pos += 1;
          if (c === 0x0d || c === 0x0a) break;
        }
        // CRLF의 경우 LF 추가 소비
        if (buf[this.pos] === 0x0a && buf[this.pos - 1] === 0x0d) this.pos += 1;
      } else {
        return;
      }
    }
  }

  readNumber(): Token {
    const start = this.pos;
    const buf = this.buf;
    let hasDot = false;
    if (buf[this.pos] === 0x2b /*+*/ || buf[this.pos] === 0x2d /*-*/) this.pos += 1;
    while (this.pos < buf.length) {
      const b = buf[this.pos]!;
      if (isDigit(b)) {
        this.pos += 1;
      } else if (b === 0x2e && !hasDot) {
        hasDot = true;
        this.pos += 1;
      } else {
        break;
      }
    }
    const text = new TextDecoder('latin1').decode(buf.subarray(start, this.pos));
    if (hasDot) {
      return { type: 'real', start, end: this.pos, value: parseFloat(text) };
    }
    // int 파싱 — '+', '-' 만 있고 끝나면 invalid
    if (text === '+' || text === '-' || text === '') {
      throw new ParseError(`Bad number at ${start}: '${text}'`, start);
    }
    return { type: 'int', start, end: this.pos, value: parseInt(text, 10) };
  }

  readName(): Token {
    const start = this.pos;
    this.pos += 1; // skip '/'
    const buf = this.buf;
    const out: number[] = [];
    while (this.pos < buf.length) {
      const b = buf[this.pos]!;
      if (!isRegular(b)) break;
      if (b === 0x23 /*#*/) {
        // #XX hex escape (PDF 1.2+)
        const h1 = buf[this.pos + 1] ?? 0;
        const h2 = buf[this.pos + 2] ?? 0;
        out.push((hexVal(h1) << 4) | hexVal(h2));
        this.pos += 3;
      } else {
        out.push(b);
        this.pos += 1;
      }
    }
    return {
      type: 'name',
      start,
      end: this.pos,
      value: new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(out)),
    };
  }

  readLiteralString(): Token {
    const start = this.pos;
    this.pos += 1; // skip '('
    const buf = this.buf;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < buf.length && depth > 0) {
      const b = buf[this.pos]!;
      if (b === 0x5c /*\\*/) {
        // 이스케이프
        const next = buf[this.pos + 1];
        if (next === undefined) {
          this.pos += 1;
          continue;
        }
        if (next === 0x6e) {
          out.push(0x0a);
          this.pos += 2;
        } else if (next === 0x72) {
          out.push(0x0d);
          this.pos += 2;
        } else if (next === 0x74) {
          out.push(0x09);
          this.pos += 2;
        } else if (next === 0x62) {
          out.push(0x08);
          this.pos += 2;
        } else if (next === 0x66) {
          out.push(0x0c);
          this.pos += 2;
        } else if (next === 0x28 || next === 0x29 || next === 0x5c) {
          out.push(next);
          this.pos += 2;
        } else if (next === 0x0d || next === 0x0a) {
          // line continuation: 백슬래시 + EOL → 무시
          this.pos += 2;
          if (next === 0x0d && buf[this.pos] === 0x0a) this.pos += 1;
        } else if (next >= 0x30 && next <= 0x37) {
          // 8진수 1~3자리
          let v = next - 0x30;
          this.pos += 2;
          for (let i = 0; i < 2; i += 1) {
            const c = buf[this.pos];
            if (c !== undefined && c >= 0x30 && c <= 0x37) {
              v = v * 8 + (c - 0x30);
              this.pos += 1;
            } else break;
          }
          out.push(v & 0xff);
        } else {
          // 알려지지 않은 이스케이프 → 백슬래시 무시
          this.pos += 1;
        }
      } else if (b === 0x28) {
        depth += 1;
        out.push(b);
        this.pos += 1;
      } else if (b === 0x29) {
        depth -= 1;
        if (depth > 0) out.push(b);
        this.pos += 1;
      } else {
        // CR, LF, CRLF는 LF로 정규화 (§7.3.4.2)
        if (b === 0x0d) {
          out.push(0x0a);
          this.pos += 1;
          if (buf[this.pos] === 0x0a) this.pos += 1;
        } else {
          out.push(b);
          this.pos += 1;
        }
      }
    }
    return { type: 'literal_string', start, end: this.pos, value: new Uint8Array(out) };
  }

  readHexString(): Token {
    const start = this.pos;
    this.pos += 1; // skip '<'
    const buf = this.buf;
    const out: number[] = [];
    let high = -1;
    while (this.pos < buf.length) {
      const b = buf[this.pos]!;
      if (b === 0x3e /*>*/) {
        this.pos += 1;
        break;
      }
      if (isWhitespace(b)) {
        this.pos += 1;
        continue;
      }
      const v = hexVal(b);
      if (v < 0) throw new ParseError(`Bad hex char ${b} at ${this.pos}`, this.pos);
      if (high < 0) high = v;
      else {
        out.push((high << 4) | v);
        high = -1;
      }
      this.pos += 1;
    }
    if (high >= 0) {
      // 홀수 길이 → 마지막에 0 패딩
      out.push(high << 4);
    }
    return { type: 'hex_string', start, end: this.pos, value: new Uint8Array(out) };
  }

  readKeyword(): Token {
    const start = this.pos;
    const buf = this.buf;
    while (this.pos < buf.length && isRegular(buf[this.pos]!)) {
      this.pos += 1;
    }
    const text = new TextDecoder('latin1').decode(buf.subarray(start, this.pos));
    return { type: 'keyword', start, end: this.pos, value: text };
  }
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

export class ParseError extends Error {
  constructor(message: string, public offset?: number) {
    super(offset !== undefined ? `${message} (offset ${offset})` : message);
    this.name = 'ParseError';
  }
}
