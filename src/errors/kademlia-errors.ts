/**
 * Base class for all Kademlia-related errors
 */
export class KademliaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KademliaError" as const;
  }
}

/**
 * Thrown when a node fails to respond to a request
 */
export class NodeTimeoutError extends KademliaError {
  constructor(
    public readonly nodeId: string,
    public readonly operation: string,
  ) {
    super(`Node ${nodeId} timed out during ${operation}`);
    this.name = "NodeTimeoutError" as const;
  }
}

/**
 * Thrown when a lookup operation fails to find a value or nodes
 */
export class LookupError extends KademliaError {
  constructor(
    public readonly target: string,
    public readonly reason: string,
  ) {
    super(`Lookup for ${target} failed: ${reason}`);
    this.name = "LookupError" as const;
  }
}

/**
 * Thrown when a store operation fails
 */
export class StoreError extends KademliaError {
  constructor(
    public readonly key: string,
    public readonly reason: string,
  ) {
    super(`Failed to store value for key ${key}: ${reason}`);
    this.name = "StoreError" as const;
  }
}

/**
 * Thrown when a value cannot be found in the DHT
 */
export class ValueNotFoundError extends KademliaError {
  constructor(public readonly key: string) {
    super(`Value not found for key ${key}`);
    this.name = "ValueNotFoundError" as const;
  }
}

/**
 * Thrown when a node is considered unreliable due to multiple failures
 */
export class UnreliableNodeError extends KademliaError {
  constructor(
    public readonly nodeId: string,
    public readonly failureCount: number,
  ) {
    super(`Node ${nodeId} is unreliable (${failureCount} failures)`);
    this.name = "UnreliableNodeError" as const;
  }
}

/**
 * Thrown when a node can't be contacted because of a circuit breaker
 */
export class CircuitBreakerOpenError extends KademliaError {
  constructor(
    public readonly nodeId: string,
    public readonly resetTime: Date,
  ) {
    super(
      `Circuit breaker open for node ${nodeId} until ${resetTime.toISOString()}`,
    );
    this.name = "CircuitBreakerOpenError" as const;
  }
}
