# 12. Risks & Open Questions

## 가장 큰 리스크 5개

### R1. 폰트 처리 복잡도 (편집 시) — **High**

**문제**: PDF 텍스트 편집은 폰트의 `/Encoding`, `/Widths`, `/ToUnicode`가 모두 정확히 맞물려야 깨지지 않는다. 임베디드 *서브셋* 폰트는 문서가 사용하는 글리프만 들어있어, 새 글자를 추가하면 글리프 부재.

**완화**:
- v1: *기존 텍스트 편집은 같은 폰트의 글리프 집합 안에서만* 자유. 그 밖 글자는 자동으로 코어14 fallback.
- 사용자 TTF 1종 옵션으로 한국어 등 새 글자 추가.
- 진단 정보로 "이 블록은 글리프 부족으로 편집 제한" 표시.

**남은 리스크**: 사용자가 "이 단어를 다른 단어로 바꾸려는데 어떤 글자가 안 되는지 사전 안 보여서 불편" — UX로 풀 것.

### R2. 자체 렌더러 부재로 인한 시각 갭 — **High**

**문제**: Phase 1에서 페이지 도형/이미지를 *못 보여준다*. 사용자는 "내 PDF가 잘 들어왔는지" 확인 못 한다.

**완화**:
- 텍스트 오버레이만으로도 페이지 식별성을 높이기 (블록의 위치/크기를 페이지 비율 안에서 정확히 표시).
- "다운로드한 결과로 검증" 흐름을 첫 화면 튜토리얼에서 강조.
- `<embed type="application/pdf">`로 *원본*을 사이드바 미리보기로 보여주는 progressive enhancement (편집 대상 ≠ 표시 대상).

**남은 리스크**: 일부 사용자는 못 견디고 떠난다. → Phase 2 raster renderer 일정을 앞당겨야 할 수도.

### R3. 비표준 PDF 호환성 — **Medium**

**문제**: 야생 PDF는 명세를 다양하게 위반한다. 우리가 다루지 않은 변종을 만나 파싱 실패 가능.

**완화**:
- 코퍼스에 손상 카테고리 미리 포함, 관용 처리 정책 명시 ([`03-parser.md#tolerance`](./03-parser.md#tolerance)).
- 진단 시스템으로 "복구 모드로 열림" 가시화.
- 운영 시 실패 PDF 익명 보고 (사용자 동의 시) → 코퍼스 보강 루프.

### R4. CJK CMap 임베디드 케이스 — **Medium**

**문제**: 한국어 PDF의 일부는 임베디드 CMap을 쓴다. mini-language 파서를 직접 짜야 함.

**완화**:
- Adobe 표준 CMap 정적 번들로 80% 케이스 커버 (대부분 한국어 PDF는 표준 CMap 사용).
- 임베디드 CMap 파서를 Phase 5로 분리, 그때까지는 표준 CMap만 지원하고 다른 경우는 readonly 표시.

### R5. 일정 — **Medium**

**문제**: 본 프로젝트는 *야심 찬* 범위. 1인 풀타임 기준 14주. 파트타임이면 6개월+.

**완화**:
- Phase 2 종료 시점에 *부분 출시* 가능 (페이지 조작만 동작) → 일정 압박 분산.
- 텍스트 편집 (Phase 4)은 영어만 우선 → 한국어 (Phase 5)는 후속.
- "외부 라이브러리 금지" 원칙은 핵심 가치이므로 *시간 압박이 와도 우회하지 않는다* — 대신 범위를 줄인다.

## 보안 리스크 <a id="security"></a>

| 위협 | 완화 |
|---|---|
| 악성 PDF의 `/JavaScript` | 발견 시 strip 또는 reject. 클라이언트에 절대 임베드된 JS 노출 안 됨. |
| `/Launch` 액션 (다른 프로그램 실행) | strip. |
| 임베디드 파일 (`/EmbeddedFile`) | v1에서 strip 옵션 default. |
| zip-bomb 식 무한 stream | inflate 시 출력 크기 한도 (10x raw 또는 100MB). |
| xref 사이클 | 방문 set으로 차단. |
| 매우 깊은 nesting | 재귀 한도 (1000), 그 이상은 거부. |
| 업로드 가용성 공격 | nginx와 API 라우트 양쪽에서 200MB 제한. 레이트 리밋. |
| 내부 SSRF (예: `/URI` 액션) | 우리는 액션 trigger 안 함. 보존만. |
| MinIO presigned URL 누수 | 우리는 stream proxy로만 다운로드 → presigned 외부 노출 X. |
| XSS via 파일명 | 파일명 표시 시 sanitize. |
| 추출 텍스트의 XSS | React가 자동 escape. 단 contenteditable에서 paste 시 sanitize 추가. |

## 미해결 질문 (의사 결정 필요)

### Q1. 자체 raster renderer는 정말 짤 것인가?

OPTION A) 끝까지 외부 라이브러리 안 쓰고 짠다. 큰 작업, 가치 큼.
OPTION B) v2에서 *오프라인 raster용 외부 도구* (Ghostscript) 도입. 본 사용자 인용("절대 다른 라이브러리 쓰지 말고")과 충돌. 사용자 추가 동의 필요.

