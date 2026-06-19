import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  assertBucketAllowed,
  assertUrlMapAllowed,
  ForbiddenError,
} from "$lib/server/config";
import { getProvider } from "$lib/server/providers";
import { writeLocalBackup } from "$lib/server/backup";
import type { InvalidationResult, UpdateResult } from "$lib/types";

interface UpdateBody {
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
  try {
    assertBucketAllowed(bucket);
    for (const m of urlMaps) {
      assertUrlMapAllowed(m);
    }
  } catch (e) {
    if (e instanceof ForbiddenError) error(403, e.message);
    throw e;
  }

  const contentType = contentTypeForPath(path);
  if (contentType === "application/json") {
    try {
      JSON.parse(content);
    } catch (e) {
      error(
        422,
        `New config is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const provider = getProvider();

  // 1. Read current content and back it up locally before overwriting.
  let backupPath: string | null = null;
  let backupSkippedReason: string | undefined;
  try {
    const current = await provider.readConfig(bucket, path);
    if (current.exists && current.content !== null) {
      backupPath = await writeLocalBackup(bucket, path, current.content);
    } else {
      backupSkippedReason = "Object does not exist yet — nothing to back up.";
    }
  } catch (e) {
    error(
      502,
      `Failed to read/backup current config: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 2. Upload the new content.
  try {
    await provider.uploadConfig(bucket, path, content, contentType);
  } catch (e) {
    error(502, `Upload failed: ${e instanceof Error ? e.message : String(e)}`);
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
    } catch (e) {
      invalidations.push({
        urlMap,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const result: UpdateResult = {
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
