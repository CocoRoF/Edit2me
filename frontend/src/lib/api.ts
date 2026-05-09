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
  diagnostics?: Array<{ level: string; code: string; message: string }>;
}

export interface TextBlock {
  blockId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontBaseName: string;
  fontSize: number;
  isCJK: boolean;
  fullyDecoded: boolean;
  editable: boolean;
}

export interface PageText {
  pageIndex: number;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  blocks: TextBlock[];
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
  const res = await fetch(apiUrl(`/api/documents/${docId}`));
  if (!res.ok) throw new Error(`Failed to load doc (${res.status})`);
  return (await res.json()) as DocumentMeta;
}

export async function getPageText(docId: string, idx: number): Promise<PageText> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/pages/${idx}/text`));
  if (!res.ok) throw new Error(`Failed to load page text (${res.status})`);
  return (await res.json()) as PageText;
}

export function thumbUrl(docId: string, idx: number, w = 200): string {
  return apiUrl(`/api/documents/${docId}/pages/${idx}/thumb?w=${w}`);
}

import type { Op } from '@/pdf/ops/types';

export async function applyOps(
  docId: string,
  baseRevision: number,
  ops: Op[],
): Promise<{ revision: number; affectedPages: number[]; newPageCount: number }> {
  const res = await fetch(apiUrl(`/api/documents/${docId}/ops`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, ops }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Op failed (${res.status})`);
  }
  return await res.json();
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
