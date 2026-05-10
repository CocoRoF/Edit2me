import { describe, expect, it } from 'vitest';
import { parseTtf } from '../pdf/fonts/ttf-parser';

describe('ttf-parser', () => {
  it('throws on too-short input', () => {
    expect(() => parseTtf(new Uint8Array(4))).toThrow(/too short/);
  });

  it('throws on unknown sfnt scaler', () => {
    const buf = new Uint8Array(12);
    new DataView(buf.buffer).setUint32(0, 0xdeadbeef);
    expect(() => parseTtf(buf)).toThrow(/sfnt/);
  });

  it('throws on OTF/CFF (OTTO)', () => {
    const buf = new Uint8Array(12);
    new DataView(buf.buffer).setUint32(0, 0x4f54544f); // 'OTTO'
    expect(() => parseTtf(buf)).toThrow(/OTTO/);
  });
});
