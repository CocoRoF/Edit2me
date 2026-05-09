# 11. Testing Strategy

## 1. 테스트 레이어

| 레이어 | 도구 | 위치 | 무엇을 본다 |
|---|---|---|---|
| **단위 (parser)** | vitest | `tests/unit/parser/` | tokenizer, lexer, xref, stream filter — *바이트 in / 객체 out*. |
| **단위 (writer)** | vitest | `tests/unit/writer/` | 객체 in / 바이트 out. round-trip. |
| **단위 (ops)** | vitest | `tests/unit/ops/` | 합성 PdfDocument에 op 적용 → 결과 검증. |
| **통합 (engine)** | vitest | `tests/integration/` | 실제 PDF 파일 in → op 체인 → 직렬화 → re-open → 검증. |
| **API contract** | vitest + supertest | `tests/api/` | route handler 입출력. |
| **E2E (UI)** | playwright | `tests/e2e/` | 브라우저로 풀 흐름 (업로드, 편집, 다운로드). |
| **호환성 회귀** | shell + vitest | `tests/compat/` | 출력 PDF를 다른 도구(qpdf, mutool, pdfinfo)로 재검증. |

## 2. 테스트 코퍼스 <a id="perf"></a>

### 2.1 카테고리 (50+ 파일)

| 카테고리 | 수 | 출처 |
|---|---|---|
| 단순 텍스트 (코어14만) | 5 | 자체 생성 |
| 다중 페이지 영문 | 5 | 공개 도메인 (Project Gutenberg PDF 등) |
| 임베디드 TrueType | 5 | 자체 생성 (LaTeX, Word) |
| CJK (한국어) | 5 | 자체 생성 (HWP→PDF, 관공서 공개) |
| CJK (일본어/중국어) | 4 | 위키북스 공개 |
| Xref stream + Object stream | 3 | LibreOffice 출력 |
| 압축 다단 (`/Filter [...]`) | 2 | 수동 작성 |
| 이미지 위주 (스캔) | 3 | 공개 데이터셋 |
| 양식(AcroForm) | 2 | 정부 양식 |
| 디지털 서명 | 2 | self-signed로 생성 |
| 손상/관용 처리 필요 | 5 | 의도적 손상 후 |
| 큰 파일 (50–200 MB) | 2 | 합성 |
| 회전/혼합 회전 | 2 | 자체 생성 |
| 암호화 | 2 | 우리는 *거부*해야 함 |

### 2.2 저장
큰 파일은 *git에 안 넣음* (`.gitignore`로 `tests/corpus/`). 대신:
- `tests/corpus/MANIFEST.json`에 SHA256 + 출처 + 라이선스 + 다운로드 URL.
- `tests/corpus/fetch.sh`가 manifest를 보고 받아옴.
- 작은 자체 생성 PDF (≤50KB)는 `tests/corpus/small/`에 git으로 포함.

### 2.3 라이선스
모든 코퍼스 PDF는 다음 중 하나:
- 자체 생성 (Edit2me 라이선스).
- 공개 도메인 / CC0.
- CC-BY (출처 표기).

## 3. 단위 테스트 패턴

### Tokenizer
```ts
test('handles all newline forms', () => {
  expect([...tokenize(b('1\r2\n3\r\n4'))]).toMatchSnapshot();
});

test('escaped paren in literal string', () => {
  const [tok] = [...tokenize(b('(hi \\(nest\\) ok)'))];
  expect(decodeLiteralString(tok)).toEqual('hi (nest) ok');
});
```

property-based: 임의 토큰 → 직렬화 → tokenize → 같은 결과.

### Xref
- `0 65535 f` 시작 보장.
- 다중 subsection.
- xref-stream의 `/W [1 4 2]` 폭 변형.

### Stream filter
- FlateDecode + PNG predictor:
  - 알려진 입력의 디코드 결과를 fixture로.
  - `(zlib-encoded with predictor)` ↔ `(decoded)` round-trip.

### Page operations
헬퍼 `mkDoc({ pages: [{w:612,h:792}, ...] })` 로 합성 doc → op 적용 → assert.

## 4. Round-trip 테스트

이게 PDF 엔진 테스트의 *가장 가치 있는 패턴*:

```ts
for (const file of corpus) {
  const original = readFile(file);
  const doc = await PdfDocument.open(original);
  const out = await serialize(doc, { mode: 'incremental' });
  const reopened = await PdfDocument.open(out);

  // 1) 페이지 수 동일
  expect(reopened.getPages().length).toBe(doc.getPages().length);

  // 2) 모든 페이지의 MediaBox 동일
  ...

  // 3) 텍스트 추출 결과 동일 (편집 안 했으니)
  ...
}
```

