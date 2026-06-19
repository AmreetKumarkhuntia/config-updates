import type { ConfigStore } from './types';
import { gcpStore } from './gcp';

/**
 * Returns the active cloud provider implementation.
 * GCP only for now; an AWS implementation can be selected here later
 * (e.g. via a CLOUD_PROVIDER env var).
 */
export function getProvider(): ConfigStore {
  return gcpStore;
}

export type { ConfigStore };
