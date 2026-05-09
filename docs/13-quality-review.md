# 13. v0 Quality Review & 고도화 계획

> v0 (commits up through `813fcda`)를 실 사용자가 한국어 PDF로 시도한 결과, 텍스트 인코딩 깨짐·UI 질감 미흡·로딩 지연이 보고됐다. 본 문서는 모든 결함을 분류해 기록하고, 어느 시점에 어떤 방식으로 고치는지를 명확히 한다.

## 0. 사용자 보고 한 줄

| # | 증상 | 카테고리 |
|---|---|---|
| U1 | 한국어 PDF 텍스트가 `���` 또는 `OFSUQJUB` 같은 의미 없는 ASCII로 표시 | PDF 엔진 |
| U2 | 페이지마다 "텍스트 로드 중..." 이 길게 떠 있음 | 성능 |
| U3 | "흑/백 너무 이상한 디자인" — 시각적 완성도 낮음 | UI/UX |

세 가지 모두 *치명적*. 이번 패치(v0.1)에서 모두 해결한다.

## 1. 결함 카탈로그

### A. PDF 엔진 (Backend)

| ID | 심각도 | 파일 | 결함 |
|---|---|---|---|
| **A1** | **P0** | [`fonts/font-info.ts`](../frontend/src/pdf/fonts/font-info.ts) `toUnicode()` | Type0(composite) 폰트의 CID에 대해 `code >= 0x20 && code <= 0x7e` 분기로 ASCII 문자를 fallback 반환. 한글 PDF의 CID가 우연히 ASCII 범위면 잘못된 영문이 표시됨(`OFSUQJUB`). |
| **A2** | **P0** | [`fonts/cmap.ts`](../frontend/src/pdf/fonts/cmap.ts) `simpleTokenize` / `hexStrToString` | 1) hex 문자열에 *공백 포함* 시 (예: `<0041 0042>`) 두 번째 글자를 잃음. 2) `usecmap` 디렉티브로 부모 CMap 상속 처리 안 함. 3) 일부 형태 (`beginnotdefchar`, `usefont`)를 무시하지만 토크나이저가 그 안의 hex를 건드릴 수 있음. |
| **A3** | **P0** | [`fonts/font-info.ts`](../frontend/src/pdf/fonts/font-info.ts) Type0 `decodeBytes` | 모든 composite 폰트를 *2바이트 고정* 으로 가정. 가변 길이 CMap (1/2/4 byte) 미지원. 우연히 페이지 콘텐츠 바이트 수가 홀수면 마지막 바이트 누락. |
| **A4** | **P0** | [`fonts/font-info.ts`](../frontend/src/pdf/fonts/font-info.ts) | 표준 Adobe CJK CMap (`UniKS-UCS2-H`, `Adobe-Korea1-UCS2`, JP/CN 등) 미번들. ToUnicode가 없는 PDF는 디코드 불가능. |
| **A5** | **P1** | [`parser/document.ts`](../frontend/src/pdf/parser/document.ts) | `pageContent()`가 매 호출마다 stream을 다시 디코드. 같은 페이지에 대해 text-extract / thumb / edit이 동시에 호출되면 zlib decode 3회. |
| **A6** | **P1** | [`graphics/text-extract.ts`](../frontend/src/pdf/graphics/text-extract.ts) | 결과를 캐싱하지 않음. 매 API 호출마다 파싱 + 그래픽 머신 재실행. |
| **A7** | **P2** | [`graphics/content-stream.ts`](../frontend/src/pdf/graphics/content-stream.ts) | `parseContent` 가 토크나이저를 그대로 재사용해 매 토큰마다 객체 할당. 큰 콘텐츠 스트림에서 GC 압력. |
| **A8** | **P2** | [`fonts/font-info.ts`](../frontend/src/pdf/fonts/font-info.ts) `parseCIDWidths` | width 못 찾으면 default를 반환하지만 vertical writing mode 무시. 한자 vertical PDF에서 위치 오차. |
| **A9** | **P2** | [`ops/edit-text.ts`](../frontend/src/pdf/ops/edit-text.ts) | TJ 연산자에서 advance 보정 안 함 → 편집 후 옆 텍스트 위치 어긋남. 알려진 트레이드오프이지만 v0.2에서 보정. |
| **A10** | **P2** | [`graphics/text-extract.ts`](../frontend/src/pdf/graphics/text-extract.ts) | `Tz` (horizontal scaling) 무시. 일부 문서에서 폰트 폭 오차. |
| **A11** | **P3** | 전체 | 진단(`diagnostics`)이 잘못된 PDF를 만났을 때만 채워짐. *정상* 처리 결과 (예: ToUnicode 부재) 도 진단으로 노출하면 UI에서 "이 폰트는 편집 불가" 표시 가능. |

