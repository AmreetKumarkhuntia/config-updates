// Cloud-provider abstraction. GCP is implemented today; an AWS (S3 + CloudFront)
// implementation can be added later behind the same interface.

export interface ReadResult {
  content: string | null;
  exists: boolean;
  contentType?: string;
}

export interface InvalidateOp {
  operationId?: string;
  operationName?: string;
}

export interface ConfigStore {
  /** Read a config object. Returns { content: null, exists: false } when missing. */
  readConfig(bucket: string, path: string): Promise<ReadResult>;
  /** Overwrite (or create) a config object. */
  uploadConfig(
    bucket: string,
    path: string,
    content: string,
    contentType: string,
  ): Promise<void>;
  /** Invalidate the CDN cache for `path` on the given URL map (load balancer). */
  invalidate(urlMap: string, path: string): Promise<InvalidateOp>;
  /** Reachability check for a bucket (metadata fetch). */
  checkBucket(bucket: string): Promise<boolean>;
}
