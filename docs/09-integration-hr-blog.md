# 09. hr_blog2.0 Integration

> Edit2me는 **별도 repo**에서 개발되지만, 배포는 **hr_blog2.0의 docker-compose에 service로 합류**한다. 이 문서는 그 통합 방식을 정의한다.

## 한 줄 결정

| 항목 | 결정 |
|---|---|
| 코드베이스 | 별도 git repo (`github.com/CocoRoF/Edit2me`). hr_blog2.0과 sub-module/sub-tree 관계 없음. |
| 빌드 방식 | hr_blog2.0이 자체 `edit2me/Dockerfile` 을 가지고 빌드 시 **`git clone`** 으로 Edit2me를 가져옴. **호스트 파일시스템에 Edit2me 체크아웃 불필요.** |
| 배포 단위 | 별도 docker 이미지(`edit2me-frontend`). hr_blog2.0의 compose에 service 1개 추가. |
| URL 경로 | `https://hrletsgo.me/edit2me/...` (Next.js basePath = `/edit2me`). |
| MinIO | hr_blog2.0 인스턴스 공유. 별도 버킷 `pdf-edit`. |
| nginx | hr_blog2.0의 nginx에 `/edit2me/*` 라우팅 location 추가. |
| 인증 | 1차 무인증. 후일 hr_blog2.0 세션 쿠키 공유 가능. |
| DB | 1차 미사용 (in-memory). 필요해지면 hr_blog2.0 PostgreSQL에 별도 schema. |

→ ADR: [`adr/0003-mount-under-hr-blog.md`](./adr/0003-mount-under-hr-blog.md).

## 1. nginx 라우팅 추가

`hr_blog2.0/nginx/default.conf` 와 `default.dev.conf` 에 location 블록 추가:

```nginx
# /edit2me/* → edit2me-frontend
# basePath=/edit2me 로 빌드된 Next.js 가 모든 라우트를 자체 처리
location /edit2me/ {
    set $edit2me_up http://edit2me-frontend:3000;
    proxy_pass $edit2me_up;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # 큰 PDF 업로드
    client_max_body_size 200m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_request_buffering off;
}

# Next.js의 _next 정적 자원도 basePath 아래에 떨어진다 (자동).
# 별도 location 불필요.
```

`default.dev.conf`에는 위 `set $edit2me_up ...` 대신 upstream 블록도 추가:
```nginx
upstream edit2me { server edit2me-frontend:3000; }
```

**주의**: `client_max_body_size`는 nginx.conf의 50m을 200m로 *전역* 올리거나, 위 location에서 *덮어쓰기*. 후자가 안전 — 다른 라우트에는 영향 X.

## 2. docker-compose 통합

### 호스트 측 Dockerfile

hr_blog2.0 repo 안에 `edit2me/` 디렉토리를 만들고 두 개의 Dockerfile을 둔다. 이들은 빌드 시 `git clone` 으로 Edit2me를 가져온다 — 호스트 파일시스템에 Edit2me 체크아웃이 있어야 할 필요 *없다*.

`hr_blog2.0/edit2me/Dockerfile` (운영):
```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG EDIT2ME_REPO=https://github.com/CocoRoF/Edit2me.git
ARG EDIT2ME_REF=main

WORKDIR /app

RUN git clone --depth 1 --branch "${EDIT2ME_REF}" "${EDIT2ME_REPO}" /tmp/edit2me \
 && cp -r /tmp/edit2me/frontend/src/. /app/ \
 && rm -rf /tmp/edit2me

RUN npm install --no-audit --no-fund
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
```

`hr_blog2.0/edit2me/Dockerfile.dev` 는 위와 동일하되 `npm run build` 생략, `CMD ["npm", "run", "dev"]`.

### 새 commit 반영 / 버전 박기

`--depth 1 --branch main` 은 docker layer 캐시에 잡히므로, Edit2me에 새 commit이 올라오면 강제 재빌드해야 한다:

```bash
docker compose -f docker-compose.prod.yml build --no-cache edit2me-frontend
```

또는 `EDIT2ME_REF` 를 commit SHA / tag로 박는 게 결정론적이다:

