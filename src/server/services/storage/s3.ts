/**
 * S3-compatible object storage (`STORAGE_DRIVER=s3`): a private bucket, browsers talk to it
 * directly through presigned URLs. Node-native module (relative `.ts` imports). Server-only.
 */
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../../config/env.ts";
import { SIGNED_URL_TTL_S, type StorageProvider } from "./types.ts";

export function createS3Storage(): StorageProvider {
  const credentials = {
    accessKeyId: env.s3.accessKeyId,
    secretAccessKey: env.s3.secretAccessKey,
  };
  const internal = new S3Client({
    region: env.s3.region,
    endpoint: env.s3.endpoint ?? undefined,
    forcePathStyle: env.s3.forcePathStyle,
    credentials,
  });
  // Browsers sign against the public endpoint when it differs from the one the server reaches.
  const pub = env.s3.publicEndpoint;
  const browserFacing =
    !pub || pub === env.s3.endpoint
      ? internal
      : new S3Client({
          region: env.s3.region,
          endpoint: pub,
          forcePathStyle: env.s3.forcePathStyle,
          credentials,
        });
  const Bucket = env.s3.bucket;

  return {
    async signedGetUrl(key, filename, mime, inline = false) {
      const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`;
      return getSignedUrl(
        browserFacing,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: disposition,
          ResponseContentType: mime,
        }),
        { expiresIn: SIGNED_URL_TTL_S },
      );
    },
    async signedPutUrl(key, mime, size) {
      return getSignedUrl(
        browserFacing,
        new PutObjectCommand({ Bucket, Key: key, ContentType: mime, ContentLength: size }),
        { expiresIn: SIGNED_URL_TTL_S },
      );
    },
    async headObject(key) {
      try {
        const r = await internal.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: Number(r.ContentLength ?? 0),
          mime: r.ContentType ?? "application/octet-stream",
        };
      } catch {
        return null;
      }
    },
    async getObject(key) {
      try {
        const r = await internal.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!r.Body) return null;
        return {
          body: await r.Body.transformToByteArray(),
          mime: r.ContentType ?? "application/octet-stream",
        };
      } catch {
        return null;
      }
    },
    async putObject(key, body, mime) {
      await internal.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: mime }),
      );
    },
  };
}
