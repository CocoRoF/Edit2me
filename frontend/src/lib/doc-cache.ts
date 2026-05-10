// 서버 측 in-memory doc 캐시.
//
// docId → { doc, name, revision, undo/redo 스택, 페이지 텍스트 캐시 }.
// LRU 32개. idle 5분 후 자동 evict.

import crypto from 'node:crypto';
import { PdfDocument } from '@/pdf/parser/document';
import { Op } from '@/pdf/ops/types';
import { applyOps } from '@/pdf/ops/apply';
import { extractTextFromPage, TextExtractionResult } from '@/pdf/graphics/text-extract';
import { ParsedTtf, parseTtf } from '@/pdf/fonts/ttf-parser';
import { getUpload, putUpload, deleteDoc } from '@/pdf/store/minio';

export interface UploadedFont {
  parsed: ParsedTtf;
  baseName: string;
  /** 사용자에게 보여줄 라벨 */
  displayName: string;
}

interface DocEntry {
  doc: PdfDocument;
  name: string;
  revision: number;
  lastAccess: number;
  /** 적용된 op들 (시간순). undo가 여기서 pop. */
  history: Op[];
  /** 취소된 op들. redo가 여기서 pop. */
  redoStack: Op[];
  /** 페이지별 텍스트 추출 캐시. revision 변경 시 무효화. */
  textCache: Map<number, TextExtractionResult>;
  /** 원본 PDF byte (undo 시 처음부터 op replay 위해). */
  originalBytes: Uint8Array;
  /** 이 doc 에 업로드된 TTF (uploadId → font). */
  uploadedFonts: Map<string, UploadedFont>;
}

const cache = new Map<string, DocEntry>();
const TTL_MS = 5 * 60 * 1000;
const MAX = 32;

export function newDocId(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function registerNewDoc(
  buf: Uint8Array,
  name: string,
): Promise<{ docId: string; entry: DocEntry }> {
  const docId = newDocId();
  await putUpload(docId, buf);
  const doc = PdfDocument.open(buf);
  const entry: DocEntry = {
    doc,
    name,
    revision: 0,
    lastAccess: Date.now(),
    history: [],
    redoStack: [],
    textCache: new Map(),
    originalBytes: buf,
    uploadedFonts: new Map(),
  };
  cache.set(docId, entry);
  evictIfNeeded();
  return { docId, entry };
}

export async function getDoc(docId: string): Promise<DocEntry | null> {
  const cached = cache.get(docId);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached;
  }
  let buf: Uint8Array;
  try {
    buf = await getUpload(docId);
  } catch {
    return null;
  }
  const doc = PdfDocument.open(buf);
  const entry: DocEntry = {
    doc,
    name: 'document.pdf',
    revision: 0,
    lastAccess: Date.now(),
    history: [],
    redoStack: [],
    textCache: new Map(),
    originalBytes: buf,
    uploadedFonts: new Map(),
  };
  cache.set(docId, entry);
  evictIfNeeded();
  return entry;
}

export async function disposeDoc(docId: string): Promise<void> {
  cache.delete(docId);
  await deleteDoc(docId);
}

export interface OpResult {
  revision: number;
  affectedPages: number[];
  newPageCount: number;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * 전체 페이지 메타 (width, height, rotate). C5 — surgical update:
   * 클라이언트가 GET /documents/{id} 를 별도 호출하지 않아도 되도록.
   */
  pages: Array<{ index: number; width: number; height: number; rotate: 0 | 90 | 180 | 270 }>;
}

function snapshotPages(entry: DocEntry): OpResult['pages'] {
  return entry.doc.getPages().map((p, i) => {
    const [llx, lly, urx, ury] = entry.doc.pageMediaBox(p.dict);
    return {
      index: i,
      width: urx - llx,
      height: ury - lly,
      rotate: entry.doc.pageRotation(p.dict),
    };
  });
}

export async function applyOpsToDoc(docId: string, ops: Op[]): Promise<OpResult | null> {
  const entry = await getDoc(docId);
  if (!entry) return null;
  const result = applyOps(entry.doc, ops, { uploadedFonts: entry.uploadedFonts });
  entry.history.push(...ops);
  entry.redoStack = [];
  entry.revision += 1;
  entry.lastAccess = Date.now();
  if (
    ops.some(
      (o) => o.op === 'delete-pages' || o.op === 'reorder-pages' || o.op === 'rotate-pages',
    )
  ) {
    entry.textCache.clear();
  } else {
    for (const p of result.affectedPages) entry.textCache.delete(p);
  }
  entry.doc.invalidateContentCache();
  return {
    revision: entry.revision,
    ...result,
    canUndo: entry.history.length > 0,
    canRedo: entry.redoStack.length > 0,
    pages: snapshotPages(entry),
  };
}

