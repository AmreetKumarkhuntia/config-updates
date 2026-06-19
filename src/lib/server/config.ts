// Server-only configuration + allowlist guards.
// Auth model: service-account key only (no ADC).

import { readFileSync } from "node:fs";
import { env } from "$env/dynamic/private";
import type { UrlMapTarget } from "$lib/types";

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
    }
  }
  return "";
}

export function getClientEmail(): string {
  return env.GCP_CLIENT_EMAIL?.trim() ?? "";
}

/** Private key with escaped newlines un-escaped (matches lighthouse handling). */
export function getPrivateKey(): string {
  return env.GCP_PRIVATE_KEY ? env.GCP_PRIVATE_KEY.replace(/\\n/g, "\n") : "";
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
  return splitList(env.GCP_URL_MAPS).map((entry) => {
    const [name, domain] = entry.split("|").map((p) => p.trim());
    return domain ? { name, domain } : { name };
  });
}

/** Local directory where previous config versions are backed up before overwrite. */
export function getBackupDir(): string {
  const dir = env.BACKUP_DIR?.trim();
  return dir && dir.length > 0 ? dir : "./backups";
}

export function assertBucketAllowed(bucket: string): void {
  if (!getBuckets().includes(bucket)) {
    throw new ForbiddenError(
      `Bucket "${bucket}" is not in the allowlist (GCP_BUCKETS).`,
    );
  }
}

export function assertUrlMapAllowed(urlMap: string): void {
  if (!getUrlMaps().some((m) => m.name === urlMap)) {
    throw new ForbiddenError(
      `URL map "${urlMap}" is not in the allowlist (GCP_URL_MAPS).`,
    );
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
