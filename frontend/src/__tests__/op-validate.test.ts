import { describe, expect, it } from 'vitest';
import { validateOps } from '../lib/op-validate';

describe('validateOps', () => {
  it('rejects non-array', () => {
    expect(validateOps(null).ok).toBe(false);
    expect(validateOps({}).ok).toBe(false);
    expect(validateOps('hi').ok).toBe(false);
  });

  it('rejects empty array', () => {
    expect(validateOps([]).ok).toBe(false);
  });

  it('rejects too many ops', () => {
    const many = Array.from({ length: 201 }, () => ({ op: 'delete-pages', indices: [0] }));
    expect(validateOps(many).ok).toBe(false);
  });

  it('accepts valid delete-pages', () => {
    const r = validateOps([{ op: 'delete-pages', indices: [1, 2, 3] }]);
    expect(r.ok).toBe(true);
    expect(r.ops).toHaveLength(1);
  });

  it('rejects negative indices', () => {
    expect(validateOps([{ op: 'delete-pages', indices: [-1] }]).ok).toBe(false);
  });

  it('accepts valid add-text', () => {
    const r = validateOps([
      {
        op: 'add-text',
        pageIndex: 0,
        x: 10,
        y: 20,
        text: 'hello',
        font: 'Helvetica',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown font in add-text', () => {
    const r = validateOps([
      {
        op: 'add-text',
        pageIndex: 0,
        x: 10,
        y: 20,
        text: 'hi',
        font: 'Arial',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects oversized text', () => {
    const r = validateOps([
      {
        op: 'add-text',
        pageIndex: 0,
        x: 0,
        y: 0,
        text: 'a'.repeat(10_001),
        font: 'Helvetica',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects unknown op', () => {
    expect(validateOps([{ op: 'wat' }]).ok).toBe(false);
  });

  it('accepts valid edit-text', () => {
    const r = validateOps([
      { op: 'edit-text', pageIndex: 0, blockId: 'p0-op3', newText: 'fixed' },
    ]);
    expect(r.ok).toBe(true);
  });
});
