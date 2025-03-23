import {
  type NodeId,
  calculateScalarDistance,
  compareDistances,
} from "../core";
import type { DHTNode, RoutingTable } from "../routing";
import type { LookupType } from "./kademlia-node.types";

/**
 * State maintained during a lookup operation
 */
export interface LookupState<TValue> {
  // Target ID we're looking for
  targetId: NodeId;
  // Nodes already queried
  queriedNodes: Set<string>;
  // Nodes in process of being queried
  pendingNodes: Set<string>;
  // Current closest nodes sorted by distance
  closestNodes: DHTNode[];
  // Value found during lookup (for findValue)
  foundValue: TValue | null;
  // Number of iterations completed
  iterations: number;
  // Whether progress was made in the last iteration
  progressMade: boolean;
  // Track if this is the first iteration
  isFirstIteration: boolean;
  // Closest distance seen so far
  closestDistanceSeen: bigint;
  // ID for tracking this lookup
  lookupId?: string;
  // Alpha parameter (concurrency)
  alpha: number;
  // K parameter (max nodes to return)
  k: number;
  // Maximum iterations
  maxIterations: number;
}

/**
 * Options for the iterative lookup operation
 */
export interface LookupOptions {
  alpha: number;
  k: number;
  maxIterations: number;
  lookupId?: string;
}

/**
 * Result of a lookup operation
 */
export interface LookupResult<TValue> {
  value: TValue | null;
  nodes: DHTNode[];
}

/**
 * Type for request tracking information
 */
export interface RequestTrackingInfo {
  type: LookupType;
  startTime: number;
  target: string;
  alpha: number;
  contacted: Set<string>;
}

/**
 * Manages iterative lookup operations for Kademlia DHT
 */
export class LookupManager {
  private localNodeId: NodeId;
  private routingTable: RoutingTable;
  private activeRequests: Map<string, RequestTrackingInfo>;

  /**
   * Create a new LookupManager
   *
   * @param localNodeId The ID of the local node
   * @param routingTable The routing table to use for node lookups
   * @param activeRequests Map for tracking active requests
   */
  constructor(
    localNodeId: NodeId,
    routingTable: RoutingTable,
    activeRequests: Map<string, RequestTrackingInfo>,
  ) {
    this.localNodeId = localNodeId;
    this.routingTable = routingTable;
    this.activeRequests = activeRequests;
  }

  /**
   * Performs an iterative lookup operation in the Kademlia DHT
   *
   * @param targetId The target node ID to look for
   * @param queryFn Function that queries a node and returns results
   * @param processResults Function to process query results
   * @param options Lookup options
   * @returns Lookup result containing found value and/or closest nodes
   */
  public async iterativeLookup<TValue, TQueryResult>(
    targetId: NodeId,
    queryFn: (node: DHTNode) => Promise<TQueryResult>,
    processResults: (result: TQueryResult) => {
      value?: TValue | null;
      nodes: DHTNode[];
    },
    options: LookupOptions,
  ): Promise<LookupResult<TValue>> {
    const state = this.initializeLookupState<TValue>(targetId, options);

    while (this.shouldContinueLookup(state)) {
      state.iterations++;
      state.isFirstIteration = state.iterations === 1;
      state.progressMade = false;

      const nodesToQuery = this.selectNodesToQuery(state);

      if (nodesToQuery.length === 0) {
        break;
      }

      await this.queryNodesAndProcessResults(
        nodesToQuery,
        targetId,
        queryFn,
        processResults,
        state,
      );

      if (state.foundValue !== null) {
        break;
      }

      this.updateClosestNodes(state);
    }

    return {
      value: state.foundValue,
      nodes: state.closestNodes.slice(0, state.k),
    };
  }

