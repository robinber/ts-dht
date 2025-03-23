import { CircuitBreakerOpenError } from "../errors/kademlia-errors";

/**
 * Circuit breaker state
 */
export enum CircuitBreakerSate {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

/**
 * Options for configuring the circuit breaker
 */
export type CircuitBreakerOptions = {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Reset timeout in milliseconds */
  resetTimeout: number;
  /** Function to determine if an error should be counted as a failure */
  isFailure: (error: Error) => boolean;
};

/**
 * Circuit circuit breaker options
 */
const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 3,
  resetTimeout: 60000,
  isFailure: () => true,
} as const;

/**
 * A circuit breaker implementation to prevent repeated failures
 */
export class CircuitBreaker {
  private options: CircuitBreakerOptions;
  private state: CircuitBreakerSate = CircuitBreakerSate.CLOSED;
  private failureCount = 0;
  private nextAttempt: number = Date.now();
  private contexts: Map<
    string,
    {
      state: CircuitBreakerSate;
      failureCount: number;
      nextAttempt: number;
    }
  > = new Map();

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options };
  }

  /**
   * Execute a function through the circuit breaker
   *
   * @param fn Function to execute
   * @param context Optional context key to keep separate failure counts
   * @returns Promise with the function result
   * @throws CircuitBreakerOpenError if the circuit is open
   */
  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    // Use global state if no context is provided
    if (!context) {
      return this.executeWithState(
        fn,
        this.state,
        this.failureCount,
        this.nextAttempt,
      ).then((result) => {
        this.state = result.nextState;
        this.failureCount = result.failureCount;
        this.nextAttempt = result.nextAttempt;

        return result.value;
      });
    }

    // Get or create context-specific state
    let contextState = this.contexts.get(context);

    if (!contextState) {
      contextState = {
        state: CircuitBreakerSate.CLOSED,
        failureCount: 0,
        nextAttempt: Date.now(),
      };
      this.contexts.set(context, contextState);
    }

    const result = await this.executeWithState(
      fn,
      contextState.state,
      contextState.failureCount,
      contextState.nextAttempt,
    );

    // Update context state
    this.contexts.set(context, {
      state: result.nextState,
      failureCount: result.failureCount,
      nextAttempt: result.nextAttempt,
    });

    return result.value;
  }

  /**
   * Execute a function with specific circuit breaker state
   *
   * @param fn Function to execute
   * @param state Current circuit breaker state
   * @param failureCount Current failure count
   * @param nextAttempt Next attempt timestamp
   * @returns Promise with the function result and updated state
   */
  private async executeWithState<T>(
    fn: () => Promise<T>,
    state: CircuitBreakerSate,
    failureCount: number,
    nextAttempt: number,
  ): Promise<{
    value: T;
    nextState: CircuitBreakerSate;
    failureCount: number;
    nextAttempt: number;
  }> {
    let internalState = state;
    const now = Date.now();

    if (internalState === CircuitBreakerSate.OPEN) {
      if (now < nextAttempt) {
        throw new CircuitBreakerOpenError(
          "Circuit is open",
          new Date(nextAttempt),
        );
      }

      // Move to half-open state for testing
      internalState = CircuitBreakerSate.HALF_OPEN;
    }

    try {
      const result = await fn();

      if (internalState === CircuitBreakerSate.HALF_OPEN) {
        // Success - reset or close the circuit
        return {
          value: result,
          nextState: CircuitBreakerSate.CLOSED,
          failureCount: 0,
          nextAttempt: now,
        };
      }

      // Already closed, just reset failures
      return {
        value: result,
        nextState: CircuitBreakerSate.CLOSED,
        failureCount: 0,
        nextAttempt: now,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Only count failures that match the failure criteria
      if (!this.options.isFailure(error)) {
        throw error;
      }

      if (internalState === CircuitBreakerSate.HALF_OPEN) {
        // Failure test in half-open state - reopen the circuit
        return {
          value: null as unknown as T,
          nextState: CircuitBreakerSate.OPEN,
          failureCount: this.options.failureThreshold,
          nextAttempt: now + this.options.resetTimeout,
        };
      }

      const newFailureCount = failureCount + 1;

      if (newFailureCount >= this.options.failureThreshold) {
        // Open the circuit
        return {
          value: null as unknown as T,
          nextState: CircuitBreakerSate.OPEN,
          failureCount: newFailureCount,
          nextAttempt: now + this.options.resetTimeout,
        };
      }

      // Still under the threshold, remain closed
      return {
        value: null as unknown as T,
        nextState: CircuitBreakerSate.CLOSED,
        failureCount: newFailureCount,
        nextAttempt: now,
      };
    }
  }

  /**
   * Reset the circuit breaker state
   * @param context Optional context key to reset
   */
  reset(context?: string): void {
    if (!context) {
      this.state = CircuitBreakerSate.CLOSED;
      this.failureCount = 0;
      this.nextAttempt = Date.now();

      return;
    }

    this.contexts.set(context, {
      state: CircuitBreakerSate.CLOSED,
      failureCount: 0,
      nextAttempt: Date.now(),
    });
  }

  /**
   * Get the current circuit breaker state
   * @param context Optional context key to get
   * @returns The current state
   */
  getState(context?: string): CircuitBreakerSate {
    if (!context) {
      return this.state;
    }

    return this.contexts.get(context)?.state ?? CircuitBreakerSate.CLOSED;
  }

  /**
   * Check if the circuit breaker is open
   * @param context Optional context key to check
   * @returns True if the circuit is open
   */
  isOpen(context?: string): boolean {
    return this.getState(context) === CircuitBreakerSate.OPEN;
  }

  /**
   * Get the current circuit breaker failure count
   * @param context Optional context key to get
   * @returns The current failure count
   */
  getFailureCount(context?: string): number {
    if (!context) {
      return this.failureCount;
    }

    return this.contexts.get(context)?.failureCount ?? 0;
  }
}

export enum NodeContextOperationEnum {
  FIND_NODE = "find_node",
  FIND_VALUE = "find_value",
  STORE = "store",
  PING = "ping",
}

/**
 * Create a node-specific context key for the circuit breaker
 * @param nodeId The ID of the node
 * @param [operation] Optional operation name
 * @returns The context key
 */
export function createNodeContext(
  nodeId: string,
  operation?: NodeContextOperationEnum,
): string {
  return operation ? `node:${nodeId}:${operation}` : `node:${nodeId}`;
}
