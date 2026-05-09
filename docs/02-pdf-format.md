# 02. PDF Binary Format — 구현 레퍼런스

> 본 문서는 직접 파서/라이터를 짤 때 매번 ISO 32000-1을 다시 펼치지 않도록 핵심을 정리한 것이다. 명세 섹션 번호를 [§x.y] 표기로 같이 적어 1차 출처를 항상 추적 가능하게 한다.
>
> **출처**: ISO 32000-1:2008 (PDF 1.7). PDF 2.0 (ISO 32000-2)은 v2에서 고려.

## 0. 큰 그림

```
┌──────────────────────────┐
│ %PDF-1.7                 │  ← 헤더 (§7.5.2)
│ %binary-marker           │
├──────────────────────────┤
│ 1 0 obj                  │  ← 객체 본체 (§7.5.3)
│   << /Type /Catalog ... >> │
│ endobj                   │
│ 2 0 obj                  │
│   ...                    │
│ endobj                   │
│ ...                      │
├──────────────────────────┤
│ xref                     │  ← 교차참조 표 (§7.5.4)
│ 0 N                      │
│ 0000000000 65535 f       │  (free)
│ 0000000017 00000 n       │  (in-use, byte offset)
│ ...                      │
├──────────────────────────┤
│ trailer                  │  ← 트레일러 (§7.5.5)
│ << /Size N /Root 1 0 R >>│
│ startxref                │
│ 12345                    │  ← xref 시작 byte offset
│ %%EOF                    │
└──────────────────────────┘
```

**파서는 항상 끝에서부터 읽는다**: `%%EOF` → `startxref` → xref → trailer → Root 객체. 이래야 큰 파일도 빠르게 메타만 잡힌다.

## 1. 어휘 (§7.2)

### 공백
SPACE(0x20), TAB(0x09), CR(0x0D), LF(0x0A), FF(0x0C), NUL(0x00). NUL이 공백으로 취급된다는 점이 의외 — 무시 말 것.

### 구분자
`( ) < > [ ] { } / %`. 특히 `%`는 라인 주석 시작 (한 줄 끝까지).

### 토큰 종류
- **Boolean**: `true` / `false`
- **Numeric**: `123`, `+17`, `-2`, `34.5`, `-.002` — 정수와 실수 구분
- **Literal string** `(...)`: 괄호는 균형이면 그대로, 아니면 `\(`. 이스케이프: `\n \r \t \b \f \( \) \\ \ddd`(8진수). 줄바꿈 직접 포함 가능.
- **Hex string** `<...>`: 짝홀수면 마지막에 0 패딩. `<48656C6C6F>` = `"Hello"`.
- **Name** `/...`: 1.2부터 `#XX`로 비ASCII 이스케이프. `/A#20B` = `"A B"`.
- **Array** `[ ... ]`: 임의 객체 나열.
- **Dictionary** `<< /Key Value ... >>`: 키는 항상 Name. 값 임의.
- **Stream**: `<< ... >> stream\n...bytes...\nendstream`. 길이는 dict의 `/Length` 키에 명시.
- **Null**: `null`.
- **Indirect reference**: `N G R` (예: `5 0 R`). N=객체번호, G=세대번호.

### 함정
- 줄바꿈은 CR, LF, CRLF 모두 합법. 토크나이저는 셋 다 처리.
- `stream` 키워드 뒤에는 정확히 *EOL 1개* (CRLF 또는 LF). CR-only는 사실상 비표준이지만 발견되면 관용 처리.
- 객체 안의 `endobj` 앞 EOL은 옵션. 이 점이 단순 정규식 파서를 망친다.

## 2. 파일 구조 (§7.5)

### 2.1 헤더 (§7.5.2)
```
%PDF-1.N
%<binary marker, 4+ bytes ≥ 0x80>
```
첫 줄로 버전 식별. 두 번째 줄의 바이너리 마커는 transfer agent 들이 텍스트로 오인하지 않게 하는 용도.

**구현**: 첫 1024 byte 안에 `%PDF-` 패턴 탐색 (앞에 BOM 등이 붙는 비표준 파일 대응).

