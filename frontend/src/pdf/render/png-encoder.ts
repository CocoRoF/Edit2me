// 최소 PNG encoder. 외부 이미지 라이브러리 없이 이미지 XObject 의 raw 픽셀 데이터를
// data URL 로 표시 가능한 PNG byte 로 변환.
//
// 지원: 8-bit grayscale (color type 0), 8-bit RGB (color type 2)
// CMYK 는 R=1-C, G=1-M, B=1-Y 로 단순화 (ICC 변환 없음 — 정확한 색은 v0.4)

import zlib from 'node:zlib';

export type ChannelMode = 'gray' | 'rgb' | 'cmyk-as-rgb';

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
  mode: ChannelMode,
): Uint8Array {
  let colorType: number;
  let outChannels: number;
  let pixelData: Uint8Array;

  if (mode === 'gray') {
    colorType = 0;
    outChannels = 1;
    pixelData = pixels;
  } else if (mode === 'rgb') {
    colorType = 2;
    outChannels = 3;
    pixelData = pixels;
  } else {
    // CMYK → RGB (단순)
    colorType = 2;
    outChannels = 3;
    const total = width * height;
    pixelData = new Uint8Array(total * 3);
    for (let i = 0; i < total; i += 1) {
      const c = pixels[i * 4]! / 255;
      const m = pixels[i * 4 + 1]! / 255;
      const y = pixels[i * 4 + 2]! / 255;
      const k = pixels[i * 4 + 3]! / 255;
      pixelData[i * 3] = Math.round((1 - Math.min(1, c * (1 - k) + k)) * 255);
      pixelData[i * 3 + 1] = Math.round((1 - Math.min(1, m * (1 - k) + k)) * 255);
      pixelData[i * 3 + 2] = Math.round((1 - Math.min(1, y * (1 - k) + k)) * 255);
    }
  }

  // IHDR
  const ihdr = new Uint8Array(13);
  const dvIhdr = new DataView(ihdr.buffer);
  dvIhdr.setUint32(0, width);
  dvIhdr.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT — 각 행 앞에 filter byte (0 = None)
  const rowSize = width * outChannels;
  const filtered = new Uint8Array(height * (rowSize + 1));
  for (let y = 0; y < height; y += 1) {
    filtered[y * (rowSize + 1)] = 0;
    filtered.set(
      pixelData.subarray(y * rowSize, y * rowSize + rowSize),
      y * (rowSize + 1) + 1,
    );
  }
  const compressed = zlib.deflateSync(Buffer.from(filtered));

  // 합치기
  const chunks: Uint8Array[] = [PNG_SIG, makeChunk('IHDR', ihdr), makeChunk('IDAT', new Uint8Array(compressed)), makeChunk('IEND', new Uint8Array(0))];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // CRC32 over (type + data)
  const crcBuf = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) crcBuf[i] = type.charCodeAt(i);
  crcBuf.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcBuf));
  return out;
}

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}
function crc32(bytes: Uint8Array): number {
  const t = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
