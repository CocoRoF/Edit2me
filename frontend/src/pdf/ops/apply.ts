// 모든 편집 연산의 단일 진입점.

import { PdfDocument } from '../parser/document';
import { Op } from './types';
import { deletePages } from './delete-pages';
import { reorderPages, rotatePages } from './reorder-pages';
import { addText } from './add-text';
import { editText } from './edit-text';
import { editTextGroup } from './edit-text-group';
import { ParsedTtf } from '../fonts/ttf-parser';

export interface ApplyResult {
  affectedPages: number[];
  newPageCount: number;
}

export interface ApplyContext {
  /** uploadId → ParsedTtf + baseName. add-text { font: { kind: 'ttf', uploadId } } 에서 참조. */
  uploadedFonts?: Map<string, { parsed: ParsedTtf; baseName: string }>;
}

export function applyOps(doc: PdfDocument, ops: Op[], ctx: ApplyContext = {}): ApplyResult {
  const affected = new Set<number>();
  for (const op of ops) {
    switch (op.op) {
      case 'delete-pages':
        deletePages(doc, op.indices);
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
      case 'add-text': {
        let ttf: { parsed: ParsedTtf; baseName: string } | undefined;
        let coreFont = 'Helvetica';
        if (typeof op.font === 'string') {
          coreFont = op.font;
        } else if (op.font.kind === 'ttf') {
          const f = ctx.uploadedFonts?.get(op.font.uploadId);
          if (!f) {
            throw new Error(`add-text: uploaded font "${op.font.uploadId}" not found`);
          }
          ttf = f;
        }
        addText(doc, {
          pageIndex: op.pageIndex,
          x: op.x,
          y: op.y,
          text: op.text,
          font: coreFont,
          fontSize: op.fontSize,
          color: op.color,
          ttf,
        });
        affected.add(op.pageIndex);
        break;
      }
      case 'edit-text':
        editText(doc, {
          pageIndex: op.pageIndex,
          blockId: op.blockId,
          newText: op.newText,
        });
        affected.add(op.pageIndex);
        break;
      case 'edit-text-group':
        editTextGroup(doc, {
          pageIndex: op.pageIndex,
          blockIds: op.blockIds,
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
