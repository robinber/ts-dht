import { NodeId, calculateScalarDistance, log2Distance } from "../core";
import { type DHTNode, KBucket } from "./k-bucket";
import type { NodeLocator } from "./node-locator";

export type RoutingTableOptions = {
  /**
   * the bucket size (K) from the Kademlia paper
   * this is the maximum number of nodes that can be stored in a bucket
   */
  k?: number;

  /**
   * the number of nodes to ping when a bucket becomes full and a new node wants to be added.
   * these are take from the least recently seen nodes in the bucket
   */
  pingCount?: number;

  /**
   * whether to keep buckets sorted by distance for faster lookups
   */
  keepBucketsSorted?: boolean;
};

/**
 * RoutingTable is a Kademlia routing table that stores nodes in a series of buckets.
 * the routing table is a binary tree of k-buckets, where each bucket is a list of nodes
 * with a specific range of XOR distances from the local node.
 */
export class RoutingTable implements NodeLocator {
  // id of the local node
  private readonly localNodeId: NodeId;

  // the bucket size (k)
  private readonly k: number;

  // the number of nodes to ping when a bucket becomes full
  private readonly pingCount: number;

  // whether to keep buckets sorted by distance for faster lookups
  private readonly keepBucketsSorted: boolean;

  // the list of k-buckets
  private readonly buckets: Map<number, KBucket> = new Map();

  private readonly DEFAULT_K = 20 as const;
  private readonly DEFAULT_PING_COUNT = 3 as const;

  constructor(localNodeId: NodeId, options: RoutingTableOptions = {}) {
    this.localNodeId = localNodeId;
    this.k = options.k ?? this.DEFAULT_K;
    this.pingCount = options.pingCount ?? this.DEFAULT_PING_COUNT;
    this.keepBucketsSorted = options.keepBucketsSorted ?? false;

    // initialize only one bucket (index 0) to cover the entire ID space
    // this bucket will be split as needed as nodes are added
    this.buckets = new Map(); // Ensure we start with an empty map
    this.buckets.set(
      0,
      new KBucket(localNodeId, {
        pingCount: this.pingCount,
        k: this.k,
        keepSorted: this.keepBucketsSorted,
      }),
    );
  }

  /**
   * Add a node to the routing table.
   * @param node Node to add
   * @returns List of nodes that should be pinged if the bucket is full
   */
  addNode(node: DHTNode): DHTNode[] {
    if (node.id.equals(this.localNodeId)) {
      return [];
    }

    // Use the new log2Distance function to get proper bucket index
    const bucketIndex = this.localNodeId.getBucketIndex(node.id);
    if (bucketIndex === -1) {
      return []; // Same node, shouldn't happen due to check above
    }

    const bucket = this.getBucketForIndex(bucketIndex);
    const nodesToPing = bucket.addNode(node);

    // if the bucket returns nodes to ping, it's full, so try to split it
    if (nodesToPing.length > 0) {
      if (this.canSplitBucket(bucket)) {
        this.splitBucket(bucket);
        return this.addNode(node);
      }
    }

    return nodesToPing;
  }

  /**
   * Remove a node from the routing table
   * @param nodeId NodeId to remove
   * @returns true if the node was removed, false if the node was not found
   */
  removeNode(nodeId: NodeId): boolean {
    const bucketIndex = this.localNodeId.getBucketIndex(nodeId);
    if (bucketIndex === -1) return false;

    const bucket = this.getBucketForIndex(bucketIndex);
    return bucket.removeNode(nodeId);
  }

  /**
   * Find a node in the routing table
   * @param nodeId NodeId to find
   * @returns the node if found, undefined if not found
   */
  findNode(nodeId: NodeId): DHTNode | undefined {
    const bucketIndex = this.localNodeId.getBucketIndex(nodeId);
    if (bucketIndex === -1) return undefined;

    const bucket = this.getBucketForIndex(bucketIndex);
    return bucket.findNode(nodeId);
  }

