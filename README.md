# Edit2me

브라우저에서 동작하는 PDF 온라인 편집기. PDF 파서/라이터를 외부 라이브러리 없이 **PDF 객체 레벨에서 직접 구현**하는 것을 핵심 원칙으로 한다.

> **상태**: 계획 단계. 코드는 아직 없음. 먼저 [docs/](./docs/)의 설계 문서를 모두 합의한 뒤 구현에 들어간다.

## 핵심 제약 (Non-negotiable)

- PDF 처리에 어떤 외부 라이브러리도 사용하지 않는다 — `pdf.js`, `pdf-lib`, `jsPDF`, `mupdf`, `pdfkit`, `poppler` 등 전부 금지.
- PDF 명세(ISO 32000-1)에 기반해 헤더/객체/스트림/xref/트레일러를 직접 파싱하고 직렬화한다.
- 압축 필터(`FlateDecode` 등)는 Node 표준 라이브러리(`zlib`)와 Web `CompressionStream`만 사용 — PDF 전용 라이브러리는 금지.
- 자세한 의사결정 근거는 [`docs/adr/0001-no-pdf-libraries.md`](./docs/adr/0001-no-pdf-libraries.md) 참고.

## MVP 기능 (반드시 포함)

1. **텍스트 편집** — 페이지에서 추출된 텍스트 조각을 인라인 편집 (`docs/06-features.md#1`)
2. **텍스트 추가** — 임의 위치에 새 텍스트 박스 삽입 (`#2`)
3. **페이지 순서 변경** — 드래그로 페이지 재배치 (`#3`)
4. **페이지 삭제** — 단일/다중 페이지 삭제 (`#4`)
5. **PDF 병합** — 여러 PDF에서 페이지를 골라 새 PDF로 합성 (`#5`)

## 아키텍처 한 눈에 보기

```
┌────────────────────────── Edit2me (별도 repo) ─────────────────────────┐
│                                                                       │
│  Next.js 15 (App Router, basePath=/edit2me)                           │
│  ├─ app/             ─ UI (React 19 + Tailwind 4)                     │
│  ├─ app/api/         ─ 서버 사이드 PDF 파싱/직렬화                    │
│  └─ src/pdf/         ─ 자체 PDF 엔진 (parser, writer, renderer, ops)  │
│                                                                       │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │ 동일 docker network
       ┌───────────────────────────┴───────────────────────────┐
       │              hr_blog2.0 (별도 repo, 호스트)            │
       │                                                       │
       │  nginx ─ /edit2me/* → edit2me-frontend:3000           │
       │       └ /uploads/*  → minio:9000                      │
       │  minio ─ 버킷 `pdf-edit` (Edit2me 전용)               │
       └───────────────────────────────────────────────────────┘
```

소스는 분리, 배포만 hr_blog2.0의 docker-compose에 service로 추가. 자세한 통합 방식은 [`docs/09-integration-hr-blog.md`](./docs/09-integration-hr-blog.md).

## 문서 구성

| # | 문서 | 내용 |
|---|---|---|
| 00 | [vision.md](./docs/00-vision.md) | 목표, 비목표, 성공 기준 |
| 01 | [architecture.md](./docs/01-architecture.md) | 컴포넌트, 데이터 흐름, 디렉토리 구조 |
| 02 | [pdf-format.md](./docs/02-pdf-format.md) | PDF 바이너리 포맷 핵심 정리 (구현 레퍼런스) |
| 03 | [parser.md](./docs/03-parser.md) | 토크나이저 → 객체 → 문서 트리 |
| 04 | [writer.md](./docs/04-writer.md) | 객체 직렬화, xref, incremental update |
| 05 | [renderer.md](./docs/05-renderer.md) | 페이지를 Canvas에 그리는 자체 렌더러 |
| 06 | [features.md](./docs/06-features.md) | 5개 MVP 기능의 사양과 알고리즘 |
| 07 | [ui-ux.md](./docs/07-ui-ux.md) | 화면 구성, 상호작용, 단축키 |
| 08 | [api-contract.md](./docs/08-api-contract.md) | Next.js Route Handler 계약 |
| 09 | [integration-hr-blog.md](./docs/09-integration-hr-blog.md) | nginx/docker-compose/MinIO 통합 |
| 10 | [roadmap.md](./docs/10-roadmap.md) | 단계별 마일스톤 |
| 11 | [testing.md](./docs/11-testing.md) | 테스트 전략과 코퍼스 |
| 12 | [risks.md](./docs/12-risks.md) | 리스크와 미해결 질문 |

ADR: [`docs/adr/`](./docs/adr/)

## 기술 스택 (확정)

- Next.js 15 (App Router) — UI + API Route Handlers
- React 19 + TypeScript + Tailwind CSS 4 (hr_blog2.0과 동일 스택)
- Node.js 20+ 런타임 (API 측 PDF 파싱)
- MinIO (S3 호환, hr_blog2.0 인스턴스 공유, 별도 버킷)

추가 의존성은 ADR을 통해서만 들어온다.

## 라이선스

미정 (private).
