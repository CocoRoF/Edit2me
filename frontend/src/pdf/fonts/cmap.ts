// ToUnicode CMap parser
//
// 지원하는 디렉티브:
//   beginbfchar / endbfchar:   <code> <unicode-hex>
//   beginbfrange / endbfrange: <c0> <c1> <unicode-hex>      (선형 증가)
//                              <c0> <c1> [ <u0> <u1> ... ]  (개별 매핑)
//   begincidchar / endcidchar  (encoding CMap의 CID 매핑 — 동일 형식)
//   begincidrange / endcidrange
//   beginnotdefchar / beginnotdefrange  (skip)
//   usecmap                    (parent 인식만, 미지원 — diagnostic 으로 noted)
//   begincodespacerange        (skip — 우리는 byte 디코드 별도로 처리)
//
// ISO 32000-1 §9.10.3 (ToUnicode CMaps), §9.7.5 (CIDFont CMaps).

export interface CMapData {
  /** code → unicode 문자열 매핑 */
  toUnicode: Map<number, string>;
  /** 부모 CMap 이름 (`usecmap`로 참조). 우리는 표시만 하고 미해소. */
  usesParent?: string;
  /** code space의 byte 길이들 (예: [1, 2]). 비어 있으면 파서가 추정. */
  codeRanges: Array<{ low: number; high: number; bytes: number }>;
  /** 0 = horizontal (default), 1 = vertical. CMap 의 `/WMode N def` 디렉티브. */
  wmode: 0 | 1;
}

// ---- Public API ----

export function parseToUnicodeCMap(data: Uint8Array): CMapData {
  const text = decodeAsLatin1(data);
  return parseCMapText(text);
}

/** 호환을 위해 keepalive: 기존 호출자가 Map만 원하는 경우 */
export function parseToUnicodeMap(data: Uint8Array): Map<number, string> {
  return parseToUnicodeCMap(data).toUnicode;
}

// ---- Implementation ----

function decodeAsLatin1(data: Uint8Array): string {
  // CMap은 ASCII가 본문이라 latin1로 충분. UTF-8은 사용 안 함.
  return new TextDecoder('latin1').decode(data);
}

function parseCMapText(text: string): CMapData {
  const out: CMapData = {
    toUnicode: new Map(),
    codeRanges: [],
    wmode: 0,
  };

  // /WMode N def — vertical writing detection. 본문 어디에도 등장 가능.
  const wmodeMatch = /\/WMode\s+(\d+)\s+def/.exec(text);
  if (wmodeMatch && wmodeMatch[1] === '1') out.wmode = 1;

  const tokens = tokenize(text);
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i]!;

    // 'usecmap' 디렉티브: 직전 토큰이 CMap 이름.
    if (t === 'usecmap') {
      // 직전 토큰이 /Name 형태
      const prev = tokens[i - 1];
      if (prev && prev.startsWith('/')) {
        out.usesParent = prev.slice(1);
      }
      i += 1;
      continue;
    }

    // 'begincodespacerange' / 'endcodespacerange'
    if (t === 'begincodespacerange') {
      i += 1;
      while (i < tokens.length && tokens[i] !== 'endcodespacerange') {
        const lo = hexStrToNum(tokens[i]!);
        const hi = hexStrToNum(tokens[i + 1]!);
        const byteLen = hexStrByteLen(tokens[i]!);
        if (lo !== null && hi !== null && byteLen > 0) {
          out.codeRanges.push({ low: lo, high: hi, bytes: byteLen });
        }
        i += 2;
      }
      i += 1; // skip 'endcodespacerange'
      continue;
    }

    // 'beginbfchar' / 'begincidchar' — 동일 형식
    if (t === 'beginbfchar' || t === 'begincidchar') {
      const endTok = t === 'beginbfchar' ? 'endbfchar' : 'endcidchar';
      i += 1;
      while (i < tokens.length && tokens[i] !== endTok) {
        const code = hexStrToNum(tokens[i]!);
        const next = tokens[i + 1]!;
        const uni =
          t === 'beginbfchar' ? hexStrToString(next) : numToString(hexStrToNum(next));
        if (code !== null && uni !== null) out.toUnicode.set(code, uni);
        i += 2;
      }
      i += 1;
      continue;
    }

    // 'beginbfrange' / 'begincidrange'
    if (t === 'beginbfrange' || t === 'begincidrange') {
      const endTok = t === 'beginbfrange' ? 'endbfrange' : 'endcidrange';
      i += 1;
      while (i < tokens.length && tokens[i] !== endTok) {
        const a = hexStrToNum(tokens[i]!);
        const b = hexStrToNum(tokens[i + 1]!);
        const third = tokens[i + 2];
        if (a === null || b === null || !third) {
          i += 3;
          continue;
        }
        if (third === '[') {
          // [ <u0> <u1> ... ]
          let j = i + 3;
          const arr: string[] = [];
          while (j < tokens.length && tokens[j] !== ']') {
            const s =
              t === 'beginbfrange' ? hexStrToString(tokens[j]!) : numToString(hexStrToNum(tokens[j]!));
            if (s !== null) arr.push(s);
            j += 1;
          }
          for (let k = 0; k <= b - a && k < arr.length; k += 1) {
            out.toUnicode.set(a + k, arr[k]!);
          }
          i = j + 1;
        } else {
          const base =
            t === 'beginbfrange' ? hexStrToString(third) : numToString(hexStrToNum(third));
          if (base !== null) {
            for (let k = 0; k <= b - a; k += 1) {
              out.toUnicode.set(a + k, incLastChar(base, k));
            }
          }
          i += 3;
        }
      }
      i += 1;
      continue;
    }

    // 'beginnotdefchar' / 'beginnotdefrange' — skip 본문
    if (t === 'beginnotdefchar' || t === 'beginnotdefrange') {
      const endTok = t === 'beginnotdefchar' ? 'endnotdefchar' : 'endnotdefrange';
      i += 1;
      while (i < tokens.length && tokens[i] !== endTok) i += 1;
      i += 1;
      continue;
    }

    i += 1;
  }

  return out;
}

