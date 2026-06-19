import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  assertBucketAllowed,
  assertUrlMapAllowed,
  parseStack,
  ForbiddenError,
} from "$lib/server/config";
import { getProvider } from "$lib/server/providers";
import { writeLocalBackup } from "$lib/server/backup";
import { createLogger, errMsg } from "$lib/server/logger";
import type { InvalidationResult, UpdateResult } from "$lib/types";

const log = createLogger("api:update");

interface UpdateBody {
  stack?: string;
  bucket?: string;
  path?: string;
  content?: string;
  urlMaps?: string[];
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".js")) return "application/javascript";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".html") || lower.endsWith(".htm"))
    return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/**
 * POST /api/config/update — guard → backup previous → upload → invalidate.
 * Body: { bucket, path, content, urlMaps[] }
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: UpdateBody;
  try {
    body = await request.json();
  } catch {
    error(400, "Invalid JSON body.");
  }

  const bucket = body.bucket?.trim() ?? "";
  const path = body.path?.trim() ?? "";
  const content = body.content ?? "";
  const urlMaps = Array.isArray(body.urlMaps) ? body.urlMaps : [];

  if (!bucket || !path) {
    error(400, 'Both "bucket" and "path" are required.');
  }

  // Server-side allowlist enforcement — UI selection is never trusted.
  let stack;
  try {
    stack = parseStack(body.stack);
    assertBucketAllowed(stack, bucket);
    for (const m of urlMaps) {
      assertUrlMapAllowed(stack, m);
    }
  } catch (e) {
    if (e instanceof ForbiddenError) error(403, e.message);
    throw e;
  }

  log.info("update requested", {
    stack,
    bucket,
    path,
    contentBytes: Buffer.byteLength(content, "utf-8"),
    urlMaps,
  });

  const contentType = contentTypeForPath(path);
  if (contentType === "application/json") {
    try {
      JSON.parse(content);
    } catch (e) {
      log.warn("rejected invalid JSON", { stack, bucket, path, err: e });
      error(
        422,
        `New config is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const provider = getProvider(stack);

  // 1. Read current content and back it up locally before overwriting.
  let backupPath: string | null = null;
  let backupSkippedReason: string | undefined;
  try {
    const current = await provider.readConfig(bucket, path);
    if (current.exists && current.content !== null) {
      backupPath = await writeLocalBackup(bucket, path, current.content);
      log.info("backup phase complete", { stack, bucket, path, backupPath });
    } else {
      backupSkippedReason = "Object does not exist yet — nothing to back up.";
      log.info("backup phase skipped", {
        stack,
        bucket,
        path,
        reason: backupSkippedReason,
      });
    }
  } catch (e) {
    log.error("backup phase failed", { stack, bucket, path, err: e });
    error(502, `Failed to read/backup current config: ${errMsg(e)}`);
  }

  // 2. Upload the new content.
  try {
    await provider.uploadConfig(bucket, path, content, contentType);
    log.info("upload phase complete", {
      stack,
      bucket,
      path,
      contentType,
      bytes: Buffer.byteLength(content, "utf-8"),
    });
  } catch (e) {
    log.error("upload phase failed", { stack, bucket, path, err: e });
    error(502, `Upload failed: ${errMsg(e)}`);
  }

  // 3. Invalidate each whitelisted URL map. Partial failures are surfaced, not swallowed.
  const invalidations: InvalidationResult[] = [];
  for (const urlMap of urlMaps) {
    try {
      const op = await provider.invalidate(urlMap, path);
      invalidations.push({
        urlMap,
        ok: true,
        operationId: op.operationId,
        operationName: op.operationName,
      });
      log.info("invalidation ok", {
        stack,
        urlMap,
        operationId: op.operationId,
      });
    } catch (e) {
      invalidations.push({
        urlMap,
        ok: false,
        error: errMsg(e),
      });
      log.warn("invalidation failed", { stack, urlMap, err: e });
    }
  }

  const okCount = invalidations.filter((i) => i.ok).length;
  log.info("update complete", {
    stack,
    bucket,
    path,
    uploaded: true,
    invalidationsOk: okCount,
    invalidationsFailed: invalidations.length - okCount,
  });

  const result: UpdateResult = {
    stack,
    bucket,
    path,
    backupPath,
    backupSkippedReason,
    uploaded: true,
    contentType,
    invalidations,
  };
  return json(result);
};
