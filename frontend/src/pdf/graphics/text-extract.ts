// 텍스트 추출.
//
// 콘텐츠 스트림의 ops를 그래픽 상태 머신으로 돌리며 텍스트 위치 계산.
// 결과: 페이지 좌표계 기준의 TextRun 시퀀스 + 진단.

import { PdfDict } from '../core/object';
import { PdfDocument } from '../parser/document';
import { ContentOp, ContentOpWithSource, parseContent } from './content-stream';
import { FontInfo, buildFontMap } from '../fonts/font-info';

export interface TextRun {
  blockId: string;
  text: string;
  // bbox: PDF 좌표계 (좌하 원점)
  x: number;
  y: number;
  width: number; // text space units (advance — Td 보정 단위와 동일)
  height: number;
  fontName: string;
  fontBaseName: string;
  fontSize: number;
  isComposite: boolean;
  fullyDecoded: boolean;
  /** 이 폰트로 새 텍스트를 인코딩 가능한지 (편집 가능성). encodeText 가 null 이면 false. */
  fontEncodable: boolean;
  /** 원본 byte 시퀀스 (코드들 — 1바이트 폰트면 byte 배열 그대로). edit-text 의 advance 보정에 사용. */
  rawCodeBytes: Uint8Array;
  source: {
    contentByteStart: number;
    contentByteEnd: number;
    opIndex: number;
    /** TJ array 안의 string 항목 index (Tj/'/" 는 항상 0). edit 시 segment 만 교체. */
    tjSegmentIndex: number;
  };
}

