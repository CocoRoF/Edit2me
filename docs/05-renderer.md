# 05. Renderer Design

> 사용자에게 페이지를 *시각적으로* 보여주는 부분. PDF를 외부 라이브러리 없이 직접 그리는 것은 본 프로젝트에서 **가장 큰 미지수**다. 이 문서는 단계적 접근을 정의한다.

## 0. 핵심 결정

**Phase 1 (MVP)**: PDF의 *시각 충실 렌더링*은 하지 **않는다**. 대신:
- 페이지 = 흰 박스 + MediaBox 비율로 사각형 표시.
- 그 위에 *추출된 텍스트 블록*을 HTML/CSS로 절대 위치 오버레이.
- 이미지/도형 등은 보이지 않음. **하지만 편집 시 보존된다** (incremental update가 손대지 않으므로).

이게 무엇을 가능하게 하는가:
- 텍스트 편집/추가 UI는 *완전히* 동작.
- 페이지 재배치/삭제/병합은 *썸네일이 없어도* 페이지 메타(번호, 크기)만으로 동작.
- 사용자가 다운로드하면 *원본 시각이 그대로* 들어간 PDF를 받는다.

**한계**: 사용자는 자신이 편집할 페이지를 *시각적으로* 못 본다. 작은 텍스트 미리보기가 있어도 도형/이미지는 안 보인다. → 이 문제는 Phase 2에서 단계적 해결.

**Phase 2 (post-MVP)**: 자체 raster renderer.
- 콘텐츠 스트림 ops를 해석해 HTML5 Canvas에 그린다.
- 텍스트는 OS 폰트로 *근사*하되, 임베디드 TTF가 있으면 글리프 정확히 그림.
- 이미지(JPEG)는 `<img>` 태그처럼 base64로 즉시 표시.
- 벡터 그래픽 일부 지원 (직선, 사각형, 곡선의 단순 케이스).

**Phase 3**: 충실도 향상 — 패턴, 셰이딩, 투명, ICC 색공간.

## 1. Phase 1 상세: Text Overlay Renderer

### 클라이언트 컴포넌트
```
<PageView page={page}>
  <PaperFrame width={mediaBox.w} height={mediaBox.h} rotation={rotate}>
    {textBlocks.map(b =>
      <TextBlock
        x={b.bbox[0]}
        y={pageH - b.bbox[3]}     // PDF 좌표 → CSS top-down
        w={b.bbox[2]-b.bbox[0]}
        h={b.bbox[3]-b.bbox[1]}
        fontFamily={mapFontToWeb(b.font)}   // 코어14 → 웹 안전 폰트
        fontSize={b.size * zoom}
      >
        {b.text}
      </TextBlock>
    )}
  </PaperFrame>
</PageView>
```

### 폰트 매핑
| PDF 폰트 | 웹 매핑 |
|---|---|
| Helvetica* | `system-ui, -apple-system, "Helvetica Neue", sans-serif` |
| Times-* | `"Times New Roman", Times, serif` |
| Courier-* | `"Courier New", Courier, monospace` |
| Symbol | (Symbol 글리프는 v1에서 미지원, 그대로 표시) |
| ZapfDingbats | (마찬가지) |
| 기타 임베디드 | `serif` fallback + 경고 표시 |

CJK 폰트는 OS의 기본 한국어 폰트(`-apple-system` 등) 사용.

### 위치 정확도
PDF 좌표로 ±2pt 오차 허용. CSS `transform` 안 쓰고 `position: absolute; left/top`만 사용 → 서브픽셀 정렬 일관.

### 페이지 회전
`/Rotate` 90/180/270 → 페이퍼 자체에 `transform: rotate(...)`. 텍스트 좌표는 *회전 전* 좌표를 쓰고, transform이 시각적으로 회전.

### 줌
페이지 컨테이너에 `transform: scale(zoom)`. 100%가 아닐 때 텍스트 사이즈는 `font-size: ${size * zoom}px` (transform이 아닌 직접 스케일) — 이래야 텍스트 선명.

## 2. Phase 1 한계와 대응

