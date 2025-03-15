import { compareDistances } from "./distance";
import { type DHTNode, KBucket } from "./k-bucket";
import type { NodeId } from "./node-id";

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
};

/**
 * RoutingTable is a Kademlia routing table that stores nodes in a series of buckets.
 * the routing table is a binary tree of k-buckets, where each bucket is a list of nodes
 * with a specific range of XOR distances from the local node.
 */
export class RoutingTable {
  // id of the local node
  private readonly localNodeId: NodeId;

  // th bucket size (k)
  private readonly k: number;

  // the number of nodes to ping when a bucket becomes full
  private readonly pingCount: number;

  // the list of k-buckets
  private readonly buckets: Map<number, KBucket> = new Map();

  private readonly DEFAULT_K = 20 as const;

  private readonly DEFAULT_PING_COUNT = 3 as const;

  constructor(localNodeId: NodeId, options: RoutingTableOptions = {}) {
    this.localNodeId = localNodeId;
    this.k = options.k ?? this.DEFAULT_K;
    this.pingCount = options.pingCount ?? this.DEFAULT_PING_COUNT;

    // initialize the first bucket with cover the entire ID space
    this.buckets.set(
      0,
      new KBucket(localNodeId, {
        pingCount: this.pingCount,
        k: this.k,
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

    // calculate the prefix length of the node ID to determine which bucket to add it to.
    const prefixLength = this.localNodeId.commonPrefixLength(node.id);

    const bucket = this.getBucketFromPrefixLength(prefixLength);

    const nodesToPing = bucket.addNode(node);

    // if the bucket return nodes to ping, consider is full and try to split it
    if (nodesToPing.length > 0) {
      // TODO: implement bucket splitting
    }

    return nodesToPing;
  }

  /**
   * remove a node from the routing table
   * @param nodeId NodeId to remove
   * @returns true if the node was removed, false if the node was not found
   */
  removeNode(nodeId: NodeId): boolean {
    const prefixLength = this.localNodeId.commonPrefixLength(nodeId);
    const bucket = this.getBucketFromPrefixLength(prefixLength);

    return bucket.removeNode(nodeId);
  }

  /**
   * find a node in the routing table
   * @param nodeId NodeId to find
   * @returns the node if found, undefined if not found
   */
  findNode(nodeId: NodeId): DHTNode | undefined {
    const prefixLength = this.localNodeId.commonPrefixLength(nodeId);
    const bucket = this.getBucketFromPrefixLength(prefixLength);

    return bucket.findNode(nodeId);
  }

  /**
   * Find the k closest nodes to a target NodeId.
   * @param targetId Target NodeId
   * @param count Maximum number of nodes to return
   * @returns List of k closest nodes to the target NodeId
   */
  findClosestNodes(targetId: NodeId, count = this.k): DHTNode[] {
    const allNodes = this.getAllNodes();

    const sortedNodes = [...allNodes].sort((a, b) =>
      compareDistances(targetId, a.id, b.id),
    );

    return sortedNodes.slice(0, count);
  }

  /**
   * Update the last seen time of a node in the routing table.
   * @param nodeId NodeId to update
   */
  updateNodeTimestamp(nodeId: NodeId): void {
    const prefixLength = this.localNodeId.commonPrefixLength(nodeId);
    const bucket = this.getBucketFromPrefixLength(prefixLength);

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
   * Get the bucket from a prefix length.
   * @param _prefixLength Prefix length to get the bucket for
   * @returns KBucket for the prefix length
   */
  private getBucketFromPrefixLength(_prefixLength: number): KBucket {
    // biome-ignore lint/style/noNonNullAssertion: FIXME: Implement bucket splitting and remove this assertion
    return this.buckets.get(0)!;
  }
}
