import type { PageServerLoad } from './$types';
import { getBuckets, getUrlMaps } from '$lib/server/config';

export const load: PageServerLoad = () => {
  return {
    buckets: getBuckets(),
    urlMaps: getUrlMaps()
  };
};
