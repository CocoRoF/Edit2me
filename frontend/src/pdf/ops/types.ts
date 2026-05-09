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

export interface AddTextOp {
  op: 'add-text';
  pageIndex: number;
  x: number; // PDF 좌표 (좌하 원점)
  y: number;
  text: string;
  font: 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Courier' | 'Courier-Bold';
  fontSize: number;
  color: { r: number; g: number; b: number }; // 0..1
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
