// Full rewrite serialization
//
// 도달 가능한 모든 객체를 새 객체 번호 1..N으로 재할당해 새로 작성.
// 페이지 병합 결과나 "최적화" 다운로드에 사용.

import {
  PdfArray,
  PdfDict,
  PdfObject,
  PdfRef,
  PdfStream,
  cloneObject,
  dictGet,
  dictSet,
  isArray,
  isDict,
  isRef,
  isStream,
  pdfArray,
  pdfHexString,
  pdfInt,
  pdfRef,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { ByteSink, serializeIndirectObject, serializeObject } from './serializer';

export interface FullWriteOptions {
  catalog?: PdfRef; // 다른 catalog로 시작하고 싶을 때 (병합)
}

// 객체 그래프 BFS로 reachable 객체를 모두 새 번호로 매핑하면서 직렬화.
export function serializeFull(doc: PdfDocument, opts: FullWriteOptions = {}): Uint8Array {
  const out = new ByteSink();

  // 1) 헤더
  out.write(`%PDF-${doc.version || '1.7'}\n`);
  // 바이너리 마커
  out.write(new Uint8Array([0x25, 0xc4, 0xc5, 0xc6, 0xc7, 0x0a]));

  // 2) reachable 객체 수집 + 번호 재매핑
  const oldToNew = new Map<string, number>(); // `${num}_${gen}` → newNum
  const queue: PdfRef[] = [];
  let nextNum = 1;

  const rootRef = opts.catalog ?? (dictGet(doc.trailer, 'Root') as PdfRef | undefined);
  if (!rootRef || !isRef(rootRef)) throw new Error('No /Root');
  queue.push(rootRef);
  oldToNew.set(`${rootRef.num}_${rootRef.gen}`, nextNum);
  nextNum += 1;

  // /Info도 보존 (있으면)
  const infoRef = dictGet(doc.trailer, 'Info');
  let newInfo: PdfRef | undefined;
  if (infoRef && isRef(infoRef)) {
    newInfo = pdfRef(nextNum);
    oldToNew.set(`${infoRef.num}_${infoRef.gen}`, nextNum);
    queue.push(infoRef);
    nextNum += 1;
  }

  // BFS — 객체 내부의 ref들을 발견할 때마다 새 번호 부여 + 큐에 추가.
  // 이 과정에서 객체 본문은 *복제*하면서 ref만 새 번호로 교체.
  const remappedObjects = new Map<number, PdfObject>(); // newNum → 직렬화할 객체

  while (queue.length > 0) {
    const ref = queue.shift()!;
    const newNum = oldToNew.get(`${ref.num}_${ref.gen}`)!;
    const obj = doc.resolve(ref);
    const remapped = remapRefs(obj, oldToNew, queue, () => {
      const n = nextNum;
      nextNum += 1;
      return n;
    });
    remappedObjects.set(newNum, remapped);
  }

  // 3) 객체 직렬화 (newNum 오름차순)
  const offsets = new Map<number, number>();
  const sortedNums = [...remappedObjects.keys()].sort((a, b) => a - b);
  for (const newNum of sortedNums) {
    offsets.set(newNum, out.length);
    serializeIndirectObject(newNum, 0, remappedObjects.get(newNum)!, out);
  }

  // 4) xref
  const xrefOffset = out.length;
  out.write('xref\n');
  out.write(`0 ${nextNum}\n`);
  out.write('0000000000 65535 f \n');
  for (let i = 1; i < nextNum; i += 1) {
    const off = offsets.get(i) ?? 0;
    out.write(`${off.toString().padStart(10, '0')} 00000 n \n`);
  }

  // 5) trailer
  out.write('trailer\n');
  const tSink = new ByteSink();
  const trailerDict: PdfDict = { kind: 'dict', map: new Map() };
  dictSet(trailerDict, 'Size', pdfInt(nextNum));
  dictSet(trailerDict, 'Root', pdfRef(oldToNew.get(`${rootRef.num}_${rootRef.gen}`)!));
  if (newInfo) dictSet(trailerDict, 'Info', newInfo);
  // /ID
  const id1 = pdfHexString(randomBytes(16));
  const id2 = pdfHexString(randomBytes(16));
  dictSet(trailerDict, 'ID', pdfArray([id1, id2]));
  serializeObject(trailerDict, tSink);
  out.write(tSink.toBytes());
  out.write('\n');

  // 6) startxref + EOF
  out.write(`startxref\n${xrefOffset}\n%%EOF\n`);
  return out.toBytes();
}

// PdfObject 내의 ref를 새 번호로 교체. 발견된 새 ref는 큐에 추가.
function remapRefs(
  obj: PdfObject,
  oldToNew: Map<string, number>,
  queue: PdfRef[],
  alloc: () => number,
): PdfObject {
  switch (obj.kind) {
    case 'ref': {
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
      const items = obj.items.map((x) => remapRefs(x, oldToNew, queue, alloc));
      return { kind: 'array', items };
    }
    case 'dict': {
      const m = new Map<string, PdfObject>();
      for (const [k, v] of obj.map) m.set(k, remapRefs(v, oldToNew, queue, alloc));
      return { kind: 'dict', map: m };
    }
    case 'stream': {
      const dict = remapRefs(obj.dict, oldToNew, queue, alloc) as PdfDict;
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
