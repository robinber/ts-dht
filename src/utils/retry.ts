import { setTimeout } from "node:timers/promises";

/**
 * Options for the retry mechanism
 */
export type RetryOptions = {
  /** Maximum number of attempts (including the first one) */
  maxAttempts?: number;
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Backoff factor (multiplier for each retry) */
  backoffFactor?: number;
  /** Jitter factor to avoid thundering herd (0-1) */
  jitter?: number;
  /** Function to determine whether an error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Function to call before each retry */
  onRetry?: (attempt: number, delay: number, error: Error) => void;
};

/**
 * Result of a retry operation, including metadata about attempts
 */
export type RetryResult<T> = {
  /** The result of the operation if successful */
  result: T;
  /** The number of attempts made (1 = no retries) */
  attempts: number;
  /** The total time elapsed in milliseconds */
  totalTime: number;
  /** Whether the operation was successful */
  successful: boolean;
  /** The last error encountered (if unsuccessful) */
  lastError?: Error;
};

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffFactor: 2,
  jitter: 0.1,
  isRetryable: () => true,
  onRetry: () => {},
} as const;

/**
 * Sleep for a given duration with optional jitter
 *
 * @param ms Base milliseconds to sleep
 * @param jitter Jitter factor (0-1)
 * @returns Promise that resolves after the sleep duration
 */
async function sleep(ms: number, jitter: number): Promise<void> {
  let delay = ms;

  if (jitter > 0) {
    const jitterAmount = ms * jitter;
    delay = ms + Math.random() * jitterAmount - jitterAmount / 2;
  }

  return setTimeout(delay);
}

/**
 * Calculate the delay for the next retry using exponential backoff
 *
 * @param attempt Current attempt number (0-based)
 * @param options Retry options
 * @returns Delay in milliseconds for the next retry
 */
function calculateBackOff(
  attempt: number,
  options: Required<RetryOptions>,
): number {
  return Math.min(
    options.initialDelay * options.backoffFactor ** attempt,
    options.maxDelay,
  );
}

/**
 * Execute an operation with automatic retries using exponential backoff
 *
 * @param operation The async operation to execute
 * @param options Retry configuration
 * @returns Promise resolving to a RetryResult
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };

  let attempts = 0;
  let lastError: Error | undefined;

  while (attempts < opts.maxAttempts) {
    attempts++;

    try {
      const result = await operation();

      return {
        result,
        attempts,
        totalTime: Date.now() - startTime,
        successful: true,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempts > opts.maxAttempts || !opts.isRetryable(lastError)) {
        break;
      }

      // Calculate delay for next retry
      const delay = calculateBackOff(attempts - 1, opts);

      // Call the onRetry handler
      opts.onRetry(attempts, delay, lastError);

      // wait for the delay before retrying
      await sleep(delay, opts.jitter);
    }
  }

  return {
    result: null as unknown as T,
    attempts,
    totalTime: Date.now() - startTime,
    successful: false,
    lastError,
  };
}

/**
 * Execute multiple operations with automatic retries
 * Allows limiting concurrency to avoid overwhelming the system
 *
 * @param operations Array of operations to execute
 * @param options Retry configuration
 * @param concurrency Maximum number of operations to execute in parallel
 * @returns Promise resolving to an array of RetryResults
 */
export async function withRetryAll<T>(
  operations: (() => Promise<T>)[],
  options: RetryOptions = {},
  concurrency = Number.POSITIVE_INFINITY,
): Promise<RetryResult<T>[]> {
  if (!operations.length) {
    return [];
  }

  if (concurrency <= 0) {
    throw new Error("Concurrency must be a positive number");
  }

  const results: RetryResult<T>[] = [];

  if (
    concurrency === Number.POSITIVE_INFINITY ||
    concurrency >= operations.length
  ) {
    return Promise.all(operations.map((op) => withRetry(op, options)));
  }

  // Execute with limited concurrency
  const queue = [...operations];
  const executing: Promise<void>[] = [];

  while (queue.length > 0 || executing.length > 0) {
    while (executing.length < concurrency && queue.length > 0) {
      const operation = queue.shift();

      if (operation) {
        executing.push(
          withRetry(operation, options).then((result) => {
            results.push(result);
          }),
        );
      }
    }

    // Wait for at least one promise to complete
    if (executing.length > 0) {
      await Promise.race(executing);
    }
  }

  return results;
}
