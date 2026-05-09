// 페이지에 새 텍스트 추가.
//
// 정책:
// - 폰트는 코어14 (임베딩 없음). PDF 자원 dict에 등록.
// - 콘텐츠 stream을 *배열*로 만들고 새 fragment를 push (원본 손대지 않음).

import zlib from 'node:zlib';
import {
  PdfArray,
  PdfDict,
  PdfObject,
  PdfRef,
  PdfStream,
  asNumber,
  cloneObject,
  dictGet,
  dictSet,
  isArray,
  isDict,
  isRef,
  isStream,
  pdfArray,
  pdfDict,
  pdfInt,
  pdfName,
  pdfRef,
  pdfStream,
} from '../core/object';
import { PdfDocument } from '../parser/document';

export interface AddTextSpec {
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  font: string; // 코어14 이름
  fontSize: number;
  color: { r: number; g: number; b: number };
}

export function addText(doc: PdfDocument, spec: AddTextSpec): void {
  const pages = doc.getPages();
  const page = pages[spec.pageIndex];
  if (!page) throw new Error(`Page ${spec.pageIndex} not found`);

  // 1) 페이지 dict 가져오기 + clone (수정 위해)
  const pageDict = cloneObject(page.dict) as PdfDict;

  // 2) Resources dict 보장 (페이지 자체에 없으면 inline 복제)
  let resources = dictGet(pageDict, 'Resources');
  let resourcesDict: PdfDict;
  if (resources && isRef(resources)) {
    // shared resources를 직접 수정하면 다른 페이지에도 영향. 우리는 inline 복제.
    const resolved = doc.resolve(resources);
    if (resolved.kind !== 'dict') throw new Error('Resources is not a dict');
    resourcesDict = cloneObject(resolved) as PdfDict;
  } else if (resources && isDict(resources)) {
    resourcesDict = resources;
  } else {
    // 상속 가능
    const inh = doc.inheritedAttr(pageDict, 'Resources');
    if (inh) {
      const r = doc.resolve(inh);
      resourcesDict = isDict(r) ? (cloneObject(r) as PdfDict) : pdfDict();
    } else {
      resourcesDict = pdfDict();
    }
  }
  dictSet(pageDict, 'Resources', resourcesDict);

  // 3) Font dict 보장
  let fontDict = dictGet(resourcesDict, 'Font');
  let fontDictResolved: PdfDict;
  if (fontDict && isRef(fontDict)) {
    const r = doc.resolve(fontDict);
    if (r.kind === 'dict') fontDictResolved = cloneObject(r) as PdfDict;
    else fontDictResolved = pdfDict();
  } else if (fontDict && isDict(fontDict)) {
    fontDictResolved = fontDict;
  } else {
    fontDictResolved = pdfDict();
  }
  dictSet(resourcesDict, 'Font', fontDictResolved);

  // 4) 사용할 폰트 등록 (이미 같은 폰트가 있으면 재사용)
  let resourceName = findOrRegisterFont(doc, fontDictResolved, spec.font);

  // 5) 콘텐츠 fragment 생성
  const escaped = escapeLiteralString(spec.text);
  const safeColor = (v: number) => Math.max(0, Math.min(1, v)).toFixed(3);
  const fragment =
    `\nq\n` +
    `${safeColor(spec.color.r)} ${safeColor(spec.color.g)} ${safeColor(spec.color.b)} rg\n` +
    `BT\n` +
    `/${resourceName} ${spec.fontSize} Tf\n` +
    `1 0 0 1 ${spec.x.toFixed(3)} ${spec.y.toFixed(3)} Tm\n` +
    `(${escaped}) Tj\n` +
    `ET\n` +
    `Q\n`;
  const fragmentBytes = new TextEncoder().encode(fragment);
  // FlateDecode 압축
  const compressed = zlib.deflateSync(Buffer.from(fragmentBytes));
  const fragmentStream = pdfStream(
    pdfDict([
      ['Length', pdfInt(compressed.length)],
      ['Filter', pdfName('FlateDecode')],
    ]),
    new Uint8Array(compressed),
  );
  const fragmentRef = doc.allocateObject(fragmentStream);

  // 6) /Contents를 array로 만들고 fragment ref 추가
  const cur = dictGet(pageDict, 'Contents');
  let newContents: PdfArray;
  if (!cur) {
    newContents = pdfArray([fragmentRef]);
  } else if (isArray(cur)) {
    newContents = pdfArray([...cur.items, fragmentRef]);
  } else if (isRef(cur) || isStream(cur)) {
    newContents = pdfArray([cur, fragmentRef]);
  } else {
    newContents = pdfArray([fragmentRef]);
  }
  dictSet(pageDict, 'Contents', newContents);

  // 7) 페이지 dict 갱신
  doc.markDirty(page.ref.num, page.ref.gen, pageDict);
}

function findOrRegisterFont(
  doc: PdfDocument,
  fontDict: PdfDict,
  fontName: string,
): string {
  // 이미 같은 BaseFont로 등록된 폰트가 있는지 확인
  for (const [name, ref] of fontDict.map) {
    const f = doc.resolve(ref);
    if (f.kind !== 'dict') continue;
    const bf = dictGet(f, 'BaseFont');
    if (bf && bf.kind === 'name' && bf.value === fontName) return name;
  }
  // 새 등록
  let n = 1;
  let key = `F${n}`;
  while (fontDict.map.has(key)) {
    n += 1;
    key = `F${n}`;
  }
  const newFont = pdfDict([
    ['Type', pdfName('Font')],
    ['Subtype', pdfName('Type1')],
    ['BaseFont', pdfName(fontName)],
    ['Encoding', pdfName('WinAnsiEncoding')],
  ]);
  const ref = doc.allocateObject(newFont);
  dictSet(fontDict, key, ref);
  return key;
}

// PDF literal string 이스케이프. 비ASCII는 8진수로.
function escapeLiteralString(s: string): string {
  // WinAnsi 인코딩으로 변환 — 단순화: latin1로.
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0x28) out += '\\(';
    else if (c === 0x29) out += '\\)';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c >= 0x20 && c <= 0x7e) out += s[i];
    else if (c <= 0xff) out += '\\' + c.toString(8).padStart(3, '0');
    else {
      // 비latin1 — '?'로 대체 (코어14 폰트는 어차피 표시 못함)
      out += '?';
    }
  }
  return out;
}
