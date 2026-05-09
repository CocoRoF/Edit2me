# 08. API Contract

Next.js Route Handlers (`app/api/...`) 가 단일 백엔드 역할을 한다. 모든 경로는 `/edit2me` basePath 아래.

## 공통 사항

- 인증: 1차는 무인증 (anonymous). docId는 unguessable 32-byte URL-safe random. `cookie: e2m_session`로 사용자 ↔ doc 소유 관계 추적 (서버 측 in-memory or Redis — Phase 1은 in-process).
- 응답: JSON. 에러는 `{ error: { code, message, details? } }` + 4xx/5xx.
- Content-Type: `application/json` 기본, 업로드는 `multipart/form-data`, 썸네일 등 바이너리는 `image/png` 등.
- 모든 API는 idempotent하지 않은 쪽이 명시적 (`POST` 만 변경, `GET`은 read-only).

---

## `POST /api/documents`

PDF 업로드. 파싱하고 메타 반환.

**Request**: `multipart/form-data`
- `file`: PDF binary (≤ 200MB).

**Response 200**:
```jsonc
{
  "docId": "AbCdEf...",
  "name": "원본파일명.pdf",
  "pageCount": 24,
  "version": "1.7",
  "encrypted": false,
  "diagnostics": [
    { "level": "warn", "code": "xref-offset-fixed", "message": "..." }
  ],
  "pages": [
    {
      "index": 0,
      "width": 595,
      "height": 842,
      "rotate": 0
    }
  ],
  "createdAt": "2026-05-09T12:34:56Z"
}
```

**Response 400 / 415**:
- `unsupported-encrypted`: 암호화 PDF.
- `not-pdf`: 헤더 없음.
- `too-large`: > 200MB.

**Side effects**:
- MinIO `pdf-edit/uploads/{docId}.pdf` 적재 (24h 만료).
- 서버 메모리에 `PdfDocument` 캐시 (LRU 최대 32개, idle 5분 후 evict — 다시 요청되면 MinIO에서 재로드).

---

## `GET /api/documents/{docId}`

문서 메타 조회 (재로드 / 새로고침 후).

**Response 200**: 위 업로드 응답과 동일 (단, `name`은 *세션이 가진 메타*).

**Response 404**: 만료 또는 권한 없음.

---

## `DELETE /api/documents/{docId}`

문서 삭제 (사용자가 의도적으로). MinIO 객체 + 캐시 제거.

**Response 204**: no content.

---

## `GET /api/documents/{docId}/pages/{idx}/text`

해당 페이지의 텍스트 블록 (편집 UI를 위해).

**Response 200**:
```jsonc
{
  "pageIndex": 3,
  "rotate": 0,
  "blocks": [
    {
      "blockId": "page-3:cs-0:op-12",
      "text": "Hello world",
      "bbox": [72, 720, 240, 740],
      "font": { "name": "Helvetica", "isCore14": true, "size": 12 },
      "editable": true,
      "rotation": 0
    },
    {
      "blockId": "page-3:cs-0:op-25",
      "text": "한글 텍스트",
      "bbox": [72, 700, 200, 720],
      "font": { "name": "F2", "isCore14": false, "size": 12, "embedded": true },
      "editable": true,
      "rotation": 0,
      "warnings": ["partial-glyph-coverage"]
    }
  ]
}
```

`editable: false`인 케이스: ToUnicode 없고 표준 인코딩 추정 실패, Type 3 폰트 등. 클라이언트는 readonly로 표시.

---

## `GET /api/documents/{docId}/pages/{idx}/thumb?w=200`

썸네일. Phase 1에서는 *데이터 URL 형태로 합성*된 light 썸네일 (텍스트만), Phase 2부터는 raster.

**Response 200**: `image/svg+xml` (Phase 1) 또는 `image/png` (Phase 2).
캐시: `Cache-Control: private, max-age=600`.

---

## `POST /api/documents/{docId}/ops`

편집 연산 적용. 클라이언트가 큐에 쌓아둔 op들을 일괄 전송.

**Request**:
```jsonc
{
  "baseRevision": 4,
  "ops": [
    { "op": "edit-text", "pageIndex": 0, "blockId": "...", "newText": "Hi" },
    { "op": "delete-pages", "indices": [3, 5] }
  ]
}
```

`baseRevision`: 클라이언트가 알고 있는 마지막 revision. 서버 현재 revision과 다르면 `409 conflict`.

**Response 200**:
```jsonc
{
  "revision": 5,
  "appliedOps": 2,
  "affectedPages": [0, 3, 4, 5, 6, 7],
  "newPageCount": 22,
  "diagnostics": []
}
```

