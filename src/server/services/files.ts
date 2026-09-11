/**
 * Private object storage behind signed URLs (≤ 5 min). MinIO in dev, any S3 API in production.
 * Server-only.
 */
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/config/env";

export const SIGNED_URL_TTL_S = 5 * 60;

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    region: env.s3.region,
    endpoint: env.s3.endpoint ?? undefined,
    forcePathStyle: env.s3.forcePathStyle,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
  });
  return client;
}

/**
 * Browsers sign against the public endpoint (a MinIO container is `minio:9000` inside compose and
 * `localhost:9010` outside); `S3_PUBLIC_ENDPOINT` names the outside one when they differ.
 */
function publicClient(): S3Client {
  const pub = process.env.S3_PUBLIC_ENDPOINT;
  if (!pub || pub === env.s3.endpoint) return s3();
  return new S3Client({
    region: env.s3.region,
    endpoint: pub,
    forcePathStyle: env.s3.forcePathStyle,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
  });
}

export async function signedGetUrl(
  key: string,
  filename: string,
  mime: string,
  inline = false,
): Promise<string> {
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return getSignedUrl(
    publicClient(),
    new GetObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      ResponseContentDisposition: disposition,
      ResponseContentType: mime,
    }),
    { expiresIn: SIGNED_URL_TTL_S },
  );
}

export async function signedPutUrl(key: string, mime: string, size: number): Promise<string> {
  return getSignedUrl(
    publicClient(),
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      ContentType: mime,
      ContentLength: size,
    }),
    {
      expiresIn: SIGNED_URL_TTL_S,
    },
  );
}

/** After a browser PUT, the server confirms the object exists and reads its real size/type. */
export async function headObject(key: string): Promise<{ size: number; mime: string } | null> {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    return {
      size: Number(r.ContentLength ?? 0),
      mime: r.ContentType ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function putObject(
  key: string,
  body: Uint8Array | string,
  mime: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: mime }),
  );
}
