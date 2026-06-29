// AWS implementation of ConfigStore: S3 for objects, CloudFront for cache
// invalidation. No credentials in code — the SDK reads the standard credential
// chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN exported
// in the env); the region comes from AWS_REGION.

import { randomUUID } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { ConfigError, getAwsRegion } from "../config";
import { createLogger } from "../logger";
import type {
  ConfigStore,
  DownloadResult,
  InvalidateOp,
  ReadResult,
} from "./types";

const log = createLogger("aws");

let s3: S3Client | null = null;
let cloudfront: CloudFrontClient | null = null;

function getRegion(): string {
  const region = getAwsRegion();
  if (!region) {
    throw new ConfigError(
      "AWS_REGION is not set. Set AWS_REGION to use the AWS stack.",
    );
  }
  return region;
}

function getS3(): S3Client {
  if (!s3) {
    const region = getRegion();
    log.debug("s3 client initialized", { region });
    s3 = new S3Client({ region });
  }
  return s3;
}

// CloudFront is a global service; the SDK still wants a region for signing.
function getCloudFront(): CloudFrontClient {
  if (!cloudfront) {
    const region = getRegion();
    log.debug("cloudfront client initialized", { region });
    cloudfront = new CloudFrontClient({ region });
  }
  return cloudfront;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e.name === "NoSuchKey" ||
    e.Code === "NoSuchKey" ||
    e.$metadata?.httpStatusCode === 404
  );
}

export const awsStore: ConfigStore = {
  async readConfig(bucket, path): Promise<ReadResult> {
    log.debug("reading object", { bucket, path });
    try {
      const res = await getS3().send(
        new GetObjectCommand({ Bucket: bucket, Key: path }),
      );
      const content = (await res.Body?.transformToString("utf-8")) ?? "";
      const contentType = res.ContentType ?? undefined;
      log.info("read object", {
        bucket,
        path,
        bytes: Buffer.byteLength(content, "utf-8"),
        contentType,
      });
      return { content, exists: true, contentType };
    } catch (error) {
      if (isNotFound(error)) {
        log.info("object not found", { bucket, path });
        return { content: null, exists: false };
      }
      log.error("read failed", { bucket, path, err: error });
      throw error;
    }
  },

  async downloadObject(bucket, path): Promise<DownloadResult> {
    log.debug("downloading object", { bucket, path });
    try {
      const res = await getS3().send(
        new GetObjectCommand({ Bucket: bucket, Key: path }),
      );
      const bytes =
        (await res.Body?.transformToByteArray()) ?? new Uint8Array();
      const contentType = res.ContentType ?? undefined;
      log.info("downloaded object", {
        bucket,
        path,
        bytes: bytes.length,
        contentType,
      });
      return { bytes, exists: true, contentType };
    } catch (error) {
      if (isNotFound(error)) {
        log.info("object not found", { bucket, path });
        return { bytes: null, exists: false };
      }
      log.error("download failed", { bucket, path, err: error });
      throw error;
    }
  },

  async uploadConfig(bucket, path, content, contentType): Promise<void> {
    const bytes = Buffer.byteLength(content, "utf-8");
    await getS3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        Body: Buffer.from(content, "utf-8"),
        ContentType: contentType,
      }),
    );
    log.info("uploaded", { bucket, path, bytes, contentType });
  },

  async invalidate(distributionId, path): Promise<InvalidateOp> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const res = await getCloudFront().send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: randomUUID(),
          Paths: { Quantity: 1, Items: [normalizedPath] },
        },
      }),
    );
    const op: InvalidateOp = {
      operationId: res.Invalidation?.Id,
      operationName: res.Invalidation?.Status,
    };
    log.info("invalidation requested", {
      distributionId,
      path: normalizedPath,
      operationId: op.operationId,
    });
    return op;
  },

  async checkBucket(bucket): Promise<boolean> {
    try {
      await getS3().send(new HeadBucketCommand({ Bucket: bucket }));
      log.debug("bucket check ok", { bucket });
      return true;
    } catch {
      log.debug("bucket check failed", { bucket });
      return false;
    }
  },
};
