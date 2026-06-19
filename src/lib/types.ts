// Shared types used by both the browser UI and server endpoints.
// Keep this file free of any server-only imports.

export interface UrlMapTarget {
  /** GCP URL map (load balancer) name. */
  name: string;
  /** Optional human-friendly domain label shown in the UI. */
  domain?: string;
}

/** Data the page load() hands to the UI. */
export interface AllowlistData {
  buckets: string[];
  urlMaps: UrlMapTarget[];
}

/** Response of GET /api/config. */
export interface CurrentConfigResponse {
  content: string | null;
  exists: boolean;
  contentType?: string;
}

export interface InvalidationResult {
  urlMap: string;
  ok: boolean;
  operationId?: string;
  operationName?: string;
  error?: string;
}

/** Response of POST /api/config/update. */
export interface UpdateResult {
  bucket: string;
  path: string;
  /** Absolute path of the local backup of the previous content, or null if none was written. */
  backupPath: string | null;
  backupSkippedReason?: string;
  uploaded: boolean;
  contentType: string;
  invalidations: InvalidationResult[];
}
