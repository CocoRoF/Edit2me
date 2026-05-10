// PDF 페이지 → SVG 문자열.
//
// 다루는 범위:
//   - Path: m / l / c / v / y / re / h
//   - Paint: S / s / f / F / f* / B / B* / b / b* / n
//   - Clipping: W / W*
//   - Graphics state: q / Q / cm / w / J / j / M / d / gs
//   - Color: G / g / RG / rg / K / k / SC / sc / SCN / scn / CS / cs
//   - Text: BT / ET / Tf / Tm / Td / TD / T* / TL / Tj / TJ / ' / " / Tc / Tw / Tz / Ts / Tr
//     (글리프는 OS 폰트 SVG <text> 로 — outline 변환은 다음 PR)
//   - Image: Do (DCTDecode / JPX → 그대로 base64 data URL; FlateDecode + DeviceGray/RGB → PNG 인코드)
//
// 좌표: PDF user space (y-up). 외곽 group 에 (1,0,0,-1,0,H) 변환으로 SVG y-down 변환.
// 회전: 페이지 /Rotate 는 별도 outer transform 으로.

import {
  PdfDict,
  PdfStream,
  asNumber,
  dictGet,
  isArray,
  isDict,
  isName,
  isStream,
} from '../core/object';
import { PdfDocument } from '../parser/document';
import { decodeStream, getFilterChain } from '../core/stream';
import { ContentOp, parseContent } from '../graphics/content-stream';
import { buildFontMap, FontInfo } from '../fonts/font-info';
import { encodePng } from './png-encoder';

type Mat6 = [number, number, number, number, number, number];
const IDENTITY: Mat6 = [1, 0, 0, 1, 0, 0];

