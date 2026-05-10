// 페이지에 새 텍스트 추가.
//
// 두 가지 폰트 경로:
//   - Core 14 (Helvetica 등): 임베딩 없음. WinAnsi 인코딩 (ASCII 한정).
//   - 업로드된 TTF: Type0 + CIDFontType2 + Identity-H (한글/CJK 가능).

import zlib from 'node:zlib';
import {
  PdfArray,
  PdfDict,
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
  pdfDict,
  pdfInt,
  pdfName,
  pdfStream,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { ParsedTtf } from '../fonts/ttf-parser';
import { embedTtf } from '../fonts/ttf-embed';

export interface AddTextSpec {
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  /** Core 14 이름. ttf가 주어지면 무시. */
  font: string;
  fontSize: number;
  color: { r: number; g: number; b: number };
  /** 업로드된 TTF (있으면 우선) */
  ttf?: { parsed: ParsedTtf; baseName: string };
}

export function addText(doc: PdfDocument, spec: AddTextSpec): void {
  const pages = doc.getPages();
  const page = pages[spec.pageIndex];
  if (!page) throw new Error(`Page ${spec.pageIndex} not found`);

  const pageDict = cloneObject(page.dict) as PdfDict;

  // Resources / Font dict 보장 (다른 페이지와 공유 시 inline 복제)
  let resources = dictGet(pageDict, 'Resources');
  let resourcesDict: PdfDict;
  if (resources && isRef(resources)) {
    const resolved = doc.resolve(resources);
    if (resolved.kind !== 'dict') throw new Error('Resources is not a dict');
    resourcesDict = cloneObject(resolved) as PdfDict;
  } else if (resources && isDict(resources)) {
    resourcesDict = resources;
  } else {
    const inh = doc.inheritedAttr(pageDict, 'Resources');
    if (inh) {
      const r = doc.resolve(inh);
      resourcesDict = isDict(r) ? (cloneObject(r) as PdfDict) : pdfDict();
    } else resourcesDict = pdfDict();
  }
  dictSet(pageDict, 'Resources', resourcesDict);

  let fontDict = dictGet(resourcesDict, 'Font');
  let fontDictResolved: PdfDict;
  if (fontDict && isRef(fontDict)) {
    const r = doc.resolve(fontDict);
    fontDictResolved = r.kind === 'dict' ? (cloneObject(r) as PdfDict) : pdfDict();
  } else if (fontDict && isDict(fontDict)) {
    fontDictResolved = fontDict;
  } else fontDictResolved = pdfDict();
  dictSet(resourcesDict, 'Font', fontDictResolved);

  // ---- 폰트 등록 + 텍스트 인코딩 ----
  let resourceName: string;
  let textShowBytes: string; // PDF content stream에 들어갈 형식: "(escaped) Tj" 또는 "<hex> Tj"
  if (spec.ttf) {
    const embed = embedTtf(doc, spec.ttf.parsed, spec.ttf.baseName);
    resourceName = registerFontByRef(doc, fontDictResolved, embed.fontRef, spec.ttf.baseName);
    const enc = embed.encodeHex(spec.text);
    textShowBytes = `<${enc.hex}> Tj`;
  } else {
    resourceName = findOrRegisterCore14(doc, fontDictResolved, spec.font);
    const escaped = escapeLiteralString(spec.text);
    textShowBytes = `(${escaped}) Tj`;
  }

  // ---- 콘텐츠 fragment ----
  const safeColor = (v: number) => Math.max(0, Math.min(1, v)).toFixed(3);
  const fragment =
    `\nq\n` +
    `${safeColor(spec.color.r)} ${safeColor(spec.color.g)} ${safeColor(spec.color.b)} rg\n` +
    `BT\n` +
    `/${resourceName} ${spec.fontSize} Tf\n` +
    `1 0 0 1 ${spec.x.toFixed(3)} ${spec.y.toFixed(3)} Tm\n` +
    `${textShowBytes}\n` +
    `ET\n` +
    `Q\n`;
  const fragmentBytes = new TextEncoder().encode(fragment);
  const compressed = zlib.deflateSync(Buffer.from(fragmentBytes));
  const fragmentStream = pdfStream(
    pdfDict([
      ['Length', pdfInt(compressed.length)],
      ['Filter', pdfName('FlateDecode')],
    ]),
    new Uint8Array(compressed),
  );
  const fragmentRef = doc.allocateObject(fragmentStream);

  // /Contents 를 array로 만들어 fragment 추가
  const cur = dictGet(pageDict, 'Contents');
  let newContents: PdfArray;
  if (!cur) newContents = pdfArray([fragmentRef]);
  else if (isArray(cur)) newContents = pdfArray([...cur.items, fragmentRef]);
  else if (isRef(cur) || isStream(cur)) newContents = pdfArray([cur, fragmentRef]);
  else newContents = pdfArray([fragmentRef]);
  dictSet(pageDict, 'Contents', newContents);

  doc.markDirty(page.ref.num, page.ref.gen, pageDict);
}

function findOrRegisterCore14(doc: PdfDocument, fontDict: PdfDict, fontName: string): string {
  for (const [name, ref] of fontDict.map) {
    const f = doc.resolve(ref);
    if (f.kind !== 'dict') continue;
    const bf = dictGet(f, 'BaseFont');
    const sub = dictGet(f, 'Subtype');
    if (
      bf &&
      bf.kind === 'name' &&
      bf.value === fontName &&
      sub &&
      sub.kind === 'name' &&
      sub.value === 'Type1'
    )
      return name;
  }
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

function registerFontByRef(
  doc: PdfDocument,
  fontDict: PdfDict,
  ref: PdfRef,
  baseName: string,
): string {
  // 같은 ref 가 이미 있으면 재사용 — 같은 페이지에 여러 번 add-text 시 dedup
  for (const [name, existing] of fontDict.map) {
    if (
      existing.kind === 'ref' &&
      existing.num === ref.num &&
      existing.gen === ref.gen
    )
      return name;
  }
  let n = 1;
  let key = `F${n}`;
  while (fontDict.map.has(key)) {
    n += 1;
    key = `F${n}`;
  }
  void baseName;
  dictSet(fontDict, key, ref);
  return key;
}

function escapeLiteralString(s: string): string {
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
    else out += '?';
  }
  return out;
}