| 사용자가 못 보는 것 | UI 보완 |
|---|---|
| 도형/이미지 | "이 페이지의 텍스트만 표시 중. 다운로드하면 원본 그대로 들어갑니다." 배너. |
| 텍스트 정확한 폰트 | "근사 표시" 라벨 + 호버 툴팁. |
| 회전된 텍스트 | 1차 미지원, 추출 단계에서 표시("이 페이지에 회전된 텍스트가 있습니다 — 편집 시 보존됨"). |

## 3. Phase 2: Server-side Raster Preview

Phase 2 진입 시 빠른 시각 보강 옵션:
- 서버에서 페이지를 PNG로 raster화 → 이미지로 표시 + 그 위에 *투명* 텍스트 오버레이로 편집.
- raster화 자체는 우리가 짜야 함 (외부 라이브러리 금지).

**의존성 함정**: "단지 미리보기 raster"라고 외부 라이브러리(예: pdf.js)를 도입하면 ADR-0001 위반. 명시적 기각.

대안:
- (a) 자체 캔버스 렌더 — 정공법. 시간 많이 듦.
- (b) **사용자가 동의 시** ghostscript/poppler 바이너리를 컨테이너에 두고 *오프라인 raster 전용*으로 사용. 이는 "라이브러리"가 아니라 "external program"이지만 정신상 같으므로 **별도 ADR로 결정해야** 함. MVP에서는 *기각*. (사용자 인용: "절대 다른 라이브러리 쓰지 말고 직접 OLE 레벨에서 파싱해서")

→ 우리는 (a)를 한다. Phase 2는 빠르게 가지 않을 수 있고, 그 동안 Phase 1로 사용자 가치를 충분히 제공한다는 가정.

## 4. Phase 2 자체 raster 디자인

```
src/pdf/render/
├── canvas-renderer.ts     # 진입점
├── graphics-state.ts      # CTM, 색, 선 등 스택
├── path-builder.ts        # 'm', 'l', 'c', 'v', 'y' → Path2D
├── text-renderer.ts       # 텍스트 ops → glyph 비트맵
├── image-decoder.ts       # DCT(JPEG) 패스스루, FlateDecode 이미지 → ImageData
└── font-rasterizer.ts     # TTF 글리프 비트맵 (CFF, glyf 테이블 직접 파싱)
```

`Node.js` 측에서는 `<canvas>` 가 없으므로 자체 *비트맵 합성*. RGBA Uint8ClampedArray + 단순 필 알고리즘 (스캔라인). PNG 인코딩은 자체 구현 (Deflate).

→ 이 자체로 별도 프로젝트 규모. v1에서는 진입 안 함.

## 5. Phase 1 *섬네일 전략*

페이지 보드/병합 UI에서 썸네일이 필요하다.

**옵션**:
1. (선호) 흰 박스 + 페이지 번호 + (가능하면) 첫 줄 텍스트 + 페이지 비율 → 시각적 식별 가능.
2. raster 미리보기는 Phase 2 이후.

업로드 시 각 페이지의 첫 5개 텍스트 블록을 추출 → 작은 카드에 표시. 이게 의외로 식별성이 좋다.

## 6. 인쇄/다운로드 미리보기

다운로드 직전 *최종 미리보기*는 Phase 1에서는 다음 중 선택:
- (A) 그냥 다운로드 후 사용자 OS의 PDF 뷰어로 열게 한다 — 가장 정확.
- (B) `<embed type="application/pdf">` 또는 `<object>`로 브라우저 내장 PDF 뷰어 사용.

(B)가 더 매끄럽지만 브라우저별 동작 차이 큼. 일단 (A)로 시작 + (B) progressive enhancement.

→ 결국 우리는 *Edit2me 자체 PDF 렌더 없이도* 사용자에게 가치 전달 가능.

## 7. Renderer 인터페이스 (장기)

미래 호환을 위해 인터페이스는 미리 잡아둔다:
```ts
export interface PageRenderer {
  renderPage(page: PageHandle, ctx: RenderContext): Promise<void>;
}

export interface RenderContext {
  type: 'overlay-html' | 'canvas-raster';
  zoom: number;
  // overlay-html 모드: TextRun을 absolutely-positioned div로
  // canvas-raster 모드: ImageData
}
```

Phase 1: `OverlayHtmlRenderer` 만 구현.
Phase 2: `CanvasRasterRenderer` 추가, UI는 toggle.
