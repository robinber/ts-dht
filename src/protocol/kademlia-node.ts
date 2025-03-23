import { NodeId, calculateScalarDistance, compareDistances } from "../core";
import { type DHTNode, RoutingTable } from "../routing";

// Kademlia protocol constants
const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour
const DEFAULT_ALPHA = 3; // Concurrency parameter
const DEFAULT_K = 20; // Bucket size & max returned nodes
const DEFAULT_MAX_ITERATIONS = 20; // Maximum lookup iterations
const DEFAULT_REPUBLISH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_EXPIRE_INTERVAL = 60 * 1000; // 1 minute

/**
 * Data structure for stored values in the DHT
 */
export type StoreValue = {
  value: Uint8Array;
  expiresAt: number;
  republishAt: number;
  originalPublisherNodeId?: string; // Used for republishing
};

/**
 * Configuration options for a Kademlia node
 */
export type KademliaNodeOptions = {
  /**
   * Network address in the format "ip:port"
   */
  address: `${string}:${number}`;

  /**
   * k-bucket size (default: 20)
   */
  k?: number;

  /**
   * Concurrency parameter for lookups (default: 3)
   */
  alpha?: number;

  /**
   * Default time-to-live for stored values in milliseconds (default: 1 hour)
   */
  defaultTTL?: number;

  /**
   * Interval for republishing stored values in milliseconds (default: 24 hours)
   */
  republishInterval?: number;

  /**
   * Interval for checking expired values in milliseconds (default: 1 minute)
   */
  expireInterval?: number;

  /**
   * Maximum number of iterations for iterative lookups (default: 20)
   */
  maxIterations?: number;

  /**
   * Whether to enable automated maintenance tasks (default: true)
   */
  enableMaintenance?: boolean;
};

/**
 * Lookup types for different Kademlia operations
 */
export enum LookupType {
  NODE = "NODE",
  VALUE = "VALUE",
  STORE = "STORE",
}

/**
 * Statistics for monitoring the node's performance
 */
export type NodeStats = {
  // Storage stats
  storedKeys: number;
  storageSize: number; // Approximate bytes used

  // Routing stats
  routingTableSize: number;
  bucketStats: Array<{
    index: number;
    size: number;
    utilization: number;
  }>;

  // Operation stats
  successfulLookups: number;
  failedLookups: number;
  avgLookupTime: number;
  valuesFetched: number;
  valuesStored: number;

  // Network stats
  messagesSent: number;
  messagesReceived: number;

  // Uptime
  startTime: number;
  uptime: number;
};

/**
 * Implementation of a Kademlia DHT node
 */
export class KademliaNode {
  // Core properties
  private readonly nodeId: NodeId;
  private readonly routingTable: RoutingTable;
  private readonly storage: Map<string, StoreValue> = new Map();
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

    // Create routing table
    this.routingTable = new RoutingTable(nodeId, {
      k: this.k,
      keepBucketsSorted: true,
    });

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

