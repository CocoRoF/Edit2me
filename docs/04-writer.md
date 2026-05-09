# 04. Writer Design

`src/pdf/writer/` — `PdfDocument` (편집 적용된 상태) → 바이트 출력.

## 1. 두 가지 직렬화 전략

| 모드 | 동작 | 사용 케이스 |
|---|---|---|
| **Incremental update** (§7.5.6) | 원본 바이트 *그대로* + 끝에 변경분만 추가 | **기본**. round-trip 보존 최선. 디지털 서명·메타·리소스 무손실. |
| **Full rewrite** | 모든 객체를 새로 직렬화. 객체 번호도 재할당 가능. | 메타 영구 삭제, 파일 크기 최적화, 또는 파서가 원본을 충분히 신뢰하지 못할 때. |

→ Edit2me는 **incremental을 default**, full rewrite는 *명시 옵션* (`finalize?mode=optimize`).

이 결정이 핵심이다. 이유:
1. 우리 파서가 못 알아본 부분을 *건드리지 않는다* — 즉 미지원 기능에 의한 손상이 0.
2. 디지털 서명, 첨부, JavaScript(strip 안 했을 때) 등이 보존됨.
3. 출력 파일 크기는 더 크지만, 24h TTL이라 문제 없음.

## 2. Serializer (`writer/serializer.ts`)

객체 1개 → 바이트.

```ts
export function writeObject(obj: PdfObject, out: ByteSink): void;
```

규칙:
- 정수: `123`, 음수 `-7`, leading zero 없음. 무한대/NaN 거부.
- 실수: `123.456`. 지수 표기 안 됨. 소수점 5자리 이내 라운딩 (PDF 일반 관행).
- Name: `/Foo`. 비ASCII 또는 `# /` 같은 문자는 `#XX` 이스케이프.
- Literal string: 가능하면 그대로, 비프린터블 또는 unbalanced paren이면 hex로 fallback.
- Hex string: `<48656C6C6F>`. 짝수 자리 보장.
- Array: 공백 구분.
- Dict: `<< /K V /K V >>` — *키 순서는 입력의 Map 순서 보존*. 결정론적 출력 → diff 가능 → 테스트 용이.
- Stream: dict 직렬화 + `\nstream\n` + raw bytes + `\nendstream`. 길이가 변경됐으면 `/Length` 갱신.

**중요**: stream의 raw bytes는 *디코드된 적이 있어도* 원본 raw를 보존한다. 우리가 *디코드 후 변경한* stream만 새 byte로 교체하고 `/Filter`, `/DecodeParms` 갱신.

## 3. Incremental Update (`writer/incremental.ts`)

```
[원본 바이트 (수정 없음)]
\n  ← 안전하게 EOL 1개
<dirty 객체들 직렬화>
\n
xref
<수정/신규/free 엔트리만, 서브섹션 단위>
trailer
<< /Size new_size /Root rootRef /Prev original_startxref /ID [orig_id new_id] /Info ...>>
startxref
<새 xref offset>
%%EOF
```

알고리즘:
1. `dirtySet = doc.dirtyObjects()`.
2. 출력 = original buffer concat (이미 byte로 보유).
3. 각 dirty 객체를 새 offset으로 직렬화. offset 기록.
4. 객체 번호를 sort → xref subsection 단위로 묶음.
5. xref + trailer 직렬화. trailer.`/Prev` = `originalStartxref`. trailer.`/ID[1]` 갱신 (timestamp+random hash).
6. `startxref` + offset + `%%EOF`.

**Free 처리** (페이지 삭제 등으로 객체 회수):
- xref entry type='free' + 다음 free 객체 번호 링크.
- generation을 1 증가.
- 원본 free list head (`0 0 obj`)도 갱신해야 함 → 이 객체를 dirtySet에 포함.

## 4. Full Rewrite (`writer/full.ts`)

1. live 객체 식별: catalog 부터 BFS로 도달 가능한 모든 객체.
2. 객체 번호를 1..N으로 *재할당*. 매핑 테이블 보관.
3. 모든 ref를 새 번호로 교체.
4. 각 객체 직렬화 → offset 기록.
5. classical xref 작성, trailer 작성.