### B. UI / UX

| ID | 심각도 | 파일 | 결함 |
|---|---|---|---|
| **B1** | **P0** | [`app/globals.css`](../frontend/src/app/globals.css) | 다크모드를 시스템 자동 감지로만 두고 라이트 토큰 위에 덮어쓰는데, paper 색이 어색함. light/dark 양쪽 디자인이 미완성. |
| **B2** | **P0** | [`components/editor/PageView.tsx`](../frontend/src/components/editor/PageView.tsx) | 텍스트 미수신 시 큰 박스 안에 작은 회색 텍스트 "텍스트 로드 중..." 만 — 스켈레톤 부재. |
| **B3** | **P0** | [`components/editor/Sidebar.tsx`](../frontend/src/components/editor/Sidebar.tsx) | 110px 폭은 페이지 카드 식별성 너무 낮음. 활성/선택/드래그 시각 피드백 약함. 스크롤바 시각 노이즈. |
| **B4** | **P0** | [`app/page.tsx`](../frontend/src/app/page.tsx) | 랜딩이 빈곤함. 드롭존 외 가치 전달 컴포넌트 없음. |
| **B5** | **P0** | 전체 | 에러 표시는 빨간 텍스트 한 줄. Toast/배너 시스템 부재. |
| **B6** | **P0** | [`components/editor/PageView.tsx`](../frontend/src/components/editor/PageView.tsx) | 페이지마다 *개별 fetch* — 24페이지면 24 round-trip. 스켈레톤도 없어서 모든 페이지가 동시에 "로드 중" 메시지로 가득. |
| **B7** | **P1** | [`app/e/[docId]/page.tsx`](../frontend/src/app/e/[docId]/page.tsx) | 활성 페이지 전후 1개 (`isNear`) 만 렌더 — 사용자가 빠르게 스크롤하면 빈 placeholder만 보임. 가상화/intersection observer 필요. |
| **B8** | **P1** | [`components/editor/Toolbar.tsx`](../frontend/src/components/editor/Toolbar.tsx) | 버튼 그룹 분리 없음. 단축키 힌트 없음. modified 상태 표시 약함. |
| **B9** | **P1** | [`components/editor/PageView.tsx`](../frontend/src/components/editor/PageView.tsx) | 텍스트 블록의 폰트 매핑이 단순. CJK 폰트 표시는 OS sans-serif에 떨어지는데 가독성 차이가 큼. |
| **B10** | **P1** | [`app/m/page.tsx`](../frontend/src/app/m/page.tsx) | 병합 모드 좌측 패널이 너무 좁고 결과 시퀀스 빈 상태가 friendly 하지 않음. |
| **B11** | **P2** | 전체 | 키보드 단축키 표시 없음 (UX 발견 어려움). |
| **B12** | **P2** | 전체 | 진단(diagnostics) UI 표시 안 함. 사용자가 왜 편집이 막혔는지 모름. |
| **B13** | **P2** | 전체 | 모바일 반응형 미흡. |

### C. 성능

