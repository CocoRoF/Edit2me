# ADR 0004 — 자체 raster renderer 보류 (v0.4+ 사이클)

- **Status**: Accepted
- **Date**: 2026-05-10
- **Deciders**: 프로젝트 오너

## Context

[`docs/05-renderer.md`](../05-renderer.md) Phase 2~3 는 *자체 raster renderer* 를 명시한다. 외부 PDF 라이브러리 금지(ADR-0001) 원칙 하에, 페이지를 픽셀로 그리려면:

1. **그래픽 상태 머신** — text 외에 path/color/clip/transparency 까지 풀 구현
2. **path 라스터화** — 폐곡선 채우기 (스캔라인 + even-odd / nonzero rule), stroke (라인 두께/조인/캡)
3. **글리프 outline 라스터화** — TrueType `glyf` 테이블 (좌표 + on-curve/off-curve 플래그), 복합 글리프 합성, hinting (또는 무시), 안티알리아싱
4. **이미지 디코드** — DCT 는 브라우저 위임 가능, 그 외 raw + ColorSpace 변환
5. **색공간** — DeviceGray/RGB/CMYK, ICC profile (적어도 sRGB), Pattern, Shading
6. **PNG 인코더** — 결과 비트맵을 brower 표시 가능 형식으로

각 항목 자체가 별도의 작은 프로젝트다.

## Decision

**v0.3 사이클에서 자체 raster renderer를 *시작하지 않는다*.** 차후 사용자 피드백에 따라 별도 사이클로 진입.

대신 v0.3 까지의 *텍스트 오버레이* 표시 ([`05-renderer.md` Phase 1](../05-renderer.md)) 를 유지한다.

## Why

### 비용
- 가장 단순한 구현으로도 5,000~10,000 라인 신규 코드 + 다수의 작은 코퍼스 + 시각적 회귀 테스트 인프라
- 1인 풀타임 8~12 주 추정 (TrueType `glyf` 처리만으로도 2 주, 스캔라인 채우기 1 주, 색공간 1 주, 디버깅/엣지 2 주)
- 테스트 인프라 (시각적 비교) 도 같이 만들어야 함

### 사용자 가치
- 우리 사용자 시나리오(`docs/00-vision.md` Top 3)는 모두 **편집 후 결과 다운로드** 가 핵심. 시각 미리보기는 *편의*.
- 텍스트 오버레이로 "이 페이지에 어떤 텍스트가 있는지"는 이미 보임 — 사용자가 *어디를 편집하는지* 알기 충분.
- 도형/이미지는 다운로드한 결과물에서 100% 그대로 보존됨 (incremental update). 미리보기에서 안 보일 뿐.

### 위험
- 시각 충실도가 *부분적* 이면 (예: 텍스트는 잘 그리는데 이미지는 회색 박스) 오히려 사용자 혼란 증가. "이 영역이 누락됐나?" 같은 오해.
- 부분 구현이 "완성도 낮음" 인상을 줘 v0.3 까지의 견고한 기능까지 평가 절하될 수 있음.

### 대안
- **사용자가 명시적으로 "외부 OS 프로그램 사용 OK" 라고 동의** 하면 ghostscript / poppler 의 *프로그램* 사용 가능 (라이브러리가 아닌 별도 프로세스). 현재 ADR-0001 정신상 차단됨.
- **편집 후 다운로드한 결과를 브라우저 PDF 뷰어로 인라인 표시** (`<embed type="application/pdf">`) — 이미 가능. 별도 PR 없이 사용자가 다운로드 후 OS 뷰어로 확인.

## Consequences

긍정:
- v0.3 까지의 견고한 핵심을 손대지 않음
- 사용자 가치/비용 측정을 미리 할 수 있음 (raster 없이도 충분한지)

부정 (수용):
- "시각적으로 미리 보고 싶다" 는 사용자 요청이 들어오면 v0.4+ 에서 다룸

## Trigger for Re-opening

다음 중 하나가 발생하면 본 ADR 를 재논의:

1. *알파 사용자 피드백*에서 "도형/이미지가 안 보여서 어디를 편집하는지 모르겠다" 가 N=3 이상 보고됨
2. 사용자 시나리오에 *시각 비교 후 편집* (예: "이 도형 옆에 텍스트 추가") 이 추가됨
3. ghostscript/poppler 외부 프로그램 사용 옵션이 ADR 로 별도 승인됨

## 관련 문서

- ADR-0001 (no external PDF libraries) — 본 결정의 상위 제약
- [`docs/05-renderer.md`](../05-renderer.md) — 원래 phased plan
- [`docs/14-v0.2-changelog.md`](../14-v0.2-changelog.md), [`docs/15-v0.3-changelog.md`](../15-v0.3-changelog.md) — 실제 진행
