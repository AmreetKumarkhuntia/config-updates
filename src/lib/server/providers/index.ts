import type { Stack } from "$lib/types";
import type { ConfigStore } from "./types";
import { gcpStore } from "./gcp";
import { awsStore } from "./aws";
import { createLogger } from "../logger";

const log = createLogger("provider");

/**
 * Returns the cloud provider implementation for the given stack.
 */
export function getProvider(stack: Stack): ConfigStore {
  log.debug("provider selected", { stack });
  return stack === "aws" ? awsStore : gcpStore;
}

export type { ConfigStore };
