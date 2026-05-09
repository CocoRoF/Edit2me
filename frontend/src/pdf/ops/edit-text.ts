// 기존 텍스트 편집.
//
// 정책 (v1):
// - 같은 폰트로 새 텍스트를 인코딩.
// - 단순 1바이트 폰트 (Type1/TrueType + StandardEncoding/WinAnsiEncoding)만 지원.
// - 그 외 (Type0 / CIDFont, ToUnicode 부재 등)는 거부.
// - 콘텐츠 stream 안의 *해당 op의 byte 범위*만 새 op로 교체.

import zlib from 'node:zlib';
import {
  PdfArray,
  PdfDict,
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
  pdfHexString,
  pdfInt,
  pdfLiteralString,
  pdfName,
  pdfStream,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { decodeStream } from '../core/stream';
import { extractTextFromPage } from '../graphics/text-extract';
import { buildFontMap } from '../fonts/font-info';

export interface EditTextSpec {
  pageIndex: number;
  blockId: string;
  newText: string;
}

export class EditTextError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export function editText(doc: PdfDocument, spec: EditTextSpec): void {
  const pages = doc.getPages();
  const page = pages[spec.pageIndex];
  if (!page) throw new EditTextError('Page not found', 'page-not-found');

  const result = extractTextFromPage(doc, page.dict, spec.pageIndex);
  const target = result.runs.find((r) => r.blockId === spec.blockId);
  if (!target) throw new EditTextError('Block not found', 'block-not-found');

  // 폰트 정보 — 단순 1바이트만 지원
  const fonts = buildFontMap(doc, page.dict);
  const font = fonts.get(target.fontName);
  if (!font) throw new EditTextError('Font not found', 'font-not-found');
  if (font.isComposite) {
    throw new EditTextError(
      'Composite (CID-keyed) font editing is not supported in v1',
      'unsupported-font',
    );
  }

  // 새 텍스트를 byte로 인코딩 (latin1로 단순화 — WinAnsiEncoding 근사)
  const newBytes: number[] = [];
  for (let i = 0; i < spec.newText.length; i += 1) {
    const c = spec.newText.charCodeAt(i);
    if (c <= 0xff) {
      newBytes.push(c);
    } else {
      throw new EditTextError(
        `Character '${spec.newText[i]}' (U+${c.toString(16)}) is not encodable in this font`,
        'glyph-missing',
      );
    }
  }
  const newOpBytes = new TextEncoder().encode(
    `(${escapeLiteralBytes(new Uint8Array(newBytes))}) Tj\n`,
  );

  // 콘텐츠 stream을 *디코드한 byte*에서 해당 op 위치를 찾아 교체.
  // 우리는 페이지의 모든 콘텐츠를 단일 byte로 합쳐 작업한 뒤,
  // 새 단일 stream으로 갱신.
  const contentBytes = doc.pageContent(page.dict);
  const start = target.source.contentByteStart;
  const end = target.source.contentByteEnd;
  if (start < 0 || end > contentBytes.length || start > end) {
    throw new EditTextError('Bad block source range', 'bad-range');
  }
  // 새 op는 같은 텍스트 매트릭스에서 시작해야 같은 위치에 표시됨.
  // 단순화: 기존 op (Tj/TJ/'/")가 있던 자리를 *새 Tj 한 줄*로 교체.
  // 단, 'TJ' 의 경우 advance 가 달라 다음 op들이 시각적으로 어긋날 수 있음 (감수).
  const before = contentBytes.subarray(0, start);
  const after = contentBytes.subarray(end);
  const merged = new Uint8Array(before.length + newOpBytes.length + after.length);
  merged.set(before, 0);
  merged.set(newOpBytes, before.length);
  merged.set(after, before.length + newOpBytes.length);

  // 페이지의 /Contents를 단일 새 stream으로 교체
  const compressed = zlib.deflateSync(Buffer.from(merged));
  const newStream = pdfStream(
    pdfDict([
      ['Length', pdfInt(compressed.length)],
      ['Filter', pdfName('FlateDecode')],
    ]),
    new Uint8Array(compressed),
  );
  const newRef = doc.allocateObject(newStream);

  const pageDict = cloneObject(page.dict) as PdfDict;
  dictSet(pageDict, 'Contents', newRef);
  doc.markDirty(page.ref.num, page.ref.gen, pageDict);
}

function escapeLiteralBytes(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b === 0x28) out += '\\(';
    else if (b === 0x29) out += '\\)';
    else if (b === 0x5c) out += '\\\\';
    else if (b === 0x0a) out += '\\n';
    else if (b === 0x0d) out += '\\r';
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += '\\' + b.toString(8).padStart(3, '0');
  }
  return out;
}