### 2.2 본체 (§7.5.3)
```
N G obj
  <object>
endobj
```
N=양의 정수, G=non-negative 정수(보통 0). 처음 만든 객체의 G는 0, 삭제 후 재사용되면 G가 1 증가.

### 2.3 Cross-Reference Table (§7.5.4)

#### Classical (text) xref
```
xref
0 6
0000000000 65535 f
0000000017 00000 n
0000000081 00000 n
0000000000 00007 f
0000000331 00000 n
0000000409 00000 n
```
- 첫 줄은 항상 `0 65535 f` (free list head).
- `n` = in-use, 10자리 byte offset.
- `f` = free, 10자리는 다음 free 객체 번호, 그 다음은 generation.
- 서브섹션이 여러 개일 수 있다: `0 1` 다음에 `5 3` 같은 식으로.

#### Cross-Reference Stream (§7.5.8) — PDF 1.5+
xref가 *stream object*에 들어간 형태. `/Type /XRef`.
- `/W [w1 w2 w3]` 으로 각 entry의 byte 폭 정의 (예: `[1 4 2]`).
- entry 타입: 0=free, 1=in-use, 2=compressed (object stream에 들어있음).
- **Object Streams** (§7.5.7): 여러 객체를 zlib 압축으로 묶은 스트림. 압축률↑, 파서 복잡도↑.

> **MVP**: classical xref는 필수. xref-stream은 *읽기*만 지원하고 *쓰기*는 classical로 다운그레이드. (대부분의 PDF 뷰어가 둘 다 받음 — 호환성 안전)

### 2.4 Trailer (§7.5.5)
```
trailer
<< /Size 22
   /Root 2 0 R
   /Info 1 0 R
   /Prev 12345     (← incremental일 때만)
   /ID [ <hex16> <hex16> ]
>>
startxref
12345
%%EOF
```
- `/Size`: xref의 entry 수 (객체번호 0 포함하므로 객체 수+1).
- `/Root`: catalog 객체 참조 (필수).
- `/Info`: 메타데이터 dict (선택).
- `/Prev`: incremental update에서 이전 xref offset.
- `/ID`: 두 개의 16진수 string. 첫 ID는 파일 생성 시 고정, 둘째는 매번 변경.

### 2.5 Incremental Update (§7.5.6)
**핵심 — Edit2me의 저장 전략의 기반.**

원본 파일에 *덮어쓰지 않고 끝에 추가*한다:
```
[원본 바이트]                 ← 그대로 보존
새 객체들 (수정 또는 신규)
xref (수정/신규 객체만 + free entries)
trailer << ... /Prev <원본 startxref> >>
startxref <새 xref offset>
%%EOF
```
파서는 가장 최근 xref부터 읽고, `/Prev`를 따라가 이전 xref들을 *겹쳐* 읽는다 → 가장 최근 항목이 우선.

**이점**: 디지털 서명 보존 가능. 원본 바이트 그대로 → 감사 가능. 파서가 부분 손상되어도 이전 버전으로 회수 가능.

## 3. 문서 구조 객체 (§7.7)

### 3.1 Catalog (§7.7.2)
```
<< /Type /Catalog
   /Pages 3 0 R       ← 페이지 트리 루트
   /PageMode /UseThumbs
   /Metadata 4 0 R    (XMP)
   /Names ...
   /AcroForm ...      (양식)
>>
```

### 3.2 Page Tree (§7.7.3)
재귀 트리. 모든 노드는 `/Type /Pages` (중간) 또는 `/Type /Page` (잎).

```
3 0 obj    << /Type /Pages /Kids [ 4 0 R 7 0 R ] /Count 5 >>
4 0 obj    << /Type /Pages /Parent 3 0 R /Kids [ 5 0 R 6 0 R ] /Count 2 >>
5 0 obj    << /Type /Page  /Parent 4 0 R
              /MediaBox [0 0 612 792]
              /Resources << /Font << /F1 10 0 R >> >>
              /Contents 8 0 R >>
```

**상속**: `/Resources`, `/MediaBox`, `/CropBox`, `/Rotate`는 부모에서 자식으로 상속.

