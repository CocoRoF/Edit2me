# 03. Parser Design

`src/pdf/parser/` 의 설계. 입력은 `Buffer | Uint8Array | (랜덤 액세스를 지원하는) ReadableSource`, 출력은 `PdfDocument` 객체 트리.

## 1. 모듈 분할

```
core/
├── tokenizer.ts   # 바이트 스트림 → 토큰 (저수준)
├── object.ts      # PdfObject 타입 정의 + 헬퍼
├── stream.ts      # 압축 필터 디코드
└── xref.ts        # xref 표 + xref stream 파싱

parser/
├── lexer.ts       # tokenizer + 객체 단위 파싱
├── parser.ts      # 객체 그래프 구축 (lazy)
└── document.ts    # PdfDocument 진입점 (open/close)
```

## 2. 데이터 모델

```ts
// object.ts
export type PdfObject =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'int'; value: number }
  | { kind: 'real'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'string'; value: Uint8Array; /* literal vs hex 보존 */ literal: boolean }
  | { kind: 'array'; items: PdfObject[] }
  | { kind: 'dict'; map: Map<string, PdfObject> }     // 키 순서 보존 위해 Map
  | { kind: 'stream'; dict: PdfDict; raw: Uint8Array; offset: number; /* lazy */ }
  | { kind: 'ref'; objNum: number; gen: number };

export type PdfDict = Extract<PdfObject, { kind: 'dict' }>;

// 항상 indirect → resolve된 형태가 헷갈림. 명시적 헬퍼 사용:
export function resolve(doc: PdfDocument, obj: PdfObject): PdfObject;
```

**왜 union with discriminator인가**: `instanceof` 가 잘 안 통하는 단순 데이터를 다룬다. 직렬화·복제·비교가 쉽다. `kind` 필드로 TS exhaustive check가 작동.

**왜 string을 Uint8Array로**: PDF literal string은 *임의 바이트* 배열이지 UTF-8이 아니다. `/Encoding`을 적용해야 비로소 텍스트가 된다. 미리 string으로 디코드하면 정보 손실.

## 3. 토크나이저 (`core/tokenizer.ts`)

상태 없는 함수형 토크나이저:
```ts
export interface Token {
  type: TokenType;          // 'int' | 'real' | 'name' | 'lparen' | ...
  start: number;            // byte offset
  end: number;              // exclusive
  value?: unknown;          // 즉시 파싱한 값 (옵션)
}

export function* tokenize(buf: Uint8Array, from = 0): Generator<Token>;
```

**왜 Generator**: 큰 stream의 콘텐츠 토큰화는 lazy로 가야 메모리 안정. 또 `peek/consume` 인터페이스를 빌려쓰는 lexer가 위에 올라온다.

**처리 순서**:
1. 공백 skip (NUL 포함).
2. `%` → 라인 끝까지 주석 skip.
3. 첫 문자 분기:
   - `+ - 0-9 .` → 숫자 (정수/실수 구분은 `.` 포함 여부).
   - `(` → literal string. 괄호 깊이 추적, 이스케이프 처리.
   - `<<` → dict 시작 / `<` 단독 → hex string.
   - `[` `]` → array.
   - `>>` `>` → dict 끝 / hex 끝.
   - `/` → name. 다음 구분자/공백까지. `#XX` 디코드.
   - 알파벳 → 키워드 (`obj`, `endobj`, `stream`, `endstream`, `xref`, `trailer`, `startxref`, `null`, `true`, `false`, `R`).
4. EOF → 종료.

**숫자 파싱**: 단순 `Number(s)` 금지. PDF는 `+17`을 허용하고 `1.0e10`은 *허용 안 함*. 자체 구현이 안전.

## 4. Lexer (`parser/lexer.ts`)

토큰 → 객체 1개. 핵심은 `parseObject(start)` → `[obj, end]`.

```ts
export class Lexer {
  constructor(private buf: Uint8Array) {}

  parseObject(start: number): { obj: PdfObject; end: number };
  parseIndirectObject(start: number): { num: number; gen: number; obj: PdfObject; end: number };
  // R 키워드는 lexer에서는 'ref'로 바로 만든다 (parseObject 안에서 lookahead로 처리)
}
```

**Stream 처리**:
1. `<< ... >>` 파싱 후 `stream` 키워드 만나면 그 직후 EOL 위치 → stream 본문 시작.
2. dict의 `/Length`로 본문 길이 결정. 단 `/Length`가 indirect ref이면 *지연 평가* (이 ref는 xref 로드 후에야 resolve 가능).
3. 길이가 indirect거나 신뢰할 수 없을 때 → `endstream` 키워드를 직접 검색하는 fallback.
4. stream 본문은 *디코드하지 않고* `{ raw, offset }` 만 저장. 사용 시점에 `decodeStream(stream, doc)` 호출.

## 5. Xref 파싱 (`core/xref.ts`)

