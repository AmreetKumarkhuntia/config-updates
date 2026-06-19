import type { PageServerLoad } from "./$types";
import { getBucketsForStack, getUrlMapsForStack } from "$lib/server/config";
import type { Stack, StackData } from "$lib/types";

const STACKS: Array<Pick<StackData, "id" | "label" | "targetLabel">> = [
  { id: "gcp", label: "GCP", targetLabel: "load balancers (URL maps)" },
  { id: "aws", label: "AWS", targetLabel: "CloudFront distributions" },
];

export const load: PageServerLoad = () => {
  const stacks: StackData[] = STACKS.map((s) => ({
    ...s,
    buckets: getBucketsForStack(s.id as Stack),
    urlMaps: getUrlMapsForStack(s.id as Stack),
  })).filter((s) => s.buckets.length > 0);

  return { stacks };
};
