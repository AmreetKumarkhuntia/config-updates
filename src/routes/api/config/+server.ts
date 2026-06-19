import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertBucketAllowed, ForbiddenError } from '$lib/server/config';
import { getProvider } from '$lib/server/providers';

/** GET /api/config?bucket=&path= — current content of a config object. */
export const GET: RequestHandler = async ({ url }) => {
  const bucket = url.searchParams.get('bucket')?.trim() ?? '';
  const path = url.searchParams.get('path')?.trim() ?? '';

  if (!bucket || !path) {
    error(400, 'Both "bucket" and "path" query params are required.');
  }

  try {
    assertBucketAllowed(bucket);
  } catch (e) {
    if (e instanceof ForbiddenError) error(403, e.message);
    throw e;
  }

  try {
    const result = await getProvider().readConfig(bucket, path);
    return json(result);
  } catch (e) {
    error(500, e instanceof Error ? e.message : 'Failed to read config.');
  }
};
