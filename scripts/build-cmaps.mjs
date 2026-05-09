#!/usr/bin/env node
/**
 * Adobe CMap resources 에서 CID → Unicode 매핑을 가져와 압축 JSON 으로 저장.
 *
 * 사용:
 *   node scripts/build-cmaps.mjs           # 모두 (Korea1, Japan1, GB1, CNS1)
 *   node scripts/build-cmaps.mjs Korea1    # 특정 ordering만
 *
 * 결과:
 *   frontend/src/pdf/fonts/cid-mappings/data/adobe-korea1.json
 *   frontend/src/pdf/fonts/cid-mappings/data/adobe-japan1.json
 *   ...
 *
 * 라이선스: Adobe CMap resources는 BSD-style. 출처/라이선스 헤더를 보존한다.
 *
 * 의존성: Node 22+ (built-in fetch).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'frontend', 'src', 'pdf', 'fonts', 'cid-mappings', 'data');

// 각 ordering 의 UCS2 CMap raw 파일 URL (Adobe CMap resources GitHub mirror).
const SOURCES = {
  Korea1: 'https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-Korea1-7/CMap/Adobe-Korea1-UCS2',
  Japan1: 'https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-Japan1-7/CMap/Adobe-Japan1-UCS2',
  GB1: 'https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-GB1-5/CMap/Adobe-GB1-UCS2',
  CNS1: 'https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-CNS1-7/CMap/Adobe-CNS1-UCS2',
};

const args = process.argv.slice(2);
const requested = args.length > 0 ? args : Object.keys(SOURCES);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const ordering of requested) {
    const url = SOURCES[ordering];
    if (!url) {
      console.error(`Unknown ordering: ${ordering}`);
      continue;
    }
    console.log(`[${ordering}] fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[${ordering}] HTTP ${res.status}`);
      continue;
    }
    const text = await res.text();
    const map = parseCMap(text);
    const compact = compress(map);
    const out = {
      registry: 'Adobe',
      ordering,
      ranges: compact.ranges,
      ...(Object.keys(compact.singles).length > 0 ? { singles: compact.singles } : {}),
    };
    const path = join(OUT_DIR, `adobe-${ordering.toLowerCase()}.json`);
    await writeFile(path, JSON.stringify(out));
    console.log(`[${ordering}] ${out.ranges.length} ranges + ${Object.keys(compact.singles).length} singles → ${path}`);
  }
}

/**
 * Adobe CMap text → CID → Unicode Map.
 * 인식: beginbfchar/endbfchar, beginbfrange/endbfrange.
 */
function parseCMap(text) {
  const map = new Map(); // cid → string
  const tokens = tokenize(text);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'beginbfchar') {
      i++;
      while (i < tokens.length && tokens[i] !== 'endbfchar') {
        const cid = hexToNum(tokens[i]);
        const u = hexToString(tokens[i + 1]);
        if (cid !== null && u !== null) map.set(cid, u);
        i += 2;
      }
      i++;
    } else if (t === 'beginbfrange') {
      i++;
      while (i < tokens.length && tokens[i] !== 'endbfrange') {
        const a = hexToNum(tokens[i]);
        const b = hexToNum(tokens[i + 1]);
        const third = tokens[i + 2];
        if (a === null || b === null) {
          i += 3;
          continue;
        }
        if (third === '[') {
          let j = i + 3;
          const arr = [];
          while (j < tokens.length && tokens[j] !== ']') {
            const s = hexToString(tokens[j]);
            if (s !== null) arr.push(s);
            j++;
          }
          for (let k = 0; k <= b - a && k < arr.length; k++) map.set(a + k, arr[k]);
          i = j + 1;
        } else {
          const base = hexToString(third);
          if (base !== null) {
            for (let k = 0; k <= b - a; k++) map.set(a + k, incLast(base, k));
          }
          i += 3;
        }
      }
      i++;
    } else {
      i++;
    }
  }
  return map;
}

function tokenize(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f') {
      i++;
      continue;
    }
    if (c === '%') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '<') {
      const end = text.indexOf('>', i);
      if (end < 0) break;
      out.push('<' + text.substring(i + 1, end).replace(/\s+/g, '') + '>');
      i = end + 1;
      continue;
    }
    if (c === '[' || c === ']') {
      out.push(c);
      i++;
      continue;
    }
    if (c === '/') {
      let j = i + 1;
      while (j < n && !/[\s<>[\]/%]/.test(text[j])) j++;
      out.push(text.substring(i, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/[\s<>[\]/%]/.test(text[j])) j++;
    if (j === i) i++;
    else {
      out.push(text.substring(i, j));
      i = j;
    }
  }
  return out;
}

function hexToNum(t) {
  if (!t || !t.startsWith('<') || !t.endsWith('>')) return null;
  const h = t.slice(1, -1);
  if (!/^[0-9A-Fa-f]+$/.test(h)) return null;
  return parseInt(h, 16);
}

function hexToString(t) {
  if (!t || !t.startsWith('<') || !t.endsWith('>')) return null;
  const h = t.slice(1, -1);
  if (h.length === 0) return '';
  if (!/^[0-9A-Fa-f]+$/.test(h)) return null;
  if (h.length % 4 === 0) {
    let out = '';
    for (let i = 0; i < h.length; i += 4) {
      out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    }
    return out;
  }
  if (h.length === 2) return String.fromCharCode(parseInt(h, 16));
  if (h.length % 2 === 0) {
    let out = '';
    for (let i = 0; i < h.length; i += 2) {
      out += String.fromCharCode(parseInt(h.substr(i, 2), 16));
    }
    return out;
  }
  return null;
}

function incLast(s, by) {
  if (s.length === 0) return s;
  return s.slice(0, -1) + String.fromCharCode((s.charCodeAt(s.length - 1) + by) & 0xffff);
}

/**
 * Map<cid, string> → 압축 형식.
 *   - 단일-문자 + 연속 cid + 연속 unicode 면 ranges 로 합침
 *   - 그 외는 singles 로
 */
function compress(map) {
  const cids = [...map.keys()].sort((a, b) => a - b);
  const ranges = []; // [cidStart, cidEnd, unicodeStart]
  const singles = {};
  let i = 0;
  while (i < cids.length) {
    const cid = cids[i];
    const u = map.get(cid);
    if (u.length !== 1) {
      // multi-char destination — singles 로
      singles[cid] = u;
      i++;
      continue;
    }
    let j = i;
    const startU = u.charCodeAt(0);
    while (j + 1 < cids.length) {
      const nextCid = cids[j + 1];
      if (nextCid !== cids[j] + 1) break;
      const nextU = map.get(nextCid);
      if (nextU.length !== 1) break;
      if (nextU.charCodeAt(0) !== startU + (nextCid - cid)) break;
      j++;
    }
    ranges.push([cid, cids[j], startU]);
    i = j + 1;
  }
  return { ranges, singles };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
