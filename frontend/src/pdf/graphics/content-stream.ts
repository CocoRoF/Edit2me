// 콘텐츠 스트림 토큰화 → 연산자 시퀀스.
// Text + Graphics + Color + XObject 등 PDF 1.7 §8 / §9 의 주요 연산자 인식.
// 인식 안 된 연산자는 _unknown { raw, operands } 로 보존.

import { PdfObject } from '../core/object';
import { Tokenizer } from '../core/tokenizer';

export type ContentOp =
  // Graphics state
  | { op: 'q' }
  | { op: 'Q' }
  | { op: 'cm'; m: [number, number, number, number, number, number] }
  | { op: 'w'; v: number }
  | { op: 'J'; v: number }
  | { op: 'j'; v: number }
  | { op: 'M'; v: number }
  | { op: 'd'; dashArray: number[]; phase: number }
  | { op: 'ri'; v: string }
  | { op: 'i'; v: number }
  | { op: 'gs'; name: string }
  // Path construction
  | { op: 'm'; x: number; y: number }
  | { op: 'l'; x: number; y: number }
  | { op: 'c'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { op: 'v'; x2: number; y2: number; x3: number; y3: number }
  | { op: 'y'; x1: number; y1: number; x3: number; y3: number }
  | { op: 'h' }
  | { op: 're'; x: number; y: number; w: number; h: number }
  // Path painting
  | { op: 'S' }
  | { op: 's' }
  | { op: 'f' }
  | { op: 'F' }
  | { op: 'f*' }
  | { op: 'B' }
  | { op: 'B*' }
  | { op: 'b' }
  | { op: 'b*' }
  | { op: 'n' }
  // Clipping
  | { op: 'W' }
  | { op: 'W*' }
  // Color
  | { op: 'CS'; name: string }
  | { op: 'cs'; name: string }
  | { op: 'SC'; values: number[] }
  | { op: 'sc'; values: number[] }
  | { op: 'SCN'; values: number[]; pattern?: string }
  | { op: 'scn'; values: number[]; pattern?: string }
  | { op: 'G'; v: number }
  | { op: 'g'; v: number }
  | { op: 'RG'; r: number; g: number; b: number }
  | { op: 'rg'; r: number; g: number; b: number }
  | { op: 'K'; c: number; m: number; y: number; k: number }
  | { op: 'k'; c: number; m: number; y: number; k: number }
  // Text object
  | { op: 'BT' }
  | { op: 'ET' }
  | { op: 'Tf'; font: string; size: number }
  | { op: 'Tm'; m: [number, number, number, number, number, number] }
  | { op: 'Td'; tx: number; ty: number }
  | { op: 'TD'; tx: number; ty: number }
  | { op: 'T*' }
  | { op: 'TL'; leading: number }
  | { op: 'Tj'; bytes: Uint8Array }
  | {
      op: 'TJ';
      items: Array<{ kind: 'bytes'; bytes: Uint8Array } | { kind: 'shift'; v: number }>;
    }
  | { op: "'"; bytes: Uint8Array }
  | { op: '"'; aw: number; ac: number; bytes: Uint8Array }
  | { op: 'Tc'; v: number }
  | { op: 'Tw'; v: number }
  | { op: 'Tz'; v: number }
  | { op: 'Ts'; v: number }
  | { op: 'Tr'; v: number }
  // XObject + shading
  | { op: 'Do'; name: string }
  | { op: 'sh'; name: string }
  // Marked content (no-op for renderer)
  | { op: 'MP'; tag: string }
  | { op: 'DP'; tag: string; props?: PdfObject }
  | { op: 'BMC'; tag: string }
  | { op: 'BDC'; tag: string; props?: PdfObject }
  | { op: 'EMC' }
  // Inline image (skip)
  | { op: 'BI' }
  | { op: 'ID' }
  | { op: 'EI' }
  // Unknown — operands 도 함께 보존
  | { op: '_unknown'; raw: string; operands: PdfObject[] };

interface ParseSource {
  start: number;
  end: number;
  opIndex: number;
}

export interface ContentOpWithSource {
  op: ContentOp;
  source: ParseSource;
}

export function parseContent(data: Uint8Array): ContentOpWithSource[] {
  const tk = new Tokenizer(data, 0);
  const out: ContentOpWithSource[] = [];
  let operands: PdfObject[] = [];
  let opStartByte = 0;
  while (true) {
    const t = tk.next();
    if (t.type === 'eof') break;
    if (t.type === 'keyword') {
      const kw = t.value as string;
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
          const items: PdfObject[] = [];
          while (true) {
            const t2 = tk.next();
            if (t2.type === 'array_close') break;
            if (t2.type === 'eof') break;
            if (t2.type === 'int' || t2.type === 'real') {
              items.push({
                kind: t2.type === 'int' ? 'int' : 'real',
                value: t2.value as number,
              });
            } else if (t2.type === 'literal_string' || t2.type === 'hex_string') {
              items.push({
                kind: 'string',
                bytes: t2.value as Uint8Array,
                literal: t2.type === 'literal_string',
              });
            } else if (t2.type === 'name') {
              items.push({ kind: 'name', value: t2.value as string });
            }
          }
          operands.push({ kind: 'array', items } as PdfObject);
          break;
        }
        case 'dict_open': {
          // Inline image dict 등 — 본문은 모르고 닫는 토큰만 따라가기
          let depth = 1;
          while (depth > 0) {
            const t2 = tk.next();
            if (t2.type === 'eof') break;
            if (t2.type === 'dict_open') depth += 1;
            else if (t2.type === 'dict_close') depth -= 1;
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return out;
}

function num(operands: PdfObject[], i: number): number {
  const o = operands[i];
  if (!o) return 0;
  if (o.kind === 'int' || o.kind === 'real') return o.value;
  return 0;
}
function name(operands: PdfObject[], i: number): string {
  const o = operands[i];
  if (!o) return '';
  if (o.kind === 'name') return o.value;
  return '';
}
function bytes(operands: PdfObject[], i: number): Uint8Array {
  const o = operands[i];
  if (!o) return new Uint8Array();
  if (o.kind === 'string') return o.bytes;
  return new Uint8Array();
}

function makeOp(kw: string, operands: PdfObject[]): ContentOp | null {
  switch (kw) {
    // Graphics state
    case 'q':
      return { op: 'q' };
    case 'Q':
      return { op: 'Q' };
    case 'cm':
      return {
        op: 'cm',
        m: [num(operands, 0), num(operands, 1), num(operands, 2), num(operands, 3), num(operands, 4), num(operands, 5)],
      };
    case 'w':
      return { op: 'w', v: num(operands, 0) };
    case 'J':
      return { op: 'J', v: num(operands, 0) };
    case 'j':
      return { op: 'j', v: num(operands, 0) };
    case 'M':
      return { op: 'M', v: num(operands, 0) };
    case 'd': {
      const arr = operands[0];
      const dashArray: number[] = [];
      if (arr && arr.kind === 'array') {
        for (const item of arr.items) {
          if (item.kind === 'int' || item.kind === 'real') dashArray.push(item.value);
        }
      }
      return { op: 'd', dashArray, phase: num(operands, 1) };
    }
    case 'ri':
      return { op: 'ri', v: name(operands, 0) };
    case 'i':
      return { op: 'i', v: num(operands, 0) };
    case 'gs':
      return { op: 'gs', name: name(operands, 0) };
    // Path construction
    case 'm':
      return { op: 'm', x: num(operands, 0), y: num(operands, 1) };
    case 'l':
      return { op: 'l', x: num(operands, 0), y: num(operands, 1) };
    case 'c':
      return {
        op: 'c',
        x1: num(operands, 0), y1: num(operands, 1),
        x2: num(operands, 2), y2: num(operands, 3),
        x3: num(operands, 4), y3: num(operands, 5),
      };
    case 'v':
      return {
        op: 'v',
        x2: num(operands, 0), y2: num(operands, 1),
        x3: num(operands, 2), y3: num(operands, 3),
      };
    case 'y':
      return {
        op: 'y',
        x1: num(operands, 0), y1: num(operands, 1),
        x3: num(operands, 2), y3: num(operands, 3),
      };
    case 'h':
      return { op: 'h' };
    case 're':
      return { op: 're', x: num(operands, 0), y: num(operands, 1), w: num(operands, 2), h: num(operands, 3) };
    // Path painting
    case 'S': return { op: 'S' };
    case 's': return { op: 's' };
    case 'f': return { op: 'f' };
    case 'F': return { op: 'F' };
    case 'f*': return { op: 'f*' };
    case 'B': return { op: 'B' };
    case 'B*': return { op: 'B*' };
    case 'b': return { op: 'b' };
    case 'b*': return { op: 'b*' };
    case 'n': return { op: 'n' };
    // Clipping
    case 'W': return { op: 'W' };
    case 'W*': return { op: 'W*' };
    // Color
    case 'CS': return { op: 'CS', name: name(operands, 0) };
    case 'cs': return { op: 'cs', name: name(operands, 0) };
    case 'SC':
    case 'sc': {
      const values = operands
        .filter((o) => o.kind === 'int' || o.kind === 'real')
        .map((o) => (o.kind === 'int' || o.kind === 'real' ? o.value : 0));
      return { op: kw, values } as ContentOp;
    }
    case 'SCN':
    case 'scn': {
      const last = operands[operands.length - 1];
      let pattern: string | undefined;
      let take = operands;
      if (last && last.kind === 'name') {
        pattern = last.value;
        take = operands.slice(0, -1);
      }
      const values = take
        .filter((o) => o.kind === 'int' || o.kind === 'real')
        .map((o) => (o.kind === 'int' || o.kind === 'real' ? o.value : 0));
      return { op: kw, values, pattern } as ContentOp;
    }
    case 'G': return { op: 'G', v: num(operands, 0) };
    case 'g': return { op: 'g', v: num(operands, 0) };
    case 'RG': return { op: 'RG', r: num(operands, 0), g: num(operands, 1), b: num(operands, 2) };
    case 'rg': return { op: 'rg', r: num(operands, 0), g: num(operands, 1), b: num(operands, 2) };
    case 'K': return { op: 'K', c: num(operands, 0), m: num(operands, 1), y: num(operands, 2), k: num(operands, 3) };
    case 'k': return { op: 'k', c: num(operands, 0), m: num(operands, 1), y: num(operands, 2), k: num(operands, 3) };
    // Text
    case 'BT': return { op: 'BT' };
    case 'ET': return { op: 'ET' };
    case 'Tf': return { op: 'Tf', font: name(operands, 0), size: num(operands, 1) };
    case 'Tm':
      return {
        op: 'Tm',
        m: [num(operands, 0), num(operands, 1), num(operands, 2), num(operands, 3), num(operands, 4), num(operands, 5)],
      };
    case 'Td': return { op: 'Td', tx: num(operands, 0), ty: num(operands, 1) };
    case 'TD': return { op: 'TD', tx: num(operands, 0), ty: num(operands, 1) };
    case 'T*': return { op: 'T*' };
    case 'TL': return { op: 'TL', leading: num(operands, 0) };
    case 'Tc': return { op: 'Tc', v: num(operands, 0) };
    case 'Tw': return { op: 'Tw', v: num(operands, 0) };
    case 'Tz': return { op: 'Tz', v: num(operands, 0) };
    case 'Ts': return { op: 'Ts', v: num(operands, 0) };
    case 'Tr': return { op: 'Tr', v: num(operands, 0) };
    case 'Tj': return { op: 'Tj', bytes: bytes(operands, 0) };
    case "'": return { op: "'", bytes: bytes(operands, 0) };
    case '"':
      return { op: '"', aw: num(operands, 0), ac: num(operands, 1), bytes: bytes(operands, 2) };
    case 'TJ': {
      const arr = operands[0];
      const items: Array<{ kind: 'bytes'; bytes: Uint8Array } | { kind: 'shift'; v: number }> = [];
      if (arr && arr.kind === 'array') {
        for (const item of arr.items) {
          if (item.kind === 'string') items.push({ kind: 'bytes', bytes: item.bytes });
          else if (item.kind === 'int' || item.kind === 'real') items.push({ kind: 'shift', v: item.value });
        }
      }
      return { op: 'TJ', items };
    }
    // XObject
    case 'Do': return { op: 'Do', name: name(operands, 0) };
    case 'sh': return { op: 'sh', name: name(operands, 0) };
    // Marked content
    case 'MP': return { op: 'MP', tag: name(operands, 0) };
    case 'DP': return { op: 'DP', tag: name(operands, 0), props: operands[1] };
    case 'BMC': return { op: 'BMC', tag: name(operands, 0) };
    case 'BDC': return { op: 'BDC', tag: name(operands, 0), props: operands[1] };
    case 'EMC': return { op: 'EMC' };
    // Inline image (skip — content between BI..ID..EI is binary)
    case 'BI': return { op: 'BI' };
    case 'ID': return { op: 'ID' };
    case 'EI': return { op: 'EI' };
    default:
      return { op: '_unknown', raw: kw, operands: operands.slice() };
  }
}
