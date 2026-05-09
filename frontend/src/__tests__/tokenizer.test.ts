import { describe, expect, it } from 'vitest';
import { Tokenizer } from '../pdf/core/tokenizer';

function tokens(s: string) {
  const tk = new Tokenizer(new TextEncoder().encode(s));
  const out: Array<{ type: string; value?: unknown }> = [];
  while (true) {
    const t = tk.next();
    if (t.type === 'eof') break;
    out.push({ type: t.type, value: t.value });
  }
  return out;
}

describe('tokenizer', () => {
  it('parses integer / real numbers', () => {
    expect(tokens('1 2 -3 +4 .5 -.7 1.25')).toEqual([
      { type: 'int', value: 1 },
      { type: 'int', value: 2 },
      { type: 'int', value: -3 },
      { type: 'int', value: 4 },
      { type: 'real', value: 0.5 },
      { type: 'real', value: -0.7 },
      { type: 'real', value: 1.25 },
    ]);
  });

  it('treats CR / LF / CRLF as whitespace', () => {
    expect(tokens('1\r2\n3\r\n4').map((t) => t.value)).toEqual([1, 2, 3, 4]);
  });

  it('parses literal strings with escapes', () => {
    const ts = tokens('(hi) (line1\\nline2) (\\(nest\\))');
    expect(ts).toHaveLength(3);
    expect(new TextDecoder().decode(ts[0]!.value as Uint8Array)).toBe('hi');
    expect(new TextDecoder().decode(ts[1]!.value as Uint8Array)).toBe('line1\nline2');
    expect(new TextDecoder().decode(ts[2]!.value as Uint8Array)).toBe('(nest)');
  });

  it('parses hex strings (even and odd length)', () => {
    const ts = tokens('<48656C6C6F> <4D>');
    expect(new TextDecoder().decode(ts[0]!.value as Uint8Array)).toBe('Hello');
    expect((ts[1]!.value as Uint8Array)[0]).toBe(0x4d);
  });

  it('parses names with hex escape', () => {
    expect(tokens('/Foo /A#20B /F1')).toEqual([
      { type: 'name', value: 'Foo' },
      { type: 'name', value: 'A B' },
      { type: 'name', value: 'F1' },
    ]);
  });

  it('skips line comments', () => {
    expect(tokens('1 % a comment\n2').map((t) => t.value)).toEqual([1, 2]);
  });

  it('opens dict and array', () => {
    const ts = tokens('<< /K 1 >> [1 2 3]');
    expect(ts.map((t) => t.type)).toEqual([
      'dict_open',
      'name',
      'int',
      'dict_close',
      'array_open',
      'int',
      'int',
      'int',
      'array_close',
    ]);
  });
});