### 5.1 진입: 끝에서부터
```ts
export function locateStartxref(buf: Uint8Array): number {
  // 마지막 1KB 정도에서 'startxref' 토큰 검색
  // 발견 못하면 'obj'를 직접 스캔하는 'recover' 모드로 fallback
}
```

### 5.2 Classical xref
```ts
interface XrefEntry {
  type: 'free' | 'inUse' | 'compressed';
  offset?: number;       // inUse: byte offset; free: next free objNum
  gen?: number;
  streamObjNum?: number; // compressed: object stream을 담은 객체 번호
  indexInStream?: number;
}

export type XrefTable = Map<number /*objNum*/, XrefEntry>;
```

여러 xref 섹션을 *최신 우선*으로 합쳐 단일 `XrefTable` 반환. trailer의 `/Prev`를 따라 재귀적으로 합침.

### 5.3 Xref Stream
PDF 1.5+. `<< /Type /XRef /W [w1 w2 w3] /Index [...] /Filter /FlateDecode >>` + binary stream.

**구현**: stream을 zlib decode → predictor 복원 → byte 폭에 맞춰 entry parse. Index는 [start count, start count, ...] 형태일 수 있음.

### 5.4 Object Streams (§7.5.7)
xref entry type=2인 객체는 *별도 stream object 안에* 들어있다. stream의 헤더는 `<< /Type /ObjStm /N <count> /First <offset> >>` + 본문은 `[objNum offset] x N` 다음에 실제 객체들.

→ `resolveCompressed(streamObjNum, indexInStream)`로 lazy decode.

## 6. Document 진입점 (`parser/document.ts`)

```ts
export class PdfDocument {
  static async open(buf: Uint8Array, opts?: OpenOptions): Promise<PdfDocument>;

  readonly version: string;
  readonly xref: XrefTable;
  readonly trailer: PdfDict;
  readonly catalog: PdfDict;

  // Lazy 객체 로드. 동일 ref 반복 호출은 캐시.
  resolve(ref: PdfRef): PdfObject;
  resolveDict(obj: PdfObject): PdfDict;
  resolveArray(obj: PdfObject): PdfObject[];
  decodeStream(stream: PdfStream): Uint8Array;

  // 페이지 트리 평면화
  getPages(): PageHandle[];   // PageHandle = { objNum, gen, dict, index }
  getPage(index: number): PageHandle;

  // 변경 추적
  markDirty(objNum: number): void;
  isDirty(objNum: number): boolean;

  // 새 객체 할당
  allocateObject(obj: PdfObject): PdfRef;
}
```

**Lazy 정책**:
- `open()`은 헤더 + xref + trailer + catalog 까지만 강제 로드.
- 페이지 dict는 `getPages()` 호출 시 트리 순회하며 로드.
- 콘텐츠 stream/리소스는 페이지 단위 작업이 시작될 때 로드.

**캐시**: WeakRef 안 씀 (예측 어려움). 단순 LRU (`Map`, 1000 객체 한도) — MVP에는 충분.

## 7. 콘텐츠 스트림 파서 (`graphics/content-stream.ts`)

페이지의 `/Contents`를 디코드한 결과는 *연산자 시퀀스*다.

```ts
export type ContentOp =
  | { op: 'q' }
  | { op: 'Q' }
  | { op: 'cm'; matrix: [number, number, number, number, number, number] }
  | { op: 'BT' }
  | { op: 'ET' }
  | { op: 'Tf'; fontResource: string; size: number }
  | { op: 'Tm'; matrix: [number, number, number, number, number, number] }
  | { op: 'Td'; tx: number; ty: number }
  | { op: 'TD'; tx: number; ty: number }
  | { op: 'Tj'; bytes: Uint8Array }
  | { op: 'TJ'; items: Array<{ kind: 'bytes'; bytes: Uint8Array } | { kind: 'shift'; value: number }> }
  // ... 그래픽 연산자도 추후 추가. MVP는 텍스트 우선.
  | { op: '_unknown'; raw: Uint8Array };  // 미지원 연산자 보존
```

**핵심 결정**: 미지원 연산자는 *문자열 그대로* 보존한다. 우리가 인식하는 연산자만 객체화하고, 나머지는 raw bytes로 두면 *재직렬화 시 원형 보존*.

콘텐츠 스트림이 여러 stream의 배열인 경우 (`/Contents [ a b c R ]`) → 모두 디코드해 *concat*해서 단일 시퀀스로 본다 (PDF는 이를 단순 이어붙임으로 정의).

## 8. 텍스트 추출 (`graphics/text-extract.ts`)

페이지 콘텐츠 ops를 입력받아 *텍스트 블록 트리* 산출:
```ts
interface TextRun {
  unicode: string;
  bbox: [number, number, number, number];  // 페이지 좌표계
  pageRotation: 0|90|180|270;
  font: string;
  size: number;
  // 편집 가능성을 위해, 원래 ops 안에서의 위치를 추적
  source: { contentStreamId: string; opIndex: number; rangeInOp: [number, number] };
}

interface TextBlock { runs: TextRun[]; bbox: ...; text: string; /* 합친 것 */ }
```

