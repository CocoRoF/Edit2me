// Stream filter decode (§7.4)
//
// FlateDecode (zlib) + PNG predictor가 가장 많이 쓰인다.
// ASCIIHexDecode, ASCII85Decode, RunLengthDecode도 흔한 편.
// CCITT/JBIG2/JPX/DCT는 v1에서 디코드 안 함 (이미지 stream은 그대로 보존).

import zlib from 'node:zlib';
import {
  PdfDict,
  PdfObject,
  PdfStream,
  asNumber,
  dictGet,
  isArray,
  isDict,
  isName,
} from './object';

export interface StreamFilter {
  name: string;
  params?: PdfDict;
}

// stream의 /Filter, /DecodeParms를 정규화해서 [{name, params}, ...] 로.
export function getFilterChain(stream: PdfStream): StreamFilter[] {
  const filterObj = dictGet(stream.dict, 'Filter');
  if (!filterObj) return [];
  const paramsObj = dictGet(stream.dict, 'DecodeParms') ?? dictGet(stream.dict, 'DP');

  const names: string[] = [];
  if (isName(filterObj)) names.push(filterObj.value);
  else if (isArray(filterObj)) {
    for (const x of filterObj.items) if (isName(x)) names.push(x.value);
  }

  const params: Array<PdfDict | undefined> = [];
  if (paramsObj) {
    if (isDict(paramsObj)) params.push(paramsObj);
    else if (isArray(paramsObj)) {
      for (const x of paramsObj.items) {
        if (isDict(x)) params.push(x);
        else params.push(undefined);
      }
    }
  }

  return names.map((name, i) => ({ name, params: params[i] }));
}

// 단일 필터 디코드. 미지원 필터는 그대로 반환 (이미지 stream 등).
export function applyFilter(input: Uint8Array, f: StreamFilter): Uint8Array {
  switch (f.name) {
    case 'FlateDecode':
    case 'Fl': {
      const inflated = zlib.inflateSync(Buffer.from(input));
      return applyPredictor(new Uint8Array(inflated), f.params);
    }
    case 'ASCIIHexDecode':
    case 'AHx':
      return decodeAsciiHex(input);
    case 'ASCII85Decode':
    case 'A85':
      return decodeAscii85(input);
    case 'RunLengthDecode':
    case 'RL':
      return decodeRunLength(input);
    case 'LZWDecode':
    case 'LZW':
      return applyPredictor(decodeLZW(input), f.params);
    case 'DCTDecode':
    case 'DCT':
    case 'JPXDecode':
    case 'JPX':
    case 'JBIG2Decode':
    case 'CCITTFaxDecode':
    case 'CCF':
    case 'Crypt':
      // 이미지/암호 필터는 보존 (디코드 안 함)
      return input;
    default:
      throw new Error(`Unknown stream filter: ${f.name}`);
  }
}

// 모든 필터 체인 적용. 마지막이 이미지 필터(DCT 등)면 그 단계에서 멈춰 raw 반환.
export function decodeStream(stream: PdfStream): Uint8Array {
  let data = stream.raw;
  const chain = getFilterChain(stream);
  for (const f of chain) {
    if (
      f.name === 'DCTDecode' ||
      f.name === 'DCT' ||
      f.name === 'JPXDecode' ||
      f.name === 'JPX' ||
      f.name === 'JBIG2Decode' ||
      f.name === 'CCITTFaxDecode' ||
      f.name === 'CCF'
    ) {
      // 이미지 필터에 도달하면 디코드 안 함 (raw 보존)
      return data;
    }
    data = applyFilter(data, f);
  }
  return data;
}

// ---- Predictor (PNG predictor 등 — §7.4.4.4) ----