/** 가장 최근 op을 취소. */
export async function undoDoc(docId: string): Promise<OpResult | null> {
  const entry = await getDoc(docId);
  if (!entry) return null;
  if (entry.history.length === 0) {
    return {
      revision: entry.revision,
      affectedPages: [],
      newPageCount: entry.doc.pageCount(),
      canUndo: false,
      canRedo: entry.redoStack.length > 0,
      pages: snapshotPages(entry),
    };
  }
  const op = entry.history.pop()!;
  entry.redoStack.push(op);
  entry.doc = PdfDocument.open(entry.originalBytes);
  if (entry.history.length > 0) {
    applyOps(entry.doc, [...entry.history], { uploadedFonts: entry.uploadedFonts });
  }
  entry.revision += 1;
  entry.textCache.clear();
  entry.lastAccess = Date.now();
  return {
    revision: entry.revision,
    affectedPages: [],
    newPageCount: entry.doc.pageCount(),
    canUndo: entry.history.length > 0,
    canRedo: entry.redoStack.length > 0,
    pages: snapshotPages(entry),
  };
}

/** redoStack 의 op을 다시 적용. */
export async function redoDoc(docId: string): Promise<OpResult | null> {
  const entry = await getDoc(docId);
  if (!entry) return null;
  if (entry.redoStack.length === 0) {
    return {
      revision: entry.revision,
      affectedPages: [],
      newPageCount: entry.doc.pageCount(),
      canUndo: entry.history.length > 0,
      canRedo: false,
      pages: snapshotPages(entry),
    };
  }
  const op = entry.redoStack.pop()!;
  applyOps(entry.doc, [op], { uploadedFonts: entry.uploadedFonts });
  entry.history.push(op);
  entry.revision += 1;
  entry.textCache.clear();
  entry.doc.invalidateContentCache();
  entry.lastAccess = Date.now();
  return {
    revision: entry.revision,
    affectedPages: [],
    newPageCount: entry.doc.pageCount(),
    canUndo: entry.history.length > 0,
    canRedo: entry.redoStack.length > 0,
    pages: snapshotPages(entry),
  };
}

/** GET /documents/{id} 등에 사용 — 현재 undo/redo 가능 여부. */
export function entryUndoState(entry: DocEntry): { canUndo: boolean; canRedo: boolean } {
  return {
    canUndo: entry.history.length > 0,
    canRedo: entry.redoStack.length > 0,
  };
}

/** TTF 업로드 → 파싱 → entry.uploadedFonts 에 등록. uploadId 반환. */
export async function uploadFont(
  docId: string,
  ttfBytes: Uint8Array,
  displayName: string,
): Promise<{ uploadId: string; sample: { glyphs: number; unicodeMappings: number } } | null> {
  const entry = await getDoc(docId);
  if (!entry) return null;
  const parsed = parseTtf(ttfBytes);
  const uploadId = crypto.randomBytes(8).toString('base64url');
  // BaseFont 이름 — Unicode 안전한 ASCII 식별자만 (Adobe FontName 규칙)
  const sanitized = (displayName.replace(/[^A-Za-z0-9_-]/g, '') || 'UserFont').slice(0, 32);
  const baseName = `Edit2me${uploadId}+${sanitized}`;
  entry.uploadedFonts.set(uploadId, { parsed, baseName, displayName });
  return {
    uploadId,
    sample: { glyphs: parsed.numGlyphs, unicodeMappings: parsed.unicodeToGid.size },
  };
}

export function listUploadedFonts(
  entry: DocEntry,
): Array<{ uploadId: string; displayName: string }> {
  return [...entry.uploadedFonts.entries()].map(([uploadId, f]) => ({
    uploadId,
    displayName: f.displayName,
  }));
}

/** 페이지 텍스트 (캐시 우선) */
export async function getPageText(
  docId: string,
  pageIndex: number,
): Promise<{ entry: DocEntry; result: TextExtractionResult } | null> {
  const entry = await getDoc(docId);
  if (!entry) return null;
  let result = entry.textCache.get(pageIndex);
  if (!result) {
    const pages = entry.doc.getPages();
    const page = pages[pageIndex];
    if (!page) return null;
    result = extractTextFromPage(entry.doc, page.dict, pageIndex);
    entry.textCache.set(pageIndex, result);
  }
  return { entry, result };
}

export async function rebaseDoc(
  docId: string,
  newDoc: PdfDocument,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const entry: DocEntry = {
    doc: newDoc,
    name,
    revision: 0,
    lastAccess: Date.now(),
    history: [],
    redoStack: [],
    textCache: new Map(),
    originalBytes: bytes,
    uploadedFonts: new Map(),
  };
  cache.set(docId, entry);
}

function evictIfNeeded(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.lastAccess > TTL_MS) cache.delete(k);
  }
  if (cache.size > MAX) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = cache.size - MAX;
    for (let i = 0; i < toRemove; i += 1) cache.delete(sorted[i]![0]);
  }
}

// ---- Download tokens (5-min) ----

const tokens = new Map<
  string,
  { docId: string; bytes: Uint8Array; expires: number; fileName: string }
>();

export function issueDownloadToken(
  docId: string,
  bytes: Uint8Array,
  fileName: string,
): string {
  const token = crypto.randomBytes(16).toString('base64url');
  tokens.set(token, {
    docId,
    bytes,
    fileName,
    expires: Date.now() + 5 * 60 * 1000,
  });
  return token;
}

export function consumeDownloadToken(
  token: string,
): { bytes: Uint8Array; fileName: string } | null {
  const t = tokens.get(token);
  if (!t) return null;
  if (Date.now() > t.expires) {
    tokens.delete(token);
    return null;
  }
  return { bytes: t.bytes, fileName: t.fileName };
}

export function deleteDownloadToken(token: string): void {
  tokens.delete(token);
}
