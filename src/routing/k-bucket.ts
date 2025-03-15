import { type NodeId, compareDistances } from "../core";

export type DHTNode = {
  id: NodeId;
  /**
   * The IP address and port with format "ip:port".
   */
  address: `${string}:${number}`;
  /**
   * The last time this node was seen. This is used to determine which nodes
   * to ping when a bucket becomes full
   */
  lastSeen?: number;
};

export type KBucketOptions = {
  /**
   * The bucket size parameter (k) from the Kademlia paper.
   * This is the maximum number of nodes that can be stored in a bucket.
   */
  k?: number;

  /**
   * The number of nodes to ping when a bucket becomes full and a new node
   * wants to be inserted. These are taken from the least recently seen nodes.
   */
  pingCount?: number;
};

export class KBucket {
  // Default k value as specified in the Kademlia paper
  private static readonly DEFAULT_K = 20 as const;

  // Default number of nodes to ping when a bucket becomes full
  private static readonly DEFAULT_PING_COUNT = 3 as const;

  // localNodeId is the ID of the local node
  private readonly localNodeId: NodeId;

  // the bucket size (k)
  private readonly k: number;

  // the number of nodes to ping when a bucket becomes full
  private readonly pingCount: number;

  // the bucket of nodes
  private nodes: DHTNode[] = [];

  constructor(localNodeId: NodeId, options: KBucketOptions = {}) {
    this.localNodeId = localNodeId;
    this.k = options.k ?? KBucket.DEFAULT_K;
    this.pingCount = options.pingCount ?? KBucket.DEFAULT_PING_COUNT;
  }

  getAllNodes(): DHTNode[] {
    return [...this.nodes];
  }

  size(): number {
    return this.nodes.length;
  }

  isFull(): boolean {
    return this.size() >= this.k;
  }

  findNode(nodeId: NodeId): DHTNode | undefined {
    return this.nodes.find((node) => node.id.equals(nodeId));
  }

  updateNodeTimestamp(nodeId: NodeId): void {
    const node = this.findNode(nodeId);

    if (!node) {
      return;
    }

    node.lastSeen = Date.now();

    this.nodes = this.nodes.filter((node) => !node.id.equals(nodeId));
    this.nodes.push(node);
  }

  /**
   * Adds or updates a node in the bucket.
   * If the node exists, it updates the lastSeen timestamp and moves it to the end.
   * If the bucket is full, it returns the least recently seen nodes to ping.
   *
   * @param node The node to add or update
   * @returns The least recently seen nodes if the bucket is full, empty array otherwise
   */
  addNode(node: DHTNode): DHTNode[] {
    // Don't add the local node to its own bucket
    if (node.id.equals(this.localNodeId)) {
      return [];
    }

    if (!node.lastSeen) {
      node.lastSeen = Date.now();
    }

    const existingNode = this.findNode(node.id);
    if (existingNode) {
      this.updateNodeTimestamp(existingNode.id);

      return [];
    }

    if (!this.isFull()) {
      this.nodes.push(node);

      return [];
    }

    return this.nodes.slice(0, this.pingCount);
  }

  /**
   * Removes a node from the bucket.
   *
   * @param nodeId The ID of the node to remove
   * @returns True if the node was removed, false otherwise
   */
  removeNode(nodeId: NodeId): boolean {
    const originalSize = this.size();

    this.nodes = this.nodes.filter((node) => !node.id.equals(nodeId));

    return this.size() < originalSize;
  }

  /**
   * Finds the k closest nodes to a target node ID.
   *
   * @param targetNodeId The target node ID
   * @param count The number of nodes to return, defaults to k
   * @returns The k closest nodes to the target node ID sorted by distance
   */
  findClosestNodes(targetNodeId: NodeId, count = this.k): DHTNode[] {
    return [...this.nodes]
      .sort((a, b) => compareDistances(targetNodeId, a.id, b.id))
      .slice(0, count);
  }

  /**
   * Check if the bucket contains a node with the given ID.
   *
   * @param nodeId The ID of the node to check
   * @returns True if the node is in the bucket, false otherwise
   */
  contains(nodeId: NodeId): boolean {
    return this.nodes.some((node) => node.id.equals(nodeId));
  }
}
