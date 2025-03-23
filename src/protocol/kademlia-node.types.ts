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