**페이지 조작 핵심**:
- 페이지 삭제 = 부모 `/Kids` 배열에서 참조 제거 + 모든 조상의 `/Count` 감소 + 객체를 free 처리.
- 페이지 재배치 = `/Kids` 배열 순서 변경.
- 페이지 추가 = `/Kids`에 ref 추가, `/Count` 증가, 새 페이지 객체 생성, `/Resources` 보장.
- **편의성**: 트리를 *flatten해서* 평면 배열로 작업하고 저장 직전 다시 트리화하는 게 단순함. (성능: 1000 페이지 미만에서는 무시 가능.)

### 3.3 Page (§7.7.3.3)
주요 키:
- `/MediaBox` [llx lly urx ury] — 미디어 크기 (필수).
- `/CropBox` — 크롭. 없으면 MediaBox.
- `/Resources` — 폰트, 이미지, 색공간 등 리소스 참조.
- `/Contents` — 콘텐츠 스트림 (단일 stream 또는 stream 배열).
- `/Rotate` — 0, 90, 180, 270.
- `/Annots` — 주석 참조 배열.

## 4. 콘텐츠 스트림 (§7.8)

페이지의 시각적 내용은 콘텐츠 스트림에 *포스트스크립트 풍 명령어*로 적힌다.

### 4.1 그래픽 상태 머신 (§8.4)
스택 기반 상태:
- CTM (Current Transformation Matrix) — 좌표 변환
- 색공간/색
- 선 두께/조인/대시
- 텍스트 상태 (폰트, 크기, 자간, 매트릭스 등)

연산자: `q` push, `Q` pop, `cm` CTM 곱하기, `w` 선폭, `RG`/`rg` 색.

### 4.2 텍스트 (§9) — **가장 중요**
```
BT                       % Begin Text
  /F1 12 Tf              % 폰트 F1, 크기 12
  72 720 Td              % 위치 이동 (text matrix translate)
  (Hello world) Tj       % 텍스트 표시
  T*                     % 다음 줄
  [(He) -120 (llo)] TJ   % 글리프 간격 조정 표시
ET                       % End Text
```

연산자:
- `Tf font size` — 폰트 설정
- `Tm a b c d e f` — 텍스트 매트릭스 절대 설정
- `Td tx ty` — 매트릭스 평행이동
- `TD tx ty` — Td + leading 설정
- `T*` — 다음 줄 (leading만큼 이동)
- `Tj string` — 문자열 표시
- `TJ array` — 배열 (string과 숫자(역방향 간격) 혼합)
- `'` — newline + show, `"` — newline + word/char spacing + show

**텍스트 매트릭스 (Tm)**가 글자의 *최종 위치/회전/스케일*을 결정. 추출 알고리즘은 Tm을 추적하면서 각 string의 시작점을 얻는다.

### 4.3 폰트와 글리프 (§9.6, §9.7)

이게 가장 까다롭다:

1. PDF의 string은 **글리프 인덱스의 시퀀스**, 유니코드 시퀀스가 *아니다*.
2. 글리프→유니코드 매핑은 폰트의 `/ToUnicode` CMap에 있을 수도 있고 *없을 수도* 있다.
3. 폰트는 다음 중 하나:
   - **코어 14** (§9.6.2.2): Times, Helvetica, Courier (각 4 변형) + Symbol + ZapfDingbats. 임베딩 없음. 메트릭 표 내장.
   - **Type 1**: PostScript 폰트. 임베딩.
   - **TrueType**: 일반 TTF. 임베딩.
   - **Type 3**: 콘텐츠 스트림으로 정의된 글리프.
   - **Type 0 (Composite)** (§9.7): CJK 등 멀티바이트. 자식 CIDFont (`/CIDFontType0` PostScript / `/CIDFontType2` TrueType) + Encoding CMap.

**텍스트 추출 알고리즘**:
```
for each string in Tj/TJ:
  for each char code:
    glyph_id = font.encoding.lookup(code)
    unicode = font.toUnicode.lookup(glyph_id) ?? guess_from_encoding(code)
    width   = font.widths[code] ?? font.missingWidth
    emit(unicode, currentPos)
    advance(currentPos, width)
```

