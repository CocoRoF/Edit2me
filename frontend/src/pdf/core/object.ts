// PDF 객체 타입 정의 (ISO 32000-1 §7.3)
//
// 모든 PDF 값은 이 union 중 하나. discriminator는 'kind' 필드.
// PdfRef('5 0 R')는 다른 객체를 가리키며, resolve()로 indirect를 따라간다.

export type PdfObject =
  | PdfNull
  | PdfBool
  | PdfInt
  | PdfReal
  | PdfName
  | PdfString
  | PdfArray
  | PdfDict
  | PdfStream
  | PdfRef;

export interface PdfNull {
  kind: 'null';
}
export interface PdfBool {
  kind: 'bool';
  value: boolean;
}
export interface PdfInt {
  kind: 'int';
  value: number;
}
export interface PdfReal {
  kind: 'real';
  value: number;
}
export interface PdfName {
  kind: 'name';
  value: string;
}
// String은 *임의 바이트*. literal/hex 보존하지 않으면 직렬화 시 정보 손실.
export interface PdfString {
  kind: 'string';
  bytes: Uint8Array;
  literal: boolean;
}
export interface PdfArray {
  kind: 'array';
  items: PdfObject[];
}
// Dict의 키 순서를 보존하기 위해 Map. 결정론적 직렬화를 위해 중요.
export interface PdfDict {
  kind: 'dict';
  map: Map<string, PdfObject>;
}
// Stream은 dict + 본문 raw bytes. raw는 디코드 전 상태.
export interface PdfStream {
  kind: 'stream';
  dict: PdfDict;
  raw: Uint8Array;
}
export interface PdfRef {
  kind: 'ref';
  num: number;
  gen: number;
}

// 헬퍼들

export const PdfNull: PdfNull = Object.freeze({ kind: 'null' });
export const PdfTrue: PdfBool = Object.freeze({ kind: 'bool', value: true });
export const PdfFalse: PdfBool = Object.freeze({ kind: 'bool', value: false });

export function pdfInt(value: number): PdfInt {
  return { kind: 'int', value };
}
export function pdfReal(value: number): PdfReal {
  return { kind: 'real', value };
}
export function pdfName(value: string): PdfName {
  return { kind: 'name', value };
}
export function pdfRef(num: number, gen = 0): PdfRef {
  return { kind: 'ref', num, gen };
}
export function pdfDict(entries?: Array<[string, PdfObject]>): PdfDict {
  return { kind: 'dict', map: new Map(entries ?? []) };
}
export function pdfArray(items: PdfObject[] = []): PdfArray {
  return { kind: 'array', items };
}
export function pdfLiteralString(value: string | Uint8Array): PdfString {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return { kind: 'string', bytes, literal: true };
}
export function pdfHexString(bytes: Uint8Array): PdfString {
  return { kind: 'string', bytes, literal: false };
}
export function pdfStream(dict: PdfDict, raw: Uint8Array): PdfStream {
  return { kind: 'stream', dict, raw };
}

// Dict 접근 헬퍼: 키가 없으면 undefined, ref면 그대로 반환 (resolve 호출자 책임).
export function dictGet(dict: PdfDict, key: string): PdfObject | undefined {
  return dict.map.get(key);
}
export function dictSet(dict: PdfDict, key: string, value: PdfObject): void {
  dict.map.set(key, value);
}
export function dictDelete(dict: PdfDict, key: string): boolean {
  return dict.map.delete(key);
}
export function dictHas(dict: PdfDict, key: string): boolean {
  return dict.map.has(key);
}

// 타입 가드
export function isRef(obj: PdfObject | undefined): obj is PdfRef {
  return !!obj && obj.kind === 'ref';
}
export function isDict(obj: PdfObject | undefined): obj is PdfDict {
  return !!obj && obj.kind === 'dict';
}
export function isArray(obj: PdfObject | undefined): obj is PdfArray {
  return !!obj && obj.kind === 'array';
}
export function isStream(obj: PdfObject | undefined): obj is PdfStream {
  return !!obj && obj.kind === 'stream';
}
export function isName(obj: PdfObject | undefined): obj is PdfName {
  return !!obj && obj.kind === 'name';
}
export function isString(obj: PdfObject | undefined): obj is PdfString {
  return !!obj && obj.kind === 'string';
}
export function isInt(obj: PdfObject | undefined): obj is PdfInt {
  return !!obj && obj.kind === 'int';
}
export function isReal(obj: PdfObject | undefined): obj is PdfReal {
  return !!obj && obj.kind === 'real';
}
export function isNumber(obj: PdfObject | undefined): obj is PdfInt | PdfReal {
  return !!obj && (obj.kind === 'int' || obj.kind === 'real');
}
export function asNumber(obj: PdfObject | undefined): number | undefined {
  return isNumber(obj) ? obj.value : undefined;
}

// 문자열 디코드: PDF 스트링 → JS 문자열
// PDFDocEncoding (단순화) 또는 UTF-16BE BOM (FE FF) 처리.
export function decodePdfString(s: PdfString): string {
  const b = s.bytes;
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    // UTF-16BE
    let out = '';
    for (let i = 2; i + 1 < b.length; i += 2) {
      out += String.fromCharCode(b[i]! * 256 + b[i + 1]!);
    }
    return out;
  }
  // PDFDocEncoding을 단순히 latin-1로 가정 (대부분의 ASCII에 대해 일치)
  return new TextDecoder('latin1').decode(b);
}

// PdfObject deep clone (참조는 그대로, dict/array/stream은 복사)
export function cloneObject(obj: PdfObject): PdfObject {
  switch (obj.kind) {
    case 'null':
    case 'bool':
    case 'int':
    case 'real':
    case 'name':
    case 'ref':
      return { ...obj };
    case 'string':
      return { kind: 'string', bytes: new Uint8Array(obj.bytes), literal: obj.literal };
    case 'array':
      return { kind: 'array', items: obj.items.map(cloneObject) };
    case 'dict': {
      const m = new Map<string, PdfObject>();
      for (const [k, v] of obj.map) m.set(k, cloneObject(v));
      return { kind: 'dict', map: m };
    }
    case 'stream':
      return {
        kind: 'stream',
        dict: cloneObject(obj.dict) as PdfDict,
        raw: new Uint8Array(obj.raw),
      };
  }
}
