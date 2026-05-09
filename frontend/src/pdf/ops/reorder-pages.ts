import { PdfDocument } from '../parser/document';
import { listPageRefs, reflattenPages } from './page-tree';

export function reorderPages(doc: PdfDocument, permutation: number[]): void {
  const refs = listPageRefs(doc);
  if (permutation.length !== refs.length) {
    throw new Error(`Permutation length ${permutation.length} != page count ${refs.length}`);
  }
  // 검증: 0..N-1이 정확히 1번씩
  const seen = new Set<number>();
  for (const i of permutation) {
    if (i < 0 || i >= refs.length || seen.has(i)) {
      throw new Error('Invalid permutation');
    }
    seen.add(i);
  }
  const newOrder = permutation.map((i) => refs[i]!);
  reflattenPages(doc, newOrder);
}

export function rotatePages(doc: PdfDocument, indices: number[], angle: 90 | -90 | 180): void {
  const refs = listPageRefs(doc);
  for (const idx of indices) {
    if (idx < 0 || idx >= refs.length) continue;
    const ref = refs[idx]!;
    const obj = doc.resolve(ref);
    if (obj.kind !== 'dict') continue;
    const cur = doc.pageRotation(obj);
    const next = (cur + angle + 360) % 360;
    obj.map.set('Rotate', { kind: 'int', value: next });
    doc.markDirty(ref.num, ref.gen, obj);
  }
}
