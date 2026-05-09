# 06. Features — 5 MVP + Future

각 기능에 대해: **(a) 사용자 시나리오, (b) UI, (c) 자료 구조 / 연산, (d) 알고리즘, (e) 엣지 케이스, (f) 시험 케이스**.

연산은 직렬화 가능한 객체로 정의되어 클라이언트 큐 → 서버 적용 → undo 스택의 흐름을 탄다. 연산 모음은 [`08-api-contract.md`](./08-api-contract.md)에서도 참고.

---

## 1. 텍스트 편집 (Edit Existing Text)

> 기존 PDF에서 추출된 텍스트 조각을 사용자가 인라인으로 수정할 수 있어야 한다.

### (a) 시나리오
1. 사용자 업로드 → 에디터 진입.
2. 페이지 컨테이너 위에 텍스트 블록이 보임.
3. 더블클릭 → contenteditable로 전환.
4. 입력 후 ESC/blur → 변경 commit.
5. 우측 상단에 "수정됨" 배지 + 다운로드 버튼.

### (b) UI
- TextBlock 컴포넌트가 hover 시 점선 테두리.
- 클릭 = 선택, 더블클릭 = 편집.
- 편집 중 우측에 floating toolbar: 글꼴 변경 안 됨 (v1 제약), **글자 크기/색상 변경 안 됨** (v1 제약: 기존 폰트의 metric을 무너뜨리지 않기 위해).
- 단축키: `Enter`로 commit, `ESC`로 취소.

### (c) 연산
```ts
type EditTextOp = {
  op: 'edit-text';
  pageIndex: number;
  blockId: string;       // doc 안에서 blockId는 결정적 ID (contentStreamId + opIndex)
  newText: string;       // 새 유니코드 텍스트
};
```

### (d) 알고리즘
1. blockId로 원래 콘텐츠 스트림과 op 위치 찾기 (`source` 정보, `03-parser.md#8`).
2. 새 텍스트를 *기존 폰트의 인코딩으로 재인코드*:
   - 폰트가 단순 8bit (StandardEncoding 등)이면 unicode → glyph index → byte 1개.
   - 폰트가 Type 0이면 unicode → CID → 2바이트.
   - **글리프가 폰트에 없으면**? → *추가된 문자만* fallback 폰트(`Helvetica` 코어)로 분리해 인접 두 텍스트 op로 분할. 이게 v1 정책.
3. 새 byte를 만든 뒤 *그 op만* 콘텐츠 스트림에서 교체.
4. **자간 보정**: 단순 `Tj`라면 byte만 바꾸면 끝. `TJ`였다면 표시 폭을 다시 계산해 string 변경 + 인접 shift 항목 업데이트 (자간 일관성을 위해).
5. 콘텐츠 stream 객체를 dirty 표시 → incremental update에 포함.

### (e) 엣지 케이스
- **글리프 누락**: 위 fallback. UI에서 "이 문자는 다른 폰트로 표시됩니다" 경고.
- **여러 줄에 걸친 블록**: 우리 UI는 줄 단위 블록으로 자르므로 발생 안 함 (블록 정의가 한 줄).
- **하나의 `TJ`에 여러 string이 섞여 있음** (위치 조정): 우리가 하나의 run으로 합쳤다면 편집 시 *전체 TJ를 한 string으로 평탄화*하여 다시 작성. 자간 정확도는 ±1pt 손실 가능 — 트레이드오프.
- **회전된 텍스트**: 편집 가능하지만 미리보기에서 회전 표시. 매트릭스는 보존.
- **암호화 폰트**: 거부 (편집 비활성화 + 안내).

### (f) 시험
- 코어14 폰트로 만든 PDF: 글자 길이 같음/짧음/김 케이스.
- 임베디드 TTF: 새 글자가 폰트에 있는 경우 / 없는 경우.
- CJK CIDFont: 한글 ↔ 한글, 한글 ↔ 영문 혼합.
- TJ로 자간 조정된 텍스트: 시각적으로 일관 유지.

---

## 2. 텍스트 추가 (Add New Text)

> 페이지 임의 위치에 새 텍스트 박스를 삽입.

