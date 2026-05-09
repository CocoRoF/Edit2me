import { describe, expect, it } from 'vitest';
import { ByteSink, serializeObject } from '../pdf/writer/serializer';
import {
  pdfArray,
  pdfDict,
  pdfHexString,
  pdfInt,
  pdfLiteralString,
  pdfName,
  pdfReal,
  pdfRef,
  PdfTrue,
  PdfFalse,
  PdfNull,
} from '../pdf/core/object';

function ser(obj: Parameters<typeof serializeObject>[0]): string {
  const sink = new ByteSink();
  serializeObject(obj, sink);
  return new TextDecoder().decode(sink.toBytes());
}

describe('serializer', () => {
  it('booleans and null', () => {
    expect(ser(PdfTrue)).toBe('true');
    expect(ser(PdfFalse)).toBe('false');
    expect(ser(PdfNull)).toBe('null');
  });

  it('integers', () => {
    expect(ser(pdfInt(0))).toBe('0');
    expect(ser(pdfInt(123))).toBe('123');
    expect(ser(pdfInt(-7))).toBe('-7');
  });

  it('reals trim trailing zeros', () => {
    expect(ser(pdfReal(1.5))).toBe('1.5');
    expect(ser(pdfReal(2.0))).toBe('2');
    expect(ser(pdfReal(0.0001))).toMatch(/^0\.0001/);
  });

  it('names with hex escape', () => {
    expect(ser(pdfName('Foo'))).toBe('/Foo');
    expect(ser(pdfName('A B'))).toBe('/A#20B');
    expect(ser(pdfName('hash#bang'))).toBe('/hash#23bang');
  });

  it('refs', () => {
    expect(ser(pdfRef(5, 0))).toBe('5 0 R');
    expect(ser(pdfRef(12, 3))).toBe('12 3 R');
  });

  it('literal string for safe chars', () => {
    expect(ser(pdfLiteralString('hi'))).toBe('(hi)');
  });

  it('hex string for binary content', () => {
    expect(ser(pdfHexString(new Uint8Array([0x48, 0xff])))).toBe('<48FF>');
  });

  it('arrays', () => {
    expect(ser(pdfArray([pdfInt(1), pdfInt(2), pdfRef(3)]))).toBe('[1 2 3 0 R]');
  });

  it('dicts preserve key order', () => {
    const d = pdfDict([
      ['Type', pdfName('Page')],
      ['Count', pdfInt(3)],
    ]);
    expect(ser(d)).toBe('<< /Type /Page /Count 3 >>');
  });
});