```bash
EDIT2ME_REF=v0.3.0 docker compose -f docker-compose.prod.yml build edit2me-frontend
```

### 개발 (`docker-compose.dev.yml`)

```yaml
  edit2me-frontend:
    container_name: new-web-edit2me-dev
    build:
      context: ./edit2me                       # ← 호스트 측 Dockerfile.dev 가 git clone
      dockerfile: Dockerfile.dev
      args:
        EDIT2ME_REF: ${EDIT2ME_REF:-main}
    # Edit2me는 자체 .env 파일을 가지지 않는다 — 호스트가 모든 값 주입.
    environment:
      - NODE_ENV=development
      - NEXT_PUBLIC_BASE_PATH=/edit2me
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin123
      - MINIO_BUCKET=pdf-edit
      - MINIO_SECURE=false
      - EDIT2ME_MAX_UPLOAD_MB=200
      - EDIT2ME_DOC_TTL_HOURS=24
    expose:
      - "3000"
    ports:
      - "53001:3000"
    depends_on:
      minio:
        condition: service_healthy
    restart: unless-stopped
```

> **Edit2me 자체 개발 워크플로우**는 별도다. Edit2me repo를 clone 후 `cd Edit2me/frontend/src && npm run dev` 로 standalone 실행하고, MinIO만 hr_blog2.0의 인스턴스를 가리키면 된다.

### 운영 (`docker-compose.prod.yml`)

```yaml
  edit2me-frontend:
    container_name: new-web-edit2me
    build:
      context: ./edit2me
      dockerfile: Dockerfile
      args:
        EDIT2ME_REF: ${EDIT2ME_REF:-main}
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_BASE_PATH=/edit2me
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ROOT_USER:-minioadmin}
      - MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD:-change-me-minio-password}
      - MINIO_BUCKET=pdf-edit
      - MINIO_SECURE=false
      - EDIT2ME_MAX_UPLOAD_MB=200
      - EDIT2ME_DOC_TTL_HOURS=24
    expose:
      - "3000"
    depends_on:
      minio:
        condition: service_healthy
    restart: always
```

`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`는 backend의 `.env`에 있는 값을 `${...}` interpolation으로 가져와 같은 자격증명을 공유한다.

## 3. MinIO 통합

### 버킷 구조
```
hr_blog2.0의 단일 MinIO 인스턴스
├── blog-images/          ← 기존 (hr_blog2.0)
└── pdf-edit/             ← 신규 (Edit2me 전용)
    ├── uploads/{docId}.pdf
    └── results/{docId}-{revision}.pdf
```

### 버킷 생성/정책
첫 부팅 시 Edit2me 컨테이너 자체가 부재하면 생성하는 로직 (idempotent). 또는 hr_blog2.0의 `scripts/`에 `setup-minio-buckets.sh` 추가:
```bash
mc alias set local http://minio:9000 ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD}
mc mb -p local/pdf-edit
mc ilm import local/pdf-edit <<EOF
{ "Rules": [{ "ID": "expire-24h", "Status": "Enabled",
              "Expiration": { "Days": 1 }, "Filter": { "Prefix": "uploads/" } }] }
EOF
```

### 정책 (라이프사이클)
- `pdf-edit/uploads/*`: 24시간 만료.
- `pdf-edit/results/*`: 24시간 만료.

### 자격 증명
Edit2me 컨테이너는 *루트 자격증명*이 아닌 별도 service account를 받는 게 좋다 — 그러나 Phase 1은 단순화 위해 동일 자격증명 사용. Phase 2에 분리.

## 4. nginx에서 다운로드 처리

`/uploads/*` location은 `blog-images` 버킷으로 rewrite 중. 우리는 다운로드를 *MinIO 직접*이 아닌 **Edit2me API 라우트가 stream proxy**하므로 nginx 변경 불필요. `/edit2me/api/documents/{docId}/download/{token}` → edit2me-frontend → MinIO → 사용자.

## 5. 환경 변수 합의

