// PdfObject → 바이트 직렬화

import {
  PdfArray,
  PdfDict,
  PdfObject,
  PdfStream,
  PdfString,
  isInt,
  isReal,
} from '../core/object';

const SP = 0x20;
const LF = 0x0a;

export class ByteSink {
  private chunks: Uint8Array[] = [];
  private size = 0;

  write(b: Uint8Array | string): void {
    const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : b;
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  writeByte(b: number): void {
    const arr = new Uint8Array(1);
    arr[0] = b;
    this.chunks.push(arr);
    this.size += 1;
  }

  get length(): number {
    return this.size;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

export function serializeObject(obj: PdfObject, out: ByteSink): void {
  switch (obj.kind) {
    case 'null':
      out.write('null');
      return;
    case 'bool':
      out.write(obj.value ? 'true' : 'false');
      return;
    case 'int':
      out.write(String(obj.value | 0));
      return;
    case 'real':
      out.write(formatReal(obj.value));
      return;
    case 'name':
      out.write(serializeName(obj.value));
      return;
    case 'string':
      out.write(serializeString(obj));
      return;
    case 'ref':
      out.write(`${obj.num} ${obj.gen} R`);
      return;
    case 'array':
      serializeArray(obj, out);
      return;
    case 'dict':
      serializeDict(obj, out);
      return;
    case 'stream':
      serializeStream(obj, out);
      return;
  }
}

function formatReal(v: number): string {
  if (!Number.isFinite(v)) return '0';
  // 소수점 5자리, 불필요한 0 제거
  let s = v.toFixed(5);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function serializeName(v: string): string {
  // /로 시작 + 비ASCII / 구분자 / # 는 #XX 이스케이프
  const bytes = new TextEncoder().encode(v);
  let out = '/';
  for (const b of bytes) {
    if (
      b < 0x21 ||
      b > 0x7e ||
      b === 0x23 || // #
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
    ) {
      out += '#' + b.toString(16).padStart(2, '0').toUpperCase();
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

function serializeString(s: PdfString): string {
  // literal로 표현 가능한지 확인. 비프린터블이 많으면 hex로.
  let nonPrintable = 0;
  for (const b of s.bytes) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) nonPrintable += 1;
    if (b > 0x7e) nonPrintable += 1;
  }
  const useHex = !s.literal || nonPrintable * 3 > s.bytes.length;
  if (useHex) {
    let out = '<';
    for (const b of s.bytes) out += b.toString(16).padStart(2, '0').toUpperCase();
    out += '>';
    return out;
  }
  // literal: ( ... ). \ ( ) 만 이스케이프, 그 외는 그대로.
  let out = '(';
  let depth = 0;
  for (let i = 0; i < s.bytes.length; i += 1) {
    const b = s.bytes[i]!;
    if (b === 0x5c) out += '\\\\';
    else if (b === 0x28) {
      out += '\\(';
      depth += 1;
    } else if (b === 0x29) {
      if (depth > 0) {
        out += ')';
        depth -= 1;
      } else out += '\\)';
    } else if (b === 0x0d) out += '\\r';
    else if (b === 0x0a) out += '\\n';
    else if (b === 0x09) out += '\\t';
    else if (b < 0x20 || b > 0x7e) {
      out += '\\' + b.toString(8).padStart(3, '0');
    } else out += String.fromCharCode(b);
  }
  out += ')';
  return out;
}

function serializeArray(a: PdfArray, out: ByteSink): void {
  out.write('[');
  for (let i = 0; i < a.items.length; i += 1) {
    if (i > 0) out.writeByte(SP);
    serializeObject(a.items[i]!, out);
  }
  out.write(']');
}

function serializeDict(d: PdfDict, out: ByteSink): void {
  out.write('<<');
  for (const [k, v] of d.map) {
    out.write(' ');
    out.write(serializeName(k));
    out.write(' ');
    serializeObject(v, out);
  }
  out.write(' >>');
}

function serializeStream(s: PdfStream, out: ByteSink): void {
  // /Length 갱신 보장
  s.dict.map.set('Length', { kind: 'int', value: s.raw.length });
  serializeDict(s.dict, out);
  out.write('\nstream\n');
  out.write(s.raw);
  out.write('\nendstream');
}

export function serializeIndirectObject(
  num: number,
  gen: number,
  obj: PdfObject,
  out: ByteSink,
): void {
  out.write(`${num} ${gen} obj\n`);
  serializeObject(obj, out);
  out.write('\nendobj\n');
}
