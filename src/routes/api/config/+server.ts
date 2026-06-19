import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  assertBucketAllowed,
  parseStack,
  ForbiddenError,
} from "$lib/server/config";
import { getProvider } from "$lib/server/providers";
import { createLogger } from "$lib/server/logger";

const log = createLogger("api:config");

/** GET /api/config?stack=&bucket=&path= — current content of a config object. */
export const GET: RequestHandler = async ({ url }) => {
  const bucket = url.searchParams.get("bucket")?.trim() ?? "";
  const path = url.searchParams.get("path")?.trim() ?? "";

  if (!bucket || !path) {
    error(400, 'Both "bucket" and "path" query params are required.');
  }

  let stack;
  try {
    stack = parseStack(url.searchParams.get("stack"));
    assertBucketAllowed(stack, bucket);
  } catch (e) {
    if (e instanceof ForbiddenError) error(403, e.message);
    throw e;
  }

  log.info("load current", { stack, bucket, path });
  try {
    const result = await getProvider(stack).readConfig(bucket, path);
    log.info("load result", {
      stack,
      bucket,
      path,
      exists: result.exists,
      bytes: result.content !== null ? result.content.length : 0,
    });
    return json(result);
  } catch (e) {
    log.error("load failed", { stack, bucket, path, err: e });
    error(500, e instanceof Error ? e.message : "Failed to read config.");
  }
};
