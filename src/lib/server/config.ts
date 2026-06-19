// Server-only configuration + allowlist guards.
// Auth model: service-account key file, or Application Default Credentials
// (gcloud auth application-default login / attached service account).

import { readFileSync } from "node:fs";
import { env } from "$env/dynamic/private";
import type { Stack, UrlMapTarget } from "$lib/types";
import { createLogger } from "./logger";

const log = createLogger("config");

/** Thrown when a request targets a bucket / URL map outside the allowlist. */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Thrown when required configuration is missing or invalid. */
export class ConfigError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Raw GCP_PROJECT_ID env value. Prefer resolveProjectId() for the effective project. */
export function getProjectId(): string {
  return env.GCP_PROJECT_ID?.trim() ?? "";
}

/**
 * Effective project id: GCP_PROJECT_ID if set, otherwise the project_id read from the
 * service-account key-file JSON (so a key mounted into a pod is enough to run).
 * Inline creds carry no project id, so that auth path still needs GCP_PROJECT_ID.
 */
export function resolveProjectId(): string {
  const fromEnv = getProjectId();
  if (fromEnv) return fromEnv;
  const keyFile = getKeyFile();
  if (keyFile) {
    try {
      const json = JSON.parse(readFileSync(keyFile, "utf-8")) as {
        project_id?: string;
      };
      if (json.project_id) return json.project_id;
    } catch {
      // unreadable / non-JSON key file — fall through to the "not set" error
      log.debug("key file unreadable; cannot derive project_id", { keyFile });
    }
  }
  return "";
}

/** Key-file path: GCP_KEY_FILE, else the standard GOOGLE_APPLICATION_CREDENTIALS (pod mount). */
export function getKeyFile(): string {
  return (
    (env.GCP_KEY_FILE?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) ??
    ""
  );
}

/** Allowlisted GCS bucket names (GCP_BUCKETS, comma-separated). */
export function getBuckets(): string[] {
  return splitList(env.GCP_BUCKETS);
}

/**
 * Allowlisted URL maps (load balancers) for cache invalidation.
 * GCP_URL_MAPS entries are "name" or "name|display.domain".
 */
export function getUrlMaps(): UrlMapTarget[] {
  return parseTargets(env.GCP_URL_MAPS);
}

/** AWS region for the S3 / CloudFront clients (AWS_REGION). */
export function getAwsRegion(): string {
  return env.AWS_REGION?.trim() ?? "";
}

/** Allowlisted S3 bucket names (AWS_BUCKETS, comma-separated). */
export function getAwsBuckets(): string[] {
  return splitList(env.AWS_BUCKETS);
}

/**
 * Allowlisted CloudFront distributions for cache invalidation.
 * AWS_DISTRIBUTIONS entries are "distributionId" or "distributionId|display.domain".
 */
export function getAwsDistributions(): UrlMapTarget[] {
  return parseTargets(env.AWS_DISTRIBUTIONS);
}

/** Local directory where previous config versions are backed up before overwrite. */
export function getBackupDir(): string {
  const dir = env.BACKUP_DIR?.trim();
  return dir && dir.length > 0 ? dir : "./backups";
}

/** Validate an untrusted stack value, defaulting to "gcp". */
export function parseStack(value: unknown): Stack {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "aws") return "aws";
  if (v === "gcp" || v === "") return "gcp";
  log.warn("rejected unknown stack", { stack: String(value) });
  throw new ForbiddenError(`Unknown stack "${String(value)}".`);
}

/** Allowlisted buckets for the given stack. */
export function getBucketsForStack(stack: Stack): string[] {
  return stack === "aws" ? getAwsBuckets() : getBuckets();
}

/** Allowlisted invalidation targets for the given stack. */
export function getUrlMapsForStack(stack: Stack): UrlMapTarget[] {
  return stack === "aws" ? getAwsDistributions() : getUrlMaps();
}

export function assertBucketAllowed(stack: Stack, bucket: string): void {
  if (!getBucketsForStack(stack).includes(bucket)) {
    const envVar = stack === "aws" ? "AWS_BUCKETS" : "GCP_BUCKETS";
    log.warn("bucket denied", { stack, bucket, envVar });
    throw new ForbiddenError(
      `Bucket "${bucket}" is not in the allowlist (${envVar}).`,
    );
  }
}

export function assertUrlMapAllowed(stack: Stack, urlMap: string): void {
  if (!getUrlMapsForStack(stack).some((m) => m.name === urlMap)) {
    const noun = stack === "aws" ? "Distribution" : "URL map";
    const envVar = stack === "aws" ? "AWS_DISTRIBUTIONS" : "GCP_URL_MAPS";
    log.warn("invalidation target denied", { stack, urlMap, envVar });
    throw new ForbiddenError(
      `${noun} "${urlMap}" is not in the allowlist (${envVar}).`,
    );
  }
}

/** Parse a comma-separated "name" / "name|display.domain" list into targets. */
function parseTargets(value: string | undefined): UrlMapTarget[] {
  return splitList(value).map((entry) => {
    const [name, domain] = entry.split("|").map((p) => p.trim());
    return domain ? { name, domain } : { name };
  });
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
