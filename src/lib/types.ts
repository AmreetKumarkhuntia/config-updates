// Shared types used by both the browser UI and server endpoints.
// Keep this file free of any server-only imports.

/** Cloud provider ("stack") this tool can target. */
export type Stack = "gcp" | "aws";

export interface UrlMapTarget {
  /** Invalidation target: GCP URL map (load balancer) name, or AWS CloudFront distribution id. */
  name: string;
  /** Optional human-friendly domain label shown in the UI. */
  domain?: string;
}

/** Per-stack allowlist + display metadata handed to the UI for one cloud. */
export interface StackData {
  id: Stack;
  /** Short display name, e.g. "GCP" / "AWS". */
  label: string;
  /** Human label for the invalidation targets, e.g. "load balancers (URL maps)". */
  targetLabel: string;
  buckets: string[];
  urlMaps: UrlMapTarget[];
}

/** Data the page load() hands to the UI. */
export interface AllowlistData {
  stacks: StackData[];
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
  stack: Stack;
  bucket: string;
  path: string;
  /** Absolute path of the local backup of the previous content, or null if none was written. */
  backupPath: string | null;
  backupSkippedReason?: string;
  uploaded: boolean;
  contentType: string;
  invalidations: InvalidationResult[];
}
