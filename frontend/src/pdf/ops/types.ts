// 편집 연산 타입 정의 — 클라이언트 큐와 서버 적용 양쪽에서 공유.
// (UI에서 import할 수 있게 PDF 의존 없이 순수 타입만)

export interface DeletePagesOp {
  op: 'delete-pages';
  indices: number[];
}

export interface ReorderPagesOp {
  op: 'reorder-pages';
  permutation: number[]; // 새 인덱스 → 기존 인덱스
}

export type CoreFontName =
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Helvetica-BoldOblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Times-Italic'
  | 'Times-BoldItalic'
  | 'Courier'
  | 'Courier-Bold'
  | 'Courier-Oblique'
  | 'Courier-BoldOblique';

export interface AddTextOp {
  op: 'add-text';
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  /** Core 14 폰트 이름 또는 업로드된 TTF 의 fontId. */
  font: CoreFontName | { kind: 'ttf'; uploadId: string };
  fontSize: number;
  color: { r: number; g: number; b: number };
}

export interface EditTextOp {
  op: 'edit-text';
  pageIndex: number;
  blockId: string;
  newText: string;
}

export interface RotatePagesOp {
  op: 'rotate-pages';
  indices: number[];
  angle: 90 | -90 | 180;
}

export type Op =
  | DeletePagesOp
  | ReorderPagesOp
  | AddTextOp
  | EditTextOp
  | RotatePagesOp;