function mul(a: Mat6, b: Mat6): Mat6 {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
function applyMat(m: Mat6, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(4);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function colorRgb01(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  const r = (1 - Math.min(1, c * (1 - k) + k));
  const g = (1 - Math.min(1, m * (1 - k) + k));
  const bl = (1 - Math.min(1, y * (1 - k) + k));
  return [r, g, bl];
}

type ColorSpaceInfo =
  | { kind: 'Device' }
  | { kind: 'Pattern' }
  | {
      kind: 'Indexed';
      baseName: string;
      baseChannels: number;
      hival: number;
      lookup: Uint8Array;
    };

interface GfxState {
  ctm: Mat6;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  dashArray: number[];
  dashPhase: number;
  strokeColor: [number, number, number];
  fillColor: [number, number, number];
  alpha: number;
  Tc: number;
  Tw: number;
  Tz: number;
  Tl: number;
  Tfs: number;
  Tf?: FontInfo;
  Tm: Mat6;
  Tlm: Mat6;
  Trise: number;
  Tr: number; // text rendering mode
  clipId?: string;
}
function newState(): GfxState {
  return {
    ctm: [...IDENTITY] as Mat6,
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    dashArray: [],
    dashPhase: 0,
    strokeColor: [0, 0, 0],
    fillColor: [0, 0, 0],
    alpha: 1,
    Tc: 0,
    Tw: 0,
    Tz: 100,
    Tl: 0,
    Tfs: 0,
    Tm: [...IDENTITY] as Mat6,
    Tlm: [...IDENTITY] as Mat6,
    Trise: 0,
    Tr: 0,
  };
}
function cloneState(s: GfxState): GfxState {
  return {
    ...s,
    ctm: [...s.ctm] as Mat6,
    dashArray: [...s.dashArray],
    strokeColor: [...s.strokeColor] as [number, number, number],
    fillColor: [...s.fillColor] as [number, number, number],
    Tm: [...s.Tm] as Mat6,
    Tlm: [...s.Tlm] as Mat6,
  };
}

interface PathBuilder {
  segs: string[]; // 'M x y', 'L x y', 'C x1 y1 x2 y2 x3 y3', 'Z'
  curX: number;
  curY: number;
  startX: number;
  startY: number;
}
function newPath(): PathBuilder {
  return { segs: [], curX: 0, curY: 0, startX: 0, startY: 0 };
}

export interface SvgRenderResult {
  svg: string;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  diagnostics: string[];
}

export function renderPageSvg(
  doc: PdfDocument,
  pageDict: PdfDict,
  pageIndex: number,
): SvgRenderResult {
  const [llx, lly, urx, ury] = doc.pageMediaBox(pageDict);
  const W = urx - llx;
  const H = ury - lly;
  const rotate = doc.pageRotation(pageDict);

  // Page-level resources. Form XObject 재귀 시 자체 Resources 로 잠시 override.
  let currentFontMap = buildFontMap(doc, pageDict);
  let currentXobjMap = buildXObjectMap(doc, pageDict);

  const content = doc.pageContent(pageDict);
  const ops = parseContent(content);

  const out: string[] = [];
  const defs: string[] = [];
  let clipCounter = 0;
  // Symbol id 등록 — 같은 글리프(font baseName + GID) 의 outline 을 한 번만 defs 에.
  // ID: g{baseSafe}-{gid}. SVG 안에서 `<use href="#id">` 로 참조해 size 큰 폭 절약.
  const glyphSymbolIds = new Set<string>();

  let cur = newState();
  const stack: GfxState[] = [];
  let path = newPath();
  const diagnostics = new Set<string>();

  // ColorSpace 추적 — CS/cs 가 들어올 때 저장. SC/sc/SCN/scn 에서 변환에 사용.
  let strokeColorSpace: ColorSpaceInfo = { kind: 'Device' };
  let fillColorSpace: ColorSpaceInfo = { kind: 'Device' };

  function resolveColorSpace(name: string): ColorSpaceInfo {
    if (name === 'DeviceRGB' || name === 'DeviceGray' || name === 'DeviceCMYK') {
      return { kind: 'Device' };
    }
    // Page resources /ColorSpace dict 에서 찾기
    const resources = doc.pageResources(pageDict);
    const csDict = dictGet(resources, 'ColorSpace');
    const csObj = csDict ? doc.resolve(csDict) : undefined;
    if (csObj && isDict(csObj)) {
      const entry = dictGet(csObj, name);
      if (entry) {
        const arr = doc.resolve(entry);
        if (isArray(arr) && arr.items.length >= 2) {
          const head = arr.items[0];
          if (head && head.kind === 'name' && head.value === 'Indexed') {
            // [/Indexed base hival lookup]
            const base = doc.resolve(arr.items[1]!);
            const hival = asNumber(doc.resolve(arr.items[2] ?? { kind: 'null' })) ?? 0;
            const lookupObj = doc.resolve(arr.items[3] ?? { kind: 'null' });
            let lookupBytes: Uint8Array | undefined;
            if (lookupObj.kind === 'string') lookupBytes = lookupObj.bytes;
            else if (lookupObj.kind === 'stream') lookupBytes = decodeStream(lookupObj);
            const baseName = isName(base)
              ? base.value
              : isArray(base) && base.items[0] && base.items[0].kind === 'name'
                ? base.items[0].value
                : 'DeviceRGB';
            const baseChannels = baseName === 'DeviceCMYK' ? 4 : baseName === 'DeviceGray' ? 1 : 3;
            return { kind: 'Indexed', baseName, baseChannels, hival, lookup: lookupBytes ?? new Uint8Array() };
          }
          if (head && head.kind === 'name' && head.value === 'ICCBased') {
            return { kind: 'Device' }; // 단순화
          }
          if (head && head.kind === 'name' && head.value === 'Pattern') {
            return { kind: 'Pattern' };
          }
        }
      }
    }
    return { kind: 'Device' };
  }

  function colorFromValues(values: number[], cs: ColorSpaceInfo): [number, number, number] {
    if (cs.kind === 'Indexed') {
      const idx = Math.max(0, Math.min(cs.hival, Math.floor(values[0] ?? 0)));
      const off = idx * cs.baseChannels;
      if (off + cs.baseChannels - 1 < cs.lookup.length) {
        if (cs.baseChannels === 1) {
          const v = (cs.lookup[off] ?? 0) / 255;
          return [v, v, v];
        }
        if (cs.baseChannels === 3) {
          return [
            (cs.lookup[off] ?? 0) / 255,
            (cs.lookup[off + 1] ?? 0) / 255,
            (cs.lookup[off + 2] ?? 0) / 255,
          ];
        }
        if (cs.baseChannels === 4) {
          return cmykToRgb(
            (cs.lookup[off] ?? 0) / 255,
            (cs.lookup[off + 1] ?? 0) / 255,
            (cs.lookup[off + 2] ?? 0) / 255,
            (cs.lookup[off + 3] ?? 0) / 255,
          );
        }
      }
      return [0, 0, 0];
    }
    if (cs.kind === 'Pattern') {
      // Pattern fill 미지원 — fallback 회색
      return [0.5, 0.5, 0.5];
    }
    // Device
    if (values.length === 1) return [values[0]!, values[0]!, values[0]!];
    if (values.length === 3) return [values[0]!, values[1]!, values[2]!];
    if (values.length === 4) return cmykToRgb(values[0]!, values[1]!, values[2]!, values[3]!);
    return [0, 0, 0];
  }

  function pt(x: number, y: number): [number, number] {
    return applyMat(cur.ctm, x, y);
  }

  function strokeWidth(): number {
    const sx = Math.hypot(cur.ctm[0], cur.ctm[1]);
    const sy = Math.hypot(cur.ctm[2], cur.ctm[3]);
    return cur.lineWidth * (sx + sy) / 2;
  }
  function pathStrokeAttrs(): string {
    const s = cur.strokeColor;
    const w = strokeWidth();
    const cap = cur.lineCap === 1 ? 'round' : cur.lineCap === 2 ? 'square' : 'butt';
    const join = cur.lineJoin === 1 ? 'round' : cur.lineJoin === 2 ? 'bevel' : 'miter';
    let attrs = ` stroke="${colorRgb01(s[0], s[1], s[2])}" stroke-width="${fmt(Math.max(0.1, w))}" stroke-linecap="${cap}" stroke-linejoin="${join}"`;
    if (cur.miterLimit !== 10) attrs += ` stroke-miterlimit="${fmt(cur.miterLimit)}"`;
    if (cur.dashArray.length > 0) {
      attrs += ` stroke-dasharray="${cur.dashArray.map(fmt).join(',')}"`;
      if (cur.dashPhase !== 0) attrs += ` stroke-dashoffset="${fmt(cur.dashPhase)}"`;
    }
    if (cur.alpha < 1) attrs += ` stroke-opacity="${fmt(cur.alpha)}"`;
    return attrs;
  }
  function pathFillAttrs(evenOdd: boolean): string {
    const c = cur.fillColor;
    let attrs = ` fill="${colorRgb01(c[0], c[1], c[2])}"`;
    if (evenOdd) attrs += ` fill-rule="evenodd"`;
    if (cur.alpha < 1) attrs += ` fill-opacity="${fmt(cur.alpha)}"`;
    return attrs;
  }
  function clipAttr(): string {
    return cur.clipId ? ` clip-path="url(#${cur.clipId})"` : '';
  }

  function emitPath(stroke: boolean, fill: boolean, evenOdd = false): void {
    if (path.segs.length === 0) {
      path = newPath();
      return;
    }
    let attrs = `d="${path.segs.join(' ')}"`;
    attrs += clipAttr();
    if (fill) attrs += pathFillAttrs(evenOdd);
    else attrs += ' fill="none"';
    if (stroke) attrs += pathStrokeAttrs();
    out.push(`<path ${attrs}/>`);
    path = newPath();
  }

  function registerClipFromPath(evenOdd: boolean): string {
    const id = `c${pageIndex}-${clipCounter++}`;
    // clip-rule 은 path 자식 element 에 — 일부 브라우저는 clipPath 부모 attr 를 무시.
    const rule = evenOdd ? ' clip-rule="evenodd"' : '';
    defs.push(`<clipPath id="${id}"><path d="${path.segs.join(' ')}"${rule}/></clipPath>`);
    return id;
  }

  // Path 빌더 — 좌표 변환 적용
  function moveTo(x: number, y: number): void {
    const [px, py] = pt(x, y);
    path.segs.push(`M${fmt(px)} ${fmt(py)}`);
    path.curX = x; path.curY = y; path.startX = x; path.startY = y;
  }
  function lineTo(x: number, y: number): void {
    const [px, py] = pt(x, y);
    path.segs.push(`L${fmt(px)} ${fmt(py)}`);
    path.curX = x; path.curY = y;
  }
  function curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    const [p1x, p1y] = pt(x1, y1);
    const [p2x, p2y] = pt(x2, y2);
    const [p3x, p3y] = pt(x3, y3);
    path.segs.push(`C${fmt(p1x)} ${fmt(p1y)} ${fmt(p2x)} ${fmt(p2y)} ${fmt(p3x)} ${fmt(p3y)}`);
    path.curX = x3; path.curY = y3;
  }
  function closePath(): void {
    path.segs.push('Z');
    path.curX = path.startX; path.curY = path.startY;
  }
  function rect(x: number, y: number, w: number, h: number): void {
    moveTo(x, y);
    lineTo(x + w, y);
    lineTo(x + w, y + h);
    lineTo(x, y + h);
    closePath();
  }

  function processShow(bytes: Uint8Array): void {
    const ts = cur;
    const font = ts.Tf;
    if (!font || ts.Tfs === 0) return;
    const decoded = font.decodeBytes(bytes);
    const horizScale = ts.Tz / 100;
    if (ts.Tr === 3) {
      let adv = 0;
      for (let i = 0; i < decoded.codes.length; i += 1) {
        const code = decoded.codes[i]!;
        const w = font.widthOf(code) / 1000;
        adv +=
          (w * ts.Tfs + ts.Tc + (decoded.lengths[i] === 1 && code === 0x20 ? ts.Tw : 0)) *
          horizScale;
      }
      cur.Tm = mul([1, 0, 0, 1, adv, 0] as Mat6, cur.Tm);
      return;
    }
    const fillC = cur.fillColor;
    const fill = colorRgb01(fillC[0], fillC[1], fillC[2]);
    const fontFamily = fontFamilyFor(font.baseName, font.isComposite);
    const useOutline = !!font.glyphOutline;
    const upe = font.unitsPerEm || 1000;

    let glyphTm: Mat6 = [...ts.Tm] as Mat6;
    let textBuf = '';
    let textTransform = '';
    function flushTextRun(): void {
      if (textBuf === '') return;
      out.push(
        `<text${clipAttr()} transform="${textTransform}" style='font-family:${fontFamily};font-size:1px;fill:${fill}' xml:space="preserve">${escapeXml(textBuf)}</text>`,
      );
      textBuf = '';
    }

    for (let i = 0; i < decoded.codes.length; i += 1) {
      const code = decoded.codes[i]!;
      const w = font.widthOf(code) / 1000;
      const advanceX =
        (w * ts.Tfs + ts.Tc + (decoded.lengths[i] === 1 && code === 0x20 ? ts.Tw : 0)) *
        horizScale;

      if (useOutline) {
        const path = font.glyphOutline!(code);
        if (path) {
          // Symbol id — font baseName + code.
          const safeBase = font.baseName.replace(/[^A-Za-z0-9]/g, '_');
          const symId = `g_${safeBase}_${code}`;
          if (!glyphSymbolIds.has(symId)) {
            glyphSymbolIds.add(symId);
            // <symbol> 안의 path 는 자체 좌표계 (font unit). transform 으로 호출자가 위치/스케일.
            defs.push(`<symbol id="${symId}" overflow="visible"><path d="${path}"/></symbol>`);
          }
          const textM: Mat6 = [
            (ts.Tfs * horizScale) / upe,
            0,
            0,
            ts.Tfs / upe,
            0,
            ts.Trise,
          ];
          const wm = mul(textM, glyphTm);
          const final = mul(wm, ts.ctm);
          const transform = `matrix(${fmt(final[0])},${fmt(final[1])},${fmt(-final[2])},${fmt(-final[3])},${fmt(final[4])},${fmt(final[5])})`;
          out.push(
            `<use${clipAttr()} href="#${symId}" transform="${transform}" fill="${fill}"${cur.alpha < 1 ? ` fill-opacity="${fmt(cur.alpha)}"` : ''}/>`,
          );
        } else {
          const u = font.toUnicode(code) ?? ' ';
          const textM: Mat6 = [ts.Tfs * horizScale, 0, 0, ts.Tfs, 0, ts.Trise];
          const wm = mul(textM, glyphTm);
          const final = mul(wm, ts.ctm);
          const transform = `matrix(${fmt(final[0])},${fmt(final[1])},${fmt(-final[2])},${fmt(-final[3])},${fmt(final[4])},${fmt(final[5])})`;
          out.push(
            `<text${clipAttr()} transform="${transform}" style='font-family:${fontFamily};font-size:1px;fill:${fill}' xml:space="preserve">${escapeXml(u)}</text>`,
          );
        }
      } else {
        const u = font.toUnicode(code) ?? ' ';
        if (textBuf === '') {
          const textM: Mat6 = [ts.Tfs * horizScale, 0, 0, ts.Tfs, 0, ts.Trise];
          const wm = mul(textM, glyphTm);
          const final = mul(wm, ts.ctm);
          textTransform = `matrix(${fmt(final[0])},${fmt(final[1])},${fmt(-final[2])},${fmt(-final[3])},${fmt(final[4])},${fmt(final[5])})`;
        }
        textBuf += u;
      }
      glyphTm = mul([1, 0, 0, 1, advanceX, 0] as Mat6, glyphTm);
    }
    flushTextRun();
    cur.Tm = glyphTm;
  }

  // Form XObject 재귀: 자체 ops 시퀀스를 같은 출력 버퍼에 작성. Page resources 위에 form
  // resources 가 *겹쳐* 들어옴. /Matrix 와 /BBox 적용. 깊이 한도 6.
  function drawFormXObject(stream: PdfStream, dict: PdfDict, name: string, depth = 0): void {
    if (depth > 6) {
      diagnostics.add(`form-too-deep:${name}`);
      return;
    }
    const formOps = parseContent(decodeStream(stream));
    // Save state + maps
    const savedState = cloneState(cur);
    const savedFontMap = currentFontMap;
    const savedXobjMap = currentXobjMap;
    // Form resources
    const resObj = dictGet(dict, 'Resources');
    const res = resObj ? doc.resolve(resObj) : undefined;
    if (res && isDict(res)) {
      // 자식 폰트/XObject 로 override (page resources 위에 덮음)
      const formFontDict = dictGet(res, 'Font');
      if (formFontDict) {
        const fd = doc.resolve(formFontDict);
        if (isDict(fd)) {
          const childMap = new Map(currentFontMap);
          for (const [n, ref] of fd.map) {
            const f = doc.resolve(ref);
            if (f.kind === 'dict') {
              try {
                const { buildFontInfo } = require('../fonts/font-info') as typeof import('../fonts/font-info');
                childMap.set(n, buildFontInfo(doc, n, f));
              } catch {
                /* skip */
              }
            }
          }
          currentFontMap = childMap;
        }
      }
      const formXObjs = dictGet(res, 'XObject');
      if (formXObjs) {
        const xs = doc.resolve(formXObjs);
        if (isDict(xs)) {
          const childMap = new Map<string, { stream: PdfStream; dict: PdfDict }>();
          // page-level XObject도 fallback으로 유지
          // (currentXobjMap 의 항목은 .get 으로 lookup 가능 — Map 으로 복사)
          for (const [n, ref] of xs.map) {
            const o = doc.resolve(ref);
            if (isStream(o)) childMap.set(n, { stream: o, dict: o.dict });
          }
          currentXobjMap = {
            get: (n: string) => childMap.get(n) ?? savedXobjMap.get(n),
          };
        }
      }
    }
    // /Matrix
    const matObj = dictGet(dict, 'Matrix');
    if (matObj) {
      const m = doc.resolve(matObj);
      if (isArray(m) && m.items.length === 6) {
        const formMatrix: Mat6 = [
          asNumber(m.items[0]) ?? 1,
          asNumber(m.items[1]) ?? 0,
          asNumber(m.items[2]) ?? 0,
          asNumber(m.items[3]) ?? 1,
          asNumber(m.items[4]) ?? 0,
          asNumber(m.items[5]) ?? 0,
        ];
        cur.ctm = mul(formMatrix, cur.ctm);
      }
    }
    // /BBox 는 clipping 적용 가능하지만 단순화 — skip
    // Reset path & text state for form (PDF spec: form 안의 path/text state 는 외부와 격리)
    path = newPath();
    cur.Tm = [...IDENTITY] as Mat6;
    cur.Tlm = [...IDENTITY] as Mat6;

    // Recursive op loop. 본 함수는 outer for loop 안에서 호출되므로
    // 내부적으로 ops 를 직접 처리할 별도 helper 필요.
    runOpsScope(formOps, depth + 1);

    // Restore
    cur = savedState;
    currentFontMap = savedFontMap;
    currentXobjMap = savedXobjMap;
  }

  function drawImageOrFormXObject(name: string, depth: number): void {
    const x = currentXobjMap.get(name);
    if (!x) {
      diagnostics.add(`xobject-missing:${name}`);
      return;
    }
    const subtype = dictGet(x.dict, 'Subtype');
    if (isName(subtype) && subtype.value === 'Form') {
      drawFormXObject(x.stream, x.dict, name, depth + 1);
      return;
    }
    drawImageXObject(name, x);
  }

  function drawImageXObject(name: string, x: { stream: PdfStream; dict: PdfDict }): void {
    const subtype = dictGet(x.dict, 'Subtype');
    if (!isName(subtype) || subtype.value !== 'Image') {
      diagnostics.add(`xobject-other:${name}:${isName(subtype) ? subtype.value : '?'}`);
      return;
    }
    const w = asNumber(dictGet(x.dict, 'Width')) ?? 0;
    const h = asNumber(dictGet(x.dict, 'Height')) ?? 0;
    if (w === 0 || h === 0) return;

    // CTM 으로 단위 사각형 (0,0)-(1,1) 매핑 — PDF Image XObject 관습
    const M = cur.ctm;
    const mat = `matrix(${fmt(M[0] / w)},${fmt(M[1] / w)},${fmt(M[2] / h)},${fmt(M[3] / h)},${fmt(M[4])},${fmt(M[5])})`;

    // Filter 분석: DCTDecode (JPEG) → 그대로 data URL. 그 외는 raw → PNG.
    const filters = getFilterChain(x.stream);
    const lastFilter = filters[filters.length - 1]?.name;
    let dataUrl: string | undefined;
    if (lastFilter === 'DCTDecode' || lastFilter === 'DCT') {
      const b64 = base64Encode(x.stream.raw);
      dataUrl = `data:image/jpeg;base64,${b64}`;
    } else if (lastFilter === 'JPXDecode' || lastFilter === 'JPX') {
      const b64 = base64Encode(x.stream.raw);
      dataUrl = `data:image/jp2;base64,${b64}`;
    } else {
      // raw decoded pixel data → PNG
      try {
        const decoded = decodeStream(x.stream);
        const bpc = asNumber(dictGet(x.dict, 'BitsPerComponent')) ?? 8;
        const csObj = dictGet(x.dict, 'ColorSpace');
        let channels = 1;
        if (csObj && isName(csObj)) {
          const cs = csObj.value;
          if (cs === 'DeviceRGB') channels = 3;
          else if (cs === 'DeviceGray') channels = 1;
          else if (cs === 'DeviceCMYK') channels = 4;
        } else if (csObj && isArray(csObj)) {
          const head = csObj.items[0];
          if (head && head.kind === 'name') {
            if (head.value === 'ICCBased') {
              const params = csObj.items[1];
              if (params && params.kind === 'ref') {
                const r = doc.resolve(params);
                if (isStream(r)) {
                  const n = asNumber(dictGet(r.dict, 'N')) ?? 0;
                  channels = n;
                }
              }
            } else if (head.value === 'Indexed') {
              channels = 1;
            }
          }
        }
        // Indexed 는 추가 작업 필요 — 일단 회색 박스
        if (bpc === 8 && (channels === 1 || channels === 3 || channels === 4)) {
          const png = encodePng(decoded, w, h, channels === 1 ? 'gray' : channels === 3 ? 'rgb' : 'cmyk-as-rgb');
          dataUrl = `data:image/png;base64,${base64Encode(png)}`;
        }
      } catch (e) {
        diagnostics.add(`image-decode-failed:${name}`);
      }
    }

    if (dataUrl) {
      // outer flip 안에서 image 가 위아래 뒤집히지 않게 자체 flip.
      // PDF Image 는 좌상단이 (0, 1) — 그래서 unit square 매핑 후에 추가 flip 필요.
      // mat 안에 이미 (M[2]/h) 가 들어 있고 outer flip(0,0,0,-1) 과 합쳐지는데, image origin 보정을 위해
      // 자기 좌표계에서 (1, 0, 0, -1, 0, 1) 로 한번 더 flip.
      const finalMat = `matrix(${fmt(M[0] / w)},${fmt(M[1] / w)},${fmt(-M[2] / h)},${fmt(-M[3] / h)},${fmt(M[4] + M[2])},${fmt(M[5] + M[3])})`;
      out.push(
        `<image${clipAttr()} transform="${finalMat}" width="${w}" height="${h}" preserveAspectRatio="none" href="${dataUrl}"/>`,
      );
    } else {
      // Fallback: 회색 박스
      out.push(
        `<rect${clipAttr()} transform="${mat}" x="0" y="0" width="${w}" height="${h}" fill="#e5e7eb" stroke="#9ca3af" stroke-width="0.5"/>`,
      );
    }
  }

  // ---- Op dispatch (재귀 가능) ----
  function runOpsScope(opList: typeof ops, depth: number): void {
    for (const { op } of opList) {
      try {
        runOneOp(op, depth);
      } catch (e) {
        const msg = `op-failed:${op.op}:${(e as Error).message.slice(0, 80)}`;
        diagnostics.add(msg);
        process.stderr.write(`[edit2me] page ${pageIndex} op ${op.op}: ${(e as Error).stack ?? e}\n`);
      }
    }
  }

  function runOneOp(op: ContentOp, depth: number): void {
    switch (op.op) {
      case 'q':
        stack.push(cloneState(cur));
        break;
      case 'Q':
        if (stack.length > 0) cur = stack.pop()!;
        break;
      case 'cm':
        cur.ctm = mul(op.m as Mat6, cur.ctm);
        break;
      case 'w':
        cur.lineWidth = op.v;
        break;
      case 'J':
        cur.lineCap = op.v;
        break;
      case 'j':
        cur.lineJoin = op.v;
        break;
      case 'M':
        cur.miterLimit = op.v;
        break;
      case 'd':
        cur.dashArray = op.dashArray;
        cur.dashPhase = op.phase;
        break;
      case 'gs': {
        // ExtGState — alpha, line width 등
        const resources = doc.pageResources(pageDict);
        const extObj = dictGet(resources, 'ExtGState');
        const ext = extObj ? doc.resolve(extObj) : undefined;
        if (ext && isDict(ext)) {
          const gsRef = dictGet(ext, op.name);
          if (gsRef) {
            const gs = doc.resolve(gsRef);
            if (isDict(gs)) {
              const ca = asNumber(dictGet(gs, 'ca'));
              const CA = asNumber(dictGet(gs, 'CA'));
              if (ca !== undefined) cur.alpha = ca;
              else if (CA !== undefined) cur.alpha = CA;
              const lw = asNumber(dictGet(gs, 'LW'));
              if (lw !== undefined) cur.lineWidth = lw;
            }
          }
        }
        break;
      }
      // Path
      case 'm':
        moveTo(op.x, op.y);
        break;
      case 'l':
        lineTo(op.x, op.y);
        break;
      case 'c':
        curveTo(op.x1, op.y1, op.x2, op.y2, op.x3, op.y3);
        break;
      case 'v':
        // current pt as ctrl1
        curveTo(path.curX, path.curY, op.x2, op.y2, op.x3, op.y3);
        break;
      case 'y':
        // x3,y3 as ctrl2
        curveTo(op.x1, op.y1, op.x3, op.y3, op.x3, op.y3);
        break;
      case 'h':
        closePath();
        break;
      case 're':
        rect(op.x, op.y, op.w, op.h);
        break;
      // Paint
      case 'S':
        emitPath(true, false);
        break;
      case 's':
        closePath();
        emitPath(true, false);
        break;
      case 'f':
      case 'F':
        emitPath(false, true, false);
        break;
      case 'f*':
        emitPath(false, true, true);
        break;
      case 'B':
        emitPath(true, true, false);
        break;
      case 'B*':
        emitPath(true, true, true);
        break;
      case 'b':
        closePath();
        emitPath(true, true, false);
        break;
      case 'b*':
        closePath();
        emitPath(true, true, true);
        break;
      case 'n':
        path = newPath();
        break;
      // Clip
      case 'W':
        cur.clipId = registerClipFromPath(false);
        break;
      case 'W*':
        cur.clipId = registerClipFromPath(true);
        break;
      // Color
      case 'G':
        cur.strokeColor = [op.v, op.v, op.v];
        break;
      case 'g':
        cur.fillColor = [op.v, op.v, op.v];
        break;
      case 'RG':
        cur.strokeColor = [op.r, op.g, op.b];
        break;
      case 'rg':
        cur.fillColor = [op.r, op.g, op.b];
        break;
      case 'K':
        cur.strokeColor = cmykToRgb(op.c, op.m, op.y, op.k);
        break;
      case 'k':
        cur.fillColor = cmykToRgb(op.c, op.m, op.y, op.k);
        break;
      case 'SC':
      case 'SCN':
        cur.strokeColor = colorFromValues(op.values, strokeColorSpace);
        break;
      case 'sc':
      case 'scn':
        cur.fillColor = colorFromValues(op.values, fillColorSpace);
        break;
      case 'CS':
        strokeColorSpace = resolveColorSpace(op.name);
        break;
      case 'cs':
        fillColorSpace = resolveColorSpace(op.name);
        break;
      case 'ri':
      case 'i':
        break;
      // Text
      case 'BT':
        cur.Tm = [...IDENTITY] as Mat6;
        cur.Tlm = [...IDENTITY] as Mat6;
        break;
      case 'ET':
        break;
      case 'Tf':
        cur.Tf = currentFontMap.get(op.font);
        cur.Tfs = op.size;
        break;
      case 'Tm':
        cur.Tm = [...op.m] as Mat6;
        cur.Tlm = [...op.m] as Mat6;
        break;
      case 'Td': {
        const m = mul([1, 0, 0, 1, op.tx, op.ty], cur.Tlm);
        cur.Tm = m;
        cur.Tlm = m;
        break;
      }
      case 'TD': {
        cur.Tl = -op.ty;
        const m = mul([1, 0, 0, 1, op.tx, op.ty], cur.Tlm);
        cur.Tm = m;
        cur.Tlm = m;
        break;
      }
      case 'T*': {
        const m = mul([1, 0, 0, 1, 0, -cur.Tl], cur.Tlm);
        cur.Tm = m;
        cur.Tlm = m;
        break;
      }
      case 'TL':
        cur.Tl = op.leading;
        break;
      case 'Tc':
        cur.Tc = op.v;
        break;
      case 'Tw':
        cur.Tw = op.v;
        break;
      case 'Tz':
        cur.Tz = op.v;
        break;
      case 'Ts':
        cur.Trise = op.v;
        break;
      case 'Tr':
        cur.Tr = op.v;
        break;
      case 'Tj':
        processShow(op.bytes);
        break;
      case "'": {
        const m = mul([1, 0, 0, 1, 0, -cur.Tl], cur.Tlm);
        cur.Tm = m;
        cur.Tlm = m;
        processShow(op.bytes);
        break;
      }
      case '"': {
        cur.Tw = op.aw;
        cur.Tc = op.ac;
        const m = mul([1, 0, 0, 1, 0, -cur.Tl], cur.Tlm);
        cur.Tm = m;
        cur.Tlm = m;
        processShow(op.bytes);
        break;
      }
      case 'TJ': {
        const ts = cur;
        const font = ts.Tf;
        if (!font || ts.Tfs === 0) break;
        const allBytes: number[] = [];
        for (const item of op.items) {
          if (item.kind === 'bytes') for (const b of item.bytes) allBytes.push(b);
        }
        if (allBytes.length > 0) processShow(new Uint8Array(allBytes));
        for (const item of op.items) {
          if (item.kind === 'shift') {
            const adv = (-item.v / 1000) * ts.Tfs * (ts.Tz / 100);
            cur.Tm = mul([1, 0, 0, 1, adv, 0] as Mat6, cur.Tm);
          }
        }
        break;
      }
      // XObject
      case 'Do':
        drawImageOrFormXObject(op.name, depth);
        break;
      case 'sh':
      case 'MP':
      case 'DP':
      case 'BMC':
      case 'BDC':
      case 'EMC':
      case 'BI':
      case 'ID':
      case 'EI':
        break;
      case '_unknown':
        diagnostics.add(`unknown:${op.raw}`);
        break;
      default:
        break;
    }
  }

  // 실제 실행
  runOpsScope(ops, 0);

  const contentSvg = out.join('\n');
  // ⚠ defs (clipPath, symbol) 를 outer flip group *안* 에 둬야 user space 가 일관.
  // 바깥 (svg root) 에 두면 clipPath path 좌표가 PDF y-up 으로 emit 됐는데 평가 시
  // SVG y-down 으로 해석되어 *상하 반전* + clip 영역이 잘못된 위치 → 페이지 콘텐츠
  // 가 *얇은 라인* (예: 1pt clip path) 안에서만 보이는 증상.
  const defsSvg = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';
  // Outer flip: PDF y-up → SVG y-down. defs 도 같은 group 안.
  const flipped = `<g transform="matrix(1,0,0,-1,${fmt(-llx)},${fmt(ury)})">${defsSvg}${contentSvg}</g>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(W)} ${fmt(H)}" width="100%" height="100%" preserveAspectRatio="xMinYMin meet">` +
    `<rect width="100%" height="100%" fill="white"/>` +
    flipped +
    `</svg>`;

  return { svg, width: W, height: H, rotate, diagnostics: [...diagnostics] };
}

function fontFamilyFor(baseName: string, isComposite: boolean): string {
  const lower = baseName.toLowerCase();
  if (lower.includes('helvetica') || lower.includes('arial'))
    return 'system-ui, -apple-system, "Helvetica Neue", sans-serif';
  if (lower.includes('times')) return '"Times New Roman", Times, serif';
  if (lower.includes('courier')) return '"Courier New", Courier, monospace';
  if (
    isComposite ||
    /malgun|nanum|gothic|myungjo|batang|hwp|dotum|gulim/.test(lower)
  ) {
    return '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
  }
  return 'system-ui, sans-serif';
}

interface XObjMap {
  get: (name: string) => { stream: PdfStream; dict: PdfDict } | undefined;
}
function buildXObjectMap(doc: PdfDocument, page: PdfDict): XObjMap {
  const resources = doc.pageResources(page);
  const xobjObj = dictGet(resources, 'XObject');
  const xobjs = xobjObj ? doc.resolve(xobjObj) : undefined;
  const map = new Map<string, { stream: PdfStream; dict: PdfDict }>();
  if (xobjs && isDict(xobjs)) {
    for (const [name, ref] of xobjs.map) {
      const obj = doc.resolve(ref);
      if (isStream(obj)) map.set(name, { stream: obj, dict: obj.dict });
    }
  }
  return { get: (n) => map.get(n) };
}

// ---- Base64 (Node Buffer 사용 — node:fs 등과 동일 정신, PDF 라이브러리 아님) ----

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
