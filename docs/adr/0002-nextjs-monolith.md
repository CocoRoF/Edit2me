# ADR 0002 — Next.js 모놀리스 (별도 백엔드 없음)

- **Status**: Accepted
- **Date**: 2026-05-09

## Context

hr_blog2.0은 FastAPI 백엔드 + Next.js 프론트엔드의 분리 구조다. Edit2me도 같은 패턴을 따를 수 있다 (예: Python으로 PDF 엔진).

대안:
1. **FastAPI 백엔드 + Next.js 프론트엔드** — hr_blog2.0과 동형.
2. **Next.js 단독** — API Route Handlers에 엔진을 넣는다.
3. **Rust/Go 백엔드** — 성능, 그러나 인프라 다양화.

## Decision

**Option 2 (Next.js 단독)** 를 선택.

## Why

- **언어 일관성**: 클라이언트와 서버를 한 코드베이스 한 언어(TypeScript)로. 타입을 양쪽이 공유 — `Op` 타입 하나가 클라이언트 큐와 서버 적용 양쪽에 사용된다.
- **PDF 엔진 위치 자유**: 같은 TypeScript 모듈을 서버 사이드(API 라우트)와, 미래에 *클라이언트 사이드*(Web Worker)에서도 재활용 가능.
- **인프라 단순**: 컨테이너 1개 추가. backend↔frontend 사이의 SSE/WebSocket이 우리에게 불필요.
- **개발 속도**: 라우트 추가가 파일 추가. FastAPI보다 빠른 iteration.

## Consequences

부정 (수용):
- Node.js 런타임에서 PDF 파싱 — Python/C++보다 느릴 수 있다. *측정해보고* 필요하면 worker thread 분리 또는 향후 Rust로 binary 모듈화.
- 큰 파일 업로드 시 Next.js의 multipart 처리 한계 — `request.formData()` 스트리밍 사용.
- `app/api/...` 의 cold-start: 컨테이너 1개 SSR 모드로 항상 떠있음 → 영향 없음.

긍정:
- 외부 의존이 더 적음.
- 디버깅 단순.

## 미래에 분리하는 트리거

다음 중 하나라면 별도 백엔드 분리 ADR을 작성:
- Phase 1~4 측정 결과 페이지 파싱이 사용자 P95 latency를 망친다.
- 다른 도구(예: 자체 raster renderer)가 native 라이브러리 (Rust)에 적합한 영역으로 자라난다.
- hr_blog2.0과 인증/세션 통합이 백엔드 레벨에서 더 깔끔하다.
