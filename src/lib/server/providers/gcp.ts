// GCP implementation of ConfigStore: GCS for objects, Compute UrlMapsClient for
// Cloud CDN cache invalidation. Service-account-key-only auth — explicit
// credentials are passed to BOTH clients (no ADC).

import { Storage, type StorageOptions } from "@google-cloud/storage";
import { UrlMapsClient } from "@google-cloud/compute";
import {
  ConfigError,
  getClientEmail,
  getKeyFile,
  getPrivateKey,
  resolveProjectId,
} from "../config";
import type { ConfigStore, InvalidateOp, ReadResult } from "./types";

type ClientOptions = {
  projectId: string;
  credentials?: { client_email: string; private_key: string };
  keyFilename?: string;
};

let storage: Storage | null = null;
let urlMaps: UrlMapsClient | null = null;

function buildClientOptions(): ClientOptions {
  const projectId = resolveProjectId();
  if (!projectId) {
    throw new ConfigError(
      "GCP_PROJECT_ID is not set and could not be derived from the key file.",
    );
  }

  const clientEmail = getClientEmail();
  const privateKey = getPrivateKey();
  if (clientEmail && privateKey) {
    return {
      projectId,
      credentials: { client_email: clientEmail, private_key: privateKey },
    };
  }

  const keyFile = getKeyFile();
  if (keyFile) {
    return { projectId, keyFilename: keyFile };
  }

  throw new ConfigError(
    "No service-account credentials configured. Set GCP_CLIENT_EMAIL + GCP_PRIVATE_KEY, or GCP_KEY_FILE.",
  );
}

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage(buildClientOptions() as StorageOptions);
  }
  return storage;
}

function getUrlMapsClient(): UrlMapsClient {
  if (!urlMaps) {
    urlMaps = new UrlMapsClient(buildClientOptions());
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
      return { content: data.toString("utf-8"), exists: true, contentType };
    } catch (error) {
      if (isNotFound(error)) {
        return { content: null, exists: false };
      }
      throw error;
    }
  },

  async uploadConfig(bucket, path, content, contentType): Promise<void> {
    await getStorage()
      .bucket(bucket)
      .file(path)
      .save(Buffer.from(content, "utf-8"), {
        metadata: { contentType },
        resumable: true,
      });
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
    return {
      operationName: raw?.name,
      operationId: raw?.id != null ? String(raw.id) : undefined,
    };
  },

  async checkBucket(bucket): Promise<boolean> {
    try {
      await getStorage().bucket(bucket).getMetadata();
      return true;
    } catch {
      return false;
    }
  },
};