    try {
      // TODO: Implement actual RPC ping
      // For now, we'll simulate a successful ping
      this.stats.messagesSent++;
      this.stats.messagesReceived++;

      // Update the node's last seen timestamp in the routing table
      this.routingTable.updateNodeTimestamp(targetNodeId);
      return true;
    } catch (error) {
      console.error(`Failed to ping node ${targetNodeId.toHex()}:`, error);
      return false;
    }
  }

  /**
   * Store a value in the DHT
   * @param key The key under which to store the value
   * @param value The value to store (binary data)
   * @param ttl Optional time-to-live in milliseconds
   * @returns Promise resolving to true if storage was successful
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

    // Find the k closest nodes to the key
    const closestNodes = await this.findNode(key);

    // Store on remote nodes
    const storePromises = closestNodes.map(async (node) => {
      if (node.id.equals(this.nodeId)) {
        return true; // Skip self
      }

      try {
        // TODO: Implement actual RPC store operation
        // For now just simulating network activity
        this.stats.messagesSent++;
        return true;
      } catch (error) {
        console.error(
          `Failed to store value at node ${node.id.toHex()}:`,
          error,
        );
        return false;
      }
    });

    // Wait for all store operations to complete
    const results = await Promise.all(storePromises);

    // Return true if at least one remote store succeeded
    // (plus we already stored locally)
    return results.some((result) => result) || true;
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
      const { nodes } = await this.iterativeLookup<never, DHTNode[]>(
        target,
        (node) => this.queryNode(node, target, lookupId),
        (nodes) => ({ nodes }),
        {
          alpha,
          k,
          maxIterations,
          lookupId,
        },
      );

      this.stats.successfulLookups++;
      return nodes;
    } catch (error) {
      this.stats.failedLookups++;
      console.error("Find node operation failed:", error);
      return [];
    } finally {
      const request = this.activeRequests.get(lookupId);
      if (request) {
        const duration = Date.now() - request.startTime;
        // Update average lookup time using a weighted average
        this.stats.avgLookupTime =
          (this.stats.avgLookupTime * this.stats.successfulLookups + duration) /
          (this.stats.successfulLookups + 1);
        this.activeRequests.delete(lookupId);
      }
    }
  }

  /**
   * Send a FIND_NODE request to a remote node
   * @param node Target node to query
   * @param target NodeId to find nodes closest to
   * @param lookupId Optional ID for tracking the lookup operation
   * @returns Array of nodes returned by the target
   */
  async queryNode(
    node: DHTNode,
    target: NodeId,
    lookupId?: string,
  ): Promise<DHTNode[]> {
    try {
      // Track the node as contacted for this lookup
      if (lookupId) {
        const request = this.activeRequests.get(lookupId);
        if (request) {
          request.contacted.add(node.id.toHex());
        }
      }

      this.stats.messagesSent++;

      // TODO: Implement the actual RPC call
      // 1. Serialize the request
      // 2. Send it to the node using its address
      // 3. Wait for and parse the response
      // 4. Return the nodes from the response

      // For now simulate a successful response with empty results
      this.stats.messagesReceived++;

      // Update the node's last seen timestamp
      this.routingTable.updateNodeTimestamp(node.id);

      return [];
    } catch (error) {
      console.error(`Failed to query node ${node.id.toHex()}:`, error);
      return [];
    }
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

      // Not found locally, search the network
      const result = await this.iterativeLookup<
        Uint8Array,
        { value: Uint8Array | null; closestNodes: DHTNode[] }
      >(
        key,
        (node) => this.queryNodeForValue(node, key, lookupId),
        (queryResult) => ({
          value: queryResult.value,
          nodes: queryResult.closestNodes,
        }),
        {
          alpha,
          k,
          maxIterations,
          lookupId,
        },
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
      const request = this.activeRequests.get(lookupId);
      if (request) {
        const duration = Date.now() - request.startTime;
        this.stats.avgLookupTime =
          (this.stats.avgLookupTime * this.stats.successfulLookups + duration) /
          (this.stats.successfulLookups + 1);
        this.activeRequests.delete(lookupId);
      }
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
   * Query a node for a value by key
   * @param node Node to query
   * @param key Key to look for
   * @param lookupId Optional ID for tracking the lookup operation
   * @returns Object containing the value if found, and closest nodes otherwise
   */
  async queryNodeForValue(
    node: DHTNode,
    key: NodeId,
    lookupId?: string,
  ): Promise<{ value: Uint8Array | null; closestNodes: DHTNode[] }> {
    try {
      // Track the node as contacted for this lookup
      if (lookupId) {
        const request = this.activeRequests.get(lookupId);
        if (request) {
          request.contacted.add(node.id.toHex());
        }
      }

      this.stats.messagesSent++;

      // TODO: Implement the actual RPC call
      // 1. Send a FIND_VALUE RPC to the node
      // 2. The node would check its local storage for the key
      // 3. If found, it would return the value
      // 4. If not found, it would return its k closest nodes to the key

      // Update the node's last seen timestamp
      this.routingTable.updateNodeTimestamp(node.id);
      this.stats.messagesReceived++;

      return { value: null, closestNodes: [] };
    } catch (error) {
      console.error(
        `Failed to query node ${node.id.toHex()} for value:`,
        error,
      );
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
    this.republishTimer = setInterval(() => {
      this.republishValues();
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

      // Perform a findNode to refresh this bucket
      await this.findNode(randomId);

      // Mark the bucket as refreshed
      this.routingTable.markBucketAsRefreshed(bucketIndex);
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
   * Update statistics about bucket utilization
   */
  // private updateBucketStats(): void {
  //   this.stats.bucketStats = [];
  //   const bucketCount = this.routingTable.getBucketCount();
  //   const routingTableBuckets = this.routingTable.getBuckets();
  //
  //   for (let i = 0; i < bucketCount; i++) {
  //     // Get bucket stats through the buckets array
  //     // This is a workaround as we don't have a formal getBucketStats method yet
  //     const bucket = routingTableBuckets.get(i);
  //     if (bucket) {
  //       this.stats.bucketStats.push({
  //         index: i,
  //         size: bucket.nodes.length,
  //         utilization: bucket.nodes.length / this.k,
  //       });
  //     }
  //   }
  // }

  /**
   * Check if a node is in a list of nodes
   */
  private isNodeInList(nodeId: NodeId, list: DHTNode[]): boolean {
    return list.some((node) => node.id.equals(nodeId));
  }

  /**
   * Implementation of the iterative lookup algorithm used by both findNode and findValue
   */
  private async iterativeLookup<TValue, TQueryResult>(
    targetId: NodeId,
    queryFn: (node: DHTNode) => Promise<TQueryResult>,
    processResults: (result: TQueryResult) => {
      value?: TValue | null;
      nodes: DHTNode[];
    },
    options: {
      alpha: number;
      k: number;
      maxIterations: number;
      lookupId?: string;
    },
  ): Promise<{ value: TValue | null; nodes: DHTNode[] }> {
    const { alpha, k, maxIterations } = options;
    const queriedNodes = new Set<string>();
    const pendingNodes = new Set<string>();
    const closestNodes = this.routingTable.findClosestNodes(targetId, k);

    let currentClosestNodes = [...closestNodes];
    let foundValue: TValue | null = null;
    let iterations = 0;
    let progressMade = true;

    // Calculate the distance of our closest node before the lookup
    let closestDistanceBefore = BigInt(0);
    if (currentClosestNodes.length > 0) {
      closestDistanceBefore = calculateScalarDistance(
        targetId,
        currentClosestNodes[0].id,
      );
    }

    // Keep track of the closest distance seen so far
    let closestDistanceSeen = closestDistanceBefore;

    while (iterations < maxIterations && (progressMade || iterations === 1)) {
      iterations++;
      progressMade = false;

      // Select up to alpha nodes to query that haven't been queried yet
      const nodesToQuery: DHTNode[] = [];
      for (const node of currentClosestNodes) {
        const nodeIdHex = node.id.toHex();

        // Skip if already queried or is pending
        if (queriedNodes.has(nodeIdHex) || pendingNodes.has(nodeIdHex)) {
          continue;
        }

        nodesToQuery.push(node);
        pendingNodes.add(nodeIdHex);

        if (nodesToQuery.length >= alpha) {
          break;
        }
      }

      // If no nodes to query, we're done
      if (nodesToQuery.length === 0) {
        break;
      }

      // Query the nodes and wait for all responses
      const results = await Promise.all(
        nodesToQuery.map(async (node) => {
          const nodeIdHex = node.id.toHex();
          queriedNodes.add(nodeIdHex);
          pendingNodes.delete(nodeIdHex);

          const result = await queryFn(node);
          return { node, result };
        }),
      );

      // Process the results
      for (const { result } of results) {
        const { value, nodes } = processResults(result);

        // If we found a value, we're done
        if (value !== null && value !== undefined) {
          foundValue = value;
          break;
        }

        // Process returned nodes and add them to our routing table
        for (const newNode of nodes) {
          // Skip ourselves
          if (this.nodeId.equals(newNode.id)) {
            continue;
          }

          // Skip if already queried, pending, or in our closest nodes list
          const nodeIdHex = newNode.id.toHex();
          if (queriedNodes.has(nodeIdHex) || pendingNodes.has(nodeIdHex)) {
            continue;
          }

          const alreadyInList = this.isNodeInList(
            newNode.id,
            currentClosestNodes,
          );

          if (!alreadyInList) {
            // Add to routing table and closest nodes list
            this.routingTable.addNode(newNode);
            currentClosestNodes.push(newNode);

            // Check if this node is closer than any we've seen
            const distance = calculateScalarDistance(targetId, newNode.id);
            if (distance < closestDistanceSeen) {
              closestDistanceSeen = distance;
              progressMade = true;
            }
          }
        }
      }

      // If we found a value, we're done
      if (foundValue !== null) {
        break;
      }

      // Sort nodes by distance and keep only the k closest
      currentClosestNodes.sort((a, b) =>
        compareDistances(targetId, a.id, b.id),
      );
      currentClosestNodes = currentClosestNodes.slice(0, k);
    }

    return {
      value: foundValue,
      nodes: currentClosestNodes,
    };
  }
}