**한국어**: 보통 Type 0 + CIDFontType2 + `/Encoding /UniKS-UCS2-H` 같은 표준 CMap. 표준 CMap은 [Adobe CMap Resources](https://github.com/adobe-type-tools/cmap-resources)에서 받아 정적으로 번들. PDF 파일 안에 임베드된 CMap도 흔함.

## 5. 압축 필터 (§7.4)

stream의 `/Filter`로 지정. 체인 가능 (`/Filter [ /ASCII85Decode /FlateDecode ]`).

| 필터 | 알고리즘 | 우리 구현 |
|---|---|---|
| `FlateDecode` | zlib | Node `zlib.inflateSync` ✅ MVP 필수 |
| `LZWDecode` | LZW | 직접 구현 (작음). 거의 안 쓰임. |
| `ASCII85Decode` | ASCII-85 | 직접 구현 (간단) |
| `ASCIIHexDecode` | hex | 직접 구현 (간단) |
| `RunLengthDecode` | RLE | 직접 구현 (간단) |
| `CCITTFaxDecode` | G3/G4 fax | 흑백 이미지. **v2로 미룸**. |
| `JBIG2Decode` | JBIG2 | **v2 이상**. 매우 복잡. |
| `DCTDecode` | JPEG | 이미지 stream을 *그대로* 임베드된 JPEG로 다룸 — 디코드 안 해도 됨 (브라우저가 함). |
| `JPXDecode` | JPEG2000 | DCTDecode와 동일 전략. |
| `Crypt` | 암호화 | **v2**. |

`FlateDecode`에 **Predictor**(`/DecodeParms`) 적용된 경우(특히 PNG predictor)는 inflate 후 *행 단위 복원* 별도 처리. 빈번하게 등장하므로 MVP 포함.

## 6. 텍스트 인코딩 (§D)

표준 인코딩:
- **StandardEncoding**, **WinAnsiEncoding**, **MacRomanEncoding**, **MacExpertEncoding**.
- 폰트의 `/Encoding`이 dict면 `/BaseEncoding` + `/Differences` 패치.

**유니코드 매핑은 `/ToUnicode` CMap이 있으면 그것이 절대적**. 없으면:
1. 폰트 이름이 코어14면 알려진 매핑 사용.
2. 표준 encoding이면 글리프명 → AGL (Adobe Glyph List) → 유니코드.
3. 그것도 없으면 fallback: `chr(code)` (불완전, 자국어 텍스트 깨짐).

→ Edit2me는 코어14 + 임베디드 CMap만 1차 지원, 추정은 안 함.

## 7. 좌표계

기본 단위 = **1/72 inch (point)**. 원점 = 페이지 *왼쪽 아래*. y축이 위로 증가. ← UI에서 흔한 "왼쪽 위 원점"과 반대.

페이지 크기 흔한 값: A4 = 595×842, US Letter = 612×792.

**회전**(`/Rotate`)은 *시계 방향*. 90/180/270 의 경우 텍스트 위치 계산을 회전 매트릭스 곱한 후 해야 시각적으로 맞다.

## 8. 우리가 *하지 않을* 명세 영역

다음은 v2 이후로 미룬다:
- §10 그래픽 (이미지 디코드 외): 패턴(§10.4), 셰이딩(§10.5), 함수(§10).
- §12.5 주석: 인식해서 보존만, 편집 X.
- §12.6 액션: `Launch`, `JavaScript`는 발견 시 strip.
- §12.7 양식 (AcroForm/XFA).
- §12.8 디지털 서명: 보존을 위해 incremental update를 기본으로 함 (서명 자체를 검증/추가하지 않음).
- §14.6 Tagged PDF / 접근성 트리: 보존만.
- §7.6 암호화.

## 9. 자주 만나는 비표준/관용

실제 야생 PDF에는 명세 위반이 흔하다. 우리 파서가 너그럽게 받아야 할 케이스:
- `%%EOF` 뒤에 garbage byte (특히 NUL 패딩) — 무시.
- xref offset이 +/- 1 byte 어긋남 — `obj` 토큰을 검색해서 보정.
- `/Length`가 실제 stream 길이와 다름 — `endstream`까지 읽어 자동 보정 후 경고.
- generation 번호가 항상 0 — 안전 가정 가능.
- 두 번 이상 정의된 객체 — 마지막 것 사용 (xref가 결정).

자세한 fallback 정책은 [`03-parser.md`](./03-parser.md#tolerance) 참고.
