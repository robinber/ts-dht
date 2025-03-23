import { CircuitBreakerOpenError } from "../errors/kademlia-errors";

/**
 * Circuit breaker state
 */
export enum CircuitBreakerState {
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
  /** Maximum idle time for contexts before they're cleaned up (milliseconds) */
  contextTTL: number;
  /** Interval for automatic cleanup of expired contexts (milliseconds) */
  cleanupInterval: number;
  /** Maximum number of contexts to store */
  maxContexts: number;
};

/**
 * Default circuit breaker options
 */
const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 3,
  resetTimeout: 60_000,
  isFailure: () => true,
  contextTTL: 3_600_000, // 1 hour
  cleanupInterval: 30_0000, // 5 minutes
  maxContexts: 1_000,
} as const;

/**
 * Circuit breaker state information
 */
type CircuitState = {
  state: CircuitBreakerState;
  failureCount: number;
  nextAttempt: number;
  lastAccessed: number;
};

/**
 * Result of circuit breaker execution
 */
type ExecutionResult<T> = {
  value: T | null;
  error?: Error;
  success: boolean;
  nextState: CircuitBreakerState;
  failureCount: number;
  nextAttempt: number;
};

/**
 * A circuit breaker implementation to prevent repeated failures
 */
export class CircuitBreaker {
  private options: Required<CircuitBreakerOptions>;
  private globalState: CircuitState;
  private contexts: Map<string, CircuitState> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private metrics = {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    blockedCalls: 0,
    contextCount: 0,
  };

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options };

    const now = Date.now();
    this.globalState = {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      nextAttempt: now,
      lastAccessed: now,
    };

    // Start the cleanup timer if enabled
    if (this.options.cleanupInterval > 0) {
      this.startCleanupTimer();
    }
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
    this.metrics.totalCalls++;

    // Use global state if no context is provided
    if (!context) {
      this.globalState.lastAccessed = Date.now();
      const result = await this.executeWithState(fn, this.globalState);

      // Update global state with result
      this.globalState.state = result.nextState;
      this.globalState.failureCount = result.failureCount;
      this.globalState.nextAttempt = result.nextAttempt;

      // Track metrics
      this.updateMetrics(result);

      // If execution was not successful, throw the original error
      if (!result.success) {
        if (result.nextState === CircuitBreakerState.OPEN) {
          this.metrics.blockedCalls++;
          throw new CircuitBreakerOpenError(
            "Circuit is open",
            new Date(result.nextAttempt),
          );
        }
        throw result.error;
      }

      return result.value as T;
    }

    // Get or create context-specific state
    const contextState = this.getOrCreateContext(context);
    const result = await this.executeWithState(fn, contextState);

    // Update context state
    contextState.state = result.nextState;
    contextState.failureCount = result.failureCount;
    contextState.nextAttempt = result.nextAttempt;
    contextState.lastAccessed = Date.now();

    // Track metrics
    this.updateMetrics(result);

    // If execution was not successful, throw the original error or circuit open error
    if (!result.success) {
      if (result.nextState === CircuitBreakerState.OPEN) {
        this.metrics.blockedCalls++;
        throw new CircuitBreakerOpenError(
          "Circuit is open",
          new Date(result.nextAttempt),
        );
      }
      throw result.error;
    }

    return result.value as T;
  }

  /**
   * Execute a function with specific circuit breaker state
   *
   * @param fn Function to execute
   * @param circuitState Current circuit state
   * @returns Promise with the execution result and updated state
   */
  private async executeWithState<T>(
    fn: () => Promise<T>,
    circuitState: CircuitState,
  ): Promise<ExecutionResult<T>> {
    const now = Date.now();
    let currentState = circuitState.state;

    // Check if circuit is open
    if (currentState === CircuitBreakerState.OPEN) {
      if (now < circuitState.nextAttempt) {
        return {
          value: null,
          error: new CircuitBreakerOpenError(
            "Circuit is open",
            new Date(circuitState.nextAttempt),
          ),
          success: false,
          nextState: CircuitBreakerState.OPEN,
          failureCount: circuitState.failureCount,
          nextAttempt: circuitState.nextAttempt,
        };
      }

      // Move to half-open state for testing
      currentState = CircuitBreakerState.HALF_OPEN;
    }

    try {
      const result = await fn();

      // Handle successful execution
      if (currentState === CircuitBreakerState.HALF_OPEN) {
        // Success in half-open state - close the circuit
        return {
          value: result,
          success: true,
          nextState: CircuitBreakerState.CLOSED,
          failureCount: 0,
          nextAttempt: now,
        };
      }

      // Success in closed state - reset failures
      return {
        value: result,
        success: true,
        nextState: CircuitBreakerState.CLOSED,
        failureCount: 0,
        nextAttempt: now,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Only count errors that match the failure criteria
      if (!this.options.isFailure(error)) {
        return {
          value: null,
          error,
          success: false,
          nextState: circuitState.state,
          failureCount: circuitState.failureCount,
          nextAttempt: circuitState.nextAttempt,
        };
      }

      // Handle failure in half-open state
      if (currentState === CircuitBreakerState.HALF_OPEN) {
        // Failed test in half-open state - reopen the circuit
        return {
          value: null,
          error,
          success: false,
          nextState: CircuitBreakerState.OPEN,
          failureCount: this.options.failureThreshold,
          nextAttempt: now + this.options.resetTimeout,
        };
      }

      // Update failure count
      const newFailureCount = circuitState.failureCount + 1;

      // Check if we need to open the circuit
      if (newFailureCount >= this.options.failureThreshold) {
        return {
          value: null,
          error,
          success: false,
          nextState: CircuitBreakerState.OPEN,
          failureCount: newFailureCount,
          nextAttempt: now + this.options.resetTimeout,
        };
      }

      // Still under threshold - remain closed
      return {
        value: null,
        error,
        success: false,
        nextState: CircuitBreakerState.CLOSED,
        failureCount: newFailureCount,
        nextAttempt: now,
      };
    }
  }

  /**
   * Get or create a context state
   * @param context Context key
   * @returns Circuit state for the context
   */
  private getOrCreateContext(context: string): CircuitState {
    let contextState = this.contexts.get(context);

    if (!contextState) {
      // If we've reached max contexts, remove the oldest one
      if (this.contexts.size >= this.options.maxContexts) {
        this.removeOldestContext();
      }

      const now = Date.now();
      contextState = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        nextAttempt: now,
        lastAccessed: now,
      };

      this.contexts.set(context, contextState);
      this.metrics.contextCount = this.contexts.size;
    }

    return contextState;
  }

  /**
   * Update metrics based on execution result
   * @param result Execution result
   */
  private updateMetrics<T>(result: ExecutionResult<T>): void {
    if (result.success) {
      this.metrics.successCalls++;
    } else {
      this.metrics.failedCalls++;
    }
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredContexts();
    }, this.options.cleanupInterval);
  }

  /**
   * Remove the oldest accessed context
   */
  private removeOldestContext(): void {
    let oldestContext: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    // Find the oldest context
    for (const [key, state] of this.contexts.entries()) {
      if (state.lastAccessed < oldestTime) {
        oldestTime = state.lastAccessed;
        oldestContext = key;
      }
    }

    // Remove it
    if (oldestContext) {
      this.contexts.delete(oldestContext);
      this.metrics.contextCount = this.contexts.size;
    }
  }

  /**
   * Clean up expired contexts
   */
  private cleanupExpiredContexts(): void {
    const expiryTime = Date.now() - this.options.contextTTL;
    let removed = 0;

    for (const [key, state] of this.contexts.entries()) {
      if (state.lastAccessed < expiryTime) {
        this.contexts.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.metrics.contextCount = this.contexts.size;
    }
  }

  /**
   * Reset the circuit breaker state
   * @param context Optional context key to reset
   */
  reset(context?: string): void {
    const now = Date.now();

    if (!context) {
      this.globalState = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        nextAttempt: now,
        lastAccessed: now,
      };
      return;
    }

    const contextState = this.contexts.get(context);
    if (contextState) {
      contextState.state = CircuitBreakerState.CLOSED;
      contextState.failureCount = 0;
      contextState.nextAttempt = now;
      contextState.lastAccessed = now;
    }
  }

  /**
   * Reset all circuit breakers (global and all contexts)
   */
  resetAll(): void {
    const now = Date.now();

    // Reset global state
    this.globalState = {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      nextAttempt: now,
      lastAccessed: now,
    };

    // Reset all contexts
    for (const state of this.contexts.values()) {
      state.state = CircuitBreakerState.CLOSED;
      state.failureCount = 0;
      state.nextAttempt = now;
      state.lastAccessed = now;
    }
  }

  /**
   * Get the current circuit breaker state
   * @param context Optional context key to get
   * @returns The current state
   */
  getState(context?: string): CircuitBreakerState {
    if (!context) {
      return this.globalState.state;
    }

    return this.contexts.get(context)?.state ?? CircuitBreakerState.CLOSED;
  }

  /**
   * Check if the circuit breaker is open
   * @param context Optional context key to check
   * @returns True if the circuit is open
   */
  isOpen(context?: string): boolean {
    return this.getState(context) === CircuitBreakerState.OPEN;
  }

  /**
   * Get the current circuit breaker failure count
   * @param context Optional context key to get
   * @returns The current failure count
   */
  getFailureCount(context?: string): number {
    if (!context) {
      return this.globalState.failureCount;
    }

    return this.contexts.get(context)?.failureCount ?? 0;
  }

  /**
   * Remove a specific context
   * @param context Context key to remove
   */
  removeContext(context: string): void {
    if (this.contexts.has(context)) {
      this.contexts.delete(context);
      this.metrics.contextCount = this.contexts.size;
    }
  }

  /**
   * Get performance metrics for the circuit breaker
   * @returns Current metrics
   */
  getMetrics(): {
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    blockedCalls: number;
    contextCount: number;
  } {
    return { ...this.metrics };
  }

  /**
   * Clean up resources used by the circuit breaker
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.contexts.clear();
    this.metrics.contextCount = 0;
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
