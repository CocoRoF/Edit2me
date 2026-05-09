// 다중 PDF 병합. 새 doc을 0부터 만든 뒤, 입력 페이지를 deep-clone으로 복사.
//
// 구현 전략: full rewrite로 새 PDF byte를 직접 생성. doc 모델을 거치지 않고
// 객체 스트림에 새 번호를 부여하면서 기록.

import {
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
  isRef,
  pdfArray,
  pdfDict,
  pdfHexString,
  pdfInt,
  pdfName,
  pdfRef,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { ByteSink, serializeIndirectObject, serializeObject } from '../writer/serializer';

export interface MergeSpec {
  source: number; // sources index
  pageIndex: number;
  rotation?: 0 | 90 | 180 | 270;
}

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

// 입력: 여러 PdfDocument + 페이지 선택. 출력: 새 PDF bytes.
export function mergePdfs(sources: PdfDocument[], specs: MergeSpec[]): Uint8Array {
  if (specs.length === 0) throw new Error('No pages to merge');

  const out = new ByteSink();

  // 1) header
  out.write('%PDF-1.7\n');
  out.write(new Uint8Array([0x25, 0xc4, 0xc5, 0xc6, 0xc7, 0x0a]));

  // 2) 객체 번호 할당기
  let nextNum = 1;
  const offsets = new Map<number, number>();

  // 3) catalog (1), pages parent (2)를 먼저 reserve
  const catalogNum = nextNum++;
  const pagesParentNum = nextNum++;

  // 4) 각 spec에 대해 페이지 + 그 페이지에서 reachable한 객체를 복사.
  // 각 source-doc의 (oldNum, oldGen) → newNum 매핑은 source 단위.
  const newPageRefs: PdfRef[] = [];
  for (const spec of specs) {
    const src = sources[spec.source];
    if (!src) throw new Error(`Source ${spec.source} not found`);
    const pages = src.getPages();
    const page = pages[spec.pageIndex];
    if (!page) throw new Error(`Page ${spec.pageIndex} not found in source ${spec.source}`);

    const oldToNew = new Map<string, number>();
    const queue: PdfRef[] = [];

    // 페이지 ref에 새 번호 부여
    const newPageNum = nextNum++;
    oldToNew.set(`${page.ref.num}_${page.ref.gen}`, newPageNum);
    queue.push(page.ref);
    newPageRefs.push(pdfRef(newPageNum));

    while (queue.length > 0) {
      const ref = queue.shift()!;
      const newNum = oldToNew.get(`${ref.num}_${ref.gen}`)!;
      let obj = src.resolve(ref);
      if (obj.kind === 'null') continue;

      // 페이지 객체라면 상속 키를 inline
      if (
        obj.kind === 'dict' &&
        ref.num === page.ref.num &&
        ref.gen === page.ref.gen
      ) {
        obj = cloneObject(obj);
        for (const k of INHERITABLE) {
          if (!dictHas(obj as PdfDict, k)) {
            const inh = src.inheritedAttr(obj as PdfDict, k);
            if (inh) dictSet(obj as PdfDict, k, cloneObject(src.resolve(inh)));
          }
        }
        // /Parent 갱신
        dictSet(obj as PdfDict, 'Parent', pdfRef(pagesParentNum));
        // rotation 적용
        if (spec.rotation !== undefined) {
          dictSet(obj as PdfDict, 'Rotate', pdfInt(spec.rotation));
        }
        // /Annots 등 다른 페이지를 가리키는 ref는 strip (단순화)
        // (페이지 간 link 관계를 유지하려면 더 큰 작업 — v1 비목표)
        dictDelete(obj as PdfDict, 'Annots');
      }

      // ref 재매핑하면서 직렬화. /Parent는 위에서 이미 새 ref로 설정됨.
      const remapped = remapRefs(obj, oldToNew, queue, () => nextNum++, src);
      offsets.set(newNum, out.length);
      serializeIndirectObject(newNum, 0, remapped, out);
    }
  }

  // 5) pages parent dict
  offsets.set(pagesParentNum, out.length);
  const pagesParent = pdfDict([
    ['Type', pdfName('Pages')],
    ['Kids', pdfArray([...newPageRefs])],
    ['Count', pdfInt(newPageRefs.length)],
  ]);
  serializeIndirectObject(pagesParentNum, 0, pagesParent, out);

  // 6) catalog
  offsets.set(catalogNum, out.length);
  const catalog = pdfDict([
    ['Type', pdfName('Catalog')],
    ['Pages', pdfRef(pagesParentNum)],
  ]);
  serializeIndirectObject(catalogNum, 0, catalog, out);

  // 7) xref
  const xrefOffset = out.length;
  out.write('xref\n');
  out.write(`0 ${nextNum}\n`);
  out.write('0000000000 65535 f \n');
  for (let i = 1; i < nextNum; i += 1) {
    const off = offsets.get(i) ?? 0;
    out.write(`${off.toString().padStart(10, '0')} 00000 n \n`);
  }

  // 8) trailer
  const trailer = pdfDict();
  dictSet(trailer, 'Size', pdfInt(nextNum));
  dictSet(trailer, 'Root', pdfRef(catalogNum));
  const id1 = pdfHexString(randomBytes(16));
  const id2 = pdfHexString(randomBytes(16));
  dictSet(trailer, 'ID', pdfArray([id1, id2]));
  out.write('trailer\n');
  const tSink = new ByteSink();
  serializeObject(trailer, tSink);
  out.write(tSink.toBytes());
  out.write('\n');

  out.write(`startxref\n${xrefOffset}\n%%EOF\n`);
  return out.toBytes();
}

function remapRefs(
  obj: PdfObject,
  oldToNew: Map<string, number>,
  queue: PdfRef[],
  alloc: () => number,
  src: PdfDocument,
): PdfObject {
  switch (obj.kind) {
    case 'ref': {
      // 0번이거나 free면 null로
      const target = src.resolve(obj);
      if (target.kind === 'null') return { kind: 'null' };
      const key = `${obj.num}_${obj.gen}`;
      let n = oldToNew.get(key);
      if (n === undefined) {
        n = alloc();
        oldToNew.set(key, n);
        queue.push(obj);
      }
      return pdfRef(n);
    }
    case 'array': {
      const items = obj.items.map((x) => remapRefs(x, oldToNew, queue, alloc, src));
      return { kind: 'array', items };
    }
    case 'dict': {
      const m = new Map<string, PdfObject>();
      for (const [k, v] of obj.map) {
        m.set(k, remapRefs(v, oldToNew, queue, alloc, src));
      }
      return { kind: 'dict', map: m };
    }
    case 'stream': {
      const dict = remapRefs(obj.dict, oldToNew, queue, alloc, src) as PdfDict;
      return { kind: 'stream', dict, raw: new Uint8Array(obj.raw) };
    }
    default:
      return obj;
  }
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}
