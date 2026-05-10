// 인접 TextRun 들을 하나의 단위로 편집.
//
// 제약: blockIds 는 모두 같은 opIndex 의 TJ array 안의 연속 (또는 거의 연속) segment 들이어야
// 한다. 다른 op 끼리 묶이면 그 사이의 위치 ops (Tm, Td 등) 가 깨질 수 있어 거부.
//
// 동작: TJ array 에서 [firstSeg .. lastSeg] 사이의 모든 string 항목을 *하나* 의 새
// string 으로 합치고, 사이의 shift 항목은 제거 (물리적 위치를 우리 글자 advance 로
// 자연스럽게 잇게 함). 마지막 segment 의 trailing shift 가 있다면 advance delta 를
// 흡수해 다음 segment 의 위치는 보존.

import zlib from 'node:zlib';
import {
  PdfDict,
  cloneObject,
  dictSet,
  pdfDict,
  pdfInt,
  pdfName,
  pdfStream,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { extractTextFromPage } from '../graphics/text-extract';
import { buildFontMap } from '../fonts/font-info';
import { parseContent } from '../graphics/content-stream';
import { EditTextError } from './edit-text';

export interface EditTextGroupSpec {
  pageIndex: number;
  blockIds: string[];
  newText: string;
}

export function editTextGroup(doc: PdfDocument, spec: EditTextGroupSpec): void {
  if (spec.blockIds.length === 0) {
    throw new EditTextError('No blockIds', 'op-invalid');
  }
  const pages = doc.getPages();
  const page = pages[spec.pageIndex];
  if (!page) throw new EditTextError('Page not found', 'page-not-found');

  const result = extractTextFromPage(doc, page.dict, spec.pageIndex);
  const targets = spec.blockIds.map((id) => result.runs.find((r) => r.blockId === id));
  if (targets.some((t) => !t)) throw new EditTextError('Block not found', 'block-not-found');
  const runs = targets as NonNullable<(typeof targets)[number]>[];

  // 모두 같은 opIndex 인지 확인.
  const opIndex = runs[0]!.source.opIndex;
  if (!runs.every((r) => r.source.opIndex === opIndex)) {
    throw new EditTextError(
      'Group edit requires all segments in the same content op (single TJ)',
      'cross-op-group',
    );
  }
  // 폰트도 같은지 (간단화). 다른 폰트 mix 는 미지원.
  const targetFontName = runs[0]!.fontName;
  if (!runs.every((r) => r.fontName === targetFontName)) {
    throw new EditTextError(
      'Group edit requires all segments to share the same font',
      'mixed-font-group',
    );
  }

  // segment indices 정렬 (오름차순). 연속이 아니어도 받아들임 — 사이 segment 도 함께 흡수.
  const segIndices = runs.map((r) => r.source.tjSegmentIndex).sort((a, b) => a - b);
  const segMin = segIndices[0]!;
  const segMax = segIndices[segIndices.length - 1]!;

  // 폰트 인코딩
  const fonts = buildFontMap(doc, page.dict);
  const font = fonts.get(targetFontName);
  if (!font || !font.encodeText) {
    throw new EditTextError('Font does not support encoding', 'unsupported-font');
  }
  const enc = font.encodeText(spec.newText);
  if (!enc || enc.missing.length > 0) {
    throw new EditTextError(
      `Font is missing glyph(s) for: ${enc?.missing.slice(0, 5).join(', ') ?? 'unknown'}`,
      'glyph-missing',
    );
  }

  const contentBytes = doc.pageContent(page.dict);
  const reparsed = parseContent(contentBytes);
  const targetOpEntry = reparsed[opIndex];
  if (!targetOpEntry) throw new EditTextError('Op not found in content', 'op-not-found');
  const targetOp = targetOpEntry.op;

  const fontSize = runs[0]!.fontSize;
  const newLiteral = font.isComposite
    ? `<${hexEncode(enc.bytes)}>`
    : `(${escapeLiteralBytes(enc.bytes)})`;

  let newOpStr: string;
  if (targetOp.op === 'TJ') {
    // TJ array 재구성: segMin..segMax 의 모든 string + 그 사이 shift 들을 새 string 하나로
    // 대체. 그 외 segment 들은 그대로 유지.
    const newItems: string[] = [];
    let bytesIdx = 0;
    let groupConsumed = false;
    for (let i = 0; i < targetOp.items.length; i += 1) {
      const it = targetOp.items[i]!;
      if (it.kind === 'bytes') {
        const isInGroup = bytesIdx >= segMin && bytesIdx <= segMax;
        if (isInGroup) {
          if (!groupConsumed) {
            // 그룹 첫 segment 자리에 새 literal 배치, advance 보정도 여기서.
            newItems.push(newLiteral);
            // 그룹의 원래 advance (모든 segment 의 raw bytes 합) 와 새 advance 차이를
            // trailing shift 에 흡수.
            let oldAdvance1000 = 0;
            for (const r of runs) {
              const decoded = font.decodeBytes(r.rawCodeBytes);
              for (const code of decoded.codes) oldAdvance1000 += font.widthOf(code);
            }
            const advanceDelta1000 = oldAdvance1000 - enc.advance1000;
            // 그룹 *바로 다음* 위치 (segMax 다음) 의 shift 에 -delta 흡수.
            // 우리는 각 그룹 멤버의 trailing shift (있으면) 를 모두 0 으로 만들고
            // segMax 의 trailing shift 만 보정.
            // 본 loop 에선 *지나는* shift 는 그냥 skip (group 내부) 하고, group 끝나면
            // 다음 shift 는 정상 처리하되 보정 추가.
            (newItems as unknown as { advancePending?: number }).advancePending = -advanceDelta1000;
            groupConsumed = true;
          }
          // group 내부의 segment + 그 사이 shift 는 skip (이미 통합).
        } else {
          // 그룹 밖 segment — 원본 보존.
          if (font.isComposite) {
            newItems.push(`<${hexEncode(it.bytes)}>`);
          } else {
            newItems.push(`(${escapeLiteralBytes(it.bytes)})`);
          }
        }
        bytesIdx += 1;
      } else {
        // shift
        const inGroup = bytesIdx > segMin && bytesIdx <= segMax;
        // bytesIdx 는 이번 위치 *직전* 의 string 카운트. shift 가 group 내부 (segMin
        // 다음 ~ segMax 까지) 면 skip.
        if (inGroup) {
          // skip
        } else {
          // 보정 흡수 검사.
          const pending = (newItems as unknown as { advancePending?: number }).advancePending;
          if (typeof pending === 'number') {
            (newItems as unknown as { advancePending?: number }).advancePending = undefined;
            newItems.push(formatNumber(it.v + pending));
          } else {
            newItems.push(formatNumber(it.v));
          }
        }
      }
    }
    // 그룹이 TJ 끝까지 갔다면 pending 은 흘려보냄 (다음 op 에서 보정 불가).
    newOpStr = `[${newItems.join('')}] TJ`;
  } else {
    // Tj / ' / " — 그룹이 사실상 단일 segment 와 같음. 전체 op 을 새 Tj 로 교체.
    let oldAdvance1000 = 0;
    for (const r of runs) {
      const decoded = font.decodeBytes(r.rawCodeBytes);
      for (const code of decoded.codes) oldAdvance1000 += font.widthOf(code);
    }
    const advanceDelta = ((oldAdvance1000 - enc.advance1000) / 1000) * fontSize;
    newOpStr = `${newLiteral} Tj`;
    if (Math.abs(advanceDelta) > 0.001) {
      newOpStr += ` ${advanceDelta.toFixed(3)} 0 Td`;
    }
  }

  // 콘텐츠 stream 안에서 targetOp 의 byte 범위만 새 op str 로 교체.
  const newOpBytes = new TextEncoder().encode(newOpStr + '\n');
  const start = targetOpEntry.source.start;
  const end = targetOpEntry.source.end;
  const before = contentBytes.subarray(0, start);
  const after = contentBytes.subarray(end);
  const merged = new Uint8Array(before.length + newOpBytes.length + after.length);
  merged.set(before, 0);
  merged.set(newOpBytes, before.length);
  merged.set(after, before.length + newOpBytes.length);

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

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return ` ${v}`;
  let s = v.toFixed(4);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return ` ${s}`;
}
