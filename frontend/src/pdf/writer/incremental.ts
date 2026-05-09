// Incremental update 직렬화 (§7.5.6)
//
// 원본 byte 그대로 + 끝에 변경된 객체들 + 새 xref + 새 trailer.

import {
  PdfDict,
  PdfObject,
  PdfRef,
  asNumber,
  cloneObject,
  dictGet,
  dictSet,
  isArray,
  isString,
  pdfArray,
  pdfHexString,
  pdfInt,
  pdfLiteralString,
  pdfRef,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { ByteSink, serializeIndirectObject } from './serializer';

export interface SerializeResult {
  bytes: Uint8Array;
}

export function serializeIncremental(doc: PdfDocument): SerializeResult {
  const out = new ByteSink();
  // 1) 원본 그대로 — 변경 없음
  out.write(doc.buf);
  // EOL 보장 (원본이 EOL로 끝나지 않을 가능성 낮지만)
  out.write('\n');

  // 2) dirty 객체 직렬화 — 객체 번호 오름차순으로
  const dirtyEntries = [...doc.dirty.entries()].sort((a, b) => a[0] - b[0]);
  const offsets = new Map<number, { offset: number; gen: number; freed: boolean }>();
  for (const [num, { gen, obj }] of dirtyEntries) {
    if (doc.freed.has(num)) {
      offsets.set(num, { offset: 0, gen, freed: true });
      continue;
    }
    offsets.set(num, { offset: out.length, gen, freed: false });
    serializeIndirectObject(num, gen, obj, out);
  }

  // 3) 새 xref offset
  const xrefOffset = out.length;

  // 4) xref 섹션 작성 — subsection 단위로 묶음.
  out.write('xref\n');
  // 객체 번호를 정렬해 연속 구간(subsection)으로 그룹.
  const nums = [...offsets.keys()].sort((a, b) => a - b);
  // 0번도 함께 — 만약 dirty에 있지 않으면 그대로 두고 우리가 새로 쓰지 않는다.
  // 하지만 incremental update의 xref는 *변경된* 0번 free entry도 함께 포함하는 게 안전.
  // 단순화: 0번을 항상 free head로 다시 작성.
  let cursor = 0;
  const groups: Array<{ start: number; entries: Array<typeof offsets extends Map<infer _K, infer V> ? V : never> }> = [];
  let curGroup: { start: number; entries: Array<{ offset: number; gen: number; freed: boolean }> } | null = null;
  // Always include obj 0 as free head
  const all: Array<[number, { offset: number; gen: number; freed: boolean }]> = [
    [0, { offset: 0, gen: 65535, freed: true }],
  ];
  for (const n of nums) all.push([n, offsets.get(n)!]);

  for (const [n, e] of all) {
    if (!curGroup || n !== curGroup.start + curGroup.entries.length) {
      if (curGroup) groups.push(curGroup);
      curGroup = { start: n, entries: [e] };
    } else {
      curGroup.entries.push(e);
    }
  }
  if (curGroup) groups.push(curGroup);

  for (const g of groups) {
    out.write(`${g.start} ${g.entries.length}\n`);
    for (const e of g.entries) {
      const off = e.offset.toString().padStart(10, '0');
      const gen = e.gen.toString().padStart(5, '0');
      out.write(`${off} ${gen} ${e.freed ? 'f' : 'n'} \n`);
    }
  }

  // 5) trailer
  const newSize = Math.max(doc.getNextNum(), Math.max(...nums, 0) + 1);
  const trailer = cloneObject(doc.trailer) as PdfDict;
  dictSet(trailer, 'Size', pdfInt(newSize));
  // /Prev 는 *원본*의 startxref offset
  if (doc.xref.startxrefOffsets.length > 0) {
    dictSet(trailer, 'Prev', pdfInt(doc.xref.startxrefOffsets[0]!));
  }
  // /ID 갱신
  updateId(trailer);

  out.write('trailer\n');
  // dict 직렬화 (cloneObject가 PdfDict를 반환하므로 직접 sink로)
  out.write('<<');
  for (const [k, v] of trailer.map) {
    out.write(' /');
    out.write(k);
    out.write(' ');
    const tmp = new ByteSink();
    // 재귀 호출 대신 serializeObject 사용
    // import 사이클 회피를 위해 동적 import 대신 require형 — 하지만 ESM이라 같은 모듈 활용
    serializeValue(v, tmp);
    out.write(tmp.toBytes());
  }
  out.write(' >>\n');

  // 6) startxref + EOF
  out.write(`startxref\n${xrefOffset}\n%%EOF\n`);

  return { bytes: out.toBytes() };
}

// 위 직렬화에서 사용한 helper. serializer.ts의 serializeObject를 그대로 사용.
import { serializeObject } from './serializer';
function serializeValue(v: PdfObject, sink: ByteSink): void {
  serializeObject(v, sink);
}

function updateId(trailer: PdfDict): void {
  const random = randomHex(16);
  const existing = dictGet(trailer, 'ID');
  if (existing && isArray(existing) && existing.items.length === 2) {
    // 첫 ID는 보존
    const arr = existing as typeof existing & { items: PdfObject[] };
    arr.items[1] = pdfHexString(hexToBytes(random));
    dictSet(trailer, 'ID', arr);
  } else {
    const id1 = pdfHexString(hexToBytes(random));
    const id2 = pdfHexString(hexToBytes(randomHex(16)));
    dictSet(trailer, 'ID', pdfArray([id1, id2]));
  }
}

function randomHex(bytes: number): string {
  // Node crypto가 깔려있을 텐데 의존성 회피를 위해 Math.random fallback도 두자.
  let out = '';
  for (let i = 0; i < bytes; i += 1) {
    out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