## 5. 호환성 회귀

CI에서 컨테이너로 *외부 도구*를 띄워 우리 출력의 정상성을 확인:
- `qpdf --check out.pdf` — exit code 0.
- `mutool show out.pdf trailer` — trailer 읽힘.
- `pdfinfo out.pdf` — 페이지 수 일치.
- (옵션) headless Chrome 으로 PDF 열어 페이지 수 확인.

이는 외부 *런타임 의존*이 아니라 *테스트 시 검증*에만 사용 — ADR-0001과 충돌 없음.

## 6. 시각적 회귀 (Phase 2 이후)

자체 raster renderer 등장 후:
- 코퍼스의 *각 페이지*를 raster로 그려 PNG 저장.
- ground truth PNG (poppler / Acrobat의 출력)와 픽셀 diff.
- 임계치 이내면 통과. 큰 차이는 시각적 회귀로 표시.

ground truth는 *테스트 환경에서만* 생성. 런타임 의존 없음.

## 7. 퍼징 (Phase 1 종료 시점)

- 무작위 PDF byte 변형 → 파서가 *crash 없이* 정상 거부 또는 복구.
- `tests/fuzz/parser.fuzz.ts` — 1만 회.
- 발견된 crash는 unit test로 환원.

## 8. 성능 회귀

벤치 코퍼스: small/medium/large/xlarge.

```ts
bench('open 50-page 5MB', () => PdfDocument.open(fixtureMedium));
bench('serialize incremental no-op', ...);
bench('text extract 50 pages', ...);
```

CI에 트렌드 기록 (`benchmark.json` 시계열). Phase 별 SLA:

| 작업 | small | medium | large |
|---|---|---|---|
| open | < 50 ms | < 300 ms | < 1.5 s |
| getPages | < 5 ms | < 30 ms | < 100 ms |
| extract text/page | < 5 ms | < 15 ms | < 30 ms |
| serialize incremental | < 50 ms | < 300 ms | < 1 s |

## 9. E2E (Playwright)

핵심 시나리오:
1. 업로드 → 1페이지 텍스트 편집 → 다운로드 → 다운로드된 파일 byte 검증.
2. 업로드 → 페이지 3개 삭제 → 다운로드 → 페이지 수 검증.
3. 두 PDF 업로드 → 병합 → 다운로드.
4. 한국어 PDF 업로드 → 텍스트 표시 → 한 단어 수정 → 다운로드.
5. 잘못된 파일 업로드 → 친화적 에러.

CI는 Chromium + Firefox.

## 10. 결정론

직렬화 결정론 테스트:
```ts
const a = await serialize(doc, opts);
const b = await serialize(doc, opts);
// /ID 와 /ModDate 만 다르고 그 외 byte 동일
expect(stripVolatile(a)).toEqual(stripVolatile(b));
```

이는 큰 회귀 방어막이다.

## 11. 손상 PDF에 대한 정책

코퍼스의 손상 카테고리에는 *각 케이스의 기대 동작*을 fixture로 적어둔다:
```jsonc
// tests/corpus/manifest.json (excerpt)
{
  "broken-xref-offset.pdf": {
    "expected": "open-success",
    "diagnostic": ["xref-offset-fixed"]
  },
  "broken-eof.pdf": {
    "expected": "open-success-recovery",
    "diagnostic": ["recovery-mode"]
  },
  "encrypted.pdf": {
    "expected": "reject-encrypted"
  }
}
```

## 12. 보안 테스트

- 임의 *작은 페이로드*가 메모리 폭주 시키지 않음 (예: `/Length 9999999999`).
- xref 사이클 (자기 참조) → 무한 루프 안 함.
- 깊은 dict/array nesting (10K) → 스택 오버플로우 안 함 (반복 파싱).
- `/JavaScript` 액션 검출 시 strip 또는 reject.

## 13. 커버리지 목표

| 모듈 | line | branch |
|---|---|---|
| `src/pdf/core/` | ≥ 95% | ≥ 90% |
| `src/pdf/parser/` | ≥ 90% | ≥ 80% |
| `src/pdf/writer/` | ≥ 90% | ≥ 80% |
| `src/pdf/ops/` | ≥ 90% | ≥ 80% |
| `src/pdf/graphics/` | ≥ 85% | ≥ 75% |
| `src/pdf/fonts/` | ≥ 80% | ≥ 70% |
| `app/api/` | ≥ 80% | ≥ 70% |
| `components/` | ≥ 60% | n/a |

미만이면 PR 머지 막힘 (CI gate).