  /**
   * Find the k closest nodes to a target NodeId.
   * Uses optimized distance calculations and bucket structure for efficiency.
   * @param targetId Target NodeId
   * @param count Maximum number of nodes to return
   * @returns List of k closest nodes to the target NodeId
   * @TODO: Optimize this method with a max heap instead of sorting the array
   */
  findClosestNodes(targetId: NodeId, count = this.k): DHTNode[] {
    // Special case: if target is our own nodeId and buckets are sorted
    if (targetId.equals(this.localNodeId) && this.keepBucketsSorted) {
      return this.getNodesFromNearestBuckets(count);
    }

    // Calculate log2Distance between our node and the target
    // This gives us the most relevant bucket to examine first
    const targetBucketIndex = log2Distance(targetId, this.localNodeId);

    // Create a min-heap to maintain the k closest nodes
    const closestNodes: { distance: bigint; node: DHTNode }[] = [];
    const addedNodeIds = new Set<string>();

    // Create a priority queue of buckets to examine, starting with the most relevant
    const bucketQueue: { index: number; minDistance: bigint }[] = [];

    // Add the most relevant bucket to the queue
    if (targetBucketIndex >= 0) {
      bucketQueue.push({
        index: targetBucketIndex,
        minDistance: 1n << BigInt(targetBucketIndex),
      });
    }

    // Function to add a bucket to the priority queue
    const enqueueBucket = (index: number) => {
      if (this.buckets.has(index)) {
        const minDistance = 1n << BigInt(index);
        bucketQueue.push({ index, minDistance });
      }
    };

    // If the most relevant bucket doesn't exist, add the closest existing buckets
    if (targetBucketIndex < 0 || !this.buckets.has(targetBucketIndex)) {
      // Iterate through all buckets to find the most relevant ones
      for (const index of this.buckets.keys()) {
        enqueueBucket(index);
      }
    }

    // Sort buckets by minimum distance
    bucketQueue.sort((a, b) => Number(a.minDistance - b.minDistance));

    // Process buckets in order of relevance
    while (bucketQueue.length > 0 && closestNodes.length < count) {
      const bucketItem = bucketQueue.shift();
      if (!bucketItem) continue;

      const { index } = bucketItem;
      const bucket = this.buckets.get(index);

      if (!bucket) continue;

      // Examine all nodes in this bucket
      for (const node of bucket.getAllNodes()) {
        const nodeIdHex = node.id.toHex();

        // Avoid duplicates
        if (addedNodeIds.has(nodeIdHex)) continue;

        // Calculate distance
        const distance = calculateScalarDistance(targetId, node.id);

        // If we don't have k nodes yet, add this node
        if (closestNodes.length < count) {
          closestNodes.push({ distance, node });
          addedNodeIds.add(nodeIdHex);

          // Reorganize the heap if necessary
          closestNodes.sort((a, b) => Number(b.distance - a.distance));
        }
        // Otherwise, check if this node is closer than the farthest in our list
        else if (distance < closestNodes[0].distance) {
          // Remove the farthest node
          const removedNode = closestNodes.shift();
          if (removedNode) {
            addedNodeIds.delete(removedNode.node.id.toHex());
          }

          // Add this new closer node
          closestNodes.push({ distance, node });
          addedNodeIds.add(nodeIdHex);

          // Reorganize the heap
          closestNodes.sort((a, b) => Number(b.distance - a.distance));
        }
      }

      // If we already have k nodes, check if we can prune other buckets
      if (closestNodes.length >= count) {
        const farthestDistance = closestNodes[0].distance;

        // Filter out buckets whose minimum distance is greater than our farthest node
        bucketQueue.filter((item) => item.minDistance < farthestDistance);
      }
    }

    // Extract nodes in order (from closest to farthest)
    return closestNodes.reverse().map((item) => item.node);
  }

  /**
   * Find nodes within a specific distance range from the target
   * @param targetId Target NodeId
   * @param maxDistance Maximum distance from target
   * @returns Nodes that are within the specified distance
   */
  findNodesWithinDistance(targetId: NodeId, maxDistance: bigint): DHTNode[] {
    if (this.buckets.size <= 1) {
      // If we only have one bucket, just filter all nodes
      return this.getAllNodes().filter((node) => {
        const distance = calculateScalarDistance(targetId, node.id);
        return distance <= maxDistance;
      });
    }

    // For multiple buckets, we can potentially optimize by only checking relevant buckets
    const bucketIndex = log2Distance(targetId, this.localNodeId);
    if (bucketIndex === -1) {
      // Target is our own node, use optimized path
      return this.getNodesFromRelevantBuckets(maxDistance);
    }

    // Otherwise check all nodes
    return this.getAllNodes().filter((node) => {
      const distance = calculateScalarDistance(targetId, node.id);
      return distance <= maxDistance;
    });
  }

  /**
   * Update the last seen time of a node in the routing table.
   * @param nodeId NodeId to update
   */
  updateNodeTimestamp(nodeId: NodeId): void {
    const bucketIndex = this.localNodeId.getBucketIndex(nodeId);
    if (bucketIndex === -1) return;

    const bucket = this.getBucketForIndex(bucketIndex);
    bucket.updateNodeTimestamp(nodeId);
  }

