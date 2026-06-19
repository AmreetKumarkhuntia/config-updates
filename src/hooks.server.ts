// Request-level logging + centralized error logging.
import type { Handle, HandleServerError } from "@sveltejs/kit";
import { createLogger, errMsg } from "$lib/server/logger";

const log = createLogger("http");

export const handle: Handle = async ({ event, resolve }) => {
  const { method } = event.request;
  const path = event.url.pathname;
  log.debug("request", { method, path });

  const start = Date.now();
  const response = await resolve(event);
  const durationMs = Date.now() - start;

  const fields = { method, path, status: response.status, durationMs };
  if (response.status >= 500) {
    log.warn("request completed", fields);
  } else {
    log.info("request completed", fields);
  }

  return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
  // Centralized log of uncaught errors; the client only gets a generic message.
  log.error("unhandled error", { path: event.url.pathname, err: error });
  return { message: "Internal Error" };
};
