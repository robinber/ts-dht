import { NodeId } from "../core";
import {
  CircuitBreakerOpenError,
  KademliaError,
  NodeTimeoutError,
  StoreError,
  UnreliableNodeError,
} from "../errors/kademlia-errors";
import { type DHTNode, RoutingTable } from "../routing";
import {
  CircuitBreaker,
  NodeContextOperationEnum,
  createNodeContext,
} from "../utils/circuit-breaker";
import { type RetryOptions, withRetry } from "../utils/retry";
import {
  DEFAULT_ALPHA,
  DEFAULT_EXPIRE_INTERVAL,
  DEFAULT_K,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_RCP_TIMEOUT,
  DEFAULT_REPUBLISH_INTERVAL,
  DEFAULT_TTL,
} from "./kademlia-node.constants";
import {
  type KademliaNodeOptions,
  LookupType,
  type NodeStats,
  type StoreValue,
} from "./kademlia-node.types";
import { LookupManager, type LookupOptions } from "./lookup-manager";

/**
 * Implementation of a Kademlia DHT node
 */
export class KademliaNode {
  // Core properties
  private readonly nodeId: NodeId;
  private readonly routingTable: RoutingTable;
  private readonly storage: Map<string, StoreValue> = new Map();
  private readonly lookupManager: LookupManager;
  // Address field is kept for future use in actual RPC implementations
  // @ts-ignore
  private readonly address: string;

  // Configuration
  private readonly k: number;
  private readonly alpha: number;
  private readonly defaultTTL: number;
  private readonly republishInterval: number;
  private readonly expireInterval: number;
  private readonly maxIterations: number;
  private readonly rpcTimeout: number;

  // Error handling
  private readonly retryOptions: Partial<RetryOptions>;
  private readonly circuitBreaker: CircuitBreaker;

  // Periodic maintenance
  private republishTimer: NodeJS.Timeout | null = null;
  private expireTimer: NodeJS.Timeout | null = null;

  // For testing access
  /** @internal */
  public readonly _testing = {
    getK: () => this.k,
    getAlpha: () => this.alpha,
    getMaxIterations: () => this.maxIterations,
    getRepublishTimer: () => this.republishTimer,
    getExpireTimer: () => this.expireTimer,
    clearTimers: () => {
      if (this.republishTimer) {
        clearInterval(this.republishTimer);
        this.republishTimer = null;
      }
      if (this.expireTimer) {
        clearInterval(this.expireTimer);
        this.expireTimer = null;
      }
    },
    getRoutingTable: () => this.routingTable,
    getStorage: () => this.storage,
    getActiveRequests: () => this.activeRequests,
    expireValues: () => this.expireValues(),
    republishValues: () => this.republishValues(),
    // For tests that need to set stat values directly
    setStatsValue: (key: keyof NodeStats, value: number) => {
      // @ts-ignore
      this.stats[key] = value;
    },
  };

  // Statistics
  private stats: NodeStats = {
    storedKeys: 0,
    storageSize: 0,
    routingTableSize: 0,
    bucketStats: [],
    successfulLookups: 0,
    failedLookups: 0,
    avgLookupTime: 0,
    valuesFetched: 0,
    valuesStored: 0,
    messagesSent: 0,
    messagesReceived: 0,
    startTime: Date.now(),
    uptime: 0,
    totalErrors: 0,
    timeoutErrors: 0,
    circuitBreakerTrips: 0,
    totalRetries: 0,
  };

  // Lookup tracking for debugging
  private activeRequests: Map<
    string,
    {
      type: LookupType;
      startTime: number;
      target: string;
      alpha: number;
      contacted: Set<string>;
    }
  > = new Map();

