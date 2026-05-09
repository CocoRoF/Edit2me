// 코어 14 폰트의 메트릭 (단순화)
//
// PDF 1.7 명세 부속서 D에 widths 표가 있다.
// 우리는 *추출 용도의 단순한 width* 만 가진다 (편집/추가 시 정확한 위치 계산용).
// 진짜 정확한 글리프 박스는 Phase 4에서 보강.
//
// 단위: 1/1000 em (font size 1pt 기준 advance × 1000).

export interface CoreFontMetrics {
  name: string;
  // 코드포인트별 advance width (없으면 fallback 500)
  widths: Map<number, number>;
  defaultWidth: number;
  family: 'helvetica' | 'times' | 'courier' | 'symbol';
  bold: boolean;
  italic: boolean;
  ascent: number;
  descent: number;
}

// 단순화된 ASCII 영역 width 테이블 — Adobe AFM의 평균값 근사.
// 실제 production에서는 AFM 파일 그대로 임베드해야 하나, 우리 렌더는
// 위치 ±2pt 허용이라 이 정도로 사용 가능.

function helveticaWidths(): Map<number, number> {
  // Helvetica 표준 — proportional
  const common: Record<string, number> = {
    ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667,
    "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333,
    '.': 278, '/': 278, '0': 556, '1': 556, '2': 556, '3': 556, '4': 556,
    '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, ':': 278, ';': 278,
    '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
    J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
    S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
    j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
    s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    '{': 334, '|': 260, '}': 334, '~': 584,
  };
  const m = new Map<number, number>();
  for (const [k, v] of Object.entries(common)) m.set(k.charCodeAt(0), v);
  return m;
}

function timesWidths(): Map<number, number> {
  const common: Record<string, number> = {
    ' ': 250, '!': 333, '"': 408, '#': 500, $: 500, '%': 833, '&': 778,
    "'": 180, '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333,
    '.': 250, '/': 278, '0': 500, '1': 500, '2': 500, '3': 500, '4': 500,
    '5': 500, '6': 500, '7': 500, '8': 500, '9': 500, ':': 278, ';': 278,
    '<': 564, '=': 564, '>': 564, '?': 444, '@': 921,
    A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333,
    J: 389, K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667,
    S: 556, T: 611, U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
    '[': 333, '\\': 278, ']': 333, '^': 469, _: 500, '`': 333,
    a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278,
    j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333,
    s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
    '{': 480, '|': 200, '}': 480, '~': 541,
  };
  const m = new Map<number, number>();
  for (const [k, v] of Object.entries(common)) m.set(k.charCodeAt(0), v);
  return m;
}

function courierWidths(): Map<number, number> {
  // Courier — monospace. 모든 글자 600.
  const m = new Map<number, number>();
  for (let c = 0x20; c <= 0x7e; c += 1) m.set(c, 600);
  return m;
}

export const CORE_14: Record<string, CoreFontMetrics> = (() => {
  const out: Record<string, CoreFontMetrics> = {};
  const helvW = helveticaWidths();
  const timesW = timesWidths();
  const courW = courierWidths();
  const make = (name: string, w: Map<number, number>, family: CoreFontMetrics['family'], b: boolean, i: boolean): CoreFontMetrics => ({
    name, widths: w, defaultWidth: family === 'courier' ? 600 : 500, family, bold: b, italic: i,
    ascent: family === 'courier' ? 629 : family === 'times' ? 683 : 718,
    descent: family === 'courier' ? -157 : family === 'times' ? -217 : -207,
  });
  out['Helvetica'] = make('Helvetica', helvW, 'helvetica', false, false);
  out['Helvetica-Bold'] = make('Helvetica-Bold', helvW, 'helvetica', true, false);
  out['Helvetica-Oblique'] = make('Helvetica-Oblique', helvW, 'helvetica', false, true);
  out['Helvetica-BoldOblique'] = make('Helvetica-BoldOblique', helvW, 'helvetica', true, true);
  out['Times-Roman'] = make('Times-Roman', timesW, 'times', false, false);
  out['Times-Bold'] = make('Times-Bold', timesW, 'times', true, false);
  out['Times-Italic'] = make('Times-Italic', timesW, 'times', false, true);
  out['Times-BoldItalic'] = make('Times-BoldItalic', timesW, 'times', true, true);
  out['Courier'] = make('Courier', courW, 'courier', false, false);
  out['Courier-Bold'] = make('Courier-Bold', courW, 'courier', true, false);
  out['Courier-Oblique'] = make('Courier-Oblique', courW, 'courier', false, true);
  out['Courier-BoldOblique'] = make('Courier-BoldOblique', courW, 'courier', true, true);
  return out;
})();

export function isCore14(name: string): boolean {
  return name in CORE_14;
}
