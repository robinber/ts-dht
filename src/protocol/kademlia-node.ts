import { type NodeId, compareDistances } from "../core";
import { type DHTNode, RoutingTable } from "../routing";

const DEFAULT_TTL = 60 * 60 * 1000;
const DEFAULT_ALPHA = 3;
const DEFAULT_MAX_ITERATIONS = 20;

export type StoreValue = {
  value: Uint8Array;
  expiresAt: number;
};

export type KademliaNodeOptions = {
  address: `${string}:${number}`;
};

export class KademliaNode {
  private readonly nodeId: NodeId;
  private readonly routingTable: RoutingTable;
  private readonly storage: Map<string, StoreValue> = new Map();
  // private readonly address: string;
  private readonly k = 20 as const;

  constructor(nodeId: NodeId, options: KademliaNodeOptions) {
    this.nodeId = nodeId;
    // this.address = options.address;
    this.routingTable = new RoutingTable(nodeId);
  }

  // Core Kademlia operations
  async ping(nodeId: NodeId): Promise<boolean> {
    // Add implementation here with RPC calls
    return true;
  }

  async store(key: NodeId, value: Uint8Array, ttl?: number): Promise<boolean> {
    const keyHex = key.toHex();

    this.storage.set(keyHex, {
      value,
      expiresAt: ttl ? Date.now() + ttl : Number.MAX_SAFE_INTEGER,
    });

    // Add implementation here with RPC calls

    return true;
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
    alpha = DEFAULT_ALPHA,
    k = this.k,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  ): Promise<DHTNode[]> {
    const { nodes } = await this.iterativeLookup<never, DHTNode[]>(
      target,
      (node) => this.queryNode(node, target),
      (nodes) => ({ nodes }),
      {
        alpha,
        maxIterations,
        k,
      },
    );

    return nodes;
  }

  /**
   * Send a FIND_NODE request to a remote node
   * This is a placeholder for actual network communication
   * @param node Target node to query
   * @param target NodeId to find nodes closest to
   * @returns Array of nodes returned by the target
   */
  async queryNode(node: DHTNode, target: NodeId): Promise<DHTNode[]> {
    try {
      // TODO: Implement the actual RPC call
      // 1. Serialize the request
      // 2. Send it to the node using its address
      // 3. Wait for and parse the response
      // 4. Return the nodes from the response

      // For now, we'll return an empty array
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
    alpha = 3,
    k = this.k,
    maxIterations = 20,
  ): Promise<Uint8Array | null> {
    const keyHex = key.toHex();

    const localValue = this.storage.get(keyHex);

    if (localValue) {
      if (localValue.expiresAt < Date.now()) {
        this.storage.delete(keyHex);
      } else {
        return localValue.value;
      }
    }

    const result = await this.iterativeLookup<
      Uint8Array,
      { value: Uint8Array | null; closestNodes: DHTNode[] }
    >(
      key,
      (node) => this.queryNodeForValue(node, key),
      (queryResult) => ({
        value: queryResult.value,
        nodes: queryResult.closestNodes,
      }),
      {
        alpha,
        k,
        maxIterations,
      },
    );

    if (result.value !== null) {
      this.storage.set(keyHex, {
        value: result.value,
        expiresAt: Date.now() + DEFAULT_TTL,
      });
    }

    return result.value;
  }

  addNode(node: DHTNode): DHTNode[] {
    return this.routingTable.addNode(node);
  }

  /**
   * Query a node for a value by key
   * This is a placeholder for the actual RPC call implementation
   * @param node Node to query
   * @param key Key to look for
   * @returns Object containing the value if found, and closest nodes otherwise
   */
  async queryNodeForValue(
    node: DHTNode,
    key: NodeId,
  ): Promise<{ value: Uint8Array | null; closestNodes: DHTNode[] }> {
    try {
      // TODO: Implement the actual RPC call
      // 1. Send a FIND_VALUE RPC to the node
      // 2. The node would check its local storage for the key
      // 3. If found, it would return the value
      // 4. If not found, it would return its k closest nodes to the key

      return { value: null, closestNodes: [] };
    } catch (error) {
      console.error(
        `Failed to query node ${node.id.toHex()} for value:`,
        error,
      );
      return { value: null, closestNodes: [] };
    }
  }

  private isNodeInList(nodeId: NodeId, list: DHTNode[]): boolean {
    return list.some((node) => node.id.equals(nodeId));
  }

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
    },
  ): Promise<{ value: TValue | null; nodes: DHTNode[] }> {
    const { alpha, k, maxIterations } = options;
    const queriedNodes = new Set<string>();
    const closestNodes = this.routingTable.findClosestNodes(targetId, k);

    let currentClosestNodes = [...closestNodes];
    let foundValue: TValue | null = null;
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      const nodesToQuery: DHTNode[] = [];

      for (const node of currentClosestNodes) {
        const nodeIdHex = node.id.toHex();

        if (queriedNodes.has(nodeIdHex)) {
          continue;
        }

        nodesToQuery.push(node);

        if (nodesToQuery.length >= alpha) {
          break;
        }
      }

      if (nodesToQuery.length === 0) {
        break;
      }

      const results = await Promise.all(
        nodesToQuery.map((node) => {
          queriedNodes.add(node.id.toHex());
          return queryFn(node);
        }),
      );

      let foundCloserNodes = false;

      for (const result of results) {
        const { value, nodes } = processResults(result);

        if (value !== null && value !== undefined) {
          foundValue = value;
          break;
        }

        for (const newNode of nodes) {
          if (this.nodeId.equals(newNode.id)) {
            continue;
          }

          const alreadyInList = this.isNodeInList(
            newNode.id,
            currentClosestNodes,
          );

          if (!alreadyInList) {
            this.routingTable.addNode(newNode);
            currentClosestNodes.push(newNode);
            foundCloserNodes = true;
          }
        }
      }

      if (foundValue !== null) {
        break;
      }

      if (!foundCloserNodes) {
        break;
      }

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
