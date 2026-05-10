// 클라이언트 API 헬퍼.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '/edit2me';

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return `${BASE}${path}`;
}

export interface PageMeta {
  index: number;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
}

export interface DocumentMeta {
  docId: string;
  name: string;
  pageCount: number;
  version: string;
  pages: PageMeta[];
  revision: number;
  canUndo?: boolean;
  canRedo?: boolean;
  diagnostics?: Array<{ level: 'info' | 'warn' | 'error'; code: string; message: string }>;
}

export interface OpResult {
  revision: number;
  affectedPages: number[];
  newPageCount: number;
  canUndo: boolean;
  canRedo: boolean;
  /** C5 — surgical update: 클라이언트가 전체 doc 메타 재요청 안 해도 됨. */
  pages: PageMeta[];
}

export interface TextBlock {
  /** primary segment id — 단일 segment 일 때는 segment id 와 동일. */
  blockId: string;
  /** 그룹 안의 모든 underlying segment id 들. group edit 시 서버에 전송. */
  blockIds: string[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontBaseName: string;
  fontSize: number;
  isComposite: boolean;
  fullyDecoded: boolean;
  editable: boolean;
}

export interface FontWarning {
  font: string;
  warnings: string[];
}

export interface PageText {
  pageIndex: number;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  blocks: TextBlock[];
  fontWarnings: FontWarning[];
}

// ---- 클라이언트 in-memory cache (E2) ----
// 같은 docId+revision 으로 반복 요청 시 즉시 응답. 새 op 으로 revision 이 바뀌면 자연 invalidation.

interface CacheEntry<T> {
  value: T;
  expires: number;
}
const memCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 60_000; // 1분

function cacheGet<T>(key: string): T | null {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    memCache.delete(key);
    return null;
  }
  return e.value as T;
}
function cacheSet<T>(key: string, value: T): void {
  memCache.set(key, { value, expires: Date.now() + CACHE_TTL });
  if (memCache.size > 64) {
    const oldest = memCache.keys().next().value;
    if (oldest) memCache.delete(oldest);
  }
}

/** 명시적 invalidation — op 실행 후 호출. */
export function invalidateDocCache(docId: string): void {
  for (const k of memCache.keys()) {
    if (k.startsWith(`${docId}|`)) memCache.delete(k);
  }
}

export async function uploadPdf(file: File): Promise<DocumentMeta> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(apiUrl('/api/documents'), {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Upload failed (${res.status})`);
  }
  return (await res.json()) as DocumentMeta;
}

export async function getDocument(docId: string): Promise<DocumentMeta> {
  const cacheKey = `${docId}|getDocument`;
  const cached = cacheGet<DocumentMeta>(cacheKey);
  if (cached) return cached;
  const res = await fetch(apiUrl(`/api/documents/${docId}`));
  if (!res.ok) throw new Error(`Failed to load doc (${res.status})`);
  const data = (await res.json()) as DocumentMeta;
  cacheSet(cacheKey, data);
  return data;
}

export async function getPageText(docId: string, idx: number): Promise<PageText> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/pages/${idx}/text`));
  if (!res.ok) throw new Error(`Failed to load page text (${res.status})`);
  return (await res.json()) as PageText;
}

export async function getPageTextBatch(
  docId: string,
  pages: number[],
): Promise<{ pages: PageText[]; revision: number }> {
  const param = pages.length === 0 ? '' : `?pages=${pages.join(',')}`;
  const res = await fetch(apiUrl(`/api/documents/${docId}/pages/text${param}`));
  if (!res.ok) throw new Error(`Failed to load batch text (${res.status})`);
  return (await res.json()) as { pages: PageText[]; revision: number };
}

// revision 쿼리 — 페이지 reorder/rotate/delete 후 같은 idx 의 thumb 이 바뀌므로,
// 브라우저가 stale cache 를 쓰지 않도록 cache buster.
export function thumbUrl(docId: string, idx: number, w = 200, revision = 0): string {
  return apiUrl(`/api/documents/${docId}/pages/${idx}/thumb?w=${w}&r=${revision}`);
}

export function svgUrl(docId: string, idx: number, revision = 0): string {
  // revision 을 query 로 — 캐시 무효화에 활용
  return apiUrl(`/api/documents/${docId}/pages/${idx}/svg?r=${revision}`);
}

import type { Op } from '@/pdf/ops/types';

export async function applyOps(
  docId: string,
  baseRevision: number,
  ops: Op[],
): Promise<OpResult> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/ops`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, ops }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Op failed (${res.status})`);
  }
  invalidateDocCache(docId);
  return (await res.json()) as OpResult;
}

export interface InsertPdfResult {
  revision: number;
  pageCount: number;
  pages: Array<{ index: number; width: number; height: number; rotate: 0 | 90 | 180 | 270 }>;
  canUndo: boolean;
  canRedo: boolean;
  insertedFirstIndex: number;
  insertedCount: number;
}

export async function insertPdfPages(
  docId: string,
  file: File | Blob,
  insertAt: number,
): Promise<InsertPdfResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('insertAt', String(insertAt));
  const res = await fetch(apiUrl(`/api/documents/${docId}/insert-pdf`), {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Insert PDF failed (${res.status})`);
  }
  invalidateDocCache(docId);
  return (await res.json()) as InsertPdfResult;
}

export async function undoOp(docId: string): Promise<OpResult> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/undo`), { method: 'POST' });
  if (!res.ok) throw new Error(`Undo failed (${res.status})`);
  invalidateDocCache(docId);
  return (await res.json()) as OpResult;
}

export async function redoOp(docId: string): Promise<OpResult> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/redo`), { method: 'POST' });
  if (!res.ok) throw new Error(`Redo failed (${res.status})`);
  invalidateDocCache(docId);
  return (await res.json()) as OpResult;
}

export async function finalizeDoc(
  docId: string,
  mode: 'incremental' | 'optimize' = 'incremental',
): Promise<{ url: string; size: number; fileName: string }> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/finalize`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Finalize failed (${res.status})`);
  }
  return await res.json();
}

export interface UploadedFontMeta {
  uploadId: string;
  displayName: string;
}

export async function listFonts(docId: string): Promise<UploadedFontMeta[]> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/fonts`));
  if (!res.ok) return [];
  const data = (await res.json()) as { fonts: UploadedFontMeta[] };
  return data.fonts;
}

export async function uploadFont(docId: string, file: File): Promise<UploadedFontMeta> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(apiUrl(`/api/documents/${docId}/fonts`), {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Font upload failed (${res.status})`);
  }
  return (await res.json()) as UploadedFontMeta;
}

export async function mergeDocs(
  sources: Array<{ docId: string }>,
  pages: Array<{ source: number; pageIndex: number; rotation?: 0 | 90 | 180 | 270 }>,
  name?: string,
): Promise<DocumentMeta> {
  const res = await fetch(apiUrl('/api/merge'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources, pages, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Merge failed (${res.status})`);
  }
  return await res.json();
}
