# ADR 0003 — hr_blog2.0의 docker-compose 아래에 마운트

- **Status**: Accepted
- **Date**: 2026-05-09

## Context

Edit2me는 hr_blog2.0과 *별도 repo*로 개발된다. 그러나 운영 측면에서 어디에서 어떻게 호스팅할 것인가에 대한 옵션:

1. **별도 도메인/서버** — `edit2me.hrletsgo.me` 등.
2. **같은 도메인의 서브패스** — `hrletsgo.me/edit2me/` (현재 결정).
3. **별도 compose 클러스터, 같은 호스트** — 프로세스/리소스 격리는 좋으나 인프라 중복.

## Decision

**Option 2 — hr_blog2.0의 docker-compose에 service 추가, nginx 서브패스 라우팅**.

- Edit2me 코드는 `~/.../prj-doc/Edit2me`에 별도 git repo.
- hr_blog2.0의 compose가 `../Edit2me/frontend`를 build context로 잡는다.
- nginx의 `/edit2me/*` 라우팅 추가.
- MinIO는 동일 인스턴스의 별도 버킷 (`pdf-edit`).

## Why

- **인증/세션 후일 통합** 용이 (같은 origin 쿠키).
- **MinIO/Postgres 등 인프라 재사용** — 두 번 띄울 이유 없음.
- **사용자 경험**: hrletsgo.me 사용자에게 "나의 도구"로 자연스러움.
- **DevOps 경량화**: 한 호스트, 한 nginx, 한 cert.

## Consequences

긍정:
- 인프라 단일화.
- 같은 docker network 안의 빠른 통신.

부정 (수용):
- hr_blog2.0의 compose가 다른 repo의 디렉토리 위치를 알아야 함 — 그러나 *심볼릭 링크 / git submodule 없이* 단순한 형제 디렉토리 가정으로 처리 가능.
- hr_blog2.0의 compose 파일에 변경이 들어감 — 두 repo 간 *명시적 결합*. PR 리뷰 시 항상 양쪽을 같이 본다.
- nginx `client_max_body_size` 등 hr_blog2.0의 설정 변경이 필요.

## Boundaries

- Edit2me 코드는 hr_blog2.0의 어떤 코드도 import하지 않는다.
- hr_blog2.0 코드도 Edit2me의 것을 import하지 않는다.
- 결합 지점은 단지 *YAML 설정 (docker-compose)*과 *nginx 설정* 두 군데뿐.
- 테스트 환경에서 Edit2me는 *단독*으로도 docker-compose.dev.yml을 가진다 (자체 nginx + minio mock 또는 host MinIO).

## 마이그레이션

만약 Edit2me가 별도 도메인/팀으로 분리되어야 한다면:
- nginx의 location 제거 + 새 도메인의 서버 블록 추가.
- compose의 service를 *별도 compose*로 분리.
- MinIO 인스턴스 분리는 *마이그레이션 작업* 필요 (버킷 데이터 복사 또는 24h TTL 후 자연스러운 cutover).

이 마이그레이션은 *기술적으로 단순*하다. 즉 본 ADR은 lock-in이 아니다.
