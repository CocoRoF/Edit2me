# 01. Architecture

## 시스템 구성

```
                                          ┌──────────────────────────────┐
                                          │  Browser (사용자)             │
                                          │  React 19 / Tailwind 4       │
                                          │  - 썸네일 보드                │
                                          │  - 페이지 캔버스 + 오버레이   │
                                          │  - 편집 연산 큐 (undo/redo)  │
                                          └──────────────┬───────────────┘
                                                         │ HTTPS via nginx
                                                         │ (basePath /edit2me)
┌────────────────────────── nginx (hr_blog2.0) ──────────┴──────────────┐
│                                                                       │
│  /edit2me/*       → edit2me-frontend:3000  (Next.js, App Router)      │
│  /uploads/*       → minio:9000  (PDF 업로드/다운로드도 동일 경로)      │
│  /api/*, /...     → 기존 hr_blog2.0 라우팅 유지                        │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ docker network: new_web_default
                               │
       ┌───────────────────────┴────────────┐
       │                                    │
       ▼                                    ▼
┌──────────────────────┐         ┌──────────────────────┐
│ edit2me-frontend     │         │ minio (공유)          │
│ Next.js 15           │         │ 버킷: pdf-edit       │
│  - app/   (UI)       │ ───────▶│  - uploads/{id}.pdf  │
│  - app/api/  (RH)    │  S3 SDK │  - results/{id}.pdf  │
│  - src/pdf/ (engine) │         │ TTL: 24h            │
└──────────────────────┘         └──────────────────────┘
```

## 책임 경계

| 레이어 | 책임 |
|---|---|
| **Browser (UI)** | 페이지 표시, 사용자 입력 수집, 편집 연산을 큐에 쌓기, 미리보기, 다운로드 트리거. **PDF 직접 파싱/직렬화 안 함**. |
| **Next.js Route Handlers (API)** | 업로드 수신 → MinIO 적재 → 파싱 → 페이지 메타/텍스트 추출 → 편집 연산 적용 → 재직렬화 → MinIO 적재 → presigned URL 반환. |
| **`src/pdf/` 엔진** | PDF 파싱(`parser/`), 직렬화(`writer/`), 페이지 그래픽 해석(`graphics/`), 페이지 단위 연산(`ops/`). 순수 TS. Node/Edge 양쪽에서 동작 가능하지만 1차는 Node 한정. |
| **MinIO** | PDF 원본/결과의 휘발성 저장소. 24h TTL. |

## 왜 Server-side에서 직렬화하는가

**클라이언트에서 직렬화하면 안 되는가?** 기술적으로는 된다. 그러나:

1. 보안: 사용자가 임의 PDF 바이트를 만들 수 있게 하면 우리가 보장할 수 있는 것이 줄어든다 (예: 출력에 트래커가 박힘).
2. 성능: 큰 PDF의 zlib 디코드는 Node가 더 빠르고 메모리도 안정적.
3. 코드 단일 진실: 파서/라이터 한 벌만 유지. 클라이언트는 표시 책임만 진다.
4. 디버깅: 모든 편집이 서버 로그를 거치므로 재현 가능.

**Trade-off**: 라운드트립 지연 발생. 해결: 클라이언트 편집 연산을 *낙관적으로* 미리보기에 반영하고, 서버는 백그라운드로 실제 PDF를 갱신.

## 데이터 흐름

### 1) 업로드

```
Browser ──multipart──▶ /edit2me/api/documents (POST)
                          │
                          ├─ MinIO putObject(uploads/{docId}.pdf)
                          ├─ parser.openDocument(buffer)
                          │   └─ xref 읽기, /Pages 트리 순회만
                          └─ 응답: {
                              docId, pageCount,
                              pages: [{ index, w, h, thumbnail }],
                              textBlocks: [...], // page별 lazy
                            }
```

### 2) 편집 연산

```
Browser → 편집 연산 큐 [op1, op2, ...]
        ▲            │
        │            ▼ (debounce 500ms)
        │  /edit2me/api/documents/{docId}/ops (POST)
        │            │
        │            ├─ ops.apply(doc, [op1, op2, ...])
        │            │   ├─ 객체 트리 갱신 (page tree, content streams)
        │            │   └─ 임시 dirty 마킹
        │            └─ 응답: { revision, affectedPages, newThumbnails? }
        │
        └── (낙관적 UI 미리보기)
```

### 3) 다운로드

```
Browser ──▶ /edit2me/api/documents/{docId}/finalize (POST)
              │
              ├─ writer.serialize(doc, { incremental: true })
              ├─ MinIO putObject(results/{docId}-{rev}.pdf)
              └─ 응답: { downloadUrl: presigned 5min }
```

## 디렉토리 구조 (Edit2me repo)

