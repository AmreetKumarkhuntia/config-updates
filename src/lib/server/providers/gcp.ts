// GCP implementation of ConfigStore: GCS for objects, Compute UrlMapsClient for
// Cloud CDN cache invalidation. Service-account-key-only auth — explicit
// credentials are passed to BOTH clients (no ADC).

import { Storage, type StorageOptions } from "@google-cloud/storage";
import { UrlMapsClient } from "@google-cloud/compute";
import { ConfigError, getKeyFile, resolveProjectId } from "../config";
import { createLogger } from "../logger";
import type {
  ConfigStore,
  DownloadResult,
  InvalidateOp,
  ReadResult,
} from "./types";

const log = createLogger("gcp");

type ClientOptions = {
  projectId: string;
  keyFilename?: string;
};

let storage: Storage | null = null;
let urlMaps: UrlMapsClient | null = null;

function buildClientOptions(): ClientOptions {
  const projectId = resolveProjectId();
  if (!projectId) {
    throw new ConfigError(
      "GCP_PROJECT_ID is not set and could not be derived. Set GCP_PROJECT_ID " +
        "(required when authenticating via gcloud ADC).",
    );
  }

  const keyFile = getKeyFile();
  if (keyFile) {
    return { projectId, keyFilename: keyFile };
  }

  // No key file → Application Default Credentials (gcloud auth application-default login,
  // or the attached service account on GCP compute).
  return { projectId };
}

function getStorage(): Storage {
  if (!storage) {
    const opts = buildClientOptions();
    log.debug("storage client initialized", {
      projectId: opts.projectId,
      auth: opts.keyFilename ? "keyFile" : "adc",
    });
    storage = new Storage(opts as StorageOptions);
  }
  return storage;
}

function getUrlMapsClient(): UrlMapsClient {
  if (!urlMaps) {
    const opts = buildClientOptions();
    log.debug("urlMaps client initialized", {
      projectId: opts.projectId,
      auth: opts.keyFilename ? "keyFile" : "adc",
    });
    urlMaps = new UrlMapsClient(opts);
  }
  return urlMaps;
}

function isNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === 404
  );
}

export const gcpStore: ConfigStore = {
  async readConfig(bucket, path): Promise<ReadResult> {
    log.debug("reading object", { bucket, path });
    const file = getStorage().bucket(bucket).file(path);
    try {
      const [data] = await file.download();
      let contentType: string | undefined;
      try {
        const [meta] = await file.getMetadata();
        contentType = meta.contentType ?? undefined;
      } catch {
        // metadata is best-effort; ignore failures
      }
      log.info("read object", {
        bucket,
        path,
        bytes: data.length,
        contentType,
      });
      return { content: data.toString("utf-8"), exists: true, contentType };
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
    const file = getStorage().bucket(bucket).file(path);
    try {
      const [data] = await file.download();
      let contentType: string | undefined;
      try {
        const [meta] = await file.getMetadata();
        contentType = meta.contentType ?? undefined;
      } catch {
        // metadata is best-effort; ignore failures
      }
      log.info("downloaded object", {
        bucket,
        path,
        bytes: data.length,
        contentType,
      });
      return { bytes: data, exists: true, contentType };
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
    await getStorage()
      .bucket(bucket)
      .file(path)
      .save(Buffer.from(content, "utf-8"), {
        metadata: { contentType },
        resumable: true,
      });
    log.info("uploaded", { bucket, path, bytes, contentType });
  },

  async invalidate(urlMap, path): Promise<InvalidateOp> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const [operation] = await getUrlMapsClient().invalidateCache({
      project: resolveProjectId(),
      urlMap,
      cacheInvalidationRuleResource: { path: normalizedPath },
    });
    const raw = (
      operation as { latestResponse?: { name?: string; id?: string | number } }
    ).latestResponse;
    const op: InvalidateOp = {
      operationName: raw?.name,
      operationId: raw?.id != null ? String(raw.id) : undefined,
    };
    log.info("invalidation requested", {
      urlMap,
      path: normalizedPath,
      operationId: op.operationId,
    });
    return op;
  },

  async checkBucket(bucket): Promise<boolean> {
    try {
      await getStorage().bucket(bucket).getMetadata();
      log.debug("bucket check ok", { bucket });
      return true;
    } catch {
      log.debug("bucket check failed", { bucket });
      return false;
    }
  },
};
