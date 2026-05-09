// 텍스트 추출.
//
// 콘텐츠 스트림의 ops를 그래픽 상태 머신으로 돌리며 텍스트 위치를 계산.
// 결과: 페이지 좌표계 기준의 TextRun 시퀀스.

import { PdfDict } from '../core/object';
import { PdfDocument } from '../parser/document';
import { ContentOp, ContentOpWithSource, parseContent } from './content-stream';
import { FontInfo, buildFontMap } from '../fonts/font-info';

export interface TextRun {
  blockId: string; // 안정적 ID (`page${i}-op${idx}`)
  text: string;
  // bbox: PDF 좌표계 (좌하 원점)
  x: number;
  y: number;
  width: number;
  height: number; // 폰트 크기 기준
  fontName: string; // resource name (예: 'F1')
  fontBaseName: string; // BaseFont (예: 'Helvetica')
  fontSize: number;
  isCJK: boolean;
  // 편집 가능성 — 모든 글리프에 unicode 매핑 가능했는가
  fullyDecoded: boolean;
  // 원본 byte 위치 (편집 시 활용)
  source: { contentByteStart: number; contentByteEnd: number; opIndex: number };
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
  Tlm: Mat; // line matrix
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
): TextRun[] {
  const fontMap = buildFontMap(doc, pageDict);
  const content = doc.pageContent(pageDict);
  if (content.length === 0) return [];
  const ops = parseContent(content);

  const out: TextRun[] = [];
  const stack: GraphicsState[] = [];
  let cur: GraphicsState = {
    CTM: [...IDENTITY] as Mat,
    text: newTextState(),
  };

  function processShow(opSource: ContentOpWithSource['source'], bytes: Uint8Array): void {
    const ts = cur.text;
    const font = ts.Tf;
    if (!font || ts.Tfs === 0) return;
    const decoded = font.decodeBytes(bytes);
    let text = '';
    let fullyDecoded = true;
    let advanceWidth = 0;
    for (let i = 0; i < decoded.codes.length; i += 1) {
      const code = decoded.codes[i]!;
      const u = font.toUnicode(code);
      if (u === undefined) {
        fullyDecoded = false;
        text += '�';
      } else {
        text += u;
      }
      const w = font.widthOf(code) / 1000; // em units
      advanceWidth += w * ts.Tfs + ts.Tc + (code === 0x20 ? ts.Tw : 0);
    }
    // 텍스트 매트릭스 × CTM 으로 시작점 계산
    const final: Mat = multiply(cur.text.Tm, cur.CTM);
    const x = final[4]!;
    const y = final[5]!;
    // height: 폰트 크기 그대로 사용
    const fs = ts.Tfs;
    out.push({
      blockId: `p${pageIndex}-op${opSource.opIndex}`,
      text,
      x,
      y,
      width: advanceWidth,
      height: fs,
      fontName: font.resourceName,
      fontBaseName: font.baseName,
      fontSize: fs,
      isCJK: font.isCJK,
      fullyDecoded,
      source: {
        contentByteStart: opSource.start,
        contentByteEnd: opSource.end,
        opIndex: opSource.opIndex,
      },
    });
    // text matrix 갱신: tx → Tx + advanceWidth (in *unscaled text space*) — 단순화하여 final.x 기반.
    // 실제 PDF의 정확한 갱신은 horiz scaling 등이 들어가지만 우리는 다음 위치만 잡으면 됨.
    cur.text.Tm = translate(cur.text.Tm, advanceWidth, 0);
  }

  for (const { op, source } of ops) {
    switch (op.op) {
      case 'q':
        stack.push({ CTM: [...cur.CTM] as Mat, text: { ...cur.text, Tm: [...cur.text.Tm] as Mat, Tlm: [...cur.text.Tlm] as Mat } });
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
        // newline + show
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
        // 각 string을 보여주고, shift 만큼 advance.
        const ts = cur.text;
        const font = ts.Tf;
        if (!font || ts.Tfs === 0) break;
        // 합쳐서 하나의 run으로 (단순화). 정확한 자간은 손실되지만 위치/텍스트는 유지.
        const allBytes: number[] = [];
        for (const item of op.items) {
          if (item.kind === 'bytes') for (const b of item.bytes) allBytes.push(b);
          // shift는 advance에만 영향 — 텍스트에는 무시
        }
        if (allBytes.length > 0) processShow(source, new Uint8Array(allBytes));
        // 추가로 shift도 advance에 반영
        for (const item of op.items) {
          if (item.kind === 'shift') {
            const adv = (-item.v / 1000) * ts.Tfs;
            cur.text.Tm = translate(cur.text.Tm, adv, 0);
          }
        }
        break;
      }
      default:
        // 그래픽 색 등 — 무시
        break;
    }
  }

  return out;
}