```
Edit2me/
├── README.md
├── docs/                          # 본 설계 문서
├── frontend/                      # Next.js 앱 루트 (Dockerfile, package.json은 여기)
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   ├── next.config.ts             # basePath: '/edit2me'
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── public/
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx           # 랜딩 (업로드)
│       │   ├── e/[docId]/
│       │   │   └── page.tsx       # 에디터 화면
│       │   └── api/
│       │       └── documents/
│       │           ├── route.ts                       # POST: 업로드
│       │           └── [docId]/
│       │               ├── route.ts                   # GET 메타, DELETE
│       │               ├── ops/route.ts               # POST: 편집 연산
│       │               ├── pages/[idx]/text/route.ts  # GET: 페이지 텍스트 블록
│       │               ├── pages/[idx]/thumb/route.ts # GET: 썸네일 (PNG)
│       │               └── finalize/route.ts          # POST: 직렬화 + presigned
│       ├── components/            # 클라이언트 React 컴포넌트
│       │   ├── editor/
│       │   ├── thumbnails/
│       │   └── ui/
│       ├── hooks/
│       ├── lib/                   # 클라이언트 공용 (api 클라이언트, undo 스택)
│       └── pdf/                   # ★ 자체 PDF 엔진 (서버사이드 only)
│           ├── core/
│           │   ├── tokenizer.ts
│           │   ├── object.ts      # PdfObject 타입 정의
│           │   ├── xref.ts
│           │   └── stream.ts      # FlateDecode 등 필터
│           ├── parser/
│           │   ├── lexer.ts
│           │   ├── parser.ts
│           │   └── document.ts    # PdfDocument 진입점
│           ├── writer/
│           │   ├── serializer.ts
│           │   ├── xref-builder.ts
│           │   └── incremental.ts
│           ├── graphics/          # 콘텐츠 스트림 해석
│           │   ├── content-stream.ts
│           │   ├── text-state.ts
│           │   └── operators.ts
│           ├── fonts/
│           │   ├── core14.ts      # 코어 14 metric 테이블
│           │   ├── cmap.ts
│           │   └── ttf.ts         # TTF subset 임베딩 (텍스트 추가 시)
│           ├── render/
│           │   └── canvas-renderer.ts  # node-canvas 우회 안 함, 자체 raster
│           ├── ops/
│           │   ├── delete-page.ts
│           │   ├── reorder-pages.ts
│           │   ├── merge.ts
│           │   ├── add-text.ts
│           │   └── edit-text.ts
│           └── store/
│               └── minio.ts       # S3 SDK는 일반 라이브러리이므로 허용
├── tests/
│   ├── corpus/                    # 테스트 PDF 파일 (외부 동결, 작은 것만 git에)
│   ├── unit/
│   └── e2e/
├── docker-compose.dev.yml         # 로컬 단독 실행용 (옵션)
└── .gitignore
```

`frontend/` 안에 모든 코드를 넣는 이유는 hr_blog2.0의 디렉토리 관습(`backend/`, `frontend/` 분리)을 따르되, Edit2me는 백엔드를 별도로 두지 않으므로 `frontend/` 하나만 둔다. 추후 백엔드 분리가 필요해지면 `backend/`를 추가한다.

## 기술 선택 요약

| 영역 | 선택 | 근거 |
|---|---|---|
| **프레임워크** | Next.js 15 App Router | hr_blog2.0과 동일. SSR + API Route를 한 코드베이스에. |
| **언어** | TypeScript (strict) | 명세 기반 코드에서 타입은 필수. PDF 객체 union 타입 활용. |
| **UI** | React 19 + Tailwind 4 | 동일 스택 일치, 컴포넌트 재활용 잠재. |
| **상태관리** | React 19 useReducer + Context (편집 큐), URL state | 외부 라이브러리 회피. 큐 1개로 끝나서 큰 라이브러리 불필요. |
| **드래그/드롭** | HTML5 native drag API | dnd-kit 등 도입 보류. 필요해지면 ADR. |
| **객체 저장소** | MinIO (hr_blog2.0 인스턴스 공유, 별도 버킷) | 인프라 단일화. |
| **이미지 라스터화** | 자체 캔버스 렌더 (Phase 3) + Phase 1은 페이지 placeholder | 외부 PDF 라이브러리 금지. Phase 1에서는 페이지를 실제로 렌더하지 않고 "텍스트 오버레이만" 표시. |
| **PDF 압축** | Node `zlib` (서버), Web `CompressionStream` (혹시 필요할 때) | 표준 라이브러리. ADR-0001에서 허용. |
| **AWS SDK** | `@aws-sdk/client-s3` (presign 포함) | MinIO와 통신. PDF 라이브러리 아니므로 허용. |

## 비기능 요구사항

- **보안**: 업로드 PDF는 절대 실행 컨텍스트에 들어가면 안 됨. 파서는 `JavaScript` 액션 객체를 발견 즉시 거부 또는 strip. 자세한 건 [`12-risks.md`](./12-risks.md#security).
- **관측성**: API 라우트마다 `{ docId, op, durationMs, bytes }` 구조화 로그. PDF 파서 에러는 위치(byte offset) 포함.
- **국제화**: UI는 ko/en. PDF 자체의 한국어 처리는 별도 이슈([`06-features.md#i18n`](./06-features.md)).
- **접근성**: 키보드 only로 5개 MVP 기능 모두 수행 가능해야 함.
