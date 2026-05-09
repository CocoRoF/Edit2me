# 10. Roadmap

> 이 로드맵은 *능력 단위*로 끊는다 — "이 시점에 사용자가 무엇을 할 수 있는가" 가 기준.

## Phase 0 — 셋업 (≈ 1주)

목표: 빈 Next.js 앱이 hr_blog2.0의 nginx 뒤에서 `/edit2me`로 응답.

- [ ] `frontend/` 에 Next.js 15 App Router 초기화 (TS, Tailwind 4).
- [ ] `next.config.ts` 에 `basePath: '/edit2me'`.
- [ ] `Dockerfile`, `Dockerfile.dev` 작성 (hr_blog2.0의 frontend Dockerfile을 참고).
- [ ] hr_blog2.0의 `docker-compose.dev.yml` 에 `edit2me-frontend` service 추가.
- [ ] hr_blog2.0의 `nginx/default.dev.conf` 에 `/edit2me/` location 추가.
- [ ] `compose up`으로 두 서비스 함께 실행 확인.
- [ ] `/edit2me/api/health` 가 `{ status: "ok" }` 반환.

**완료 기준**: 브라우저로 `http://localhost:58080/edit2me/`에 접속하면 placeholder 페이지가 뜬다.

## Phase 1 — Core Parser (≈ 3주)

목표: 우리 파서가 일반 PDF의 *메타와 페이지 수*를 정확히 알아낸다. 아직 UI 없음.

- [ ] `core/tokenizer.ts` + 단위 테스트 (CR/LF/CRLF mix, 이스케이프 string, hex string, name, 주석).
- [ ] `core/object.ts` — PdfObject union 정의.
- [ ] `parser/lexer.ts` — `parseObject`, `parseIndirectObject`, stream 본문 lazy.
- [ ] `core/xref.ts` — classical xref 파싱, `/Prev` 체인.
- [ ] `core/stream.ts` — FlateDecode (Node `zlib`) + PNG predictor 복원.
- [ ] `parser/document.ts` — `PdfDocument.open()`, page tree 평면화.
- [ ] CLI 도구 (`bin/edit2me-inspect.ts`) — 파일 입력 → JSON 메타 출력.
- [ ] 코퍼스 ([`11-testing.md`](./11-testing.md))에서 80% 이상 open 성공.
- [ ] xref stream + object stream 지원.

**완료 기준**: 우리 코드만으로 100개 PDF의 페이지 수를 추출하고 그 중 90% 이상이 qpdf 결과와 일치.

## Phase 2 — Page Operations + Writer (≈ 2주)

목표: 페이지 *재배치/삭제/병합*이 동작. 텍스트 편집은 아직 없음.

- [ ] `writer/serializer.ts` — 객체 → byte (round-trip 테스트).
- [ ] `writer/incremental.ts` — incremental update.
- [ ] `ops/delete-pages.ts`, `ops/reorder-pages.ts`.
- [ ] `ops/merge.ts` — 다중 doc 병합 (full rewrite 모드).
- [ ] 페이지 트리 평면화 + free 객체 처리.
- [ ] 자체 검증 (직렬화 후 재오픈).
- [ ] `POST /api/documents`, `POST /api/documents/{id}/ops`, `POST /api/documents/{id}/finalize` 구현.
- [ ] 매우 단순한 UI: 업로드 → 페이지 카드 (텍스트 없는 빈 카드) → 드래그/삭제 → 다운로드.

**완료 기준**: 코퍼스의 70%에서 페이지 조작 후 다른 PDF 뷰어로 정상 표시. 사용자 시나리오 #2, #3 (병합, 삭제) 가 동작.

## Phase 3 — Text Extraction + Editor UI (≈ 3주)

목표: 텍스트 *읽기*만 동작. 편집은 다음 단계.

- [ ] `graphics/content-stream.ts` — 텍스트 ops 파싱.
- [ ] `graphics/text-state.ts` — 텍스트 매트릭스 추적.
- [ ] `fonts/core14.ts` — 14 폰트의 widths + glyph→unicode 정적 테이블.
- [ ] `/ToUnicode` CMap 파서.
- [ ] 표준 인코딩(WinAnsi, StandardEncoding) 처리.
- [ ] `graphics/text-extract.ts` — 페이지별 TextRun, TextBlock.
- [ ] `GET /api/documents/{id}/pages/{idx}/text`.
- [ ] 에디터 UI: 페이지 캔버스 + 텍스트 오버레이 ([`05-renderer.md` Phase 1](./05-renderer.md)).
- [ ] 줌, 페이지 네비게이션.

**완료 기준**: 영어 PDF의 텍스트가 위치 ±2pt 정확도로 화면에 보임.

## Phase 4 — Text Edit + Add (≈ 3주)

목표: 사용자가 텍스트를 *수정*하고 *추가*할 수 있다.

- [ ] `ops/edit-text.ts` — 콘텐츠 stream의 특정 op만 다시 작성.
- [ ] `ops/add-text.ts` — 페이지에 새 텍스트 fragment 추가.
- [ ] 폰트 등록 헬퍼 (코어14, 사용자 TTF).
- [ ] 사용자 TTF 업로드 + 서브셋 임베딩 (`fonts/ttf-subset.ts`).
- [ ] UI: 인라인 편집, 텍스트 추가 모드, 폰트/크기/색 선택.
- [ ] 글리프 누락 fallback (코어14 split).