| ID | 심각도 | 파일 | 결함 |
|---|---|---|---|
| **C1** | **P0** | [`lib/doc-cache.ts`](../frontend/src/lib/doc-cache.ts) | 추출된 텍스트를 *전혀 캐시하지 않음*. 매 페이지 fetch가 파서를 처음부터 돌림. |
| **C2** | **P0** | [`lib/api.ts`](../frontend/src/lib/api.ts) | 텍스트 fetch가 페이지마다 *순차*가 아닌 *각자 비동기*긴 하지만, 24개를 동시에 띄우면 로컬 Node 단일 스레드에서 직렬 처리되어 결국 마지막 페이지가 매우 늦게 응답. |
| **C3** | **P1** | [`app/api/documents/[docId]/pages/[idx]/text/route.ts`](../frontend/src/app/api/documents/[docId]/pages/[idx]/text/route.ts) | 단일 페이지 endpoint뿐. 다중 페이지 batch endpoint 부재. |
| **C4** | **P1** | [`app/api/documents/[docId]/pages/[idx]/thumb/route.ts`](../frontend/src/app/api/documents/[docId]/pages/[idx]/thumb/route.ts) | 썸네일도 캐시 안 됨 (HTTP `Cache-Control: max-age=600` 만). 서버 메모리에 캐시하면 더 빠름. |
| **C5** | **P2** | [`pdf/ops/apply.ts`](../frontend/src/pdf/ops/apply.ts) | op 적용 후 클라이언트가 doc 메타를 *전체 재요청*. surgical update 가능. |
| **C6** | **P2** | [`pdf/parser/document.ts`](../frontend/src/pdf/parser/document.ts) `getObject` | LRU 없는 `Map` cache. 큰 PDF에서 메모리 무제한 증가 가능. |

### D. 기능 누락

| ID | 심각도 | 결함 |
|---|---|---|
| **D1** | **P1** | Undo/Redo API endpoint 미구현 (route 디렉토리는 있지만 빈 상태). |
| **D2** | **P1** | 문서 상단 진단 배너 미표시 (e.g., "이 PDF의 폰트가 ToUnicode를 누락했습니다 — 텍스트 편집은 비활성화됩니다"). |
| **D3** | **P2** | 사용자 TTF 업로드 (한국어 텍스트 *추가*) 미구현. v1 로드맵 Phase 5. |
| **D4** | **P2** | 페이지 회전 후 텍스트 추가 UI 좌표 보정 없음. |

### E. 코드 품질

| ID | 결함 |
|---|---|
| **E1** | `as` 타입 단언 다수. validation 후 narrow 하는 게 안전. |
| **E2** | 서비스 워커/메모이즈 패턴 부재 — 클라이언트 측 fetch 결과 SWR 같은 레이어 없음. |
| **E3** | 테스트 코퍼스/유닛 테스트 없음. v0가 단순 빌드 성공만 보장. |

## 2. 우선순위 결정

이번 패치에서 **반드시** 처리:
- **A1** (Type0 ASCII fallback 버그) → 한국어 글자가 가짜 영문으로 보이는 정확한 원인
- **A2** (CMap 파서 버그)
- **A3** (가변 byte length 지원, 적어도 Identity-H 안전)
- **A6/C1** (text 추출 결과 캐시)
- **B1** (theme) / **B2-B5** (UX 폴리시) — 시각적 완성도
- **B6/C2/C3** (batch text endpoint)
- **D2** (진단 배너)

다음 패치(v0.2)로 미룸:
- **A4** (Adobe-Korea1 등 표준 CMap 번들 — 데이터가 ~500KB+)
- **A9/A10** (TJ advance 보정, Tz 처리)
- **B7** (가상화) — Intersection Observer 도입
- **D1/D3** (Undo/Redo, TTF 업로드)
- **E3** (테스트 도입)

## 3. 이번 패치 (v0.1) 변경 요약

### 3.1 PDF 엔진

```
pdf/
├── fonts/
│   ├── font-info.ts        ← Type0 ASCII fallback 버그 제거,
│   │                         가변 byte length 처리,
│   │                         디코드 실패 시 명시적 diagnostic
│   └── cmap.ts             ← 토크나이저 보강, hex 공백 처리,
│                             usecmap 인식 (parent 미지원이지만 무시 안 함),
│                             beginnotdefrange/notdefchar 인식 (skip)
└── ops/
    └── (변경 없음)
```

