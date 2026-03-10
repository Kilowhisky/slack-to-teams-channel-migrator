import { logger } from "./logger";

interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  retryableStatuses: number[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

function isRetryable(error: unknown, statuses: number[]): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return statuses.includes((error as { status: number }).status);
  }
  if (error && typeof error === "object" && "statusCode" in error) {
    return statuses.includes((error as { statusCode: number }).statusCode);
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("econnreset") || msg.includes("econnrefused");
  }
  return false;
}

function getRetryAfter(error: unknown): number | null {
  if (error && typeof error === "object" && "headers" in error) {
    const headers = (error as { headers: Record<string, string> }).headers;
    const retryAfter = headers?.["retry-after"];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }
  return null;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === opts.maxRetries || !isRetryable(error, opts.retryableStatuses)) {
        throw error;
      }

      const retryAfter = getRetryAfter(error);
      const delay = retryAfter ?? opts.baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

      logger.warn(
        `Attempt ${attempt + 1}/${opts.maxRetries} failed, retrying in ${Math.round(delay)}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Unreachable");
}
