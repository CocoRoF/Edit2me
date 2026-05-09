// Page tree 조작 헬퍼.
// MVP 정책: 모든 페이지를 단일 평면 /Pages 노드 아래로 정규화한 후 변경.
// 상속 키(MediaBox, Resources)는 각 페이지로 inline 보장.

import {
  PdfArray,
  PdfDict,
  PdfObject,
  PdfRef,
  asNumber,
  cloneObject,
  dictDelete,
  dictGet,
  dictHas,
  dictSet,
  isArray,
  isDict,
  isName,
  isRef,
  pdfArray,
  pdfDict,
  pdfInt,
  pdfName,
  pdfRef,
} from '../core/object';
import { PdfDocument } from '../parser/document';

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

// 페이지 dict들을 순서대로 받아서 단일 부모 /Pages 노드를 만들고 catalog 갱신.
// 각 페이지의 상속 키를 inline. 부모 ref도 새 부모로 갱신.
export function reflattenPages(doc: PdfDocument, pageRefs: PdfRef[]): void {
  if (pageRefs.length === 0) {
    throw new Error('Cannot create PDF with zero pages');
  }

  // 1) 새 부모 ref 미리 할당 (자식이 /Parent로 이를 참조해야 하므로)
  const newParentRef = doc.allocateObject(pdfDict([['Type', pdfName('Pages')]]));
  // 2) 각 페이지에 상속 키 inline + /Parent 갱신
  for (const ref of pageRefs) {
    const pageObj = doc.resolve(ref);
    if (!isDict(pageObj)) continue;
    // 상속된 키를 inline (이미 페이지에 있으면 그대로)
    for (const k of INHERITABLE) {
      if (!dictHas(pageObj, k)) {
        const inh = doc.inheritedAttr(pageObj, k);
        if (inh) {
          // 깊은 복제 후 inline (다른 페이지가 같은 객체를 공유할 수 있음)
          dictSet(pageObj, k, cloneObject(inh));
        }
      }
    }
    dictSet(pageObj, 'Parent', newParentRef);
    doc.markDirty(ref.num, ref.gen, pageObj);
  }
  // 3) 부모 dict 작성
  const parentDict = pdfDict([
    ['Type', pdfName('Pages')],
    ['Kids', pdfArray([...pageRefs])],
    ['Count', pdfInt(pageRefs.length)],
  ]);
  doc.markDirty(newParentRef.num, newParentRef.gen, parentDict);
  // 4) catalog의 /Pages 갱신
  const catRef = dictGet(doc.trailer, 'Root') as PdfRef | undefined;
  if (!catRef || !isRef(catRef)) throw new Error('No /Root');
  const cat = cloneObject(doc.resolve(catRef)) as PdfDict;
  dictSet(cat, 'Pages', newParentRef);
  doc.markDirty(catRef.num, catRef.gen, cat);
}

// 모든 살아있는 페이지의 ref 배열.
export function listPageRefs(doc: PdfDocument): PdfRef[] {
  return doc.getPages().map((p) => p.ref);
}
