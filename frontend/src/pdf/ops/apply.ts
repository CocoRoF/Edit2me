// 모든 편집 연산의 단일 진입점.

import { PdfDocument } from '../parser/document';
import { Op } from './types';
import { deletePages } from './delete-pages';
import { reorderPages, rotatePages } from './reorder-pages';
import { addText } from './add-text';
import { editText } from './edit-text';

export interface ApplyResult {
  affectedPages: number[];
  newPageCount: number;
}

export function applyOps(doc: PdfDocument, ops: Op[]): ApplyResult {
  const affected = new Set<number>();
  for (const op of ops) {
    switch (op.op) {
      case 'delete-pages':
        deletePages(doc, op.indices);
        // 모든 페이지가 영향
        for (let i = 0; i < doc.pageCount(); i += 1) affected.add(i);
        break;
      case 'reorder-pages':
        reorderPages(doc, op.permutation);
        for (let i = 0; i < doc.pageCount(); i += 1) affected.add(i);
        break;
      case 'rotate-pages':
        rotatePages(doc, op.indices, op.angle);
        for (const i of op.indices) affected.add(i);
        break;
      case 'add-text':
        addText(doc, {
          pageIndex: op.pageIndex,
          x: op.x,
          y: op.y,
          text: op.text,
          font: op.font,
          fontSize: op.fontSize,
          color: op.color,
        });
        affected.add(op.pageIndex);
        break;
      case 'edit-text':
        editText(doc, {
          pageIndex: op.pageIndex,
          blockId: op.blockId,
          newText: op.newText,
        });
        affected.add(op.pageIndex);
        break;
      default:
        throw new Error(`Unknown op: ${(op as { op: string }).op}`);
    }
  }
  return {
    affectedPages: [...affected].sort((a, b) => a - b),
    newPageCount: doc.pageCount(),
  };
}
