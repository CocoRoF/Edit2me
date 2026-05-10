// Op body validation. zod 등 외부 라이브러리 없이 손코딩.
// 잘못된 클라이언트 요청을 API 라우트에서 일찍 거절해 PDF 엔진까지 흘러가지 않게.

import type { Op } from '@/pdf/ops/types';

export interface ValidationResult {
  ok: boolean;
  error?: string;
  ops?: Op[];
}

const ALLOWED_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
]);

export function validateOps(raw: unknown): ValidationResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'ops must be an array' };
  if (raw.length === 0) return { ok: false, error: 'ops is empty' };
  if (raw.length > 200) return { ok: false, error: 'too many ops in one batch (max 200)' };
  const ops: Op[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    const r = validateOne(v);
    if (!r.ok) return { ok: false, error: `op[${i}]: ${r.error}` };
    ops.push(r.op!);
  }
  return { ok: true, ops };
}

function validateOne(v: unknown): { ok: boolean; error?: string; op?: Op } {
  if (!v || typeof v !== 'object') return { ok: false, error: 'not an object' };
  const o = v as Record<string, unknown>;
  switch (o.op) {
    case 'delete-pages':
      if (!Array.isArray(o.indices)) return { ok: false, error: 'indices must be array' };
      if (!o.indices.every((n) => Number.isInteger(n) && (n as number) >= 0)) {
        return { ok: false, error: 'indices must be non-negative integers' };
      }
      return { ok: true, op: { op: 'delete-pages', indices: o.indices as number[] } };
    case 'reorder-pages':
      if (!Array.isArray(o.permutation)) return { ok: false, error: 'permutation must be array' };
      if (!o.permutation.every((n) => Number.isInteger(n) && (n as number) >= 0)) {
        return { ok: false, error: 'permutation must be non-negative integers' };
      }
      return { ok: true, op: { op: 'reorder-pages', permutation: o.permutation as number[] } };
    case 'rotate-pages':
      if (!Array.isArray(o.indices)) return { ok: false, error: 'indices must be array' };
      if (o.angle !== 90 && o.angle !== -90 && o.angle !== 180) {
        return { ok: false, error: 'angle must be 90/-90/180' };
      }
      return {
        ok: true,
        op: {
          op: 'rotate-pages',
          indices: o.indices as number[],
          angle: o.angle as 90 | -90 | 180,
        },
      };
    case 'add-text': {
      if (typeof o.pageIndex !== 'number') return { ok: false, error: 'pageIndex required' };
      if (typeof o.x !== 'number' || typeof o.y !== 'number')
        return { ok: false, error: 'x, y required' };
      if (typeof o.text !== 'string' || o.text.length === 0)
        return { ok: false, error: 'text required' };
      if (o.text.length > 10_000) return { ok: false, error: 'text too long (max 10000)' };
      if (typeof o.font !== 'string' || !ALLOWED_FONTS.has(o.font))
        return { ok: false, error: `font must be one of: ${[...ALLOWED_FONTS].join(', ')}` };
      if (typeof o.fontSize !== 'number' || o.fontSize <= 0 || o.fontSize > 144)
        return { ok: false, error: 'fontSize must be 0..144' };
      const c = o.color as { r?: unknown; g?: unknown; b?: unknown } | undefined;
      if (
        !c ||
        typeof c.r !== 'number' ||
        typeof c.g !== 'number' ||
        typeof c.b !== 'number'
      ) {
        return { ok: false, error: 'color must be { r, g, b } numbers' };
      }
      return {
        ok: true,
        op: {
          op: 'add-text',
          pageIndex: o.pageIndex,
          x: o.x,
          y: o.y,
          text: o.text,
          font: o.font as Extract<Op, { op: 'add-text' }>['font'],
          fontSize: o.fontSize,
          color: { r: c.r, g: c.g, b: c.b },
        },
      };
    }
    case 'edit-text':
      if (typeof o.pageIndex !== 'number') return { ok: false, error: 'pageIndex required' };
      if (typeof o.blockId !== 'string' || o.blockId.length === 0)
        return { ok: false, error: 'blockId required' };
      if (typeof o.newText !== 'string') return { ok: false, error: 'newText required' };
      if (o.newText.length > 10_000) return { ok: false, error: 'newText too long' };
      return {
        ok: true,
        op: {
          op: 'edit-text',
          pageIndex: o.pageIndex,
          blockId: o.blockId,
          newText: o.newText,
        },
      };
    default:
      return { ok: false, error: `unknown op: ${String(o.op)}` };
  }
}