이점: 파일 작아짐, 객체 번호 정리됨. 단점: 파서가 못 본 객체는 누락 가능 → 위험.

## 5. Page Tree 정리

페이지 삭제/재배치/병합은 *page tree*를 직접 수정한다. 두 가지 접근:

### A) In-place tree mutation (incremental 친화)
- 부모 `/Pages`의 `/Kids`만 수정. 트리 깊이 보존.
- 모든 조상의 `/Count` 갱신 (BFS upward).
- 삭제된 페이지 객체는 free.

### B) Flatten + rebuild
- 트리를 평면 `[page1, page2, ...]`로 만든 뒤, 작업하고, *단일 깊이의 새 /Pages 노드*로 다시 짠다.
- 단순. 하지만 부모-자식 상속 (`/Resources`, `/MediaBox`)을 *각 페이지로 inline*해야 한다 — 페이지 dict가 비대해질 수 있음.

→ **MVP는 A**. B는 full rewrite 시에만.

### 페이지 병합 (다중 PDF)

1. 각 입력 PDF를 별도 `PdfDocument`로 open.
2. 출력 doc 생성 → 첫 입력의 catalog/info를 base로 incremental update 시작.
3. 추가할 페이지의 객체들을 *deep copy* → 객체 번호 충돌 회피를 위해 출력 doc의 새 번호로 재배정. 이때 페이지에서 도달 가능한 *모든 객체* (리소스, 폰트, 이미지, 콘텐츠 stream) 수집.
4. 페이지의 `/Resources` 가 부모로부터 상속이면 inline.
5. 페이지의 `/Parent` ref 갱신 (출력 doc의 page tree).
6. 출력 page tree에 삽입.

**충돌**: 동일한 폰트/이미지 객체가 여러 입력에서 등장해도 *중복 임베딩*한다 (단순함, 결과 큼). 중복 제거(content hash 기반)는 v2.

## 6. Stream 인코딩 결정

수정된 콘텐츠 stream을 다시 인코딩할 때:
- 원래 `/Filter`가 `/FlateDecode`였으면 zlib re-compress. predictor는 *적용 안 함* (단순화). 호환성 영향 없음.
- 원래 필터 체인이 복잡했으면 (`[ /ASCII85Decode /FlateDecode ]` 등) → 단일 `/FlateDecode`로 정규화.
- 새로 추가하는 콘텐츠 (예: 텍스트 추가) → `/FlateDecode` 적용.

## 7. 메타데이터 처리

저장 시:
- `Info` dict의 `/Producer` = "Edit2me 0.x" (서명).
- `/ModDate` = 현재 (PDF Date format: `D:YYYYMMDDHHmmSSOHH'mm'`).
- XMP metadata stream (`Catalog./Metadata`)도 변경 시 갱신 — v2.
- `/ID` 두 번째 요소를 새 random hex 16바이트로.

## 8. 결정론

같은 입력 + 같은 연산 → 같은 byte 출력 (`/ID`와 `/ModDate` 제외). 이는 테스트(byte-level diff)에 결정적이다.
구현 노트:
- 객체 직렬화 순서: 객체 번호 오름차순.
- Dict 키 순서: 입력 보존(Map 순서).
- 새 객체 번호 할당: 결정적 카운터 (UUID 사용 금지).

## 9. 안전 검증

직렬화 직후 *자체 검증*:
1. 출력 byte로 새 `PdfDocument.open()`. 성공해야 함.
2. xref entry 수 == trailer `/Size` -1? (0번 free 포함)
3. 모든 페이지 객체가 도달 가능한가?
4. (옵션) `qpdf --check` 실행 — *개발 환경 검증 도구로만*, 런타임 의존 아님.

검증 실패 시 → 출력 폐기 + 에러 보고.

## 10. 인터페이스

```ts
export interface SerializeOptions {
  mode: 'incremental' | 'full-rewrite';
  optimizeCompression?: boolean;     // full-rewrite 시 모든 stream 재압축
  stripJavaScript?: boolean;
  stripAnnotations?: boolean;
}

export async function serialize(
  doc: PdfDocument,
  opts?: SerializeOptions,
): Promise<Uint8Array>;
```