### (a) 시나리오
1. 페이지 빈 영역 더블클릭 또는 툴바의 "텍스트 추가" 버튼.
2. 클릭한 위치에 빈 입력 박스 출현, 즉시 포커스.
3. 입력 → blur 시 commit.
4. 박스를 드래그해 위치 조정 가능.

### (b) UI
- 폰트 선택: 코어 14 (`Helvetica`, `Times-Roman`, `Courier`)만. 한글이 필요하면 *사용자 업로드 TTF* (1개) 옵션.
- 크기/색상: 12pt 기본, 8/10/12/14/16/20/24/36 selectbox. 색은 black/red/blue/gray.
- 굵기/기울임: 코어14 변형으로 선택 (Helvetica-Bold 등).

### (c) 연산
```ts
type AddTextOp = {
  op: 'add-text';
  pageIndex: number;
  position: { x: number; y: number };   // PDF 좌표계 (좌하 원점)
  text: string;                          // unicode
  font: 'Helvetica' | 'Helvetica-Bold' | ... | { kind: 'user-ttf'; uploadId: string };
  fontSize: number;
  color: { r: number; g: number; b: number }; // 0..1
};
```

### (d) 알고리즘
1. 페이지의 `/Resources/Font` dict에 해당 폰트 등록 (없으면 새로 추가).
   - 코어14: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` — 임베딩 없음.
   - 사용자 TTF: 해당 글자만 포함하는 *서브셋*으로 임베딩. → `fonts/ttf-subset.ts` (Phase 2).
2. 페이지의 콘텐츠 스트림 끝에 텍스트 추가 fragment 삽입:
   ```
   q
   1 0 0 1 <x> <y> cm    % 위치
   <r> <g> <b> rg        % 색
   BT
     /F<n> <size> Tf
     0 0 Td
     (<encoded bytes>) Tj
   ET
   Q
   ```
3. 콘텐츠 stream을 *배열*로 만들어 원본 + 새 fragment를 별도 stream으로 분리 (원본 손대지 않기 위해). PDF는 `/Contents`가 array일 때 단순 이어붙임으로 정의됨.

### (e) 엣지 케이스
- **폰트 등록명 충돌**: `/F1`이 이미 있으면 `/F<next-free-number>` 사용.
- **사용자 TTF 글리프 부재**: 거부 + 어떤 글자가 빠졌는지 표시.
- **여러 줄 텍스트**: 줄바꿈을 `T*` 또는 `0 -leading Td`로 처리.
- **회전된 페이지**(`/Rotate=90`): UI는 회전 후 좌표를 받지만, 콘텐츠 fragment의 `cm`을 inverse rotation으로 보정해 *시각적으로* 사용자가 원한 위치에 떨어지게.

### (f) 시험
- 빈 페이지에 한글 추가 (사용자 업로드 TTF).
- 회전된 페이지에 텍스트 추가 → 다른 뷰어에서도 같은 자리에 보임.
- 대량 텍스트 추가 후 파일 재오픈 시 정상.

---

## 3. 페이지 순서 변경 (Reorder Pages)

### (a) 시나리오
- 우측 사이드바에 썸네일 목록 표시. 드래그로 순서 변경.

### (b) UI
- HTML5 native drag (외부 라이브러리 도입 보류).
- 다중 선택 (Shift 클릭) 후 일괄 이동.
- 키보드: 페이지 카드 포커스 후 `Cmd/Ctrl + Up/Down`.

### (c) 연산
```ts
type ReorderPagesOp = {
  op: 'reorder-pages';
  permutation: number[];   // 새 인덱스 → 기존 인덱스
};
```
N개 페이지 PDF에서 `permutation.length === N` 보장. 0..N-1 정확히 1번씩.

### (d) 알고리즘
페이지 트리를 평면화한 후:
- 새 순서대로 `/Kids` 배열을 갖는 단일 부모(또는 트리 모양 보존을 위해 기존 부모-자식 구조 유지하면서 leaf만 재정렬). MVP: leaf 재정렬.
- 부모 dict를 dirty 표시.
- 모든 페이지 객체의 `/Parent` 참조는 변경 없음 (부모만 살아있다면).

트리 모양이 복잡한 경우 (다중 깊이) → leaf 재정렬은 부모-자식 그룹을 깬다. 그래서 **MVP는 "단일 평면 트리로 정규화"**:
1. 기존 트리에서 모든 페이지 leaf 추출.
2. 모든 부모(`/Type /Pages`) 객체를 free.
3. 새 단일 `/Pages` 객체 생성, `/Kids = [perm[0], perm[1], ...]`, `/Count = N`.
4. 각 leaf의 `/Parent` 새 부모로 갱신.
5. catalog의 `/Pages` 갱신.

이는 incremental update에서 약간의 객체를 dirty 처리하지만, 전체 콘텐츠는 손대지 않음 → 안전.

### (e) 엣지 케이스
- 부모-자식 노드에 *상속 가능 키*(MediaBox 등)가 있었으면 → 평면화 전에 *각 leaf로 inline*.
- 페이지가 `/Annots`로 다른 페이지를 참조 (링크) → 인덱스 기반 link는 깨짐 (named destination은 OK). 경고.

### (f) 시험
- 깊이 3 트리, 7페이지 → 역순 정렬.
- 1페이지짜리 PDF (no-op) 거부 안 함.

---

## 4. 페이지 삭제 (Delete Pages)

### (a) 시나리오
- 썸네일 사이드바에서 다중 선택 후 Delete 키.

### (b) UI
- 다중 선택 가능. 삭제 전 확인 모달 (5장 이상 시).
- Undo 가능.

### (c) 연산
```ts
type DeletePagesOp = {
  op: 'delete-pages';
  indices: number[];   // 정렬 안 해도 됨, 서버에서 정렬+dedup
};
```

### (d) 알고리즘
1. `pages = doc.getPages()` 평면화.
2. `keep = pages.filter((_, i) => !indices.includes(i))`.
3. `keep`을 가진 새 단일 `/Pages` 트리로 재구성 (3과 동일 로직).
4. 삭제된 페이지 객체와 그 자손(콘텐츠 stream 등)을 free 처리.
   - **주의**: 자손 객체를 *다른 살아있는 페이지가 참조*할 수 있다 (공유 리소스). 따라서 reference counting 또는 BFS로 도달 가능 객체를 다시 계산한 후, 도달 못한 객체만 free.
5. catalog `/Pages` 갱신.
6. 모든 페이지 삭제 → 거부 (1페이지 이상 남아야).

### (e) 엣지 케이스
- 공유 폰트 객체: 위 (4) 의 도달성 분석으로 자동 보존.
- 페이지 외 참조 (Outlines/Bookmarks가 삭제된 페이지 가리킴) → 갱신 또는 strip.

### (f) 시험
- 100페이지 PDF에서 짝수 페이지만 삭제.
- 첫 페이지/마지막 페이지 삭제.
- 모든 페이지 삭제 시도 → 에러.

---

## 5. PDF 병합 (Merge PDFs)

> 여러 PDF에서 페이지를 골라 새 PDF로.

### (a) 시나리오
1. 메인 화면 또는 에디터에서 "병합" 모드.
2. 여러 파일 업로드.
3. 좌측: 파일별 썸네일 목록. 우측: 결과 페이지 시퀀스 (드래그로 추가).
4. 드래그 드롭으로 순서 결정.
5. "병합 완료" 버튼 → 다운로드.

### (b) UI
- 다중 파일 업로드 (`<input multiple>` + 드래그앤드롭).
- 좌측 사이드바에 각 PDF의 썸네일 (내부 collapsible).
- 우측 메인 보드에 *결과 시퀀스*. 빈 상태 안내.
- 페이지 카드를 좌→우 드래그로 추가, 우측에서 우→좌 드래그로 제거. 우측 안에서 드래그로 순서 변경.

### (c) 연산
```ts
type MergeOp = {
  op: 'merge';
  sources: Array<{ docId: string }>;     // 모두 업로드되어 있어야 함
  pages: Array<{ source: number; pageIndex: number; rotation?: 0|90|180|270 }>;
};
// 결과: 새 docId가 생성되어 서버 응답으로 반환
```

### (d) 알고리즘
1. 새 빈 doc을 생성한다. 옵션 A) 어떤 입력 PDF의 *복사본*으로 시작 (incremental update 활용 가능). 옵션 B) 진짜 빈 PDF (코어 catalog/info 만).
   - **MVP는 B**: 빈 PDF로 시작 → full rewrite 모드. 각 입력의 페이지를 *복사*해 추가. (incremental은 단일 원본 변형에 적합, 병합은 원본이 여럿이라 부적합.)
2. 각 `pages[i]`에 대해:
   - `srcDoc = openCached(sources[pages[i].source].docId)`.
   - `srcPage = srcDoc.getPage(pages[i].pageIndex)`.
   - `clonedObjects = deepCloneReachable(srcPage)` (페이지에서 reachable한 모든 객체).
   - 객체 번호를 새 doc의 새 번호로 *재매핑*. ref들도 동시에 업데이트.
   - 페이지 dict의 상속 키 (`MediaBox`, `Resources`)는 inline.
   - rotation이 지정되면 페이지 `/Rotate` 추가.
   - 새 doc의 page tree에 push.
3. 새 doc의 catalog/Outlines는 비움 (북마크는 v2).
4. full rewrite로 직렬화.

### (e) 엣지 케이스
- 입력의 폰트/이미지가 동일해도 중복 임베딩 (v1 단순화).
- 입력 PDF가 *암호화*되어 있으면 → reject.
- 입력 페이지에 `/Annots`로 페이지 내 link → 좌표 기반은 보존, 페이지 인덱스 기반(`Dest [page /XYZ ...]`)은 새 페이지로 remap.

### (f) 시험
- 5개 PDF에서 각 1페이지씩 → 5페이지 PDF.
- 동일 PDF에서 같은 페이지 두 번 사용.
- 회전 옵션 적용된 페이지.

---

## 미래 기능 (Backlog, 우선순위 순)

| # | 기능 | 메모 |
|---|---|---|
| F1 | 페이지 회전 | `/Rotate` 키만 갱신. 매우 쉬움. MVP 직후. |
| F2 | 페이지 분할 (split into N PDFs) | 병합의 역. 쉬움. |
| F3 | 텍스트 검색 (Ctrl+F) | 추출된 텍스트에서 검색. UI 이슈만 풀면 됨. |
| F4 | 페이지에 이미지 삽입 | JPEG 패스스루. /XObject 등록. |
| F5 | 텍스트 색/크기 변경 | metric 보정 필요 → 어려움. |
| F6 | 텍스트 삭제 (스트라이크아웃 아닌 진짜 삭제) | 콘텐츠 op 제거 + 흰색 사각형 페인트 필요. 백그라운드와 충돌 가능 — 까다로움. |
| F7 | 자체 raster renderer (canvas) | [`05-renderer.md`](./05-renderer.md) Phase 2. |
| F8 | 주석/하이라이트 추가 | `/Annots` 객체 작성. |
| F9 | 사용자 인증 + 파일 보존 (24h 이상) | hr_blog2.0 인증과 통합. |
| F10 | 일괄 처리 (드롭한 N개 PDF 모두 동일 작업) | UX 작업. |
| F11 | 폼(AcroForm) 채우기 | 폰트 처리 비슷. |
| F12 | 디지털 서명 보존 검증 | incremental update 덕분에 자동이지만 명시 검증. |
| F13 | OCR | 스캔 PDF 지원. 별도 엔진 필요 — 큼. |

## 국제화 (i18n) <a id="i18n"></a>

UI: 한국어/영어 토글 (Next.js i18n 라우팅 또는 단순 dictionary).
PDF 콘텐츠: 폰트가 지원하는 한 모든 유니코드 처리.
한국어 PDF 사용 시:
- 추출: 표준 CMap (UniKS-*) + 임베디드 ToUnicode.
- 편집: 임베디드 폰트의 CID 인코딩 사용.
- 추가: 사용자 업로드 한글 TTF 1종 권장 (Noto Sans KR 등 — 사용자 책임).