function applyPredictor(data: Uint8Array, params?: PdfDict): Uint8Array {
  if (!params) return data;
  const predictor = asNumber(dictGet(params, 'Predictor')) ?? 1;
  if (predictor === 1) return data;

  const columns = asNumber(dictGet(params, 'Columns')) ?? 1;
  const colors = asNumber(dictGet(params, 'Colors')) ?? 1;
  const bpc = asNumber(dictGet(params, 'BitsPerComponent')) ?? 8;
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowSize = Math.ceil((columns * colors * bpc) / 8);

  if (predictor === 2) {
    // TIFF predictor
    return applyTiffPredictor(data, columns, colors, bpc);
  }

  // PNG predictor (10..15). 행마다 1 byte tag + rowSize byte.
  if (predictor < 10 || predictor > 15) {
    // 알려지지 않은 predictor — 원본 반환 (관용 처리)
    return data;
  }

  const rowSizeWithTag = rowSize + 1;
  const numRows = Math.floor(data.length / rowSizeWithTag);
  const out = new Uint8Array(numRows * rowSize);
  let prevRow: Uint8Array = new Uint8Array(rowSize);
  for (let r = 0; r < numRows; r += 1) {
    const tag = data[r * rowSizeWithTag]!;
    const row = data.subarray(
      r * rowSizeWithTag + 1,
      r * rowSizeWithTag + 1 + rowSize,
    );
    const decoded = new Uint8Array(rowSize);
    switch (tag) {
      case 0: // None
        decoded.set(row);
        break;
      case 1: // Sub
        for (let i = 0; i < rowSize; i += 1) {
          const left = i >= bytesPerPixel ? decoded[i - bytesPerPixel]! : 0;
          decoded[i] = (row[i]! + left) & 0xff;
        }
        break;
      case 2: // Up
        for (let i = 0; i < rowSize; i += 1) {
          decoded[i] = (row[i]! + prevRow[i]!) & 0xff;
        }
        break;
      case 3: // Average
        for (let i = 0; i < rowSize; i += 1) {
          const left = i >= bytesPerPixel ? decoded[i - bytesPerPixel]! : 0;
          const up = prevRow[i]!;
          decoded[i] = (row[i]! + Math.floor((left + up) / 2)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < rowSize; i += 1) {
          const left = i >= bytesPerPixel ? decoded[i - bytesPerPixel]! : 0;
          const up = prevRow[i]!;
          const upLeft = i >= bytesPerPixel ? prevRow[i - bytesPerPixel]! : 0;
          decoded[i] = (row[i]! + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        // 알려지지 않은 tag — None으로 처리
        decoded.set(row);
    }
    out.set(decoded, r * rowSize);
    prevRow = decoded;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function applyTiffPredictor(
  data: Uint8Array,
  columns: number,
  colors: number,
  bpc: number,
): Uint8Array {
  if (bpc !== 8) return data; // 단순화
  const rowSize = columns * colors;
  const out = new Uint8Array(data);
  for (let r = 0; r < Math.floor(data.length / rowSize); r += 1) {
    for (let i = colors; i < rowSize; i += 1) {
      out[r * rowSize + i] = (out[r * rowSize + i]! + out[r * rowSize + i - colors]!) & 0xff;
    }
  }
  return out;
}

// ---- ASCIIHexDecode (§7.4.2) ----

function decodeAsciiHex(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let high = -1;
  for (const b of input) {
    if (b === 0x3e /*>*/) break;
    if (
      b === 0x20 ||
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      b === 0x0c ||
      b === 0x00
    )
      continue;
    const v = hexVal(b);
    if (v < 0) continue;
    if (high < 0) high = v;
    else {
      out.push((high << 4) | v);
      high = -1;
    }
  }
  if (high >= 0) out.push(high << 4);
  return new Uint8Array(out);
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

// ---- ASCII85Decode (§7.4.3) ----

function decodeAscii85(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group = 0;
  let count = 0;
  for (let i = 0; i < input.length; i += 1) {
    const b = input[i]!;
    if (b === 0x7e /*~*/) break; // ~> 종결
    if (
      b === 0x20 ||
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      b === 0x0c ||
      b === 0x00
    )
      continue;
    if (b === 0x7a /*z*/ && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (b < 0x21 || b > 0x75) continue;
    group = group * 85 + (b - 0x21);
    count += 1;
    if (count === 5) {
      out.push((group >>> 24) & 0xff, (group >>> 16) & 0xff, (group >>> 8) & 0xff, group & 0xff);
      group = 0;
      count = 0;
    }
  }
  if (count > 0) {
    for (let i = count; i < 5; i += 1) group = group * 85 + 84;
    const bytes = [
      (group >>> 24) & 0xff,
      (group >>> 16) & 0xff,
      (group >>> 8) & 0xff,
      group & 0xff,
    ];
    for (let i = 0; i < count - 1; i += 1) out.push(bytes[i]!);
  }
  return new Uint8Array(out);
}

// ---- RunLengthDecode (§7.4.5) ----

function decodeRunLength(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const len = input[i]!;
    i += 1;
    if (len === 128) break;
    if (len < 128) {
      // 다음 len+1 byte 그대로
      const n = len + 1;
      for (let j = 0; j < n && i < input.length; j += 1) {
        out.push(input[i]!);
        i += 1;
      }
    } else {
      // 다음 byte를 (257-len)번 반복
      const n = 257 - len;
      const b = input[i]!;
      i += 1;
      for (let j = 0; j < n; j += 1) out.push(b);
    }
  }
  return new Uint8Array(out);
}

// ---- LZWDecode (§7.4.4) ----
// 빈도 낮음. 단순 구현.

function decodeLZW(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  const bitReader = {
    pos: 0,
    read(n: number): number {
      let v = 0;
      for (let i = 0; i < n; i += 1) {
        const byteIdx = this.pos >> 3;
        const bitIdx = 7 - (this.pos & 7);
        const b = byteIdx < input.length ? input[byteIdx]! : 0;
        v = (v << 1) | ((b >> bitIdx) & 1);
        this.pos += 1;
      }
      return v;
    },
  };

  const dict: Uint8Array[] = [];
  function reset(): void {
    dict.length = 0;
    for (let i = 0; i < 256; i += 1) dict.push(new Uint8Array([i]));
    dict.push(new Uint8Array([])); // 256 = clear
    dict.push(new Uint8Array([])); // 257 = eod
  }
  reset();
  let codeBits = 9;
  let prev: Uint8Array | null = null;
  while (true) {
    if (bitReader.pos + codeBits > input.length * 8) break;
    const code = bitReader.read(codeBits);
    if (code === 257) break;
    if (code === 256) {
      reset();
      codeBits = 9;
      prev = null;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length) {
      entry = dict[code]!;
    } else if (code === dict.length && prev) {
      entry = new Uint8Array(prev.length + 1);
      entry.set(prev);
      entry[prev.length] = prev[0]!;
    } else {
      break;
    }
    for (const b of entry) out.push(b);
    if (prev) {
      const next = new Uint8Array(prev.length + 1);
      next.set(prev);
      next[prev.length] = entry[0]!;
      dict.push(next);
      if (dict.length === 511) codeBits = 10;
      else if (dict.length === 1023) codeBits = 11;
      else if (dict.length === 2047) codeBits = 12;
    }
    prev = entry;
  }
  return new Uint8Array(out);
}