알고리즘:
1. 그래픽 상태 머신을 돌리며 각 `Tj/TJ`에서 (textMatrix, font, size, bytes)를 기록.
2. font.encoding + font.toUnicode로 byte → unicode 변환.
3. char widths로 글자별 x 위치 계산.
4. **블록화**: 인접한 run들 (같은 line, 같은 폰트, gap < 0.3 * size)을 합쳐 TextBlock 형성.

**왜 source 위치를 보존**: 편집 시 *바로 그 ops 위치를 다시 작성*해서 콘텐츠 스트림을 부분 갱신할 수 있게. 자세한 건 [`06-features.md#1-텍스트-편집`](./06-features.md).

## 9. 폰트 처리 (`fonts/`)

### Core 14
정적 메트릭 테이블. AFM 파일에서 추출한 width, glyph→unicode를 TS로 임베드.
```ts
export const HELVETICA: CoreFontMetrics = { widths: { /* 한 글자당 unicode → advance(1/1000em) */ }, ... };
```

### Type 1 / TrueType (임베디드)
폰트의 `/FontFile`, `/FontFile2`, `/FontFile3` stream을 그냥 *블랙박스 보존* (편집 시 재사용). 텍스트 *추출*에는 `/Encoding` + `/Widths` + `/ToUnicode`만 본다 — 글리프 비트맵 디코드는 *렌더러*의 일이다 (Phase 3).

### Type 0 / Composite (CJK)
`/Encoding`이 CMap (이름 또는 stream).
- 표준 CMap (UniKS-UCS2-H 등): 표 미리 빌드해 번들.
- 임베디드 CMap: `beginbfchar/endbfchar`, `beginbfrange/endbfrange`, `begincidchar` 등 mini-language 파싱. 별도 모듈 `fonts/cmap.ts`.

### `/ToUnicode` CMap
거의 모든 polished PDF에 있음. **그러므로 ToUnicode가 있으면 항상 그것을 우선**. 없으면 위 fallback.

## 10. 관용 처리 (Tolerance) <a id="tolerance"></a>

| 사례 | 동작 | 로그 레벨 |
|---|---|---|
| `%PDF-` 가 첫 1024 byte 안 어디든 발견 | 그 위치를 시작으로 간주 | warn |
| xref offset 이 ±10 byte 어긋남 | 근처에서 `obj` 토큰 스캔해 보정 | warn |
| stream `/Length` 가 실제와 다름 | `endstream` 키워드까지 읽음 | warn |
| 동일 객체가 여러 번 정의 | 가장 큰 generation 또는 마지막 것 | debug |
| `obj`/`endobj` 누락 | 토큰 스캔으로 객체 경계 추정 | warn |
| `xref`가 아예 없음 (또는 손상) | 전체 파일을 스캔해 `obj` 토큰으로 xref 재구축 | warn (slow path) |
| 트레일러 dict 누락 | 마지막 `/Root` 키 가진 dict를 trailer로 채택 | warn |
| 비표준 인코딩 + ToUnicode 없음 | 텍스트 추출 실패 markup, 페이지는 보여주되 편집 비활성화 | warn |

**경고 정책**: 모든 관용 처리는 `doc.diagnostics: Diagnostic[]`에 누적. UI에서 "복구 모드로 열림" 배지 표시.

## 11. 에러와 거부

다음은 *복구하지 않고 거부*:
- 암호화된 PDF (`/Encrypt`가 trailer에 있음) → "비밀번호 보호 PDF는 v1에서 지원되지 않습니다".
- xref/trailer/Catalog 모두 못 찾음 → 잘못된 PDF.
- 첫 1024 byte에서 `%PDF-` 못 찾음 → 잘못된 PDF.
- 파일 크기 > 200MB → reject (구성 가능).
- `/JavaScript` 액션 검출 시 → 거부 또는 strip 옵션 (기본 strip).

## 12. 성능 기대치

- 50페이지/5MB PDF: open() < 200ms, getPages() < 50ms.
- 1000페이지/50MB PDF: open() < 1s.
- 객체 cache hit ratio > 90% (페이지 편집 워크로드 기준).

벤치마크 코퍼스: [`11-testing.md`](./11-testing.md#perf).

## 13. 구현 순서 제안

`10-roadmap.md`에서 자세히 다루지만 모듈 단위 구현 우선순위는:

1. tokenizer → 단위 테스트 (랜덤 토큰열 round-trip).
2. classical xref + lexer → 페이지 *수* 만 정확히 알 수 있는 단계.
3. FlateDecode + Predictor → stream decode.
4. PageTree 평면화 → 페이지 메타.
5. Content stream parser (text ops 우선).
6. 코어 14 폰트 + ToUnicode → 텍스트 추출.
7. Xref stream + Object stream → 1.5+ PDF 지원.
8. CMap (CJK 표준) → 한국어/일본어/중국어 PDF.
9. 임베디드 CMap.
10. 그 밖의 필터들.
