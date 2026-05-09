// ToUnicode CMap parser (very minimal subset).
//
// 지원하는 연산자:
//   beginbfchar / endbfchar:   <code> <unicode-hex>  (1줄당 1쌍)
//   beginbfrange / endbfrange:  <c0> <c1> <unicode-hex>   또는
//                              <c0> <c1> [ <u0> <u1> ... ]
//
// 무시: beginusematrix, beginstack, beginnotdefchar 등 — 거의 안 쓰임.

export function parseToUnicodeCMap(data: Uint8Array): Map<number, string> {
  const text = new TextDecoder('latin1').decode(data);
  const map = new Map<number, string>();

  const tokens = simpleTokenize(text);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === 'beginbfchar') {
      i += 1;
      while (i < tokens.length && tokens[i] !== 'endbfchar') {
        const code = hexStrToNum(tokens[i]!);
        const uni = hexStrToString(tokens[i + 1]!);
        if (code !== null && uni !== null) map.set(code, uni);
        i += 2;
      }
      i += 1;
    } else if (t === 'beginbfrange') {
      i += 1;
      while (i < tokens.length && tokens[i] !== 'endbfrange') {
        const a = hexStrToNum(tokens[i]!);
        const b = hexStrToNum(tokens[i + 1]!);
        const third = tokens[i + 2]!;
        if (a === null || b === null) {
          i += 3;
          continue;
        }
        if (third.startsWith('[')) {
          // [ <u0> <u1> ... ]
          const arr: string[] = [];
          let j = i + 2;
          if (tokens[j]! === '[') j += 1;
          else if (tokens[j]!.startsWith('[')) {
            // single token like '[<...>]' — split by whitespace already done, so '[' alone
          }
          while (j < tokens.length && tokens[j] !== ']') {
            const s = hexStrToString(tokens[j]!);
            if (s !== null) arr.push(s);
            j += 1;
          }
          for (let k = 0; k <= b - a && k < arr.length; k += 1) {
            map.set(a + k, arr[k]!);
          }
          i = j + 1;
        } else {
          const base = hexStrToString(third);
          if (base !== null) {
            for (let k = 0; k <= b - a; k += 1) {
              const u = incLastChar(base, k);
              map.set(a + k, u);
            }
          }
          i += 3;
        }
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return map;
}

function simpleTokenize(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i += 1;
      continue;
    }
    if (c === '%') {
      // 주석
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }
    if (c === '<') {
      const end = text.indexOf('>', i);
      if (end < 0) break;
      out.push(text.substring(i, end + 1));
      i = end + 1;
      continue;
    }
    if (c === '[' || c === ']') {
      out.push(c);
      i += 1;
      continue;
    }
    if (c === '/') {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_-]/.test(text[j]!)) j += 1;
      out.push(text.substring(i, j));
      i = j;
      continue;
    }
    // word
    let j = i;
    while (j < text.length && !/[\s<>[\]/%]/.test(text[j]!)) j += 1;
    out.push(text.substring(i, j));
    i = j;
  }
  return out;
}

function hexStrToNum(t: string): number | null {
  if (!t.startsWith('<') || !t.endsWith('>')) return null;
  const hex = t.slice(1, -1);
  if (hex.length === 0) return null;
  return parseInt(hex, 16);
}

function hexStrToString(t: string): string | null {
  if (!t.startsWith('<') || !t.endsWith('>')) return null;
  const hex = t.slice(1, -1);
  if (hex.length === 0) return '';
  // UTF-16BE 디코드
  let out = '';
  for (let i = 0; i + 3 < hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
  }
  // 짝수 자리 안 맞으면 한 글자만이라도
  if (hex.length === 2) {
    out = String.fromCharCode(parseInt(hex, 16));
  }
  return out;
}

function incLastChar(s: string, by: number): string {
  if (s.length === 0) return s;
  return s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + by);
}