**Response 409**:
```jsonc
{ "error": { "code": "stale-revision", "currentRevision": 6 } }
```
클라이언트는 메타 재로드 후 충돌 해소 (사용자에게 "다른 탭에서 변경됨, 재로드 필요" 노출).

**연산 타입 카탈로그** (전체 정의는 [`06-features.md`](./06-features.md)):

```ts
type Op =
  | EditTextOp
  | AddTextOp
  | ReorderPagesOp
  | DeletePagesOp
  | RotatePagesOp        // future
  | MergeOp;             // 별도 엔드포인트로도 분리 (다중 doc)
```

서버는 op들을 **트랜잭션처럼** 적용: 한 op가 실패하면 전체 롤백. 부분 성공 안 함.

---

## `POST /api/documents/{docId}/undo`, `redo`

서버 측 undo/redo 스택. 각 ops 호출이 한 단계.

**Request**: 빈 body.
**Response 200**: 위 ops 응답과 동일 형태 + `direction: 'undo'|'redo'`.

클라이언트도 자체 stack을 가지지만, 서버 truth가 우선 — 충돌 시 서버 결과로 동기화.

---

## `POST /api/documents/{docId}/finalize`

최종 직렬화 + presigned 다운로드 URL.

**Request**:
```jsonc
{
  "mode": "incremental",       // 'incremental' | 'optimize'
  "stripJavaScript": true,
  "stripAnnotations": false
}
```

**Response 200**:
```jsonc
{
  "url": "https://hrletsgo.me/uploads/edit2me-results/abc123.pdf?X-Amz-Sign...",
  "size": 248312,
  "expiresIn": 300,
  "fileName": "원본파일명-edited.pdf"
}
```

`url`은 nginx의 `/uploads/*` 경로를 통해 MinIO를 가리키는 presigned URL (또는 우리 API 라우트에서 stream proxy — 보안 강화).

→ **결정**: stream proxy 사용 (직접 presigned 노출 안 함). 이유: MinIO 자격증명 노출 방지, 다운로드 카운트/감사 가능.

수정: 따라서 `url`은 `https://hrletsgo.me/edit2me/api/documents/{docId}/download/{token}` 형태. 서버가 token을 5분 유효로 발급.

---

## `POST /api/merge`

**다중 문서 병합 시작**. `documents/.../ops` 와는 별도 — 입력 doc이 여럿이라.

**Request**:
```jsonc
{
  "sources": [
    { "docId": "A..." },
    { "docId": "B..." }
  ],
  "pages": [
    { "source": 0, "pageIndex": 0 },
    { "source": 1, "pageIndex": 2 },
    { "source": 0, "pageIndex": 1, "rotation": 90 }
  ]
}
```

**Response 200**: 새 docId 반환 (위 `POST /documents`와 동일 형태). 그 docId로 추가 편집 가능.

---

## `GET /api/documents/{docId}/download/{token}`

스트림 다운로드. token은 `finalize`로 발급.

**Response 200**: `application/pdf` + `Content-Disposition: attachment; filename="..."`.

---

## 에러 코드 카탈로그

| code | HTTP | 설명 |
|---|---|---|
| `not-pdf` | 415 | `%PDF-` 헤더 없음. |
| `too-large` | 413 | > 200MB. |
| `unsupported-encrypted` | 415 | `/Encrypt` 발견. |
| `parse-failed` | 422 | 복구 모드도 실패. |
| `doc-not-found` | 404 | docId 만료 또는 미존재. |
| `stale-revision` | 409 | `baseRevision` 불일치. |
| `op-invalid` | 400 | 연산 인자 검증 실패. |
| `op-unsafe` | 422 | 예: 모든 페이지 삭제. |
| `serialize-failed` | 500 | 직렬화 후 자체 검증 실패. |
| `internal` | 500 | 그 외. |

## 레이트 리밋

`/api/documents` POST: IP당 10/분.
`/ops`: docId당 60/분.
`finalize`: docId당 30/일.

Phase 1은 in-memory token bucket. Phase 2는 Redis로.

## 관측

각 라우트에 구조화 로그:
```jsonc
{ "ts": ..., "route": "POST /documents", "docId": "...", "durationMs": 87, "bytes": 124000, "warnings": 1 }
```
파서/라이터의 `diagnostics`는 doc-level에서 상세 노출.

## 보안 헤더

- `X-Frame-Options: DENY` (파일 분석 결과 임베드 방지).
- `Content-Security-Policy`: hr_blog2.0 정책에 합치하되 PDF preview는 `<embed>` 허용.
- 업로드 응답에는 PDF 자체를 echo하지 않음.