→ **현재 결정**: A. Phase 7에서 시작. Phase 6 종료 시점에 사용자가 OPTION B를 명시적으로 승인하면 재논의.

### Q2. 사용자 인증을 추가할 것인가? 언제?

1차 무인증 → 24h 휘발. 영구 보관/공유는 인증 필요.

→ Phase 6 이후 결정. hr_blog2.0이 이미 Claude Agent용 세션을 관리하므로 그 미들웨어 재사용 후보.

### Q3. PDF/A 출력 지원?

법적/아카이브 용도에 종종 요청됨. 출력 시 PDF/A 호환 보장.

→ MVP 범위 밖. 수요 검증 후.

### Q4. 모바일 편집을 어디까지 지원?

현재 결정: 데스크톱 우선, 모바일은 보기 + 페이지 조작. 텍스트 편집 모바일 UX는 별도 큰 작업.

→ Phase 6 이후. 사용 데이터 보고 결정.

### Q5. PDF 1.5 xref-stream 출력?

지원 *읽기* OK. *출력*은 classical로 다운그레이드 (호환성).

→ 결정됨. 변경하지 않음.

### Q6. 폰트 데이터 (Adobe CMap) 라이선스?

Adobe CMap Resources는 BSD-style. 우리 번들 OK.
코어14 메트릭은 PDF 1.7 명세 부속서 D에 있어 명세 출처로 OK.
하지만 *코어14의 실제 글리프 비트맵*은 우리가 안 그린다 (브라우저/OS에 위임).

→ Phase 5에서 라이선스 문서 작성.

### Q7. 사용자 업로드 TTF 라이선스 확인 책임?

우리는 기술적 제공자, 사용자가 책임 — 약관에 명시.

→ 약관 작성 시 반영.

## 확장 시나리오 시 변경되는 것들

| 사용자 트래픽 폭증 | 대응 |
|---|---|
| MinIO 공간 → S3 마이그레이션 (혹은 S3 동기). |
| 파싱 부하 → edit2me-frontend를 worker pool로. |
| nginx 단일 SPOF → load balancer 추가 (hr_blog2.0 인프라 결정에 따름). |

## 프로젝트가 막힌다면

각 phase 시작 시 *kill-criteria*를 명시:
- Phase 1이 8주 넘게 걸림 → 외부 라이브러리 도입 ADR 재검토.
- Phase 4 종료 시점에 텍스트 편집 호환성 < 60% → 범위 축소 (편집 = 같은 길이 글자만 등).
- Phase 5에서 CMap 임베디드 처리 너무 어려움 → 표준 CMap만 영구 지원.

## 알려진 *해결되지 않은* 명세 모호성

| 영역 | 우리 결정 |
|---|---|
| 두 번 정의된 객체의 우선순위 | xref가 결정 (가장 최근 offset). |
| `/Length`가 stream 본문보다 짧음 | 무시하고 `endstream` 검색. |
| `/Length`가 indirect ref + stream이 그 객체를 포함 | 명세 위반. 거부 + 진단. |
| 재귀적 페이지 트리 (cycle) | 검출 시 거부. |
| Type 3 폰트 | 텍스트 추출 best-effort, 편집 비활성. |

## 의존성 리스크

- `@aws-sdk/client-s3` 큰 패키지 — 단일 의존이지만 사이즈 큼. 대안: 직접 S3 signing (HMAC). v2 고려.
- Tailwind 4: alpha/beta 시기에 들어왔다면 마이너 버전에서 breaking 가능. hr_blog2.0과 동일 버전 lock.
- React 19 RSC: API 라우트와 server component를 섞으면 디버깅 까다로움. 우리는 server component 최소화 (편집 화면은 거의 client).
