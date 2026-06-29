import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  assertBucketAllowed,
  parseStack,
  ForbiddenError,
} from "$lib/server/config";
import { getProvider } from "$lib/server/providers";
import { writeLocalBackup } from "$lib/server/backup";
import { createLogger } from "$lib/server/logger";

const log = createLogger("api:config:backup");

/**
 * POST /api/config/backup — download the current object from the bucket and save
 * it as a snapshot in the local backup folder. Handles binary objects (e.g.
 * .parquet) as raw bytes; does not push or invalidate anything.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    stack?: unknown;
    bucket?: unknown;
    path?: unknown;
  } | null;

  const bucket = typeof body?.bucket === "string" ? body.bucket.trim() : "";
  const path = typeof body?.path === "string" ? body.path.trim() : "";

  if (!bucket || !path) {
    error(400, 'Both "bucket" and "path" are required.');
  }

  let stack;
  try {
    stack = parseStack(body?.stack);
    assertBucketAllowed(stack, bucket);
  } catch (e) {
    if (e instanceof ForbiddenError) error(403, e.message);
    throw e;
  }

  log.info("backup download", { stack, bucket, path });
  try {
    const result = await getProvider(stack).downloadObject(bucket, path);
    if (!result.exists || result.bytes === null) {
      log.info("nothing to back up — object missing", { stack, bucket, path });
      error(404, `Object "${bucket}/${path}" does not exist.`);
    }

    const backupPath = await writeLocalBackup(bucket, path, result.bytes);
    log.info("backup saved", {
      stack,
      bucket,
      path,
      backupPath,
      bytes: result.bytes.length,
    });
    return json({
      backupPath,
      bytes: result.bytes.length,
      contentType: result.contentType,
    });
  } catch (e) {
    // Re-throw SvelteKit HttpErrors (e.g. the 404 above) untouched.
    if (e && typeof e === "object" && "status" in e) throw e;
    log.error("backup failed", { stack, bucket, path, err: e });
    error(500, e instanceof Error ? e.message : "Failed to back up object.");
  }
};