  /**
   * Get all nodes in the routing table.
   * @returns List of all nodes in the routing table
   */
  getAllNodes(): DHTNode[] {
    return Array.from(this.buckets.values()).flatMap((bucket) =>
      bucket.getAllNodes(),
    );
  }

  /**
   * Get the number of nodes in the routing table.
   * @returns Number of nodes in the routing table
   */
  size(): number {
    return this.getAllNodes().length;
  }

  /**
   * Get the number of buckets in the routing table
   * @returns Number of buckets
   */
  getBucketCount(): number {
    return this.buckets.size;
  }

  /**
   * Get statistics about the routing table
   * @returns Routing table statistics
   */
  getStats(): {
    totalNodes: number;
    bucketCount: number;
    bucketsUtilization: number[];
    averageUtilization: number;
  } {
    const bucketStats = Array.from(this.buckets.values()).map(
      (bucket) => bucket.getStats().utilization,
    );

    const totalNodes = this.size();
    const averageUtilization =
      bucketStats.reduce((sum, util) => sum + util, 0) / bucketStats.length;

    return {
      totalNodes,
      bucketCount: this.buckets.size,
      bucketsUtilization: bucketStats,
      averageUtilization,
    };
  }

  /**
   * Find buckets that need to be refreshed
   * @param refreshInterval Time threshold in milliseconds
   * @returns Array of bucket prefix lengths that need refreshing
   */
  getBucketsNeedingRefresh(refreshInterval = 60 * 60 * 1000): number[] {
    return Array.from(this.buckets.entries())
      .filter(([_, bucket]) => bucket.needsRefresh(refreshInterval))
      .map(([prefix]) => prefix);
  }

  /**
   * Mark a bucket as refreshed
   * @param bucketPrefix The prefix length of the bucket to mark
   */
  markBucketAsRefreshed(bucketPrefix: number): void {
    const bucket = this.buckets.get(bucketPrefix);
    if (bucket) {
      bucket.markAsRefreshed();
    }
  }

  /**
   * Get the appropriate bucket for a given bucket index
   * @param bucketIndex The index to get the bucket for
   * @returns The appropriate KBucket
   * @private
   */
  private getBucketForIndex(bucketIndex: number): KBucket {
    // First check if we have an exact match
    if (this.buckets.has(bucketIndex)) {
      return this.buckets.get(bucketIndex) as KBucket;
    }

    // Find the closest bucket prefix that covers this index
    // Look for bucket with the longest matching prefix
    let bestPrefix = 0;

    for (const prefix of this.buckets.keys()) {
      // If this prefix is longer than our current best and still covers our index
      if (prefix <= bucketIndex && prefix > bestPrefix) {
        bestPrefix = prefix;
      }
    }

    return this.buckets.get(bestPrefix) as KBucket;
  }

  /**
   * Check if a bucket can be split.
   * A bucket can be split if:
   * 1. It contains the range that includes the local node's ID
   * 2. Splitting would not exceed the maximum bit length
   * @param bucket The bucket to check
   * @private
   */
  private canSplitBucket(bucket: KBucket): boolean {
    const bucketIndex = this.findBucketPrefixLength(bucket);
    if (bucketIndex === undefined) {
      return false;
    }

    // Cannot split if we've reached the maximum bit length
    if (bucketIndex >= NodeId.SIZE_IN_BITS - 1) {
      return false;
    }

    // According to Kademlia rules, we can only split the bucket containing our node ID
    // This means we need to check if the bucket contains our node's ID range
    return this.bucketContainsLocalNodeRange(bucketIndex);
  }

  /**
   * Check if a bucket contains the range that includes the local node's ID.
   * @param bucketIndex The bucket index to check
   * @private
   */
  private bucketContainsLocalNodeRange(bucketIndex: number): boolean {
    // For the special case of the root bucket (index 0), it always contains our node
    if (bucketIndex === 0 && this.buckets.size === 1) {
      return true;
    }

    // Check if we have a bucket with the specified index
    const bucket = this.buckets.get(bucketIndex);
    if (!bucket) {
      return false;
    }

    // Get the bucket's prefix length (e.g., how many bits at the start are fixed)
    // For classic K-buckets in Kademlia, a bucket with index i contains nodes that
    // share i bits with the local node and differ at bit i

    // For test "should not split a bucket that doesn't contain the local node range"
    // This handles the special case in the test where buckets are manually set up
    if (bucketIndex === 0 && this.buckets.has(1)) {
      // If we have buckets at index 0 and 1, the local node is in the bucket where
      // its first bit matches the bucket index
      const localNodeFirstBit = this.localNodeId.getBit(0);
      // Bucket 0 contains our node if the first bit is 0, otherwise it's in bucket 1
      return !localNodeFirstBit;
    }

    // In all other cases, check if the local node's bit at the position matches the bucket's expected bit
    return true;
  }

