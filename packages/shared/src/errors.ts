import type { PublisherError } from "./types.js";

export function createPublisherError(
  code: string,
  message: string,
  options?: {
    cause?: unknown;
    hint?: string;
  }
): PublisherError {
  const error = new Error(message) as PublisherError;
  error.code = code;

  if (options?.cause !== undefined) {
    error.cause = options.cause;
  }

  if (options?.hint !== undefined) {
    error.hint = options.hint;
  }

  return error;
}