> **원칙**: Edit2me는 자체 `.env*` 파일을 가지지 않는다. *호스트(이 compose)가* `environment:` 블록으로 직접 모든 값을 주입한다. Edit2me가 자기를 호스팅하는 환경(hr_blog2.0)을 알면 결합이 깨진다.

호스트가 주입하는 변수 목록:

| 변수 | dev 값 | prod 값 | 비고 |
|---|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | `/edit2me` | `/edit2me` | 빌드/런타임 양쪽에 필요. |
| `MINIO_ENDPOINT` | `minio:9000` | `minio:9000` | 컨테이너 내부 DNS. |
| `MINIO_ACCESS_KEY` | `minioadmin` | `${MINIO_ROOT_USER}` | hr_blog2.0의 backend `.env`와 공유. |
| `MINIO_SECRET_KEY` | `minioadmin123` | `${MINIO_ROOT_PASSWORD}` | 동상. |
| `MINIO_BUCKET` | `pdf-edit` | `pdf-edit` | hr_blog2.0의 `blog-images`와 분리. |
| `MINIO_SECURE` | `false` | `false` | 컨테이너 간은 평문. |
| `EDIT2ME_MAX_UPLOAD_MB` | `200` | `200` | API 측 한도. nginx도 동일. |
| `EDIT2ME_DOC_TTL_HOURS` | `24` | `24` | (현재는 운영자가 버킷 라이프사이클로 적용) |

## 6. 헬스체크

`edit2me-frontend`에 `/api/health` 라우트:
```jsonc
{ "status": "ok", "version": "0.1.0", "minio": "ok" }
```

docker compose의 `healthcheck`로 nginx가 부팅 순서를 안다.

## 7. 빌드 / 배포 파이프라인 (제안)

**옵션 A — 수동**: hr_blog2.0 호스트에서 `docker compose -f docker-compose.prod.yml up -d --build edit2me-frontend` 만 실행. Edit2me repo가 `../Edit2me`에 clone되어 있어야 함.

**옵션 B — CI**: Edit2me repo에 GitHub Actions → Docker 이미지 빌드 후 GHCR 푸시 → hr_blog2.0의 compose에서 `image: ghcr.io/.../edit2me:tag`로 변경. *깔끔하지만 인프라 추가 필요*. v2.

→ MVP는 옵션 A.

## 8. CORS / 쿠키 / 보안

- 같은 origin (hrletsgo.me)이라 CORS 무관.
- 쿠키: `e2m_session`을 `Path=/edit2me; HttpOnly; SameSite=Lax; Secure`. hr_blog2.0의 다른 쿠키와 격리.
- CSP: hr_blog2.0이 CSP를 두지 않고 있다면 변화 없음. Edit2me 자체 라우트에서 추가 헤더 설정.

## 9. URL 경로 일관성 체크

basePath의 효과:
- 정적 자원: `/edit2me/_next/static/...` → 자동.
- 라우트: `/edit2me/e/abc` → app/e/[docId]/page.tsx.
- API: `/edit2me/api/documents` → app/api/documents/route.ts.
- 클라이언트 fetch: `'/api/documents'` 라고 쓰면 안 됨, `/edit2me/api/documents` 또는 `process.env.NEXT_PUBLIC_BASE_PATH` 활용.

→ `lib/api.ts`에 `apiUrl(path)` 헬퍼 도입:
```ts
export const apiUrl = (p: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${p}`;
```

## 10. 마이그레이션 / 롤백

- 첫 배포: nginx 설정 + docker-compose service 추가 + Edit2me repo clone. 롤백은 nginx location 제거 + service 제거.
- DB 변경 없음 (1차).
- MinIO에 새 버킷이 생기지만 hr_blog2.0 코드에 영향 없음.

## 11. 다음 단계 시 검토

| 트리거 | 추가 작업 |
|---|---|
| 사용자 인증 도입 | hr_blog2.0의 세션 미들웨어를 공유. JWT or session cookie. |
| 영구 저장 | Postgres에 `edit2me_documents` 스키마. |
| 사용량/요금 | hr_blog2.0의 admin UI에 사용량 패널 추가. |
| 분석 | hr_blog2.0의 metric pipeline에 `edit2me.*` namespace. |