// ---- Tokenizer ----

function tokenize(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    // 공백
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f') {
      i += 1;
      continue;
    }
    // 라인 주석
    if (c === '%') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }
    // hex string <...>
    if (c === '<') {
      const end = text.indexOf('>', i);
      if (end < 0) break;
      // 내부 공백 제거된 형태로 저장
      const raw = text.substring(i + 1, end).replace(/[\s]+/g, '');
      out.push('<' + raw + '>');
      i = end + 1;
      continue;
    }
    // array 구분자
    if (c === '[' || c === ']' || c === '{' || c === '}') {
      out.push(c);
      i += 1;
      continue;
    }
    // PostScript 이름 /Foo
    if (c === '/') {
      let j = i + 1;
      while (j < n && !isWs(text[j]!) && !isDelim(text[j]!)) j += 1;
      out.push(text.substring(i, j));
      i = j;
      continue;
    }
    // literal string (CMap에서는 거의 안 쓰이나 안전을 위해)
    if (c === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === '(') {
          depth += 1;
          j += 1;
        } else if (text[j] === ')') {
          depth -= 1;
          j += 1;
        } else j += 1;
      }
      out.push(text.substring(i, j));
      i = j;
      continue;
    }
    // word
    let j = i;
    while (j < n && !isWs(text[j]!) && !isDelim(text[j]!)) j += 1;
    if (j === i) {
      // unknown char
      i += 1;
    } else {
      out.push(text.substring(i, j));
      i = j;
    }
  }
  return out;
}

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f';
}
function isDelim(c: string): boolean {
  return c === '<' || c === '>' || c === '[' || c === ']' || c === '/' || c === '%' || c === '(' || c === ')' || c === '{' || c === '}';
}

// ---- Hex helpers ----

function hexStrToNum(t: string | undefined): number | null {
  if (!t || !t.startsWith('<') || !t.endsWith('>')) return null;
  const hex = t.slice(1, -1);
  if (hex.length === 0) return null;
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
  return parseInt(hex, 16);
}

function hexStrByteLen(t: string | undefined): number {
  if (!t || !t.startsWith('<') || !t.endsWith('>')) return 0;
  const hex = t.slice(1, -1);
  return Math.ceil(hex.length / 2);
}

function hexStrToString(t: string | undefined): string | null {
  if (!t || !t.startsWith('<') || !t.endsWith('>')) return null;
  const hex = t.slice(1, -1);
  if (hex.length === 0) return '';
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
  // UTF-16BE — 4 hex chars 단위
  if (hex.length % 4 === 0) {
    let out = '';
    for (let i = 0; i < hex.length; i += 4) {
      out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    }
    return out;
  }
  // 2 hex chars (single byte) — Latin1
  if (hex.length === 2) return String.fromCharCode(parseInt(hex, 16));
  // 비표준이지만 4의 배수가 아닌 경우: byte 단위로 처리
  if (hex.length % 2 === 0) {
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return out;
  }
  return null;
}

function numToString(n: number | null): string | null {
  if (n === null) return null;
  // CID 자체는 Unicode가 아니지만 일부 CMap에서 CID-as-unicode로 사용되기도 함.
  // begincidchar/range는 보통 byte→CID이지 unicode가 아니므로 상위 사용처에서 별도 처리해야.
  // 여기서는 단순 String.fromCodePoint.
  if (n < 0 || n > 0x10ffff) return null;
  return String.fromCodePoint(n);
}

function incLastChar(s: string, by: number): string {
  if (s.length === 0) return s;
  const last = s.charCodeAt(s.length - 1);
  return s.slice(0, -1) + String.fromCharCode((last + by) & 0xffff);
}