### 3.2 Backend

```
lib/doc-cache.ts            ← DocEntry 에 textCache: Map<pageIndex, runs>,
                              revision 갱신 시 무효화

app/api/documents/[docId]/
├── pages/text/route.ts     ← NEW — batch endpoint (?pages=0,1,2 또는 all)
└── pages/[idx]/text/route.ts (기존 유지, 내부적으로 cache 사용)
```

### 3.3 UI 전면 재설계

```
app/
├── globals.css             ← 새 theme: 라이트 우선 + 정제된 다크
├── layout.tsx              ← Inter / system-ui 정리, color-scheme 메타
├── page.tsx                ← 새 랜딩 (히어로 + drop zone + 기능 카드 + 안내)
├── e/[docId]/page.tsx      ← orchestration 정돈, batch fetch 도입
└── m/page.tsx              ← 병합 페이지 폴리시

components/
├── ui/
│   ├── Toast.tsx           ← NEW (자동 dismiss)
│   ├── Skeleton.tsx        ← NEW (shimmer)
│   ├── IconButton.tsx      ← NEW
│   └── Banner.tsx          ← NEW (진단 표시)
├── editor/
│   ├── Toolbar.tsx         ← 그룹화, 단축키 칩
│   ├── Sidebar.tsx         ← 폭 ↑, 카드 시각화 ↑, 드래그 인디케이터
│   ├── PageView.tsx        ← skeleton, batch text, 회전 좌표 정렬
│   └── AddTextDialog.tsx   ← 시각 폴리시
└── upload/
    └── DropZone.tsx        ← 분리, 더 큰 영역, 진행 표시
```

### 3.4 진단 표시

페이지 또는 문서 레벨 diagnostic을 UI 배너로 노출:
- 정보: "스캔 PDF — 텍스트 편집 미지원" / "이 페이지에 회전된 텍스트 있음"
- 경고: "복구 모드로 열림" / "ToUnicode 매핑 부재 — 일부 폰트 편집 비활성화"
- 에러: "암호화 PDF" 등은 업로드 단계에서 차단되므로 여기 안 옴

## 4. 측정 / 회귀 방지

본 패치 후 *수동 회귀 테스트*:

| 시나리오 | 기대 동작 |
|---|---|
| ASCII 영문 PDF (1페이지) | 텍스트가 *정확한* 영문으로 추출. 인라인 편집 동작. |
| ASCII 영문 PDF (24페이지) | 첫 화면이 1초 안에 텍스트 모두 표시 (batch endpoint + cache). |
| 한국어 PDF + ToUnicode 정상 | 한국어 텍스트가 한국어로 표시. 편집은 readonly (Type0 편집은 v0.2). |
| 한국어 PDF + ToUnicode 결손 | 텍스트가 *공란*(✓) 으로 표시 + 페이지 상단 진단 배너 ("ToUnicode 매핑 부재 — 본 페이지의 텍스트는 표시/편집 불가입니다"). 가짜 영문(`OFSUQJUB`) 더 이상 안 나옴. |
| 페이지 삭제/재배치/병합 | 기능 영향 없음 (이번 패치는 텍스트 경로만 건드림). |

자동 테스트는 v0.2에서 도입.

## 5. 다음 두 사이클 plan (v0.2, v0.3)

### v0.2 — 한국어 PDF 1급 지원
- Adobe-Korea1-UCS2 CMap 번들 (압축 후 ~150KB)
- usecmap 부모 체인 따라가기
- Identity-H + ToUnicode 결손 PDF에 대해 폰트 BaseFont 이름과 CIDSystemInfo로 자동 매칭
- TJ advance 보정 (편집 후 위치 안정화)
- Korean 폰트로 텍스트 *추가* (사용자 업로드 TTF subset embedding)

### v0.3 — 운영 견고성
- Undo/Redo
- 진단 패널 UI
- 페이지 가상화 (큰 PDF 빠른 스크롤)
- 단위 테스트 + 코퍼스 자동 회귀
- 다국어 (en/ko)
