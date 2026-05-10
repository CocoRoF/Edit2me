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
import { parseContent } from '../graphics/content-stream';

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

  // 폰트 정보 — encodeText 가 지원되는 폰트만 편집 가능 (simple Latin / composite Identity-H).
  const fonts = buildFontMap(doc, page.dict);
  const font = fonts.get(target.fontName);
  if (!font) throw new EditTextError('Font not found', 'font-not-found');
  if (!font.encodeText) {
    throw new EditTextError(
      font.isComposite
        ? 'Composite font without Identity CIDToGIDMap or embedded TrueType — editing not supported'
        : 'Simple font with unsupported encoding',
      'unsupported-font',
    );
  }

  // 새 텍스트를 폰트 byte 시퀀스로 인코딩.
  // 우선 target 폰트로 시도 → missing 글리프 있으면 같은 페이지의 다른 폰트들 중에서
  // 모든 글자를 인코딩할 수 있는 폰트를 fallback 으로 사용. 사용자가 외부 폰트를 업로드
  // 하지 않아도 PDF 가 이미 가지고 있는 폰트만으로 가능한 한 많이 편집되도록.
  let enc = font.encodeText(spec.newText);
  if (!enc) {
    throw new EditTextError('Font cannot encode new text', 'unsupported-font');
  }
  let useFont = font;
  if (enc.missing.length > 0) {
    // 페이지의 다른 encodable 폰트 중 모든 글자 인코딩 가능한 것 찾기.
    let bestFont: typeof font | null = null;
    let bestEnc: typeof enc | null = null;
    for (const [name, f] of fonts) {
      if (name === target.fontName || !f.encodeText) continue;
      const e = f.encodeText(spec.newText);
      if (!e) continue;
      if (e.missing.length === 0) {
        bestFont = f;
        bestEnc = e;
        break;
      }
      // 차선: missing 가장 적은 것 (전부 인코딩 못 해도 부분 fallback 보다는 fail 이 안전).
    }
    if (bestFont && bestEnc) {
      useFont = bestFont;
      enc = bestEnc;
    } else {
      throw new EditTextError(
        `이 PDF 폰트에 없는 글자: ${enc.missing.slice(0, 5).join(', ')}` +
          `${enc.missing.length > 5 ? ` 외 ${enc.missing.length - 5}개` : ''}. ` +
          `편집 toolbar 의 💡 hint 에서 사용 가능한 글자 set 을 확인하세요.`,
        'glyph-missing',
      );
    }
  }
  const newBytes = Array.from(enc.bytes);

  // Advance 보정: 원본 op 의 advance 와 새 op advance 차이를 Td 로 보정.
  const fontSize = target.fontSize;
  // 원본 advance 는 원본 폰트로 계산. 새 advance 는 useFont 로 계산 (fallback 시 다름).
  const decodedOld = font.decodeBytes(target.rawCodeBytes);
  let oldAdvance1000 = 0;
  for (const code of decodedOld.codes) oldAdvance1000 += font.widthOf(code);
  const oldAdvance = (oldAdvance1000 / 1000) * fontSize;
  const newAdvance = (enc.advance1000 / 1000) * fontSize;
  const advanceDelta = oldAdvance - newAdvance;

  // composite 폰트는 hex string `<HHHH>`, simple 은 literal `(...)` 사용.
  const literal = useFont.isComposite
    ? `<${hexEncode(new Uint8Array(newBytes))}>`
    : `(${escapeLiteralBytes(new Uint8Array(newBytes))})`;
  // fallback 폰트면 Tf 로 폰트 전환 op 을 prefix 로 추가. Tfs 는 원본 fontSize 그대로.
  const fontPrefix =
    useFont.resourceName !== target.fontName
      ? `/${useFont.resourceName} ${formatFontSize(fontSize)} Tf `
      : '';

  // op 의 종류에 따라 교체 전략이 달라짐.
  //   - Tj / ' / " : op 전체를 새 Tj 한 줄로 교체 + advance 보정 Td.
  //   - TJ + 단일 segment : 동일하게 Tj 로 단순 교체.
  //   - TJ + 다중 segment : segment 만 교체. 그 segment 의 advance delta 를 trailing
  //     shift 항목에 흡수시켜 다음 segment 들의 위치를 *완벽히* 보존.
  const contentBytes = doc.pageContent(page.dict);
  const start = target.source.contentByteStart;
  const end = target.source.contentByteEnd;
  if (start < 0 || end > contentBytes.length || start > end) {
    throw new EditTextError('Bad block source range', 'bad-range');
  }

  // 원본 op 을 다시 파싱 — TJ segment 정보를 얻기 위해.
  const reparsed = parseContent(contentBytes);
  const targetOp = reparsed[target.source.opIndex]?.op;

  let newOpStr: string;
  if (targetOp && targetOp.op === 'TJ' && countBytesItems(targetOp.items) > 1) {
    // 다중 segment TJ. 새 array 를 빌드.
    const segIdx = target.source.tjSegmentIndex;
    let bytesIdxSeen = 0;
    const newItems: string[] = [];
    for (let i = 0; i < targetOp.items.length; i += 1) {
      const it = targetOp.items[i]!;
      if (it.kind === 'bytes') {
        if (bytesIdxSeen === segIdx) {
          newItems.push(literal);
          // advance 보정을 다음 shift (있으면) 에 흡수, 없으면 새 shift 삽입.
          // delta 단위: text-space (1/1000 em). user-space delta = advanceDelta (이미 Tfs 곱).
          // shift unit 은 1000 / Tfs * delta_user_space.
          const shiftDelta1000 = (advanceDelta * 1000) / fontSize;
          const next = targetOp.items[i + 1];
          if (next && next.kind === 'shift') {
            // shift 의 부호 의미: positive = backward (왼쪽). delta 가 양수 (old > new) 면
            // 다음 segment 가 *더 멀리* 가야 하니 shift 를 더 negative 로 (음수 더해짐) → -delta 더함.
            (next as { kind: 'shift'; v: number }).v += -shiftDelta1000;
          } else if (Math.abs(shiftDelta1000) > 0.5) {
            // 새 shift 삽입 — items 배열 직접 변경 (다음 loop 에서 emit 됨).
            targetOp.items.splice(i + 1, 0, { kind: 'shift', v: -shiftDelta1000 });
          }
        } else {
          // 기존 bytes 그대로 보존.
          if (font.isComposite) {
            newItems.push(`<${hexEncode(it.bytes)}>`);
          } else {
            newItems.push(`(${escapeLiteralBytes(it.bytes)})`);
          }
        }
        bytesIdxSeen += 1;
      } else {
        newItems.push(formatNumber(it.v));
      }
    }
    // fallback 폰트 사용 시 prefix 로 Tf 삽입. multi-segment 인 경우 segment 만 다른 폰트로
    // 그리고 다음 segment 부터는 원래 폰트로 돌아가야 정확한데, 단순화: 이번 작업에선
    // fallback 시에는 multi-segment TJ 도 단일 Tj 로 수렴 (다른 segment 는 그대로 hex 바이트로
    // 보존되지만 중간에 폰트 전환 op 가 들어가면 그 뒤 segment 는 fallback 폰트로 그려짐.
    // → multi-segment + fallback 은 일단 거부하는 게 안전).
    if (fontPrefix) {
      throw new EditTextError(
        'Font fallback in multi-segment TJ is not supported in this version. Try editing one cell at a time.',
        'unsupported-multi-segment-fallback',
      );
    }
    newOpStr = `[${newItems.join('')}] TJ`;
  } else {
    // 단일 segment 또는 Tj/'/". 전체 op 을 Tj 한 줄로 교체. fontPrefix 가 있으면 Tf prepend.
    newOpStr = `${fontPrefix}${literal} Tj`;
    if (Math.abs(advanceDelta) > 0.001) {
      // Td 보정 — 다음 op 가 Tm 으로 절대 위치 지정하면 무시됨, Td/T* 면 더해짐.
      newOpStr += ` ${advanceDelta.toFixed(3)} 0 Td`;
    }
  }
  const newOpBytes = new TextEncoder().encode(newOpStr + '\n');
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

function hexEncode(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function countBytesItems(items: Array<{ kind: 'bytes' } | { kind: 'shift' }>): number {
  let n = 0;
  for (const it of items) if (it.kind === 'bytes') n += 1;
  return n;
}

function formatFontSize(v: number): string {
  // Tf 의 size 인자 — PDF 는 정수/소수 모두 허용.
  if (Number.isInteger(v)) return String(v);
  let s = v.toFixed(4);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return ` ${v}`;
  // PDF spec § 7.3.3: number — fixed point 충분 (Td, TJ shift 모두 정수 또는 fixed).
  // 소수 4자리 + trailing zero 제거.
  let s = v.toFixed(4);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return ` ${s}`;
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
