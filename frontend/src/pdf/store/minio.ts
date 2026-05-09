// MinIO/S3 클라이언트. PDF 라이브러리가 아니므로 SDK 사용 허용 (ADR-0001).
//
// 1차: PDF 업로드/다운로드 + 라이프사이클(24h) 자동 적용 보장 안 함
// (운영에서 mc/콘솔로 정책 적용).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

// 모든 값은 외부(host docker-compose 등)에서 주입.
// Edit2me는 hr_blog2.0이나 특정 호스트를 알지 않는다.
// standalone 로컬 개발 시 기본값으로 localhost:9000을 쓰지만,
// 운영 배포는 반드시 환경변수를 명시적으로 설정해야 한다.
const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost:9000';
const accessKeyId = process.env.MINIO_ACCESS_KEY ?? '';
const secretAccessKey = process.env.MINIO_SECRET_KEY ?? '';
const bucket = process.env.MINIO_BUCKET ?? 'edit2me';
const secure = (process.env.MINIO_SECURE ?? 'false') === 'true';

if (!accessKeyId || !secretAccessKey) {
  // 시작 시점에는 throw하지 않고, 처음 호출 시점까지 허용 (CI 빌드 등).
  // putUpload 등 실제 호출이 일어나는 시점에 SDK 가 InvalidAccessKeyId로 실패.
  // 운영에서는 docker-compose `environment:`에서 반드시 주입해야 한다.
  console.warn('[edit2me] MINIO_ACCESS_KEY / MINIO_SECRET_KEY not set');
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    endpoint: `${secure ? 'https' : 'http'}://${endpoint}`,
    region: 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // MinIO 필요
  });
  return client;
}

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const c = getClient();
  try {
    await c.send(new HeadBucketCommand({ Bucket: bucket }));
    bucketEnsured = true;
    return;
  } catch {
    /* not exists */
  }
  try {
    await c.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketEnsured = true;
  } catch (e) {
    // 이미 존재할 수 있음 — 무시
    bucketEnsured = true;
  }
}

export async function putUpload(docId: string, data: Uint8Array): Promise<void> {
  await ensureBucket();
  const c = getClient();
  await c.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `uploads/${docId}.pdf`,
      Body: Buffer.from(data),
      ContentType: 'application/pdf',
    }),
  );
}

export async function getUpload(docId: string): Promise<Uint8Array> {
  const c = getClient();
  const res = await c.send(
    new GetObjectCommand({ Bucket: bucket, Key: `uploads/${docId}.pdf` }),
  );
  return await streamToBuffer(res.Body);
}

export async function putResult(
  docId: string,
  rev: number,
  data: Uint8Array,
): Promise<void> {
  await ensureBucket();
  const c = getClient();
  await c.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `results/${docId}-${rev}.pdf`,
      Body: Buffer.from(data),
      ContentType: 'application/pdf',
    }),
  );
}

export async function getResult(docId: string, rev: number): Promise<Uint8Array> {
  const c = getClient();
  const res = await c.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: `results/${docId}-${rev}.pdf`,
    }),
  );
  return await streamToBuffer(res.Body);
}

export async function deleteDoc(docId: string): Promise<void> {
  const c = getClient();
  await Promise.allSettled([
    c.send(new DeleteObjectCommand({ Bucket: bucket, Key: `uploads/${docId}.pdf` })),
  ]);
}

export async function uploadExists(docId: string): Promise<boolean> {
  const c = getClient();
  try {
    await c.send(
      new HeadObjectCommand({ Bucket: bucket, Key: `uploads/${docId}.pdf` }),
    );
    return true;
  } catch {
    return false;
  }
}

async function streamToBuffer(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body && typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    return await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  // Node Readable stream fallback
  const chunks: Buffer[] = [];
  const readable = body as NodeJS.ReadableStream;
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return new Uint8Array(Buffer.concat(chunks));
}
