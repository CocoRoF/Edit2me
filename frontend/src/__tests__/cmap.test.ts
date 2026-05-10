import { describe, expect, it } from 'vitest';
import { parseToUnicodeCMap } from '../pdf/fonts/cmap';

function cmap(s: string) {
  return parseToUnicodeCMap(new TextEncoder().encode(s));
}

describe('cmap parser', () => {
  it('parses single bfchar entries', () => {
    const r = cmap(`
      /CIDInit /ProcSet findresource begin
      1 beginbfchar
      <0001> <0041>
      endbfchar
      end
    `);
    expect(r.toUnicode.get(1)).toBe('A');
  });

  it('parses bfrange linear', () => {
    const r = cmap(`
      1 beginbfrange
      <0042> <0044> <0042>
      endbfrange
    `);
    expect(r.toUnicode.get(0x42)).toBe('B');
    expect(r.toUnicode.get(0x43)).toBe('C');
    expect(r.toUnicode.get(0x44)).toBe('D');
  });

  it('parses bfrange with destination array', () => {
    const r = cmap(`
      1 beginbfrange
      <0010> <0012> [ <0058> <0059> <005A> ]
      endbfrange
    `);
    expect(r.toUnicode.get(0x10)).toBe('X');
    expect(r.toUnicode.get(0x11)).toBe('Y');
    expect(r.toUnicode.get(0x12)).toBe('Z');
  });

  it('handles whitespace inside hex string (regression for v0.1 bug)', () => {
    const r = cmap(`
      1 beginbfchar
      <0001> <0041 0042>
      endbfchar
    `);
    // <0041 0042>는 'AB' 이어야 함 — 이전에는 'A'만 반환했었음
    expect(r.toUnicode.get(1)).toBe('AB');
  });

  it('records usecmap parent', () => {
    const r = cmap(`
      /UniKS-UCS2-H usecmap
      end
    `);
    expect(r.usesParent).toBe('UniKS-UCS2-H');
  });

  it('extracts codespace ranges', () => {
    const r = cmap(`
      1 begincodespacerange
      <0000> <FFFF>
      endcodespacerange
    `);
    expect(r.codeRanges).toEqual([{ low: 0, high: 0xffff, bytes: 2 }]);
  });

  it('detects /WMode 1 def for vertical writing', () => {
    const r = cmap(`
      begincmap
      /WMode 1 def
      endcmap
    `);
    expect(r.wmode).toBe(1);
  });

  it('defaults wmode to 0 (horizontal)', () => {
    const r = cmap('begincmap endcmap');
    expect(r.wmode).toBe(0);
  });
});
