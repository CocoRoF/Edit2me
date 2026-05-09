import { PdfDocument } from '../parser/document';
import { listPageRefs, reflattenPages } from './page-tree';

export function deletePages(doc: PdfDocument, indices: number[]): void {
  const refs = listPageRefs(doc);
  const drop = new Set(indices.filter((i) => i >= 0 && i < refs.length));
  if (drop.size === refs.length) {
    throw new Error('Cannot delete all pages');
  }
  const keep = refs.filter((_, i) => !drop.has(i));
  reflattenPages(doc, keep);
  // 삭제된 페이지 객체는 reachability 분석을 통해 자동으로 직렬화에서 빠짐.
  // (incremental update에서는 새 page tree에서 참조 안 되므로 dangling 객체로 남지만
  // PDF 뷰어들은 도달 못하는 객체를 무시함.)
}