  /**
   * Initialize the state for a lookup operation
   */
  private initializeLookupState<TValue>(
    targetId: NodeId,
    options: LookupOptions,
  ): LookupState<TValue> {
    const closestNodes = this.routingTable.findClosestNodes(
      targetId,
      options.k,
    );
    let closestDistanceBefore = BigInt(0);

    if (closestNodes.length > 0) {
      closestDistanceBefore = calculateScalarDistance(
        targetId,
        closestNodes[0].id,
      );
    }

    return {
      targetId,
      queriedNodes: new Set<string>(),
      pendingNodes: new Set<string>(),
      closestNodes,
      foundValue: null,
      iterations: 0,
      progressMade: true, // Start as true to ensure first iteration
      isFirstIteration: true,
      closestDistanceSeen: closestDistanceBefore,
      lookupId: options.lookupId,
      alpha: options.alpha,
      k: options.k,
      maxIterations: options.maxIterations,
    };
  }

  /**
   * Determine if the lookup should continue
   */
  private shouldContinueLookup<TValue>(state: LookupState<TValue>): boolean {
    return (
      state.iterations < state.maxIterations &&
      (state.progressMade || state.isFirstIteration)
    );
  }

  /**
   * Select nodes to query in the current iteration
   */
  private selectNodesToQuery<TValue>(state: LookupState<TValue>): DHTNode[] {
    const nodesToQuery: DHTNode[] = [];

    for (const node of state.closestNodes) {
      const nodeIdHex = node.id.toHex();

      // Skip if already queried or is pending
      if (
        state.queriedNodes.has(nodeIdHex) ||
        state.pendingNodes.has(nodeIdHex)
      ) {
        continue;
      }

      nodesToQuery.push(node);
      state.pendingNodes.add(nodeIdHex);

      if (nodesToQuery.length >= state.alpha) {
        break;
      }
    }

    return nodesToQuery;
  }

  /**
   * Query nodes and process their results
   */
  private async queryNodesAndProcessResults<TValue, TQueryResult>(
    nodesToQuery: DHTNode[],
    targetId: NodeId,
    queryFn: (node: DHTNode) => Promise<TQueryResult>,
    processResults: (result: TQueryResult) => {
      value?: TValue | null;
      nodes: DHTNode[];
    },
    state: LookupState<TValue>,
  ): Promise<void> {
    const results = await Promise.all(
      nodesToQuery.map(async (node) => {
        const nodeIdHex = node.id.toHex();
        state.queriedNodes.add(nodeIdHex);
        state.pendingNodes.delete(nodeIdHex);

        // Track this node as contacted for the lookup
        if (state.lookupId) {
          const request = this.activeRequests.get(state.lookupId);
          if (request) {
            request.contacted.add(nodeIdHex);
          }
        }

        const result = await queryFn(node);
        return { node, result };
      }),
    );

    for (const { result } of results) {
      const { value, nodes } = processResults(result);

      // If value found, we're done
      if (value !== null && value !== undefined) {
        state.foundValue = value;
        return;
      }

      // Process returned nodes
      for (const newNode of nodes) {
        // Skip ourselves
        if (this.localNodeId.equals(newNode.id)) {
          continue;
        }

        // Skip if already queried, pending, or in our closest nodes list
        const nodeIdHex = newNode.id.toHex();
        if (
          state.queriedNodes.has(nodeIdHex) ||
          state.pendingNodes.has(nodeIdHex)
        ) {
          continue;
        }

        const alreadyInList = this.isNodeInList(newNode.id, state.closestNodes);

        if (!alreadyInList) {
          // Add to routing table and closest nodes list
          this.routingTable.addNode(newNode);
          state.closestNodes.push(newNode);

          // Check if this node is closer than any we've seen
          const distance = calculateScalarDistance(targetId, newNode.id);
          if (distance < state.closestDistanceSeen) {
            state.closestDistanceSeen = distance;
            state.progressMade = true;
          }
        }
      }
    }
  }

  /**
   * Update the list of closest nodes, sorting by distance and keeping only the k closest
   */
  private updateClosestNodes<TValue>(state: LookupState<TValue>): void {
    state.closestNodes.sort((a, b) =>
      compareDistances(state.targetId, a.id, b.id),
    );
    state.closestNodes = state.closestNodes.slice(0, state.k);
  }

  /**
   * Check if a node is in a list of nodes
   */
  private isNodeInList(nodeId: NodeId, list: DHTNode[]): boolean {
    return list.some((node) => node.id.equals(nodeId));
  }
}
