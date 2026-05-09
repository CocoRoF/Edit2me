// 서버 측 in-memory doc 캐시.
//
// docId → { doc, name, revision, undo/redo 스택 }.
// LRU 32개. idle 5분 후 자동 evict.

import crypto from 'node:crypto';
import { PdfDocument } from '@/pdf/parser/document';
import { Op } from '@/pdf/ops/types';
import { applyOps } from '@/pdf/ops/apply';
import { getUpload, putUpload, deleteDoc } from '@/pdf/store/minio';

interface DocEntry {
  doc: PdfDocument;
  name: string;
  revision: number;
  lastAccess: number;
  // Undo/Redo: 각 entry는 *원본 byte로 다시 시작*하는 단순 모델 — 정확하나 비효율.
  // 큰 PDF엔 메모리 부담이지만 v1 단순화. v2에서 inverse op 구현.
  history: Op[]; // 적용된 op 누적
  redoStack: Op[];
}

const cache = new Map<string, DocEntry>();
const TTL_MS = 5 * 60 * 1000;
const MAX = 32;

export function newDocId(): string {
  // URL-safe 32-char random
  return crypto.randomBytes(24).toString('base64url');
}

export async function registerNewDoc(buf: Uint8Array, name: string): Promise<{ docId: string; entry: DocEntry }> {
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
  // MinIO에서 재로드
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
  };
  cache.set(docId, entry);
  evictIfNeeded();
  return entry;
}

export async function disposeDoc(docId: string): Promise<void> {
  cache.delete(docId);
  await deleteDoc(docId);
}

export async function applyOpsToDoc(
  docId: string,
  ops: Op[],
): Promise<{ revision: number; affectedPages: number[]; newPageCount: number } | null> {
  const entry = await getDoc(docId);
  if (!entry) return null;
  const result = applyOps(entry.doc, ops);
  entry.history.push(...ops);
  entry.redoStack = [];
  entry.revision += 1;
  entry.lastAccess = Date.now();
  return { revision: entry.revision, ...result };
}

export async function rebaseDoc(docId: string, newDoc: PdfDocument, name: string): Promise<void> {
  const entry: DocEntry = {
    doc: newDoc,
    name,
    revision: 0,
    lastAccess: Date.now(),
    history: [],
    redoStack: [],
  };
  cache.set(docId, entry);
}

function evictIfNeeded(): void {
  const now = Date.now();
  // TTL evict
  for (const [k, v] of cache) {
    if (now - v.lastAccess > TTL_MS) cache.delete(k);
  }
  // LRU evict
  if (cache.size > MAX) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = cache.size - MAX;
    for (let i = 0; i < toRemove; i += 1) cache.delete(sorted[i]![0]);
  }
}

// Download token: 5분 유효. memory에 보관.
const tokens = new Map<string, { docId: string; bytes: Uint8Array; expires: number; fileName: string }>();

export function issueDownloadToken(docId: string, bytes: Uint8Array, fileName: string): string {
  const token = crypto.randomBytes(16).toString('base64url');
  tokens.set(token, { docId, bytes, fileName, expires: Date.now() + 5 * 60 * 1000 });
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
