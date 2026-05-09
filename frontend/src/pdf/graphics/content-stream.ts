// 콘텐츠 스트림 토큰화 → 연산자 시퀀스.
//
// 우리는 *모든* 연산자를 파싱하지 않는다 — 텍스트 관련 연산자에 집중하고
// 그래픽 상태 연산자(q Q cm) 정도는 다룬다. 미지원 연산자는 _unknown으로 유지.

import {
  PdfObject,
  PdfString,
  isInt,
  isReal,
} from '../core/object';
import { Tokenizer } from '../core/tokenizer';

export type ContentOp =
  | { op: 'q'; }
  | { op: 'Q'; }
  | { op: 'cm'; m: [number, number, number, number, number, number]; }
  | { op: 'BT'; }
  | { op: 'ET'; }
  | { op: 'Tf'; font: string; size: number; }
  | { op: 'Tm'; m: [number, number, number, number, number, number]; }
  | { op: 'Td'; tx: number; ty: number; }
  | { op: 'TD'; tx: number; ty: number; }
  | { op: 'T*'; }
  | { op: 'TL'; leading: number; }
  | { op: 'Tj'; bytes: Uint8Array; }
  | { op: 'TJ'; items: Array<{ kind: 'bytes'; bytes: Uint8Array } | { kind: 'shift'; v: number }>; }
  | { op: "'"; bytes: Uint8Array; }
  | { op: '"'; aw: number; ac: number; bytes: Uint8Array; }
  | { op: 'Tc'; v: number; }
  | { op: 'Tw'; v: number; }
  | { op: 'Tz'; v: number; }
  | { op: 'Ts'; v: number; }
  | { op: 'Tr'; v: number; }
  | { op: 'rg'; r: number; g: number; b: number; }
  | { op: 'RG'; r: number; g: number; b: number; }
  | { op: '_unknown'; raw: string; };

interface ParseSource {
  start: number;
  end: number;
  opIndex: number;
}

export interface ContentOpWithSource {
  op: ContentOp;
  source: ParseSource;
}

// 단순 ops 파싱 (operands → 연산자 키워드).
export function parseContent(data: Uint8Array): ContentOpWithSource[] {
  const tk = new Tokenizer(data, 0);
  const out: ContentOpWithSource[] = [];
  let operands: Array<PdfObject | string> = [];
  let opStartByte = 0;
  while (true) {
    const t = tk.next();
    if (t.type === 'eof') break;
    if (t.type === 'keyword') {
      const kw = t.value as string;
      // 연산자
      const op = makeOp(kw, operands);
      if (op) {
        out.push({
          op,
          source: { start: opStartByte, end: t.end, opIndex: out.length },
        });
      }
      operands = [];
      opStartByte = t.end;
    } else {
      // operand
      if (operands.length === 0) opStartByte = t.start;
      switch (t.type) {
        case 'int':
        case 'real':
          operands.push({
            kind: t.type === 'int' ? 'int' : 'real',
            value: t.value as number,
          } as PdfObject);
          break;
        case 'name':
          operands.push({ kind: 'name', value: t.value as string });
          break;
        case 'literal_string':
        case 'hex_string':
          operands.push({
            kind: 'string',
            bytes: t.value as Uint8Array,
            literal: t.type === 'literal_string',
          });
          break;
        case 'array_open': {
          // TJ array
          const items: PdfObject[] = [];
          while (true) {
            const t2 = tk.next();
            if (t2.type === 'array_close') break;
            if (t2.type === 'eof') break;
            if (t2.type === 'int' || t2.type === 'real') {
              items.push({ kind: t2.type === 'int' ? 'int' : 'real', value: t2.value as number });
            } else if (t2.type === 'literal_string' || t2.type === 'hex_string') {
              items.push({
                kind: 'string',
                bytes: t2.value as Uint8Array,
                literal: t2.type === 'literal_string',
              });
            }
          }
          operands.push({ kind: 'array', items } as PdfObject);
          break;
        }
        default:
          // 기타 (dict_open 등) — 내용 무시
          break;
      }
    }
  }
  return out;
}

function makeOp(kw: string, operands: Array<PdfObject | string>): ContentOp | null {
  const num = (i: number): number => {
    const o = operands[i];
    if (!o || typeof o === 'string') return 0;
    if (o.kind === 'int' || o.kind === 'real') return o.value;
    return 0;
  };
  const name = (i: number): string => {
    const o = operands[i];
    if (!o || typeof o === 'string') return '';
    if (o.kind === 'name') return o.value;
    return '';
  };
  const str = (i: number): Uint8Array => {
    const o = operands[i];
    if (!o || typeof o === 'string') return new Uint8Array();
    if (o.kind === 'string') return o.bytes;
    return new Uint8Array();
  };
  const arr = (i: number): Array<PdfObject | string> => {
    const o = operands[i];
    if (!o || typeof o === 'string') return [];
    if (o.kind === 'array') return o.items;
    return [];
  };

  switch (kw) {
    case 'q':
      return { op: 'q' };
    case 'Q':
      return { op: 'Q' };
    case 'cm':
      return {
        op: 'cm',
        m: [num(0), num(1), num(2), num(3), num(4), num(5)],
      };
    case 'BT':
      return { op: 'BT' };
    case 'ET':
      return { op: 'ET' };
    case 'Tf':
      return { op: 'Tf', font: name(0), size: num(1) };
    case 'Tm':
      return {
        op: 'Tm',
        m: [num(0), num(1), num(2), num(3), num(4), num(5)],
      };
    case 'Td':
      return { op: 'Td', tx: num(0), ty: num(1) };
    case 'TD':
      return { op: 'TD', tx: num(0), ty: num(1) };
    case 'T*':
      return { op: 'T*' };
    case 'TL':
      return { op: 'TL', leading: num(0) };
    case 'Tc':
      return { op: 'Tc', v: num(0) };
    case 'Tw':
      return { op: 'Tw', v: num(0) };
    case 'Tz':
      return { op: 'Tz', v: num(0) };
    case 'Ts':
      return { op: 'Ts', v: num(0) };
    case 'Tr':
      return { op: 'Tr', v: num(0) };
    case 'Tj':
      return { op: 'Tj', bytes: str(0) };
    case "'":
      return { op: "'", bytes: str(0) };
    case '"':
      return { op: '"', aw: num(0), ac: num(1), bytes: str(2) };
    case 'TJ': {
      const items = arr(0);
      const out: Array<{ kind: 'bytes'; bytes: Uint8Array } | { kind: 'shift'; v: number }> = [];
      for (const item of items) {
        if (typeof item === 'string') continue;
        if (item.kind === 'string') out.push({ kind: 'bytes', bytes: item.bytes });
        else if (item.kind === 'int' || item.kind === 'real') out.push({ kind: 'shift', v: item.value });
      }
      return { op: 'TJ', items: out };
    }
    case 'rg':
      return { op: 'rg', r: num(0), g: num(1), b: num(2) };
    case 'RG':
      return { op: 'RG', r: num(0), g: num(1), b: num(2) };
    default:
      return { op: '_unknown', raw: kw };
  }
}