  /**
   * Create a new Kademlia DHT node
   * @param nodeId The unique identifier for this node
   * @param options Configuration options
   */
  constructor(nodeId: NodeId, options: KademliaNodeOptions) {
    this.nodeId = nodeId;
    this.address = options.address;

    // Initialize with provided options or defaults
    this.k = options.k ?? DEFAULT_K;
    this.alpha = options.alpha ?? DEFAULT_ALPHA;
    this.defaultTTL = options.defaultTTL ?? DEFAULT_TTL;
    this.republishInterval =
      options.republishInterval ?? DEFAULT_REPUBLISH_INTERVAL;
    this.expireInterval = options.expireInterval ?? DEFAULT_EXPIRE_INTERVAL;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.rpcTimeout = options.rpcTimeout ?? DEFAULT_RCP_TIMEOUT;

    // Initialize retry options
    this.retryOptions = {
      maxAttempts: 3,
      initialDelay: 100,
      maxDelay: 5000,
      backoffFactor: 2,
      jitter: 0.1,
      ...options.retryOptions,
      // Track retries for statistics
      onRetry: (attempt, delay, error) => {
        this.stats.totalRetries++;
        options.retryOptions?.onRetry?.(attempt, delay, error);
      },
    };

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: options.circuitBreakerOptions?.failureThreshold ?? 5,
      resetTimeout: options.circuitBreakerOptions?.resetTimeout ?? 30_000,
      isFailure: (error) => {
        return (
          error instanceof NodeTimeoutError ||
          error instanceof UnreliableNodeError
        );
      },
    });

    // Create routing table
    this.routingTable = new RoutingTable(nodeId, {
      k: this.k,
      keepBucketsSorted: true,
    });

    // Create lookup manager
    this.lookupManager = new LookupManager(
      nodeId,
      this.routingTable,
      this.activeRequests,
    );

    // Start maintenance if enabled
    if (options.enableMaintenance !== false) {
      this.startMaintenanceTasks();
    }
  }

  /**
   * Ping a node to check if it's online and responsive
   * @param targetNodeId The ID of the node to ping
   * @returns True if the node responded, false otherwise
   */
  async ping(targetNodeId: NodeId): Promise<boolean> {
    const node = this.routingTable.findNode(targetNodeId);

    if (!node) {
      return false;
    }

    const nodeIdHex = targetNodeId.toHex();
    const context = createNodeContext(nodeIdHex, NodeContextOperationEnum.PING);

    try {
      if (this.circuitBreaker.isOpen(context)) {
        this.stats.circuitBreakerTrips++;

        return false;
      }

      const result = await this.circuitBreaker.execute(async () => {
        const pingResult = await withRetry(async () => {
          // Simulate a network operation with timeout
          const pingPromise = this.sendPingRPC(node);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new NodeTimeoutError(
                  "Ping timed out",
                  NodeContextOperationEnum.PING,
                ),
              );
            }, this.rpcTimeout);
          });

          return Promise.race([pingPromise, timeoutPromise]);
        }, this.retryOptions);

        if (!pingResult.successful) {
          throw pingResult.lastError;
        }

        return pingResult.result;
      }, context);

      // Update the node's last seen timestamp in the routing table
      this.routingTable.updateNodeTimestamp(targetNodeId);

      return result;
    } catch (error) {
      this.stats.totalErrors++;

      if (error instanceof NodeTimeoutError) {
        this.stats.timeoutErrors++;
      } else if (error instanceof CircuitBreakerOpenError) {
        this.stats.circuitBreakerTrips++;
      }

      return false;
    }
  }

  /**
   * Store a value in the DHT
   * @param key The key under which to store the value
   * @param value The value to store (binary data)
   * @param ttl Optional time-to-live in milliseconds
   * @returns Promise resolving to true if storage was successful
   * @throws StoreError if the operation fails
   */
  async store(key: NodeId, value: Uint8Array, ttl?: number): Promise<boolean> {
    const keyHex = key.toHex();
    const actualTtl = ttl ?? this.defaultTTL;
    const now = Date.now();

    // Store locally
    this.storage.set(keyHex, {
      value,
      expiresAt: now + actualTtl,
      republishAt: now + this.republishInterval,
      originalPublisherNodeId: this.nodeId.toHex(),
    });

    // Update storage stats
    this.stats.storedKeys = this.storage.size;
    this.stats.storageSize += value.length;
    this.stats.valuesStored++;

    try {
      // Find the k closest nodes to the key
      const closestNodes = await this.findNode(key);

      // Store on remote nodes with controlled concurrency
      const storePromises = closestNodes.map((node) => {
        if (node.id.equals(this.nodeId)) {
          return async () => true; // Skip self
        }

        return async () => {
          const nodeIdHex = node.id.toHex();
          const context = createNodeContext(
            nodeIdHex,
            NodeContextOperationEnum.STORE,
          );

          // Skip if circuit breaker is open
          if (this.circuitBreaker.isOpen(context)) {
            this.stats.circuitBreakerTrips++;
            return false;
          }

          try {
            return await this.circuitBreaker.execute(async () => {
              const storeResult = await withRetry(async () => {
                // Simulation of actual store RPC
                const storePromise = this.sendStoreRPC(
                  node,
                  key,
                  value,
                  actualTtl,
                );
                const timeoutPromise = new Promise<never>((_, reject) => {
                  setTimeout(() => {
                    reject(new NodeTimeoutError(nodeIdHex, "store"));
                  }, this.rpcTimeout);
                });

                return Promise.race([storePromise, timeoutPromise]);
              }, this.retryOptions);

              if (!storeResult.successful) {
                throw storeResult.lastError;
              }

              return storeResult.result;
            }, context);
          } catch (error) {
            this.stats.totalErrors++;

            if (error instanceof CircuitBreakerOpenError) {
              this.stats.circuitBreakerTrips++;
            } else if (error instanceof NodeTimeoutError) {
              this.stats.timeoutErrors++;
            }

            return false;
          }
        };
      });

      // Execute store operations with concurrency control
      const results = await Promise.all(storePromises.map((fn) => fn()));

      // Return true if at least one remote store succeeded (plus we already stored locally)
      const remoteSuccess = results.some((result) => result);
      return remoteSuccess || true;
    } catch (error) {
      // Even if remote storage fails, we've stored locally
      if (error instanceof KademliaError) {
        throw error;
      }
      throw new StoreError(
        keyHex,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Send a FIND_NODE request to a remote node
   * @param node Target node to query
   * @param target NodeId to find nodes closest to
   * @param lookupId Optional ID for tracking the lookup operation
   * @returns Array of nodes returned by the target
   * @throws NodeTimeoutError if the node doesn't respond in time
   */
  async queryNode(
    node: DHTNode,
    target: NodeId,
    lookupId?: string,
  ): Promise<DHTNode[]> {
    const nodeIdHex = node.id.toHex();
    const context = createNodeContext(
      nodeIdHex,
      NodeContextOperationEnum.FIND_NODE,
    );

    // Track the node as contacted for this lookup
    if (lookupId) {
      const request = this.activeRequests.get(lookupId);
      if (request) {
        request.contacted.add(nodeIdHex);
      }
    }

    // Skip if circuit breaker is open
    if (this.circuitBreaker.isOpen(context)) {
      this.stats.circuitBreakerTrips++;
      return [];
    }

    try {
      return await this.circuitBreaker.execute(async () => {
        const queryResult = await withRetry(async () => {
          // Actual RPC call with timeout
          const queryPromise = this.sendFindNodeRPC(node, target);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new NodeTimeoutError(nodeIdHex, "findNode"));
            }, this.rpcTimeout);
          });

          return Promise.race([queryPromise, timeoutPromise]);
        }, this.retryOptions);

        if (!queryResult.successful) {
          throw queryResult.lastError;
        }

        // Update the node's last seen timestamp
        this.routingTable.updateNodeTimestamp(node.id);

        return queryResult.result;
      }, context);
    } catch (error) {
      this.stats.totalErrors++;

      if (error instanceof CircuitBreakerOpenError) {
        this.stats.circuitBreakerTrips++;
      } else if (error instanceof NodeTimeoutError) {
        this.stats.timeoutErrors++;
      }

      return [];
    }
  }

  /**
   * Find nodes closest to the target ID using recursive lookups
   * @param target The target NodeId to find nodes closest to
   * @param alpha Number of parallel lookups (typically 3)
   * @param k Number of nodes to return (typically 20)
   * @param maxIterations Maximum number of iterations to perform
   * @returns Array of the k closest nodes to the target
   */
  async findNode(
    target: NodeId,
    alpha = this.alpha,
    k = this.k,
    maxIterations = this.maxIterations,
  ): Promise<DHTNode[]> {
    const lookupId = `findNode-${target.toHex().substring(0, 8)}-${Date.now()}`;

    this.activeRequests.set(lookupId, {
      type: LookupType.NODE,
      startTime: Date.now(),
      target: target.toHex(),
      alpha,
      contacted: new Set(),
    });

    try {
      const options: LookupOptions = {
        alpha,
        k,
        maxIterations,
        lookupId,
      };

      const { nodes } = await this.lookupManager.iterativeLookup<
        never,
        DHTNode[]
      >(
        target,
        (node) => this.queryNode(node, target, lookupId),
        (nodes) => ({ nodes }),
        options,
      );

      this.stats.successfulLookups++;
      return nodes;
    } catch (error) {
      this.stats.failedLookups++;
      console.error("Find node operation failed:", error);
      return [];
    } finally {
      this.finalizeLookupStats(lookupId);
    }
  }

  /**
   * Add a node to the routing table
   * @param node The node to add
   * @returns Nodes to ping if the bucket is full
   */
  addNode(node: DHTNode): DHTNode[] {
    const result = this.routingTable.addNode(node);
    // Update routing table stats
    this.stats.routingTableSize = this.routingTable.size();
    // this.updateBucketStats();
    return result;
  }

  /**
   * Find a value in the DHT by its key
   * @param key The key to look for
   * @param alpha Number of parallel lookups (typically 3)
   * @param k Number of nodes to consider (typically 20)
   * @param maxIterations Maximum number of iterations to perform
   * @returns The value if found, null otherwise
   */
  async findValue(
    key: NodeId,
    alpha = this.alpha,
    k = this.k,
    maxIterations = this.maxIterations,
  ): Promise<Uint8Array | null> {
    const keyHex = key.toHex();
    const lookupId = `findValue-${keyHex.substring(0, 8)}-${Date.now()}`;

    this.activeRequests.set(lookupId, {
      type: LookupType.VALUE,
      startTime: Date.now(),
      target: keyHex,
      alpha,
      contacted: new Set(),
    });

    try {
      // First check local storage
      const localValue = this.storage.get(keyHex);
      if (localValue) {
        // Check if the value has expired
        if (localValue.expiresAt < Date.now()) {
          this.storage.delete(keyHex);
          // Update stats
          this.stats.storedKeys = this.storage.size;
          this.stats.storageSize -= localValue.value.length;
        } else {
          return localValue.value;
        }
      }

      const options: LookupOptions = {
        alpha,
        k,
        maxIterations,
        lookupId,
      };

      // Not found locally, search the network
      const result = await this.lookupManager.iterativeLookup<
        Uint8Array,
        { value: Uint8Array | null; closestNodes: DHTNode[] }
      >(
        key,
        (node) => this.queryNodeForValue(node, key, lookupId),
        (queryResult) => ({
          value: queryResult.value,
          nodes: queryResult.closestNodes,
        }),
        options,
      );

      // If found, cache the value locally
      if (result.value !== null) {
        this.storage.set(keyHex, {
          value: result.value,
          expiresAt: Date.now() + this.defaultTTL,
          republishAt: Date.now() + this.republishInterval,
        });

        // Update stats
        this.stats.storedKeys = this.storage.size;
        this.stats.storageSize += result.value.length;
        this.stats.valuesFetched++;
        this.stats.successfulLookups++;
      } else {
        this.stats.failedLookups++;
      }

      return result.value;
    } catch (error) {
      this.stats.failedLookups++;
      console.error("Find value operation failed:", error);
      return null;
    } finally {
      this.finalizeLookupStats(lookupId);
    }
  }

  /**
   * Query a node for a value by key
   * @param node Node to query
   * @param key Key to look for
   * @param lookupId Optional ID for tracking the lookup operation
   * @returns Object containing the value if found, and closest nodes otherwise
   * @throws NodeTimeoutError if the node doesn't respond in time
   */
  async queryNodeForValue(
    node: DHTNode,
    key: NodeId,
    lookupId?: string,
  ): Promise<{ value: Uint8Array | null; closestNodes: DHTNode[] }> {
    const nodeIdHex = node.id.toHex();
    const context = createNodeContext(
      nodeIdHex,
      NodeContextOperationEnum.FIND_VALUE,
    );

    // Track the node as contacted for this lookup
    if (lookupId) {
      const request = this.activeRequests.get(lookupId);
      if (request) {
        request.contacted.add(nodeIdHex);
      }
    }

    // Skip if circuit breaker is open
    if (this.circuitBreaker.isOpen(context)) {
      this.stats.circuitBreakerTrips++;
      return { value: null, closestNodes: [] };
    }

    try {
      return await this.circuitBreaker.execute(async () => {
        const queryResult = await withRetry(async () => {
          // Actual RPC call with timeout
          const queryPromise = this.sendFindValueRPC(node, key);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new NodeTimeoutError(
                  nodeIdHex,
                  NodeContextOperationEnum.FIND_VALUE,
                ),
              );
            }, this.rpcTimeout);
          });

          return Promise.race([queryPromise, timeoutPromise]);
        }, this.retryOptions);

        if (!queryResult.successful) {
          throw queryResult.lastError;
        }

        // Update the node's last seen timestamp
        this.routingTable.updateNodeTimestamp(node.id);

        return queryResult.result;
      }, context);
    } catch (error) {
      this.stats.totalErrors++;

      if (error instanceof CircuitBreakerOpenError) {
        this.stats.circuitBreakerTrips++;
      } else if (error instanceof NodeTimeoutError) {
        this.stats.timeoutErrors++;
      }

      return { value: null, closestNodes: [] };
    }
  }

  /**
   * Get statistics about this node's operation
   */
  getStats(): NodeStats {
    const now = Date.now();
    this.stats.uptime = now - this.stats.startTime;
    return { ...this.stats };
  }

  /**
   * Start the periodic maintenance tasks
   */
  startMaintenanceTasks(): void {
    // Stop any existing timers
    this.stopMaintenanceTasks();

    // Check for expired values
    this.expireTimer = setInterval(() => {
      this.expireValues();
    }, this.expireInterval);

    // Republish values
    this.republishTimer = setInterval(async () => {
      await this.republishValues();
    }, this.republishInterval / 10); // Check more frequently than the actual interval
  }

  /**
   * Stop all periodic maintenance tasks
   */
  stopMaintenanceTasks(): void {
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }

    if (this.republishTimer) {
      clearInterval(this.republishTimer);
      this.republishTimer = null;
    }
  }

  /**
   * Remove nodes from the routing table that haven't been seen in a while
   * @param maxAge Maximum age in milliseconds before a node is considered stale
   */
  async refreshBuckets(maxAge = 60 * 60 * 1000): Promise<void> {
    const bucketsToRefresh = this.routingTable.getBucketsNeedingRefresh(maxAge);

    for (const bucketIndex of bucketsToRefresh) {
      // Generate a random ID in this bucket's range to refresh it
      let randomId: NodeId;

      if (bucketIndex === 0) {
        // For bucket 0, use a completely random ID
        randomId = NodeId.random();
      } else {
        // For other buckets, create an ID that differs from our node ID
        // at exactly the bit position that corresponds to the bucket index
        const idBytes = this.nodeId.getBytes();
        // Flip the bit at bucketIndex position
        const bitPos = bucketIndex;
        const byteIndex = Math.floor(bitPos / 8);
        const bitInByte = bitPos % 8;
        idBytes[byteIndex] ^= 1 << (7 - bitInByte);
        randomId = new NodeId(idBytes);
      }

      try {
        // Perform a findNode to refresh this bucket
        await this.findNode(randomId);

        // Mark the bucket as refreshed
        this.routingTable.markBucketAsRefreshed(bucketIndex);
      } catch (error) {
        console.error(`Error refreshing bucket ${bucketIndex}:`, error);
      }
    }
  }

  /**
   * Check for and remove expired values
   */
  private expireValues(): void {
    const now = Date.now();
    let removedSize = 0;

    // Check all stored values
    for (const [keyHex, storeValue] of this.storage.entries()) {
      if (storeValue.expiresAt < now) {
        removedSize += storeValue.value.length;
        this.storage.delete(keyHex);
      }
    }

    // Update stats if any values were removed
    if (removedSize > 0) {
      this.stats.storedKeys = this.storage.size;
      this.stats.storageSize -= removedSize;
    }
  }

  /**
   * Republish values that are due for republishing
   */
  private async republishValues(): Promise<void> {
    const now = Date.now();
    const valuesToRepublish: Array<{
      key: NodeId;
      value: Uint8Array;
      ttl: number;
    }> = [];

    // Find values that need republishing
    for (const [keyHex, storeValue] of this.storage.entries()) {
      if (storeValue.republishAt < now) {
        // Only republish if we were the original publisher or close to the key
        const nodeIdHex = this.nodeId.toHex();
        if (storeValue.originalPublisherNodeId === nodeIdHex) {
          const key = NodeId.fromHex(keyHex);
          const ttl = storeValue.expiresAt - now;

          if (ttl > 0) {
            valuesToRepublish.push({
              key,
              value: storeValue.value,
              ttl,
            });
          }
        }

        // Update the republish time regardless
        storeValue.republishAt = now + this.republishInterval;
      }
    }

    // Republish values in parallel
    const republishPromises = valuesToRepublish.map(({ key, value, ttl }) =>
      this.store(key, value, ttl),
    );

    await Promise.all(republishPromises);
  }

  /**
   * Finalizes a lookup operation by updating performance statistics and cleaning up tracking data.
   * This method:
   * 1. Calculates the duration of the lookup operation
   * 2. Updates the average lookup time using a weighted average
   * 3. Removes the lookup request from the active requests tracking
   *
   * @param lookupId The unique identifier of the lookup operation to finalize
   * @private
   */
  private finalizeLookupStats(lookupId: string): void {
    const request = this.activeRequests.get(lookupId);
    if (request) {
      const duration = Date.now() - request.startTime;
      this.stats.avgLookupTime =
        (this.stats.avgLookupTime * this.stats.successfulLookups + duration) /
        (this.stats.successfulLookups + 1);
      this.activeRequests.delete(lookupId);
    }
  }

  /**
   * Send an actual PING RPC (to be implemented with real network code)
   * @param node Node to ping
   * @returns Promise resolving to true if successful
   */
  private async sendPingRPC(node: DHTNode): Promise<boolean> {
    console.log("Ping RPC", node);

    // TODO: Implement actual RPC ping
    // For now, we'll simulate a successful ping
    this.stats.messagesSent++;
    this.stats.messagesReceived++;

    return true;
  }

  /**
   * Send a STORE RPC (to be implemented with real network code)
   * @param node Target node
   * @param key Key to store
   * @param value Value to store
   * @param ttl Time to live in milliseconds
   * @returns Promise resolving to true if successful
   */
  private async sendStoreRPC(
    node: DHTNode,
    key: NodeId,
    value: Uint8Array,
    ttl: number,
  ): Promise<boolean> {
    console.log("Store RPC", node, key, value, ttl);

    // TODO: Implement actual RPC store
    // For now just simulating network activity
    this.stats.messagesSent++;
    this.stats.messagesReceived++;

    return true;
  }

  /**
   * Send a FIND_NODE RPC (to be implemented with real network code)
   * @param node Target node
   * @param target Target ID to find nodes for
   * @returns Promise resolving to array of nodes
   */
  private async sendFindNodeRPC(
    node: DHTNode,
    target: NodeId,
  ): Promise<DHTNode[]> {
    console.log("FindNodeRPC", node, target);

    // TODO: Implement the actual RPC call
    // For now simulate a successful response with empty results
    this.stats.messagesSent++;
    this.stats.messagesReceived++;

    return [];
  }

  /**
   * Send a FIND_VALUE RPC (to be implemented with real network code)
   * @param node Target node
   * @param key Key to find
   * @returns Promise resolving to value or closest nodes
   */
  private async sendFindValueRPC(
    node: DHTNode,
    key: NodeId,
  ): Promise<{ value: Uint8Array | null; closestNodes: DHTNode[] }> {
    console.log("FindValueRPC", node, key);

    // TODO: Implement the actual RPC call
    this.stats.messagesSent++;
    this.stats.messagesReceived++;

    return { value: null, closestNodes: [] };
  }
}