export interface TextExtractionResult {
  runs: TextRun[];
  /** 페이지에서 발견된 폰트별 진단 (편집 가능성 판단에 사용) */
  fontDiagnostics: Array<{ name: string; baseName: string; warnings: string[]; hasUnicodeMap: boolean }>;
}

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function multiply(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function translate(m: Mat, tx: number, ty: number): Mat {
  return multiply([1, 0, 0, 1, tx, ty], m);
}

interface TextState {
  Tc: number;
  Tw: number;
  Tz: number;
  Tl: number;
  Tf?: FontInfo;
  Tfs: number;
  Tr: number;
  Trise: number;
  Tm: Mat;
  Tlm: Mat;
}

interface GraphicsState {
  CTM: Mat;
  text: TextState;
}

function newTextState(): TextState {
  return {
    Tc: 0,
    Tw: 0,
    Tz: 100,
    Tl: 0,
    Tfs: 0,
    Tr: 0,
    Trise: 0,
    Tm: [...IDENTITY] as Mat,
    Tlm: [...IDENTITY] as Mat,
  };
}

export function extractTextFromPage(
  doc: PdfDocument,
  pageDict: PdfDict,
  pageIndex: number,
): TextExtractionResult {
  const fontMap = buildFontMap(doc, pageDict);
  const fontDiagnostics = [...fontMap.entries()].map(([name, f]) => ({
    name,
    baseName: f.baseName,
    warnings: f.warnings,
    hasUnicodeMap: f.hasUnicodeMap,
  }));

  const content = doc.pageContent(pageDict);
  if (content.length === 0) return { runs: [], fontDiagnostics };
  const ops = parseContent(content);

  const runs: TextRun[] = [];
  const stack: GraphicsState[] = [];
  let cur: GraphicsState = {
    CTM: [...IDENTITY] as Mat,
    text: newTextState(),
  };

  function processShow(
    opSource: ContentOpWithSource['source'],
    bytes: Uint8Array,
    tjSegmentIndex = 0,
  ): void {
    const ts = cur.text;
    const font = ts.Tf;
    if (!font || ts.Tfs === 0) return;
    const decoded = font.decodeBytes(bytes);
    let text = '';
    let fullyDecoded = true;
    let advanceWidth = 0;
    const horizontalScale = ts.Tz / 100;
    for (let i = 0; i < decoded.codes.length; i += 1) {
      const code = decoded.codes[i]!;
      const u = font.toUnicode(code);
      if (u === null) {
        fullyDecoded = false;
        // 디코드 실패는 *공란*으로 (가짜 ASCII 출력 금지 — A1 fix)
        text += ' ';
      } else {
        text += u;
      }
      const w = font.widthOf(code) / 1000;
      advanceWidth +=
        (w * ts.Tfs + ts.Tc + (decoded.lengths[i] === 1 && code === 0x20 ? ts.Tw : 0)) *
        horizontalScale;
    }
    const final: Mat = multiply(cur.text.Tm, cur.CTM);
    runs.push({
      blockId: `p${pageIndex}-op${opSource.opIndex}-${tjSegmentIndex}`,
      text,
      x: final[4]!,
      y: final[5]!,
      width: advanceWidth,
      height: ts.Tfs,
      fontName: font.resourceName,
      fontBaseName: font.baseName,
      fontSize: ts.Tfs,
      isComposite: font.isComposite,
      fullyDecoded,
      fontEncodable: !!font.encodeText,
      rawCodeBytes: new Uint8Array(bytes),
      source: {
        contentByteStart: opSource.start,
        contentByteEnd: opSource.end,
        opIndex: opSource.opIndex,
        tjSegmentIndex,
      },
    });
    // vertical writing 모드면 (0, -advance) 로 이동, horizontal 이면 (advance, 0)
    if (font.writingMode === 'vertical') {
      cur.text.Tm = translate(cur.text.Tm, 0, -advanceWidth);
    } else {
      cur.text.Tm = translate(cur.text.Tm, advanceWidth, 0);
    }
  }

  for (const { op, source } of ops) {
    switch (op.op) {
      case 'q':
        stack.push({
          CTM: [...cur.CTM] as Mat,
          text: { ...cur.text, Tm: [...cur.text.Tm] as Mat, Tlm: [...cur.text.Tlm] as Mat },
        });
        break;
      case 'Q':
        if (stack.length > 0) cur = stack.pop()!;
        break;
      case 'cm':
        cur.CTM = multiply(op.m, cur.CTM);
        break;
      case 'BT':
        cur.text.Tm = [...IDENTITY] as Mat;
        cur.text.Tlm = [...IDENTITY] as Mat;
        break;
      case 'ET':
        break;
      case 'Tf':
        cur.text.Tf = fontMap.get(op.font);
        cur.text.Tfs = op.size;
        break;
      case 'Tm':
        cur.text.Tm = [...op.m] as Mat;
        cur.text.Tlm = [...op.m] as Mat;
        break;
      case 'Td': {
        const m = multiply([1, 0, 0, 1, op.tx, op.ty], cur.text.Tlm);
        cur.text.Tm = m;
        cur.text.Tlm = m;
        break;
      }
      case 'TD': {
        cur.text.Tl = -op.ty;
        const m = multiply([1, 0, 0, 1, op.tx, op.ty], cur.text.Tlm);
        cur.text.Tm = m;
        cur.text.Tlm = m;
        break;
      }
      case 'T*': {
        const m = multiply([1, 0, 0, 1, 0, -cur.text.Tl], cur.text.Tlm);
        cur.text.Tm = m;
        cur.text.Tlm = m;
        break;
      }
      case 'TL':
        cur.text.Tl = op.leading;
        break;
      case 'Tc':
        cur.text.Tc = op.v;
        break;
      case 'Tw':
        cur.text.Tw = op.v;
        break;
      case 'Tz':
        cur.text.Tz = op.v;
        break;
      case 'Ts':
        cur.text.Trise = op.v;
        break;
      case 'Tr':
        cur.text.Tr = op.v;
        break;
      case 'Tj':
        processShow(source, op.bytes);
        break;
      case "'": {
        const m = multiply([1, 0, 0, 1, 0, -cur.text.Tl], cur.text.Tlm);
        cur.text.Tm = m;
        cur.text.Tlm = m;
        processShow(source, op.bytes);
        break;
      }
      case '"': {
        cur.text.Tw = op.aw;
        cur.text.Tc = op.ac;
        const m = multiply([1, 0, 0, 1, 0, -cur.text.Tl], cur.text.Tlm);
        cur.text.Tm = m;
        cur.text.Tlm = m;
        processShow(source, op.bytes);
        break;
      }
      case 'TJ': {
        // PDF spec § 9.4.3 순차 처리. 각 string segment 사이에 number shift 가 들어가면
        // Tm 이 그만큼 이동 → 별개 위치의 텍스트가 됨. column-jump kerning (huge negative)
        // 인 경우 각 segment 가 표의 다른 cell 일 가능성. 각 segment 를 *개별* TextRun 으로
        // emit 해 cell 단위 편집 가능하게.
        const ts = cur.text;
        const font = ts.Tf;
        if (!font || ts.Tfs === 0) break;
        let segIdx = 0;
        for (const item of op.items) {
          if (item.kind === 'bytes') {
            if (item.bytes.length > 0) processShow(source, item.bytes, segIdx);
            segIdx += 1;
          } else {
            const adv = (-item.v / 1000) * ts.Tfs * (ts.Tz / 100);
            cur.text.Tm = translate(cur.text.Tm, adv, 0);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return { runs, fontDiagnostics };
}
