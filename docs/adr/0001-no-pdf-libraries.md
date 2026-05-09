# ADR 0001 — No external PDF libraries

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: 프로젝트 오너

## Context

기존 PDF 편집 도구는 `pdf-lib`, `pdf.js`, `mupdf`, `poppler` 등 성숙한 라이브러리에 의존한다. 이는 빠른 출시와 신뢰성을 보장하지만:

- 동작이 *블랙박스*. 한국어 폰트 처리 등 엣지에서 우리가 통제하기 어렵다.
- 라이센스/번들 사이즈 / API 변화에 종속된다.
- 학습/소유의 가치가 작다.

프로젝트 오너의 강한 요청: **"절대 다른 라이브러리 쓰지 말고 직접 OLE 레벨에서 파싱"**.

## Decision

**PDF의 파싱·직렬화·페이지 조작·렌더링에 전용 외부 라이브러리를 쓰지 않는다.**

허용:
- Node 표준 모듈 (`zlib`, `crypto`, `fs`, `stream`).
- 브라우저 표준 API (`CompressionStream`, `TextEncoder`, `Canvas` API).
- AWS SDK (MinIO 통신용) — PDF 라이브러리가 아님.
- Next.js / React / Tailwind 등 *PDF와 무관한* UI 프레임워크.

금지 (예시, 비망):
- `pdf.js`, `pdf-lib`, `jsPDF`, `pdfkit`, `mupdf-js`, `hummus-recipe`, `pdf-parse`, `pdf2json`.
- 압축 외 PDF 전용 디코더 (`tiff-js`의 CCITT, `jbig2-image-decoder` 등). 우리가 직접 구현.
- PDF 폰트 파서 (`opentype.js`, `fontkit` 등). 우리가 직접.
- 글리프 라스터화 (`canvg` 등 — 그래픽 일반 라이브러리이지만 폰트 렌더와 겹치면 회색 영역).

## Why

- **명세 이해 깊이**가 사용자 가치다. 한국어 폰트가 잘못 보이는 PDF를 만났을 때, 우리가 *어떻게 잘못됐는지*를 정확히 진단할 수 있어야 한다.
- 라이브러리에 의존했다면 부수기 어려운 *상호의존*이 쌓인다. 자체 엔진은 진화 가능.
- 본 프로젝트는 학습/소유 가치가 사용자 시간보다 우선한다 (오너 결정).

## Consequences

긍정:
- 의존성이 적다. 보안 패치 부담 적음.
- 코드의 모든 줄이 "왜 그런지" 설명 가능.
- 기능 확장 시 라이브러리 한계가 없음.

부정 (수용):
- **시간**: 정직하게 수개월 더 걸린다. → [`10-roadmap.md`](../10-roadmap.md) 의 phase로 분산.
- **렌더링 갭**: Phase 1에서 페이지를 시각적으로 못 보여줌. → [`05-renderer.md`](../05-renderer.md) 의 텍스트 오버레이 전략.
- **폰트**: 임베디드 폰트의 글리프 라스터화 비용 큼. → 사용자에게는 OS 폰트로 근사 표시.
- **CCITT/JBIG2/JPEG2000 같은 고급 필터** 직접 구현 보류. 만나면 거부.

## Escape hatches

다음 경우에는 *별도 ADR*을 통해 예외 가능:
- 자체 raster renderer 작성이 운영상 비현실적이고, 사용자 가치가 시각 미리보기를 강하게 요구할 때 — *Ghostscript* 같은 OS 프로그램의 *오프라인 raster 전용* 사용 검토 가능 (라이브러리가 아닌 외부 프로그램이라는 해석).
- CCITT/JBIG2 인코딩의 이미지가 빈번해 사용자 가치가 큰데 자체 구현 불가능할 때 — 표준 zlib만 허용 정책을 *이미지 디코드 한정* 완화 검토.

→ 현재까지 모든 escape hatch는 **닫혀 있음**.

## Notes on "OLE 레벨"

오너의 표현은 *PDF의 객체(object) 레벨 직접 파싱*을 가리킨다 (마이크로소프트의 OLE Compound Document와는 무관). 우리는 PDF 의 `N G obj ... endobj`, xref, trailer를 헤더부터 읽는다.