**완료 기준**: 코퍼스의 영어 PDF 50개에 대해 텍스트 편집 후 6개 뷰어 (Chrome, Firefox, Safari, Acrobat, Preview, qpdf check)에서 모두 정상.

## Phase 5 — CJK + 폰트 강화 (≈ 2주)

목표: 한국어 PDF 편집.

- [ ] 표준 CMap (UniKS-UCS2-H 등) 정적 번들.
- [ ] 임베디드 CMap mini-language 파서.
- [ ] CIDFontType0/2 추출 + 편집.
- [ ] 한국어 텍스트 추가 (사용자 한글 TTF).

**완료 기준**: 한국어/일본어 PDF 10개에서 텍스트 편집 후 정상.

## Phase 6 — Polish + 운영 (≈ 2주)

- [ ] Undo/Redo 스택 견고화.
- [ ] 회전된 페이지 처리.
- [ ] 다운로드 모드 (incremental vs optimize) UI.
- [ ] 에러 상태 모두 친화적 처리.
- [ ] 키보드 단축키 전체 적용.
- [ ] 다국어 UI (ko/en).
- [ ] 운영 nginx + compose.prod 통합.
- [ ] 성능 튜닝 (LRU 사이즈, 큰 파일 streaming).
- [ ] MinIO 라이프사이클 정책 자동화.

## Phase 7+ (Backlog)

[`06-features.md` 미래 기능](./06-features.md#미래-기능-backlog-우선순위-순) 의 F1~F13.

특히:
- F7: 자체 raster 렌더러 (큰 작업) — 사용자 가치가 높으면 우선순위 상향.
- F9: hr_blog2.0 인증 통합 — 사용자가 자기 파일을 영구 보관할 수 있게.

## 실제 진행 (v0.2 종료 시점)

- ✅ Phase 0–6 동작 — 5개 MVP 기능 + undo/redo + i18n + 모바일 + 단위 테스트
- 🔄 Phase 5 (CJK 1급 지원): infrastructure done, 데이터 번들은 운영자 `build:cmaps` 실행으로 활성
- ⏳ Phase 7 (자체 raster): 미시작. 사용자 피드백에 따라 우선순위 결정.

자세한 PR-by-PR 변경은 [`docs/14-v0.2-changelog.md`](./14-v0.2-changelog.md).

## 마일스톤별 사용자 가치

| 끝 | 사용자가 할 수 있는 것 |
|---|---|
| Phase 0 | 페이지가 뜬다 |
| Phase 1 | 아무것도 (개발자만 ok) |
| **Phase 2** | **PDF 페이지 재배치/삭제/병합 (3/5 MVP)** |
| Phase 3 | 페이지 위 텍스트를 *볼 수* 있다 |
| **Phase 4** | **5/5 MVP 완료 (영어)** |
| Phase 5 | 한국어 PDF 편집 |
| Phase 6 | 운영 출시 |

→ Phase 2 종료 시점이 **첫 사용자 데모 가능**한 분기점. 그 시점에 hr_blog2.0의 friendly 사용자에게 알파 공개 검토.

## 일정 가정

위 시간은 *집중 작업 기준 1인 풀타임 동등*. 파트타임이면 1.5~2배. 큰 미지수는:
- **Phase 1 후반의 호환성 디버깅** (야생 PDF의 변종)
- **Phase 4의 폰트 처리** (특히 임베디드 변형 폰트)
- **Phase 5의 CMap 임베디드 케이스**

각 phase 종료 시 *명시적 회고*를 두고 다음 phase 진입 전에 plan을 갱신.

## 의존성

| 외부 의존성 | 어디 | 이유 |
|---|---|---|
| `next` | UI + API | 합의 |
| `react`, `react-dom` | UI | |
| `tailwindcss` | UI | |
| `typescript` | 전체 | |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | API | MinIO. PDF 라이브러리 아님. |
| (없음) | PDF parsing/serialization/rendering | **금지** |

테스트:
- `vitest` (또는 `bun:test`).
- 코퍼스 PDF는 라이선스 명확한 것만, 또는 자체 생성.

빌드 도구:
- Next.js의 SWC.

## CI 게이트 (각 phase 도입 시)

1. `pnpm lint` (ESLint).
2. `pnpm typecheck` (TS strict).
3. `pnpm test` (vitest, ≥ 80% line coverage on `src/pdf/`).
4. `pnpm build` (Next.js 빌드).
5. corpus smoke test (몇 개 PDF로 open + serialize round-trip).

## 첫 구현 진입

이 문서가 합의되면 다음 작업 순서:

1. Phase 0 모두 (셋업).
2. **`tokenizer.ts` 부터** — 가장 작고 분리된 모듈로 *작은 PR*에서 검증.

> "Make it work, make it right, make it fast" — Edit2me는 1단계가 매우 길다. *조급한 최적화 금지*.