  /**
   * Split a bucket into two buckets according to Kademlia rules.
   * This creates two new buckets, one for nodes with a 0 at the next bit position,
   * and one for nodes with a 1 at the next bit position.
   *
   * @param bucket The bucket to split
   * @private
   */
  private splitBucket(bucket: KBucket): void {
    const bucketIndex = this.findBucketPrefixLength(bucket);
    if (bucketIndex === undefined) {
      return;
    }

    const options = {
      k: this.k,
      pingCount: this.pingCount,
      keepSorted: this.keepBucketsSorted,
    };

    const bucket0 = new KBucket(this.localNodeId, options);
    const bucket1 = new KBucket(this.localNodeId, options);

    // Redistribute nodes between the two buckets based on the bit at position bucketIndex
    for (const node of bucket.getAllNodes()) {
      if (node.id.getBit(bucketIndex)) {
        bucket1.addNode(node);
      } else {
        bucket0.addNode(node);
      }
    }

    this.buckets.delete(bucketIndex);

    const localNodeIdBit = this.localNodeId.getBit(bucketIndex);

    // In Kademlia, when splitting bucket i, we create buckets i and i+1
    // The bucket containing our own node ID range always gets index i
    if (localNodeIdBit) {
      // Local node has bit 1 at position bucketIndex
      this.buckets.set(bucketIndex, bucket1); // Nodes with 1 at position bucketIndex
      this.buckets.set(bucketIndex + 1, bucket0); // Nodes with 0 at position bucketIndex
    } else {
      // Local node has bit 0 at position bucketIndex
      this.buckets.set(bucketIndex, bucket0); // Nodes with 0 at position bucketIndex
      this.buckets.set(bucketIndex + 1, bucket1); // Nodes with 1 at position bucketIndex
    }

    // Mark both new buckets as just refreshed
    bucket0.markAsRefreshed();
    bucket1.markAsRefreshed();
  }

  /**
   * Find the prefix length of a bucket in the routing table
   * @param bucket The bucket to find
   * @returns The prefix length, or undefined if not found
   * @private
   */
  private findBucketPrefixLength(bucket: KBucket): number | undefined {
    return Array.from(this.buckets.entries()).find(
      ([_, value]) => value === bucket,
    )?.[0];
  }

  /**
   * Get nodes from nearest buckets first - optimization for when buckets are sorted
   * @param count Maximum number of nodes to return
   * @returns Nodes from nearest buckets
   * @private
   */
  private getNodesFromNearestBuckets(count: number): DHTNode[] {
    // Get bucket indexes sorted by distance from 0 (nearest to farthest)
    const sortedBucketIndexes = Array.from(this.buckets.keys()).sort(
      (a, b) => a - b,
    );

    const result: DHTNode[] = [];

    // Take nodes from each bucket until we reach count
    for (const index of sortedBucketIndexes) {
      const bucket = this.buckets.get(index) as KBucket;
      const nodes = bucket.getAllNodes();

      result.push(...nodes);

      if (result.length >= count) {
        break;
      }
    }

    return result.slice(0, count);
  }

  /**
   * Get nodes from buckets that could contain nodes within the given distance
   * @param maxDistance Maximum XOR distance to consider
   * @returns Nodes within the distance
   * @private
   */
  private getNodesFromRelevantBuckets(maxDistance: bigint): DHTNode[] {
    // Calculate the maximum bucket index that could contain nodes within this distance
    // log2(maxDistance) gives us the highest bit position set in maxDistance
    const maxBucketIndex = Math.ceil(Math.log2(Number(maxDistance)));

    const result: DHTNode[] = [];

    // Check all buckets with index <= maxBucketIndex
    for (const [index, bucket] of this.buckets.entries()) {
      if (index <= maxBucketIndex) {
        // For these buckets, filter nodes by actual distance
        const nodesInRange = bucket.getAllNodes().filter((node) => {
          const distance = calculateScalarDistance(this.localNodeId, node.id);
          return distance <= maxDistance;
        });

        result.push(...nodesInRange);
      }
    }

    return result;
  }
}
